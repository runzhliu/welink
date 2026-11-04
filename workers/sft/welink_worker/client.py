import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

from .common import sha_file


class Client:
    def __init__(self, server, token=""):
        parsed = urllib.parse.urlparse(server)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("控制端地址不正确")
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("远程控制端必须使用 HTTPS；HTTP 仅允许 loopback")
        self.base = server.rstrip("/") + "/api/sft-worker"
        self.token = token

    def request(self, method, path, value=None, headers=None, raw=None, timeout=15):
        data = raw if raw is not None else (json.dumps(value).encode() if value is not None else None)
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        if self.token:
            request_headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path, data=data, headers=request_headers, method=method)
        return urllib.request.urlopen(request, timeout=timeout)

    def call(self, method, path, value=None, **kwargs):
        with self.request(method, path, value, **kwargs) as response:
            return json.load(response)

    def download(self, path, target, expected=None):
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        partial = target.with_suffix(target.suffix + ".partial")
        offset = partial.stat().st_size if partial.exists() else 0
        try:
            response = self.request("GET", path, headers={"Range": "bytes=" + str(offset) + "-"} if offset else {}, timeout=180)
        except urllib.error.HTTPError as exc:
            if exc.code != 416 or not partial.exists():
                raise
            checksum = expected or exc.headers.get("X-SHA256")
            exc.close()
            if checksum and sha_file(partial) == checksum:
                os.replace(partial, target)
                return
            partial.unlink()
            return self.download(path, target, expected)
        with response:
            mode = "ab" if response.status == 206 else "wb"
            with open(partial, mode) as out:
                os.chmod(partial, 0o600)
                size = offset if mode == "ab" else 0
                while True:
                    chunk = response.read(4 << 20)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > 64 << 30:
                        raise ValueError("下载超过 64 GB 限制")
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            expected = expected or response.headers.get("X-SHA256")
        if expected and sha_file(partial) != expected:
            partial.unlink()
            raise ValueError("下载内容校验失败")
        os.replace(partial, target)

    def upload(self, job, path, resume):
        path = Path(path)
        offset, size = 0, path.stat().st_size
        checksum = sha_file(path)
        endpoint = "/jobs/" + job["id"] + "/artifacts/" + path.name
        with open(path, "rb") as source:
            while offset < size:
                source.seek(offset)
                chunk = source.read(4 << 20)
                final = offset + len(chunk) == size
                try:
                    response = self.call("PUT", endpoint, headers={"Content-Type": "application/octet-stream", "Upload-Offset": str(offset), "X-Attempt": job["attempt"], "X-Fence": job["fence"], "X-Resume-Mode": resume, **({"X-SHA256": checksum} if final else {})}, raw=chunk, timeout=180)
                except urllib.error.HTTPError as exc:
                    if exc.code != 409:
                        raise
                    with exc:
                        response = json.load(exc)
                    if "offset" not in response:
                        raise
                    offset = response["offset"]
                    if not 0 <= offset <= size:
                        raise ValueError("控制端返回了非法上传偏移")
                    continue
                offset = response["offset"]
                if final:
                    return response["artifact"]
        # The final acknowledgement may have been lost. An empty final chunk
        # commits the already uploaded bytes with the same checksum.
        return self.call("PUT", endpoint, headers={"Upload-Offset": str(size), "X-Attempt": job["attempt"], "X-Fence": job["fence"], "X-SHA256": checksum, "X-Resume-Mode": resume}, raw=b"")["artifact"]
