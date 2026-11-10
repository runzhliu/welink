import gc
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import random
import socket
import subprocess
import sys
import threading
import time
import urllib.request

from .common import acquire_device_lock, WorkerError, atomic_json, fingerprint, load_json
from .engines import base_content_hash, read_rows, snapshot
from .labels import factory_encode, factory_processor, install_factory_contract, tokenizer_manifest


class Inference:
    def __init__(self, config, path, adapter=None):
        self.config = config
        self.model_path = path
        self.lock = threading.Lock()
        if config["engine"] == "mlx":
            import mlx.core as mx
            from mlx_lm import load
            self.model, self.tokenizer = load(str(path), adapter_path=str(adapter) if adapter else None, tokenizer_config={"trust_remote_code": False}, trust_remote_code=False)
            # MLX loading can leave lazy operations bound to the loading
            # thread's CPU stream. HTTP requests run in different threads, so
            # materialize the weights before handing the model to the server.
            mx.eval(self.model.parameters())
        else:
            from llamafactory.chat import ChatModel
            args = {"model_name_or_path": str(path), "template": config["template"], "finetuning_type": "lora", "trust_remote_code": False, "infer_backend": "huggingface", "enable_thinking": False}
            if adapter:
                args["adapter_name_or_path"] = str(adapter)
            self.chat_model = ChatModel(args)
            self.tokenizer = self.chat_model.engine.tokenizer

    def stream(self, messages, max_tokens=256, temperature=0):
        with self.lock:
            if self.config["engine"] == "mlx":
                import mlx.core as mx
                from mlx_lm import stream_generate
                from mlx_lm.sample_utils import make_sampler
                mx.random.seed(self.config["seed"])
                prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                for response in stream_generate(self.model, self.tokenizer, prompt, max_tokens=max_tokens, sampler=make_sampler(temp=temperature)):
                    yield response.text
            else:
                import torch
                torch.manual_seed(self.config["seed"])
                system = messages[0]["content"] if messages[0]["role"] == "system" else None
                body = messages[1:] if system is not None else messages
                yield from self.chat_model.stream_chat(body, system=system, max_new_tokens=max_tokens, do_sample=temperature > 0, temperature=max(temperature, 1e-5))

    def loss(self, rows):
        if self.config["engine"] == "mlx":
            from mlx_lm.tuner.datasets import ChatDataset, CacheDataset
            from mlx_lm.tuner.trainer import evaluate
            return float(evaluate(self.model, CacheDataset(ChatDataset(rows, self.tokenizer, mask_prompt=True)), batch_size=1, num_batches=-1, max_seq_length=self.config["sequence_length"]))
        import torch
        install_factory_contract()
        processor = factory_processor(self.tokenizer, self.config)
        model = self.chat_model.engine.model
        total, count = 0, 0
        model.eval()
        with torch.no_grad():
            for row in rows:
                ids, labels = factory_encode(processor, row["messages"])
                tokens = torch.tensor([ids], device=model.device)
                target = torch.tensor([labels], device=model.device)
                output = model(input_ids=tokens, labels=target)
                n = sum(label != -100 for label in labels[1:])
                total += float(output.loss) * n
                count += n
        return total / max(1, count)

    def close(self):
        if self.config["engine"] == "mlx":
            import mlx.core as mx
            del self.model
            gc.collect()
            mx.clear_cache()
        else:
            import torch
            del self.chat_model
            gc.collect()
            torch.cuda.empty_cache()


def verify_adapter(root, config, tokenizer, model_path):
    manifest = load_json(root / "resume/welink_manifest.json")
    if not manifest or manifest["model"] != config["model"] or manifest["model_revision"] != config["revision"] or manifest["engine"] != config["engine"]:
        raise WorkerError("适配器与基础模型的精确版本不匹配")
    # LLaMA-Factory applies its selected template during ChatModel construction.
    current = tokenizer_manifest(tokenizer)
    if any(current[k] != manifest[k] for k in ("tokenizer_hash", "template_hash")):
        raise WorkerError("适配器的 tokenizer / chat template 与推理环境不匹配")
    if base_content_hash(model_path) != manifest.get("base_content_hash"):
        raise WorkerError("基础模型缓存内容已改变，请重新校验精确权重版本")
    return manifest


