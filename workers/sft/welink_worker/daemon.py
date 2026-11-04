import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

from .client import Client
from .common import atomic_json, capabilities, load_json, safe_extract


def process_identity(pid):
    try:
        value = subprocess.check_output(["ps", "-p", str(int(pid)), "-o", "stat=", "-o", "lstart="], stderr=subprocess.DEVNULL, text=True).strip().split(None, 1)
        return value[1] if len(value) == 2 and not value[0].startswith("Z") else ""
    except (subprocess.CalledProcessError, ValueError):
        return ""


def alive(info):
    return bool(info and info.get("identity") and process_identity(info["pid"]) == info["identity"])


def stop_owned(info, force=False):
    if alive(info):
        os.killpg(info["pid"], signal.SIGKILL if force else signal.SIGTERM)


class Daemon:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.config = load_json(self.root / "credentials.json")
        if not self.config:
            raise ValueError("请先运行 welink-sft pair")
        self.client = Client(self.config["server"], self.config["token"])
        self.last_contact = time.monotonic()
        self.running = True
        self.children = {}
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self.forwarding = set()
        self.heartbeat_lock = threading.Lock()
        self.heartbeat = None

    def send_event(self, root, state, event, next_offset=None):
        pending = {"event": event, "offset": state["offset"] if next_offset is None else next_offset}
        state["pending"] = pending
        atomic_json(root / "daemon.json", state)
        self.flush_pending(root, state)

    def flush_pending(self, root, state):
        pending = state.get("pending")
        if not pending:
            return
        job = state["job"]
        self.client.call("POST", "/jobs/" + job["id"] + "/events", {"attempt": job["attempt"], "fence": job["fence"], "event": pending["event"]})
        state["seq"] = pending["event"]["seq"]
        state["offset"] = pending["offset"]
        state["pending"] = None
        if pending["event"]["type"] in ("error", "completed", "canceled"):
            state["phase"] = "finished"
        atomic_json(root / "daemon.json", state)

    def start(self, job):
        root = self.root / "jobs" / job["id"]
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if (root / "daemon.json").exists():
            raise ValueError("该 attempt 已有本地记录，拒绝重复启动")
        state = {"job": job, "seq": job["last_seq"], "offset": 0, "phase": "preparing"}
        atomic_json(root / "daemon.json", state)
        atomic_json(root / "spec.json", {"job": job})
        if not self.prepare_or_fail(root, job, state):
            return
        if (root / "cancel").exists():
            return
        self.spawn(root, state)

    def spawn(self, root, state):
        job = state["job"]
        state["phase"] = "spawning"
        state["spawn_requested_at"] = time.time()
        atomic_json(root / "daemon.json", state)
        log = open(root / "engine.log", "ab")
        os.chmod(root / "engine.log", 0o600)
        process = subprocess.Popen([sys.executable, "-m", "welink_worker.engine", str(root)], stdout=log, stderr=log, start_new_session=True)
        log.close()
        self.children[job["id"]] = process
        state["process"] = {"pid": process.pid, "identity": process_identity(process.pid)}
        state["phase"] = "running"
        atomic_json(root / "daemon.json", state)

    def prepare_files(self, root, job):
        splits = ("train", "valid") if job["kind"] in ("preflight", "train") else (("test", "train") if job["kind"] == "evaluate" else ())
        for split in splits:
            target = root / (split + ".jsonl")
            if not target.exists():
                self.client.download("/jobs/" + job["id"] + "/data/" + split, target)
        if job["config"].get("parent_run"):
            artifacts = self.client.call("GET", "/jobs/" + job["id"] + "/parent-artifacts")
            wanted = job["config"].get("checkpoint")
            artifact = next((a for a in artifacts if a["id"] == wanted), None) if wanted else next((a for a in artifacts if a["kind"] == "adapter"), None)
            if not artifact:
                raise ValueError("找不到匹配的父任务产物")
            target = root / "resume.tar"
            self.client.download("/artifacts/" + artifact["id"], target, artifact["sha256"])
            safe_extract(target, root / "resume")

    def fail_attempt(self, root, state, message):
        if (root / "cancel").exists():
            kind, data = "canceled", {"stop_reason": "worker_stop"}
        else:
            kind, data = "error", {"message": message}
        self.send_event(root, state, {"seq": state["seq"] + 1, "type": kind, "data": data})

    def prepare_or_fail(self, root, job, state):
        try:
            self.prepare_files(root, job)
            return True
        except urllib.error.HTTPError as exc:
            code = exc.code
            if code in (408, 429) or code >= 500:
                raise
            exc.close()
            self.fail_attempt(root, state, "数据 / 父产物准备失败（HTTP " + str(code) + "），请检查版本、授权与校验和")
        except ValueError:
            self.fail_attempt(root, state, "数据或父产物校验失败；未启动训练，请重新核对冻结版本和产物")
        return False

    def observe(self, job):
        root = self.root / "jobs" / job["id"]
        state = load_json(root / "daemon.json")
        if state and state.get("phase") == "finished":
            return
        if not state:
            # A new directory/installation cannot claim ownership of an unknown
            # process. Fail explicitly; the controller never reassigns it.
            state = {"job": job, "seq": job["last_seq"], "offset": 0}
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.send_event(root, state, {"seq": state["seq"] + 1, "type": "error", "data": {"message": "worker 本地执行记录丢失，已停止自动调度；请核对原机器进程"}})
            return
        self.flush_pending(root, state)
        if state.get("phase") == "finished":
            return
        if job["cancel"] or time.monotonic() - self.last_contact > 600:
            (root / "cancel").touch(mode=0o600)
            if not state.get("stop_requested_at"):
                state["stop_requested_at"] = time.time()
                atomic_json(root / "daemon.json", state)
        if state.get("phase") == "preparing" and (root / "cancel").exists():
            self.send_event(root, state, {"seq": state["seq"] + 1, "type": "canceled", "data": {"stop_reason": "worker_stop"}})
            return
        if state.get("phase") == "preparing":
            if not self.prepare_or_fail(root, job, state):
                return
            self.spawn(root, state)
            return
        if state.get("phase") == "spawning":
            # A transport interruption during preparation is safe to retry;
            # process creation only follows the durable phase transition below.
            # A restart in the tiny spawn window uses the engine's own identity.
            own = load_json(root / "process.json")
            if own and alive(own):
                state["process"] = own
                state["phase"] = "running"
                atomic_json(root / "daemon.json", state)
            elif time.time() - state.get("spawn_requested_at", 0) < 10:
                return
            else:
                self.send_event(root, state, {"seq": state["seq"] + 1, "type": "error", "data": {"message": "进程创建期间中断，请重新预检后提交；未自动重启训练"}})
                return
        event_path = root / "engine-events.jsonl"
        if event_path.exists():
            with open(event_path, "rb") as f:
                f.seek(state["offset"])
                for line in f:
                    if not line.endswith(b"\n"):
                        break
                    event = json.loads(line)
                    event["seq"] = state["seq"] + 1
                    self.send_event(root, state, event, state["offset"] + len(line))
        result = load_json(root / "result.json")
        if result is None:
            if alive(state.get("process")):
                if state.get("stop_requested_at") and time.time() - state["stop_requested_at"] > 120:
                    state["termination_reason"] = "保存并停止超时，已终止本任务进程；最近有效检查点仍保留"
                    atomic_json(root / "daemon.json", state)
                    stop_owned(state["process"], force=True)
                    result = {"state": "failed", "message": "保存并停止超时，已终止本任务进程；最近有效检查点仍保留在 worker"}
                else:
                    return
            else:
                result = {"state": "failed", "message": state.get("termination_reason", "训练进程已退出且未提交完成回执，请检查 engine.log；未自动重跑")}
        process = self.children.get(job["id"])
        if process and process.poll() is None:
            return
        if not process and alive(state.get("process")):
            return
        if process:
            process.wait()
            self.children.pop(job["id"], None)
        if result["state"] == "failed" and "artifacts" not in result:
            try:
                from .recovery import recover_artifacts
                result["artifacts"] = recover_artifacts(root, job)
            except Exception:
                result["artifacts"] = []
        if not state.get("uploaded"):
            uploaded = []
            try:
                for artifact in result.get("artifacts", []):
                    uploaded.append(self.client.upload(job, root / artifact["name"], artifact["resume"]))
            except urllib.error.HTTPError as exc:
                if exc.code in (408, 429) or exc.code >= 500:
                    raise
                exc.close()
                self.fail_attempt(root, state, "产物上传被拒绝，训练机上的原始文件已保留；请检查磁盘、授权或文件大小限制")
                return
            except ValueError:
                self.fail_attempt(root, state, "产物上传校验失败，训练机上的原始文件已保留")
                return
            state["uploaded"] = uploaded
            atomic_json(root / "daemon.json", state)
        for artifact in state.get("uploaded", []):
            if artifact["kind"] == "adapter":
                result["artifact_id"] = artifact["id"]
        if result["state"] == "failed":
            kind, data = "error", {"message": result["message"]}
        elif result["state"] == "canceled":
            # A time budget stop is also a user-submitted limit. The server must
            # acknowledge it as stopped, never a successful full training run.
            kind, data = "canceled", result
        else:
            kind, data = "completed", result
        self.send_event(root, state, {"seq": state["seq"] + 1, "type": kind, "data": data})
        state["phase"] = "finished"
        atomic_json(root / "daemon.json", state)

    def forward(self, request):
        request_id = request["id"]
        root = self.root / "jobs" / request["deployment"]
        server = load_json(root / "serving.json")
        seq = 0
        def send(data="", done=False, error=""):
            nonlocal seq
            seq += 1
            self.client.call("POST", "/inference-requests/" + request_id + "/chunks", {"seq": seq, "data": data, "done": done, "error": error})
        try:
            if not server:
                raise ValueError("推理进程不存在")
            req = urllib.request.Request("http://127.0.0.1:" + str(server["port"]) + "/v1/chat/completions", data=json.dumps(request["body"]).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as response:
                for line in response:
                    if not line.startswith(b"data: "):
                        continue
                    data = line[6:].decode().strip()
                    if data == "[DONE]":
                        send(done=True)
                        return
                    value = json.loads(data)
                    if value.get("error"):
                        raise RuntimeError("推理失败")
                    send(data=data)
            raise RuntimeError("推理流提前结束")
        except Exception:
            try:
                send(error="模型推理失败，请检查 worker 服务日志")
            except OSError:
                pass
        finally:
            self.forwarding.discard(request_id)

    def check_deployments(self, deployments):
        for deployment in deployments:
            if deployment["worker_id"] != self.config["worker_id"] or deployment["state"] == "stopped":
                continue
            root = self.root / "jobs" / deployment["id"]
            serving = load_json(root / "serving.json")
            if not serving:
                continue
            info = load_json(root / "serve-process.json")
            if not alive(info):
                self.client.call("POST", "/deployments/" + deployment["id"] + "/stopped", {"failed": not deployment.get("stop", False)})
                continue
            if deployment.get("stop"):
                stop_owned(info)
                for _ in range(20):
                    if not alive(info):
                        break
                    time.sleep(0.1)
                stop_owned(info, force=True)
                self.client.call("POST", "/deployments/" + deployment["id"] + "/stopped", {})

    def shutdown(self):
        self.running = False
        for state_path in (self.root / "jobs").glob("*/daemon.json"):
            state = load_json(state_path)
            if state.get("phase") != "finished":
                (state_path.parent / "cancel").touch(mode=0o600)

    def heartbeat_once(self):
        heartbeat = self.client.call("POST", "/heartbeat", {"capabilities": capabilities(self.root)})
        self.last_contact = time.monotonic()
        atomic_json(self.root / "last-contact.json", {"time": time.time(), "grace": heartbeat["offline_grace_seconds"]})
        for job in heartbeat["active"]:
            if job["cancel"]:
                root = self.root / "jobs" / job["id"]
                root.mkdir(parents=True, exist_ok=True, mode=0o700)
                (root / "cancel").touch(mode=0o600)
        with self.heartbeat_lock:
            self.heartbeat = heartbeat
        return heartbeat

    def heartbeat_loop(self):
        # Data/weight transfers may take minutes. They must not block stop
        # commands or make an online worker appear to lose its device lease.
        while self.running:
            try:
                self.heartbeat_once()
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    self.shutdown()
                    return
            except (OSError, TimeoutError):
                pass
            for _ in range(30):
                if not self.running:
                    return
                time.sleep(0.1)

    def run(self):
        lock = open(self.root / "worker.lock", "a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("此安装已有运行中的 worker")
        signal.signal(signal.SIGINT, lambda *_: self.shutdown())
        signal.signal(signal.SIGTERM, lambda *_: self.shutdown())
        heartbeat_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        heartbeat_thread.start()
        try:
            while self.running:
                try:
                    with self.heartbeat_lock:
                        heartbeat = self.heartbeat
                    if not heartbeat:
                        time.sleep(1)
                        continue
                    for job in heartbeat["active"]:
                        self.observe(job)
                    self.check_deployments(heartbeat["deployments"])
                    if not heartbeat["active"] and not heartbeat.get("revoked"):
                        job = self.client.call("POST", "/claim", {})["job"]
                        if job:
                            self.start(job)
                    for request in ([] if heartbeat.get("revoked") else self.client.call("GET", "/inference-requests")):
                        if request["id"] not in self.forwarding:
                            self.forwarding.add(request["id"])
                            self.pool.submit(self.forward, request)
                except urllib.error.HTTPError as exc:
                    if exc.code in (401, 403):
                        self.shutdown()
                        raise RuntimeError("worker 凭据已撤销，已请求本地任务保存并停止") from None
                    print("控制端暂时不可用，保留租约并等待对账：HTTP", exc.code, flush=True)
                except (OSError, TimeoutError):
                    print("控制端断开，保留当前任务，等待重连", flush=True)
                if time.monotonic() - self.last_contact > load_json(self.root / "last-contact.json", {}).get("grace", 600):
                    for state_path in (self.root / "jobs").glob("*/daemon.json"):
                        state = load_json(state_path)
                        if state.get("phase") != "finished":
                            (state_path.parent / "cancel").touch(mode=0o600)
                time.sleep(1)
        finally:
            self.shutdown()
            self.pool.shutdown(wait=False, cancel_futures=True)
            lock.close()
