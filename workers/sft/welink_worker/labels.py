"""Shared label contracts; use the engine's real tokenizer/template, never regex."""
from .common import WorkerError, SequenceTooLong, fingerprint


def strict_final_labels(input_ids, final_ids):
    if not final_ids or len(final_ids) >= len(input_ids) or input_ids[-len(final_ids):] != final_ids:
        raise WorkerError("模板未保留完整目标回复，不能训练此样本")
    return [-100] * (len(input_ids) - len(final_ids)) + list(final_ids)


def mlx_encode(tokenizer, messages):
    from mlx_lm.tuner.datasets import ChatDataset
    tokens, offset = ChatDataset([{"messages": messages}], tokenizer, mask_prompt=True).process({"messages": messages})
    prompt = tokenizer.apply_chat_template(messages[:-1], add_generation_prompt=True, return_dict=False)
    if not 0 < offset < len(tokens) or offset != len(prompt) or list(tokens[:offset]) != list(prompt):
        raise WorkerError("MLX 模板不能证明只有最终回复受到监督")
    labels = strict_final_labels(list(tokens), list(tokens[offset:]))
    return list(tokens), labels


def factory_processor(tokenizer, config):
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from llamafactory.data.processor.supervised import SupervisedDatasetProcessor
    from llamafactory.hparams import DataArguments
    args = DataArguments(template=config["template"], cutoff_len=config["sequence_length"], train_on_prompt=False, mask_history=True, packing=False, ignore_pad_token_for_loss=True)
    template = get_template_and_fix_tokenizer(tokenizer, args)
    return SupervisedDatasetProcessor(template=template, tokenizer=tokenizer, processor=None, data_args=args)


def install_factory_contract():
    """mask_history can supervise earlier EOS for efficient_eos templates.

    Restrict the actual production processor to the complete final target suffix,
    including that target's EOS. Preflight calls this exact patched processor.
    """
    from llamafactory.data.processor.supervised import SupervisedDatasetProcessor
    if getattr(SupervisedDatasetProcessor, "_welink_strict", False):
        return
    original = SupervisedDatasetProcessor._encode_data_example

    def encode(self, prompt, response, system, tools, images, videos, audios):
        if images or videos or audios:
            raise WorkerError("首版训练只支持文本")
        pairs = self.template.encode_multiturn(self.tokenizer, prompt + response, system, tools, False)
        full = [token for source, target in pairs for token in source + target]
        final = list(pairs[-1][1])
        if self.template.efficient_eos:
            full.append(self.tokenizer.eos_token_id)
            final.append(self.tokenizer.eos_token_id)
        if len(full) > self.data_args.cutoff_len:
            raise SequenceTooLong("样本未通过完整目标长度校验")
        ids, _ = original(self, prompt, response, system, tools, images, videos, audios)
        if ids != full:
            raise WorkerError("LLaMA-Factory 编码与已验证模板不一致")
        return ids, strict_final_labels(ids, final)

    SupervisedDatasetProcessor._encode_data_example = encode
    SupervisedDatasetProcessor._welink_strict = True


def factory_encode(processor, messages):
    system = messages[0]["content"] if messages[0]["role"] == "system" else ""
    body = messages[1:] if system else messages
    return processor._encode_data_example(body[:-1], body[-1:], system, None, [], [], [])


def compile_rows(rows, encode, max_length):
    compiled, tokens, supervised, trimmed, excluded = [], 0, 0, 0, 0
    for row in rows:
        messages = [dict(m) for m in row["messages"]]
        while True:
            try:
                ids, labels = encode(messages)
                fits = len(ids) <= max_length
            except SequenceTooLong:
                fits = False
            if fits:
                break
            start = 1 if messages[0]["role"] == "system" else 0
            if len(messages) - start <= 2:
                excluded += 1
                messages = None
                break
            del messages[start:start + 2]
            trimmed += 1
        if messages is None:
            continue
        start = next((i for i, value in enumerate(labels) if value != -100), -1)
        if not 0 < start < len(ids) or len(labels) != len(ids) or labels[start:] != ids[start:]:
            raise WorkerError("最终回复监督标签校验失败")
        compiled.append({"messages": messages})
        tokens += len(ids)
        supervised += sum(label != -100 for label in labels)
    return compiled, {"samples": len(compiled), "tokens": tokens, "supervised_tokens": supervised, "trimmed_history_turns": trimmed, "excluded_oversize": excluded}


def tokenizer_manifest(tokenizer):
    return {"tokenizer_hash": fingerprint(tokenizer.get_vocab()), "template_hash": fingerprint(tokenizer.chat_template)}