def evaluate(root, job, journal):
    from .labels import compile_rows, mlx_encode
    config = job["config"]
    path = snapshot(config)
    raw = read_rows(root / "test.jsonl")
    random.Random(config["seed"]).shuffle(raw)
    rows = raw[:50]
    baseline = Inference(config, path)
    verify_adapter(root, config, baseline.tokenizer, path)
    if config["engine"] == "mlx":
        encode = lambda messages: mlx_encode(baseline.tokenizer, messages)
    else:
        processor = factory_processor(baseline.tokenizer, config)
        encode = lambda messages: factory_encode(processor, messages)
    rows, stats = compile_rows(rows, encode, config["sequence_length"])
    if not rows:
        raise WorkerError("固定测试集没有通过长度校验的样本")
    cases = [{"id": fingerprint(row), "messages": row["messages"][:-1], "reference": row["messages"][-1]["content"]} for row in rows]
    summary = {"sample_count": len(cases), "length_filtered": stats["excluded_oversize"], "seed": config["seed"], "temperature": 0, "max_tokens": 256, "evidence": "样本不足，仅供试用" if len(cases) < 30 else "固定测试集的描述性比较，不是绝对质量评分"}
    for label in ("baseline", "tuned"):
        runner = baseline if label == "baseline" else Inference(config, path, root / "resume")
        summary[label + "_holdout_loss"] = runner.loss(rows)
        for i, case in enumerate(cases):
            journal.check_stop()
            started = time.monotonic()
            try:
                # The reference is deliberately excluded from generation input.
                case[label] = "".join(runner.stream(case["messages"], 256, 0))
                case[label + "_seconds"] = time.monotonic() - started
            except Exception as exc:
                case[label] = ""
                case[label + "_error"] = type(exc).__name__ + "：推理失败，详见机器本地日志"
            journal.metric({"evaluation_completed": i + 1, "evaluation_total": len(cases), "phase": label})
        runner.close()
    # This is a reproduction check, not a privacy guarantee. No external judge API.
    training = [r["messages"][-1]["content"] for r in read_rows(root / "train.jsonl")]
    for case in cases:
        case["leakage"] = [text[:120] for text in training if len(text) >= 32 and text in case.get("tuned", "")][:3]
    for label in ("baseline", "tuned"):
        values = [c[label] for c in cases]
        summary[label + "_empty"] = sum(not text.strip() for text in values)
        summary[label + "_mean_length"] = sum(map(len, values)) / len(values)
        summary[label + "_repeated"] = sum(len(text) > 20 and len(set(text)) < len(text) / 8 for text in values)
    return {"state": "succeeded", "cases": cases, "summary": summary}


def serve(spec_path):
    domain = acquire_device_lock()
    spec = load_json(spec_path)
    root = Path(spec_path).parent
    config = spec["job"]["config"]
    runner = Inference(config, snapshot(config), root / "resume")
    verify_adapter(root, config, runner.tokenizer, runner.model_path)
    port = spec["serve_port"]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log prompts, credentials or completions.

        def do_GET(self):
            self.send_response(200 if self.path == "/health" else 404)
            self.end_headers()

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 2 << 20:
                    raise WorkerError("request size")
                body = json.loads(self.rfile.read(length))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for text in runner.stream(body["messages"], min(body.get("max_tokens", 512), 2048), body.get("temperature", 0)):
                    chunk = {"id": "welink-sft", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": text}}]}
                    self.wfile.write(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode())
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                # A structured error is forwarded by the authenticated tunnel.
                self.wfile.write(b'data: {"error":"SFT inference failed"}\n\n')
                self.wfile.flush()

    def offline_guard():
        while True:
            marker = root.parents[1] / "last-contact.json"
            if marker.exists() and time.time() - marker.stat().st_mtime > load_json(marker, {}).get("grace", 600):
                os._exit(0)
            time.sleep(2)
    threading.Thread(target=offline_guard, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    atomic_json(root / "serving.json", {"pid": os.getpid(), "port": port})
    server.serve_forever()


def deploy(root, job, journal):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    spec = load_json(root / "spec.json")
    spec["serve_port"] = port
    atomic_json(root / "serve-spec.json", spec)
    log = open(root / "serve.log", "ab")
    os.chmod(root / "serve.log", 0o600)
    process = subprocess.Popen([sys.executable, "-m", "welink_worker.engine", "--serve", str(root / "serve-spec.json")], stdout=log, stderr=log, start_new_session=True)
    from .daemon import process_identity
    atomic_json(root / "serve-process.json", {"pid": process.pid, "identity": process_identity(process.pid)})
    try:
        for _ in range(180):
            journal.check_stop()
            if process.poll() is not None:
                raise RuntimeError("推理服务启动失败，请检查 worker 的 serve.log")
            try:
                with urllib.request.urlopen("http://127.0.0.1:" + str(port) + "/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(1)
        else:
            raise TimeoutError("推理服务启动超时")
        req = urllib.request.Request("http://127.0.0.1:" + str(port) + "/v1/chat/completions", data=json.dumps({"messages": [{"role": "user", "content": "你好，请用一句话回复。"}], "stream": True, "max_tokens": 16, "temperature": 0}).encode(), headers={"Content-Type": "application/json"})
        got_chunk, done = False, False
        with urllib.request.urlopen(req, timeout=120) as response:
            for line in response:
                if line.startswith(b"data: "):
                    payload = line[6:].strip()
                    if payload == b"[DONE]":
                        done = True
                    else:
                        row = json.loads(payload)
                        if row.get("error"):
                            raise RuntimeError("流式推理检查失败")
                        got_chunk = got_chunk or bool(row.get("choices"))
        if not got_chunk or not done:
            raise RuntimeError("流式推理没有产生完整回执")
        return {"state": "succeeded", "healthy": True, "streaming": True}
    except BaseException:
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            process.kill()
        raise
    finally:
        log.close()
