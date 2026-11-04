"""One isolated process per attempt. The daemon can reconnect to its journal."""
import json
import errno
import os
from pathlib import Path
import signal
import sys
import traceback
import threading
import time

from .common import acquire_device_lock, WorkerError, Journal, StopTraining, atomic_json, load_json


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        from .runtime import serve
        serve(sys.argv[2])
        return
    root = Path(sys.argv[1]).resolve()
    spec = load_json(root / "spec.json")
    job = spec["job"]
    os.environ["CUDA_VISIBLE_DEVICES"] = job["config"].get("gpu", "0")
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    os.environ["WANDB_DISABLED"] = "true"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    journal = Journal(root, job["config"]["max_seconds"])
    from .daemon import process_identity
    atomic_json(root / "process.json", {"pid": os.getpid(), "identity": process_identity(os.getpid())})
    def watchdog():
        stop_at = None
        while True:
            heartbeat = root.parents[1] / "last-contact.json"
            offline = heartbeat.exists() and time.time() - heartbeat.stat().st_mtime > load_json(heartbeat, {}).get("grace", 600)
            expired = time.monotonic() - journal.started > journal.budget
            if offline or expired or (root / "cancel").exists():
                (root / "cancel").touch(mode=0o600)
                stop_at = stop_at or time.monotonic()
                if time.monotonic() - stop_at > 120:
                    os._exit(124)  # Only this attempt; last committed checkpoint survives.
            time.sleep(2)
    threading.Thread(target=watchdog, daemon=True).start()
    def cancel(signum, frame):
        (root / "cancel").touch(mode=0o600)
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    try:
        domain = acquire_device_lock() if job["kind"] != "deploy" else None
        if job["kind"] in ("train", "preflight"):
            from .engines import train_or_preflight
            result = train_or_preflight(root, job, journal)
        elif job["kind"] == "evaluate":
            from .runtime import evaluate
            result = evaluate(root, job, journal)
        elif job["kind"] == "deploy":
            from .runtime import deploy
            result = deploy(root, job, journal)
        else:
            raise ValueError("不支持的任务类型")
    except StopTraining:
        result = {"state": "canceled", "stop_reason": "worker_stop"}
    except Exception as exc:
        # The local log is private; server events never copy source text / keys.
        traceback.print_exc()
        if isinstance(exc, WorkerError):
            message = str(exc)
        elif isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
            message = "磁盘空间不足，保存未完成；已保留此前有效产物"
        elif "out of memory" in str(exc).lower():
            message = "设备内存不足（OOM）；可减少序列长度或选择更小模型，再重新预检"
        else:
            message = type(exc).__name__ + "：执行失败，请检查 worker 本地 engine.log；不会自动重跑"
        result = {"state": "failed", "message": message}
        try:
            from .recovery import recover_artifacts
            result["artifacts"] = recover_artifacts(root, job)
        except Exception:
            pass  # Retain local originals; never advertise an invalid recovery point.
    atomic_json(root / "result.json", result)


if __name__ == "__main__":
    main()
