"""Publish only parseable checkpoints after a failed/interrupted engine process."""
from pathlib import Path
import tarfile
import zipfile

from .common import archive_files, atomic_json, load_json, sha_file


def valid_weights(path):
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        from safetensors import safe_open
        with safe_open(path, framework="np") as weights:
            return bool(list(weights.keys()))
    except Exception:
        return False


def full_checkpoint(path):
    if not valid_weights(path / "adapter_model.safetensors"):
        return False
    try:
        state = load_json(path / "trainer_state.json")
        return bool(state and isinstance(state.get("global_step"), int) and all(zipfile.is_zipfile(path / name) for name in ("optimizer.pt", "scheduler.pt", "rng_state.pth")) and (path / "adapter_config.json").is_file())
    except (OSError, ValueError):
        return False


def recover_artifacts(root, job):
    """This never changes a failed job into a successful model version."""
    root = Path(root)
    manifest = load_json(root / "manifest.json")
    if not manifest or job["kind"] != "train":
        return []
    config, output = job["config"], root / "adapter"
    checkpoints = sorted(output.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]), reverse=True)
    if config["engine"] == "mlx":
        candidates = [output / "adapters.safetensors", *sorted(output.glob("[0-9]*_adapters.safetensors"), reverse=True), output / "best_adapters.safetensors"]
        weights = next((path for path in candidates if valid_weights(path)), None)
        source_config = load_json(output / "adapter_config.json")
        if not weights or not source_config:
            return []
        source_config = {key: source_config[key] for key in ("fine_tune_type", "num_layers", "lora_parameters")}
        weight_name = "adapters.safetensors"
    else:
        checkpoint = next((path for path in checkpoints if valid_weights(path / "adapter_model.safetensors") and (path / "adapter_config.json").is_file()), None)
        if checkpoint is None:
            return []
        weights = checkpoint / "adapter_model.safetensors"
        source_config = load_json(checkpoint / "adapter_config.json")
        source_config["base_model_name_or_path"] = config["model"]
        source_config["revision"] = config["revision"]
        weight_name = "adapter_model.safetensors"
    manifest["recovered_after_failure"] = True
    atomic_json(root / "recovery_manifest.json", manifest)
    atomic_json(root / "recovery_adapter_config.json", source_config)
    archive = root / "adapter.tar"
    with tarfile.open(archive, "w") as tar:
        archive.chmod(0o600)
        for name, source in ((weight_name, weights), ("adapter_config.json", root / "recovery_adapter_config.json"), ("welink_manifest.json", root / "recovery_manifest.json")):
            if not source.resolve().is_relative_to(root.resolve()) or source.is_symlink():
                return []
            tar.add(source, arcname=name, recursive=False)
    artifacts = [{"name": "adapter.tar", "kind": "adapter", "sha256": sha_file(archive), "resume": "weights_only"}]
    complete = next((path for path in checkpoints if full_checkpoint(path)), None)
    if complete:
        archive_files(root / "checkpoint.tar", complete, [p for p in complete.rglob("*") if p.is_file()])
        artifacts.append({"name": "checkpoint.tar", "kind": "checkpoint", "sha256": sha_file(root / "checkpoint.tar"), "resume": "full_state"})
    return artifacts
