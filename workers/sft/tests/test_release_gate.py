import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[3] / "scripts/check_sft_release.py"
spec = importlib.util.spec_from_file_location("sft_release_gate", path)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ReleaseGate(unittest.TestCase):
    def test_pending_matrix_cannot_release_0_4_but_allows_development(self):
        self.assertTrue(gate.validate("v0.4.0", {}, lambda _: False))
        self.assertTrue(gate.validate("v4.0.0", {}, lambda _: False))
        self.assertFalse(gate.validate("dev-abcd", {}, lambda _: False))
        self.assertFalse(gate.validate("v0.4.0-rc.1", {}, lambda _: False))
        self.assertFalse(gate.validate("v0.3.0", {}, lambda _: False))

    def test_code_changes_invalidate_recorded_hardware_evidence(self):
        entry = {key: True for key in ("tested_commit", "executed_at", "reviewer", "hardware", "model_id", "model_revision", "dataset_sha256", "worker_versions", "training_job", "evaluation_job", "deployment", "real_training", "labels_and_padding", "stop_and_resume", "streaming", "default_and_rollback", "failure_injection", "full_state_continuity")}
        matrix = {"mlx": entry, "cuda": entry, "visual_review": {key: True for key in ("desktop", "mobile_390", "light_dark", "keyboard", "privacy_mode", "reviewer")}}
        self.assertEqual(gate.validate("v4.0.0", matrix, lambda _: False), [])
        self.assertTrue(gate.validate("v4.0.0", matrix, lambda _: True))
