import argparse
import getpass
import json
from pathlib import Path
import platform
import re
import sys

from .client import Client
from .common import atomic_json, capabilities, load_json


def main():
    parser = argparse.ArgumentParser(description="WeLink SFT worker · MLX / CUDA")
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/welink-sft")
    sub = parser.add_subparsers(dest="command", required=True)
    pair = sub.add_parser("pair", help="使用一次性配对码授权此机器")
    pair.add_argument("--server", required=True, help="控制端 HTTPS URL；本机允许 http://127.0.0.1:端口")
    pair.add_argument("--name", default=platform.node())
    sub.add_parser("doctor", help="只读检测硬件与依赖，不自动安装或下载模型")
    sub.add_parser("run", help="运行 worker；关闭浏览器不影响训练")
    download = sub.add_parser("download", help="流式下载本 worker 的产物，不将大文件载入浏览器内存")
    download.add_argument("--id", required=True)
    download.add_argument("--sha256", required=True)
    download.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        if args.command == "doctor":
            print(json.dumps(capabilities(args.root), indent=2, ensure_ascii=False))
        elif args.command == "pair":
            if (args.root / "credentials.json").exists():
                raise ValueError("此目录已有配对。请先在工作台撤销原环境，再使用新的 --root 目录配对")
            code = getpass.getpass("输入工作台的一次性配对码（10 分钟有效）：")
            result = Client(args.server).call("POST", "/enroll", {"code": code, "name": args.name, "capabilities": capabilities(args.root)})
            atomic_json(args.root / "credentials.json", {"server": args.server, "token": result["token"], "worker_id": result["worker"]["id"]})
            print("已配对：" + result["worker"]["name"] + "。运行 welink-sft run 开始接收任务。")
        elif args.command == "download":
            if not re.fullmatch(r"[a-f0-9]{64}", args.id) or not re.fullmatch(r"[a-f0-9]{64}", args.sha256):
                raise ValueError("产物 ID 和 SHA-256 格式不正确")
            config = load_json(args.root / "credentials.json")
            if not config:
                raise ValueError("请使用产物所属 worker 的已配对目录")
            if args.output.exists():
                raise ValueError("目标文件已存在，请选择新文件名以保留原文件")
            Client(config["server"], config["token"]).download("/artifacts/" + args.id, args.output, args.sha256)
            print("已下载并通过 SHA-256 校验：" + str(args.output))
        else:
            from .daemon import Daemon
            Daemon(args.root).run()
    except (ValueError, RuntimeError, OSError) as exc:
        # Network exception URLs contain no tokens; authentication is header-only.
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
