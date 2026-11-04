import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
import urllib.error
from unittest.mock import patch

from welink_worker.client import Client
from welink_worker.common import Journal, StopTraining, WorkerError, acquire_device_lock, archive_files, atomic_json, capabilities, safe_extract, sha_file
from welink_worker.daemon import Daemon, stop_owned, process_identity
from welink_worker.labels import compile_rows, strict_final_labels


class WorkerContracts(unittest.TestCase):
    def test_final_labels_mask_history_prompt_and_keep_complete_target(self):
        tokens = [1, 20, 2, 30, 2, 40, 2, 50, 51, 2]
        labels = strict_final_labels(tokens, [50, 51, 2])
        self.assertEqual(labels, [-100] * 7 + [50, 51, 2])
        self.assertTrue(all(x == -100 for x in labels[:7]))
        for target in ([], [50, 51], tokens):
            with self.assertRaises(ValueError):
                strict_final_labels(tokens, target)

    def test_length_compilation_trims_old_history_and_never_truncates_reply(self):
        def encode(messages):
            tokens = [ord(ch) for m in messages for ch in m["content"]]
            final = [ord(ch) for ch in messages[-1]["content"]]
            return tokens, strict_final_labels(tokens, final)
        history = [{"role": "user", "content": "old context"}, {"role": "assistant", "content": "old response"}, {"role": "user", "content": "new"}, {"role": "assistant", "content": "complete target"}]
        rows, stats = compile_rows([{"messages": history}], encode, 20)
        self.assertEqual(rows[0]["messages"], history[-2:])
        self.assertEqual(stats["trimmed_history_turns"], 1)
        rows, stats = compile_rows([{"messages": history[-2:]}], encode, 10)
        self.assertEqual(rows, [])
        self.assertEqual(stats["excluded_oversize"], 1)

    def test_arch_and_pinned_dependency_probe_does_not_assume_macos_means_metal(self):
        with tempfile.TemporaryDirectory() as root, patch("platform.system", return_value="Darwin"), patch("platform.machine", return_value="x86_64"):
            result = capabilities(root)
            self.assertFalse(result["engines"]["mlx"]["available"])
            self.assertIn("arm64", result["engines"]["mlx"]["reason"])
            self.assertEqual(result["engines"]["mlx"]["resume"], "weights_only")

    def test_cuda_visible_device_mask_preserves_physical_selection(self):
        with tempfile.TemporaryDirectory() as root, patch("platform.system", return_value="Linux"), patch("importlib.metadata.version", return_value="0.9.5"), patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "2,7"}):
            torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, device_count=lambda: 2, mem_get_info=lambda i: (1024, 2048), get_device_name=lambda i: "test device"))
            with patch.dict(sys.modules, {"torch": torch}):
                result = capabilities(root)
            self.assertEqual([device["id"] for device in result["devices"]], ["2", "7"])
            self.assertTrue(result["engines"]["llamafactory"]["available"])

    def test_remote_http_and_embedded_credentials_are_rejected(self):
        for url in ("http://gpu.example.com", "https://user:secret@server.example.com", "file:///etc/passwd", "https://server/?token=secret"):
            with self.assertRaises(ValueError):
                Client(url)
        Client("http://127.0.0.1:8080")
        Client("https://server.example.com")

    def test_checkpoint_extraction_rejects_links_and_parent_traversal(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            for name, kind in (("../../outside", tarfile.REGTYPE), ("linked", tarfile.SYMTYPE)):
                archive = root / "bad.tar"
                with tarfile.open(archive, "w") as tar:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/etc/passwd"
                    member.size = 1 if kind == tarfile.REGTYPE else 0
                    tar.addfile(member, io.BytesIO(b"x"))
                with self.assertRaises(ValueError):
                    safe_extract(archive, root / "target")
            self.assertFalse((root.parent / "outside").exists())

    def test_atomic_secrets_and_regular_artifact_roundtrip(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "secret.json", {"token": "private"})
            self.assertEqual(os.stat(root / "secret.json").st_mode & 0o777, 0o600)
            archive_files(root / "adapter.tar", root, [root / "secret.json"])
            safe_extract(root / "adapter.tar", root / "out")
            self.assertEqual(json.loads((root / "out/secret.json").read_text()), {"token": "private"})
            self.assertEqual(os.stat(root / "out/secret.json").st_mode & 0o777, 0o600)

    def test_outbox_retries_same_sequence_after_lost_ack(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "credentials.json", {"server": "http://127.0.0.1:8080", "token": "private", "worker_id": "w"})
            daemon = Daemon(root)
            accepted = {}
            class LostAck:
                first = True
                def call(self, method, path, value):
                    event = value["event"]
                    if event["seq"] in accepted:
                        self_test.assertEqual(accepted[event["seq"]], event)
                    accepted[event["seq"]] = event
                    if self.first:
                        self.first = False
                        raise OSError("ack lost")
                    return {"ok": True}
            self_test = self
            daemon.client = LostAck()
            state = {"job": {"id": "j", "attempt": "a", "fence": "f"}, "offset": 0, "seq": 0}
            event = {"seq": 1, "type": "metric", "data": {"loss": 1.2}}
            with self.assertRaises(OSError):
                daemon.send_event(root, state, event, 100)
            recovered = json.loads((root / "daemon.json").read_text())
            daemon.flush_pending(root, recovered)
            self.assertEqual(len(accepted), 1)
            self.assertEqual(recovered["seq"], 1)
            self.assertEqual(recovered["offset"], 100)
            self.assertIsNone(recovered["pending"])
            daemon.pool.shutdown()

    def test_only_owned_process_group_can_be_stopped(self):
        with patch("welink_worker.daemon.process_identity", return_value="different process"), patch("os.killpg") as kill:
            stop_owned({"pid": 12345, "identity": "original process"}, force=True)
            kill.assert_not_called()

    def test_nan_and_stop_are_not_success_metrics(self):
        with tempfile.TemporaryDirectory() as root:
            journal = Journal(root, 60)
            with self.assertRaises(ValueError):
                journal.metric({"loss": float("nan")})
            self.assertFalse((Path(root) / "engine-events.jsonl").exists())
            (Path(root) / "cancel").touch()
            with self.assertRaises(StopTraining):
                journal.metric({"loss": 1.2, "optimizer_step": 2})
            self.assertEqual(json.loads((Path(root) / "engine-events.jsonl").read_text())["data"]["optimizer_step"], 2)

    def test_factory_contract_masks_earlier_eos_in_production_processor(self):
        # Isolate the real adapter patch from heavy CUDA dependencies; optional
        # installed-engine tests exercise the identical patch with real tokens.
        from welink_worker.labels import install_factory_contract
        class Processor:
            def _encode_data_example(self, *args):
                return [1, 2, 3, 4, 5, 6, 7], [-100, 2, 3, -100, 5, 6, 7]
        modules = {"llamafactory": SimpleNamespace(), "llamafactory.data": SimpleNamespace(), "llamafactory.data.processor": SimpleNamespace(), "llamafactory.data.processor.supervised": SimpleNamespace(SupervisedDatasetProcessor=Processor)}
        with patch.dict(sys.modules, modules):
            install_factory_contract()
            processor = Processor()
            processor.template = SimpleNamespace(encode_multiturn=lambda *a: [([1], [2, 3]), ([4], [5, 6])], efficient_eos=True)
            processor.tokenizer = SimpleNamespace(eos_token_id=7)
            processor.data_args = SimpleNamespace(cutoff_len=64)
            ids, labels = processor._encode_data_example([], [], None, None, [], [], [])
            self.assertEqual(labels, [-100, -100, -100, -100, 5, 6, 7])

    def test_device_domain_is_held_by_engine_until_exit(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "device.lock"
            first = acquire_device_lock(path)
            try:
                with self.assertRaisesRegex(ValueError, "已有 WeLink"):
                    acquire_device_lock(path)
            finally:
                first.close()
            second = acquire_device_lock(path)
            second.close()

    def test_heartbeat_accepts_stop_while_main_loop_is_busy_transferring(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "credentials.json", {"server": "http://127.0.0.1:8080", "token": "private", "worker_id": "w"})
            daemon = Daemon(root)
            class Heartbeat:
                def call(self, *args):
                    return {"active": [{"id": "job_cancel", "cancel": True}], "deployments": [], "offline_grace_seconds": 30}
            daemon.client = Heartbeat()
            daemon.heartbeat_once()
            self.assertTrue((root / "jobs/job_cancel/cancel").exists())
            self.assertEqual(json.loads((root / "last-contact.json").read_text())["grace"], 30)
            daemon.pool.shutdown()

    def test_reconnect_to_spawned_process_does_not_create_another_engine(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "credentials.json", {"server": "http://127.0.0.1:8080", "token": "private", "worker_id": "w"})
            daemon = Daemon(root)
            job = {"id": "j", "cancel": False}
            job_root = root / "jobs/j"
            atomic_json(job_root / "daemon.json", {"job": job, "phase": "spawning", "seq": 0, "offset": 0})
            atomic_json(job_root / "process.json", {"pid": 1234, "identity": "same engine"})
            with patch("welink_worker.daemon.alive", return_value=True), patch.object(daemon, "spawn") as spawn:
                daemon.observe(job)
                spawn.assert_not_called()
            self.assertEqual(json.loads((job_root / "daemon.json").read_text())["phase"], "running")
            daemon.pool.shutdown()

    def test_complete_partial_download_recovers_after_lost_final_ack(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "adapter.tar"
            partial = target.with_suffix(".tar.partial")
            partial.write_bytes(b"complete artifact")
            checksum = sha_file(partial)
            client = Client("http://127.0.0.1:8080")
            def complete_range(*args, **kwargs):
                raise urllib.error.HTTPError("http://127.0.0.1/artifact", 416, "range complete", {"X-SHA256": checksum}, io.BytesIO())
            client.request = complete_range
            client.download("/artifact", target, checksum)
            self.assertEqual(target.read_bytes(), b"complete artifact")
            self.assertFalse(partial.exists())

    def test_template_contract_failure_is_not_reported_as_oversize_data(self):
        def invalid(messages):
            raise WorkerError("模板不兼容")
        with self.assertRaisesRegex(WorkerError, "模板不兼容"):
            compile_rows([{"messages": [{"role": "user", "content": "输入"}, {"role": "assistant", "content": "完整回复"}]}], invalid, 100)

    def test_permanent_data_validation_error_fails_without_starting_engine(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "credentials.json", {"server": "http://127.0.0.1:8080", "token": "private", "worker_id": "w"})
            daemon = Daemon(root)
            recorded = []
            class Recorder:
                def call(self, method, path, value):
                    recorded.append(value["event"])
                    return {"ok": True}
            daemon.client = Recorder()
            job = {"id": "j", "last_seq": 0, "attempt": "a", "fence": "f"}
            error = urllib.error.HTTPError("http://127.0.0.1/data", 422, "checksum mismatch", {}, io.BytesIO())
            with patch.object(daemon, "prepare_files", side_effect=error), patch.object(daemon, "spawn") as spawn:
                daemon.start(job)
                spawn.assert_not_called()
            self.assertEqual(recorded[0]["type"], "error")
            self.assertEqual(json.loads((root / "jobs/j/daemon.json").read_text())["phase"], "finished")
            daemon.pool.shutdown()

    def test_zombie_process_is_not_treated_as_running(self):
        with patch("subprocess.check_output", return_value="Z  Sat Oct 24 12:00:00 2026\n"):
            self.assertEqual(process_identity(1234), "")
        with patch("subprocess.check_output", return_value="Ss Sat Oct 24 12:00:00 2026\n"):
            self.assertEqual(process_identity(1234), "Sat Oct 24 12:00:00 2026")

    def test_result_file_does_not_acknowledge_a_still_running_process(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "credentials.json", {"server": "http://127.0.0.1:8080", "token": "private", "worker_id": "w"})
            daemon = Daemon(root)
            job = {"id": "j", "cancel": False}
            job_root = root / "jobs/j"
            atomic_json(job_root / "daemon.json", {"job": job, "seq": 0, "offset": 0, "phase": "running", "process": {"pid": 1234, "identity": "running"}})
            atomic_json(job_root / "result.json", {"state": "succeeded"})
            with patch("welink_worker.daemon.alive", return_value=True), patch.object(daemon, "send_event") as send:
                daemon.observe(job)
                send.assert_not_called()
            daemon.pool.shutdown()

    def test_partial_weights_are_not_advertised_as_recovery_artifacts(self):
        from welink_worker.recovery import recover_artifacts
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            atomic_json(root / "manifest.json", {"model": "org/model"})
            atomic_json(root / "adapter/adapter_config.json", {"fine_tune_type": "lora"})
            (root / "adapter/adapters.safetensors").write_bytes(b"partial")
            self.assertEqual(recover_artifacts(root, {"kind": "train", "config": {"engine": "mlx"}}), [])


if __name__ == "__main__":
    unittest.main()
