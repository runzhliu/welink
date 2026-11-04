"""Pinned engine adapters. Imports are lazy so a worker can report missing engines."""
import gc
import json
import math
import os
import shutil
from pathlib import Path
import time
from types import SimpleNamespace

from .common import WorkerError, Journal, StopTraining, archive_files, atomic_json, capabilities, fingerprint, load_json, sha_file
from .labels import compile_rows, factory_encode, factory_processor, install_factory_contract, mlx_encode, tokenizer_manifest


def read_rows(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def snapshot(config):
    from huggingface_hub import snapshot_download
    # Never enable trust_remote_code or load an arbitrary Python file / pickle.
    return Path(snapshot_download(config["model"], revision=config["revision"], allow_patterns=["*.json", "*.safetensors", "*.model", "*.tiktoken", "tokenizer*", "vocab*", "merges.txt", "LICENSE*", "README.md"]))


def base_content_hash(path):
    files = [p for p in path.iterdir() if p.is_file() and (p.suffix in (".safetensors", ".json", ".model", ".tiktoken") or p.name == "merges.txt")]
    if not any(p.suffix == ".safetensors" for p in files):
        raise WorkerError("只支持完整的 safetensors 基础权重")
    return fingerprint({p.name: sha_file(p) for p in sorted(files)})


def prepare(root, config, engine):
    if shutil.disk_usage(root).free < 2 << 30:
        raise WorkerError("可用磁盘不足 2 GB，请先释放空间再下载模型或执行预检")
    from transformers import AutoTokenizer
    path = snapshot(config)
    weight_bytes = sum(p.stat().st_size for p in path.glob("*.safetensors"))
    # Reserve output/checkpoint space after downloading. Actual OOM/resource
    # suitability is measured by the real two-update preflight below.
    reserve = max(2 << 30, weight_bytes // 4)
    if shutil.disk_usage(root).free < reserve:
        raise WorkerError("可用磁盘不足以保留适配器和恢复点，请先释放空间")
    tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=False)
    if not tokenizer.chat_template:
        raise WorkerError("基础模型缺少 chat template")
    if engine == "llamafactory":
        install_factory_contract()
        processor = factory_processor(tokenizer, config)
        encode = lambda messages: factory_encode(processor, messages)
    else:
        encode = lambda messages: mlx_encode(tokenizer, messages)
    stats = {}
    for split in ("train", "valid"):
        rows, info = compile_rows(read_rows(root / (split + ".jsonl")), encode, config["sequence_length"])
        if not rows:
            raise WorkerError(split + " 集没有可用的完整样本")
        compiled = root / "compiled"
        compiled.mkdir(exist_ok=True, mode=0o700)
        target = compiled / (split + ".jsonl")
        with open(target, "w", encoding="utf-8") as f:
            os.chmod(target, 0o600)
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        stats[split] = info
    minimum = (100, 10) if config["preset"] == "validation" else (500, 50)
    if stats["train"]["samples"] < minimum[0] or stats["valid"]["samples"] < minimum[1]:
        raise WorkerError("tokenizer 长度过滤后的训练 / 验证样本不足，请调整数据或序列长度")
    manifest = {**tokenizer_manifest(tokenizer), "base_content_hash": base_content_hash(path), "model_revision": config["revision"], "model": config["model"], "engine": engine, "labels_verified": True, "supervision": "final_assistant_only", "statistics": stats, "versions": capabilities(root)["versions"], "config_hash": fingerprint(config), "weight_bytes": weight_bytes, "reserved_disk_bytes": reserve}
    updates = config["max_steps"]
    if config["preset"] == "standard":
        epoch_steps = stats["train"]["samples"] // config["gradient_accumulation"] if engine == "mlx" else math.ceil(stats["train"]["samples"] / config["gradient_accumulation"])
        updates = min(updates, max(1, epoch_steps))
    manifest["training_plan"] = {"optimizer_steps": updates, "micro_batch": 1, "gradient_accumulation": config["gradient_accumulation"], "supervision": "final_assistant_only"}
    atomic_json(root / "manifest.json", manifest)
    return path, tokenizer, manifest


def mlx_train(root, config, model_path, journal, preflight=False):
    import mlx.core as mx
    from mlx.utils import tree_flatten
    from mlx_lm import load
    from mlx_lm.lora import CONFIG_DEFAULTS, train_model
    from mlx_lm.tuner.datasets import ChatDataset
    from mlx_lm.tuner.trainer import TrainingCallback
    model, tokenizer = load(str(model_path), tokenizer_config={"trust_remote_code": False}, trust_remote_code=False)
    accumulation = config["gradient_accumulation"]
    train = read_rows(root / "compiled/train.jsonl")
    valid = read_rows(root / "compiled/valid.jsonl")
    updates = 2 if preflight else config["max_steps"]
    if not preflight and config["preset"] == "standard":
        updates = min(updates, max(1, len(train) // accumulation))
    output = root / "adapter"
    args = dict(CONFIG_DEFAULTS)
    args.update(model=str(model_path), data=str(root / "compiled"), train=True, batch_size=1, iters=updates * accumulation, steps_per_report=accumulation, steps_per_eval=max(accumulation, min(25, updates) * accumulation), save_every=max(accumulation, min(25, updates) * accumulation), max_seq_length=config["sequence_length"], grad_accumulation_steps=accumulation, learning_rate=config["learning_rate"], num_layers=min(16, len(model.layers)), lora_parameters={"rank": config["rank"], "dropout": 0.05, "scale": 2.0}, adapter_path=str(output), mask_prompt=True, seed=config["seed"], val_batches=min(10, len(valid)), grad_checkpoint=True, trust_remote_code=False)
    if config.get("resume_mode") == "weights_only":
        args["resume_adapter_file"] = str(root / "resume/adapters.safetensors")
    elif config.get("resume_mode"):
        raise WorkerError("MLX 首版只支持从权重继续训练")

    class Callback(TrainingCallback):
        best_loss = float("inf")
        best_step = 0
        def on_train_loss_report(self, values):
            journal.metric({**values, "micro_step": values["iteration"], "optimizer_step": values["iteration"] // accumulation, "total_optimizer_steps": updates, "elapsed_seconds": time.monotonic() - journal.started})
            # Keep only the latest two weight checkpoints; final adapter is separate.
            for path in sorted(output.glob("*_adapters.safetensors"))[:-2]:
                path.unlink()

        def on_val_loss_report(self, values):
            journal.metric({**values, "optimizer_step": values["iteration"] // accumulation})
            if values["val_loss"] < self.best_loss:
                self.best_loss = values["val_loss"]
                self.best_step = values["iteration"] // accumulation
                mx.save_safetensors(str(output / "best_adapters.safetensors"), dict(tree_flatten(model.trainable_parameters())))
                atomic_json(output / "selection.json", {"policy": "best_validation_loss", "optimizer_step": self.best_step, "val_loss": float(self.best_loss)})

    journal.emit("stage", {"stage": "running", "optimizer_steps": updates, "micro_steps": updates * accumulation, "resume": config.get("resume_mode", "none")})
    try:
        train_model(SimpleNamespace(**args), model, ChatDataset(train, tokenizer, mask_prompt=True), ChatDataset(valid, tokenizer, mask_prompt=True), Callback())
    except StopTraining:
        journal.emit("stage", {"stage": "saving"})
        weights = dict(tree_flatten(model.trainable_parameters()))
        mx.save_safetensors(str(output / "adapters.safetensors"), weights)
        return output, True
    return output, False


def factory_train(root, config, model_path, journal, preflight=False):
    import torch
    from transformers import TrainerCallback
    from llamafactory.train.tuner import run_exp
    install_factory_contract()
    output = root / "adapter"
    info = {split: {"file_name": split + ".jsonl", "formatting": "sharegpt", "columns": {"messages": "messages"}, "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}} for split in ("train", "valid")}
    atomic_json(root / "compiled/dataset_info.json", info)
    updates = 2 if preflight else config["max_steps"]
    if not preflight and config["preset"] == "standard":
        updates = min(updates, max(1, math.ceil(len(read_rows(root / "compiled/train.jsonl")) / config["gradient_accumulation"])))
    args = {"model_name_or_path": str(model_path), "trust_remote_code": False, "stage": "sft", "do_train": True, "finetuning_type": "lora", "lora_rank": config["rank"], "lora_alpha": config["rank"] * 2, "lora_dropout": 0.05, "lora_target": "all", "dataset_dir": str(root / "compiled"), "dataset": "train", "eval_dataset": "valid", "template": config["template"], "cutoff_len": config["sequence_length"], "train_on_prompt": False, "mask_history": True, "ignore_pad_token_for_loss": True, "packing": False, "per_device_train_batch_size": 1, "per_device_eval_batch_size": 1, "gradient_accumulation_steps": config["gradient_accumulation"], "learning_rate": config["learning_rate"], "max_steps": updates, "eval_strategy": "steps", "eval_steps": min(25, updates), "save_strategy": "steps", "save_steps": min(25, updates), "save_total_limit": 2, "save_only_model": False, "logging_steps": 1, "output_dir": str(output), "overwrite_output_dir": False, "report_to": "none", "bf16": torch.cuda.is_bf16_supported(), "fp16": not torch.cuda.is_bf16_supported(), "seed": config["seed"], "dataloader_num_workers": 0, "preprocessing_num_workers": 1, "enable_thinking": False}
    args.update(load_best_model_at_end=True, metric_for_best_model="eval_loss", greater_is_better=False)
    if config.get("resume_mode") == "full_state":
        args["resume_from_checkpoint"] = str(root / "resume")
    elif config.get("resume_mode") == "weights_only":
        args["adapter_name_or_path"] = str(root / "resume")
        args["create_new_adapter"] = False
    stopped = False

    class Callback(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            values = {k: float(v) for k, v in (logs or {}).items() if isinstance(v, (int, float))}
            journal.metric({**values, "optimizer_step": state.global_step, "total_optimizer_steps": updates, "peak_memory": torch.cuda.max_memory_allocated() / 1e9, "elapsed_seconds": time.monotonic() - journal.started}, check_stop=False)

        def on_step_end(self, args, state, control, **kwargs):
            nonlocal stopped
            try:
                journal.check_stop()
            except StopTraining:
                stopped = True
                control.should_save = True
                control.should_training_stop = True

        def on_save(self, args, state, control, **kwargs):
            journal.emit("checkpoint", {"optimizer_step": state.global_step, "resume": "full_state"})

    journal.emit("stage", {"stage": "running", "optimizer_steps": updates})
    run_exp(args, callbacks=[Callback()])
    return output, stopped


def package_result(root, config, manifest, output, stopped):
    if not stopped and config["engine"] == "mlx" and (output / "best_adapters.safetensors").exists():
        shutil.copyfile(output / "adapters.safetensors", output / "latest_adapters.safetensors")
        shutil.copyfile(output / "best_adapters.safetensors", output / "adapters.safetensors")
        manifest["selection"] = load_json(output / "selection.json")
    atomic_json(output / "welink_manifest.json", manifest)
    if config["engine"] == "mlx":
        saved = load_json(output / "adapter_config.json")
        atomic_json(output / "adapter_config.json", {key: saved[key] for key in ("fine_tune_type", "num_layers", "lora_parameters")})
    else:
        adapter_config = load_json(output / "adapter_config.json")
        adapter_config["base_model_name_or_path"] = config["model"]
        adapter_config["revision"] = config["revision"]
        atomic_json(output / "adapter_config.json", adapter_config)
    # Inference package excludes optimizer, RNG, training data and paths to secrets.
    allowed = [p for p in output.iterdir() if p.is_file() and (p.name.endswith(".safetensors") or p.name in ("adapter_config.json", "welink_manifest.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "tokenizer.model"))]
    if not any(p.suffix == ".safetensors" for p in allowed):
        raise WorkerError("引擎退出但没有生成有效的适配器权重")
    adapter = root / "adapter.tar"
    archive_files(adapter, output, allowed)
    artifacts = [{"name": "adapter.tar", "kind": "adapter", "sha256": sha_file(adapter), "resume": "weights_only"}]
    if config["engine"] == "llamafactory":
        checkpoints = sorted(output.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
        if checkpoints:
            checkpoint = checkpoints[-1]
            required = ("trainer_state.json", "optimizer.pt", "scheduler.pt", "rng_state.pth", "adapter_model.safetensors")
            from .recovery import full_checkpoint
            if all((checkpoint / p).is_file() for p in required) and full_checkpoint(checkpoint):
                archive_files(root / "checkpoint.tar", checkpoint, [p for p in checkpoint.rglob("*") if p.is_file()])
                artifacts.append({"name": "checkpoint.tar", "kind": "checkpoint", "sha256": sha_file(root / "checkpoint.tar"), "resume": "full_state"})
    return {"state": "canceled" if stopped else "succeeded", "stop_reason": "worker_stop" if stopped else "", "manifest": manifest, "artifacts": artifacts}


def train_or_preflight(root, job, journal):
    config = job["config"]
    engine = config["engine"]
    caps = capabilities(root)
    if not caps["engines"][engine]["available"]:
        raise WorkerError(caps["engines"][engine]["reason"])
    path, tokenizer, manifest = prepare(root, config, engine)
    if job["kind"] == "train":
        source = job["input"]
        for _ in range(32):
            if source.get("preflight_result") or not source.get("original_input"):
                break
            source = source["original_input"]
        preflight = source.get("preflight_result")
        if not preflight:
            raise WorkerError("训练任务缺少可追溯的预检快照")
        if preflight and any(preflight.get(key) != manifest[key] for key in ("model_revision", "tokenizer_hash", "template_hash", "base_content_hash", "versions")):
            raise WorkerError("模型、tokenizer、模板或执行器版本与预检不一致，请重新预检")
    runner = mlx_train if engine == "mlx" else factory_train
    output, stopped = runner(root, config, path, journal, job["kind"] == "preflight")
    if job["kind"] == "preflight":
        if stopped:
            return {"state": "canceled", "stop_reason": "worker_stop"}
        if engine == "mlx":
            import mlx.core as mx
            peak_memory = mx.get_peak_memory()
        else:
            import torch
            peak_memory = torch.cuda.max_memory_allocated()
        return {"state": "succeeded", **manifest, "peak_memory_bytes": peak_memory, "compatible": True, "free_disk_bytes": capabilities(root)["free_disk_bytes"], "note": "已执行两次真实 optimizer updates；预检权重不会作为正式模型"}
    return package_result(root, config, manifest, output, stopped)
