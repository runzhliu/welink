"""Stable 4.x+ releases require explicit hardware/visual evidence, never CPU mocks."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


def validate(tag, matrix, changed_since):
    version = re.match(r"^v?(\d+)\.", tag)
    if not version or int(version.group(1)) < 4:
        return []
    errors = []
    for engine in ("mlx", "cuda"):
        entry = matrix.get(engine)
        if not isinstance(entry, dict):
            errors.append(engine + " 尚无真实硬件验收记录")
            continue
        for field in ("tested_commit", "executed_at", "reviewer", "hardware", "model_id", "model_revision", "dataset_sha256", "worker_versions", "training_job", "evaluation_job", "deployment"):
            if not entry.get(field):
                errors.append(engine + " 缺少 " + field)
        for field in ("real_training", "labels_and_padding", "stop_and_resume", "streaming", "default_and_rollback", "failure_injection"):
            if entry.get(field) is not True:
                errors.append(engine + " 尚未通过 " + field)
        if engine == "cuda" and entry.get("full_state_continuity") is not True:
            errors.append("cuda 尚未通过完整状态连续性验证")
        if entry.get("tested_commit") and changed_since(entry["tested_commit"]):
            errors.append(engine + " 验收后训练 / 应用代码已变化，需要重新验证")
    visual = matrix.get("visual_review")
    if not isinstance(visual, dict) or not all(visual.get(key) is True for key in ("desktop", "mobile_390", "light_dark", "keyboard", "privacy_mode")) or not visual.get("reviewer"):
        errors.append("桌面 / 手机 / 深浅色 / 键盘 / 隐私模式视觉验收待完成")
    return errors


def changed_since(commit):
    if not isinstance(commit,str) or not re.fullmatch(r"[a-fA-F0-9]{40}", commit):
        return True
    if subprocess.run(["git", "merge-base", "--is-ancestor", commit, "HEAD"], capture_output=True).returncode:
        return True
    paths = subprocess.check_output(["git", "diff", "--name-only", commit, "HEAD"], text=True).splitlines()
    return any(path.startswith(("backend/", "frontend/", "workers/sft/")) and path not in ("workers/sft/verified-matrix.json", "workers/sft/README.md") for path in paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--matrix", default="workers/sft/verified-matrix.json")
    args = parser.parse_args()
    errors = validate(args.tag, json.loads(Path(args.matrix).read_text()), changed_since)
    if errors:
        print("SFT 4.0 正式发布门槛未通过：\n- " + "\n- ".join(errors), file=sys.stderr)
        print("请完成 docs/sft-release-checklist.md；不得用 CPU 合约测试代替真实训练。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
