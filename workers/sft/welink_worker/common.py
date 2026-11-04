import hashlib
import fcntl
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import tarfile
import time


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".pending")
    with open(tmp, "w", encoding="utf-8") as f:
        os.chmod(tmp, 0o600)
        json.dump(value, f, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def capabilities(root):
    versions = {}
    for name in ("mlx-lm", "mlx", "llamafactory", "torch", "transformers", "peft"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    metal, cuda, devices = False, False, []
    mlx_reason = "需要原生 arm64 Python、Apple Silicon / Metal 和 mlx-lm 0.32.2"
    gpu_reason = "需要 Linux、NVIDIA CUDA 和 LLaMA-Factory 0.9.5"
    if platform.system() == "Darwin" and platform.machine() == "arm64" and versions.get("mlx-lm") == "0.32.2":
        try:
            import mlx.core as mx
            metal = bool(mx.metal.is_available())
            if metal:
                devices.append({"id": "metal", "name": "Apple Silicon", "info": mx.metal.device_info()})
        except Exception:
            metal = False
            mlx_reason = "Metal 初始化失败，请检查隔离环境"
    if platform.system() == "Linux" and versions.get("llamafactory") == "0.9.5":
        try:
            import torch
            cuda = torch.cuda.is_available()
            mask = [item.strip() for item in os.environ.get("CUDA_VISIBLE_DEVICES", "").split(",") if item.strip()]
            if mask and not all(item.isdecimal() for item in mask):
                cuda = False
                gpu_reason = "首版需要数字 GPU 编号，请在 CUDA_VISIBLE_DEVICES 中使用受授权的数字设备编号"
            for i in range(torch.cuda.device_count()):
                free, total = torch.cuda.mem_get_info(i)
                devices.append({"id": mask[i] if i < len(mask) else str(i), "name": torch.cuda.get_device_name(i), "free_bytes": free, "total_bytes": total})
        except Exception:
            cuda = False
            gpu_reason = "CUDA 初始化失败，请检查驱动与 PyTorch"
    disk = shutil.disk_usage(root)
    return {"protocol": 1, "worker_version": "1.0.0", "os": platform.system(), "arch": platform.machine(), "python": platform.python_version(), "versions": versions, "devices": devices, "free_disk_bytes": disk.free,
            "engines": {"mlx": {"available": metal, "reason": "" if metal else mlx_reason, "resume": "weights_only"}, "llamafactory": {"available": cuda, "reason": "" if cuda else gpu_reason, "resume": "full_state"}}}


def safe_extract(archive, target):
    """Accept only regular artifacts, with an expansion budget. Never links/pickle execution."""
    target = Path(target).resolve()
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(archive, "r:") as tar:
        members = tar.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 64 << 30:
            raise ValueError("检查点解包超过限制")
        for member in members:
            dest = (target / member.name).resolve()
            if not dest.is_relative_to(target) or not member.isfile() or member.size < 0:
                raise ValueError("检查点包含非法路径或非普通文件")
        for member in members:
            dest = target / member.name
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with tar.extractfile(member) as source, open(dest, "wb") as out:
                os.chmod(dest, 0o600)
                shutil.copyfileobj(source, out)


def archive_files(target, root, paths):
    root = Path(root).resolve()
    with tarfile.open(target, "w:") as tar:
        os.chmod(target, 0o600)
        for path in sorted(set(Path(p).resolve() for p in paths)):
            if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
                raise ValueError("产物路径不安全")
            tar.add(path, arcname=str(path.relative_to(root)), recursive=False)


class StopTraining(Exception):
    pass


class WorkerError(ValueError):
    """An explicitly user-facing validation error, containing no source text."""
    pass


class SequenceTooLong(WorkerError):
    pass


def acquire_device_lock(path=None):
    path = Path(path) if path else Path.home() / ".cache/welink-sft/device.lock"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = open(path, "a")
    os.chmod(path, 0o600)
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise WorkerError("本机已有 WeLink 训练或推理进程，资源尚未释放；请先停止原任务") from None
    return handle


class Journal:
    """The engine writes locally first. The daemon retries exact events in order."""
    def __init__(self, root, budget):
        self.root = Path(root)
        self.started = time.monotonic()
        self.budget = budget
        self.seq = 0
        self.events = self.root / "engine-events.jsonl"

    def emit(self, kind, data):
        self.seq += 1
        row = {"seq": self.seq, "type": kind, "data": data}
        with open(self.events, "a", encoding="utf-8") as f:
            os.chmod(self.events, 0o600)
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def check_stop(self):
        if (self.root / "cancel").exists() or time.monotonic() - self.started > self.budget:
            raise StopTraining()

    def metric(self, values, check_stop=True):
        for value in values.values():
            if isinstance(value, (int, float)) and not math.isfinite(value):
                raise ValueError("训练指标为 NaN / Inf，已停止，保留最近有效检查点")
        self.emit("metric", values)
        if check_stop:
            self.check_stop()
