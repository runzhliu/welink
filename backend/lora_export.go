/*
 * LoRA 数据集导出 — 把"我"和所有联系人的对话配成 (对方上一句, 我的回复) 训练集
 *
 * 与 skill_forge.go 的「炼化」不同：
 *   - 不调 LLM、纯本地处理
 *   - 不抽取风格画像，直接输出原始对话对
 *   - 产物是 Alpaca 格式 jsonl + 训练食谱，给用户自己拿去 Unsloth/LLaMA-Factory 微调
 *
 * 隐私：
 *   - 复用 maskSensitive（手机/邮箱/身份证/卡号/wxid）
 *   - 联系人 wxid 一律匿名化为 c01..cNN
 *   - 命中 sensitivePatterns 整条丢弃
 */

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"welink/backend/service"
)

const (
	loraPairWindowSec = 300 // 配对窗口：我的消息回看最近 5 分钟内对方的最后一条
	loraInputMinRune  = 1
	loraInputMaxRune  = 200
	loraOutputMinRune = 2
	loraOutputMaxRune = 150
	loraPerContactCap = 200  // 每个联系人最多贡献条数（防话痨样本污染）
	loraDupCap        = 1    // 同一 input 重复多次时只保留 N 条
	loraMinPairs      = 500  // 总量低于此值拒绝导出
	loraMaxPairs      = 20000
)

// LoRAPair Alpaca 格式的一条训练样本
type LoRAPair struct {
	Instruction string         `json:"instruction"`
	Input       string         `json:"input"`
	Output      string         `json:"output"`
	Meta        map[string]any `json:"meta,omitempty"`
}

type loraStats struct {
	TotalPairs     int            `json:"total_pairs"`
	ContactCount   int            `json:"contact_count"`
	AvgInputLen    float64        `json:"avg_input_len"`
	AvgOutputLen   float64        `json:"avg_output_len"`
	GeneratedAt    string         `json:"generated_at"`
	PerContactTop  []contactCount `json:"per_contact_top10"`
}

type contactCount struct {
	ContactID string `json:"contact_id"` // 匿名 c01..cNN
	Pairs     int    `json:"pairs"`
}

// BuildLoRAExportZip 收集对话对、清洗、打包成 zip 字节
func BuildLoRAExportZip(svc *service.ContactService) ([]byte, string, error) {
	if svc == nil {
		return nil, "", fmt.Errorf("服务未就绪")
	}

	// 按"我"的发言量排序，优先取互动多的联系人
	type pair struct {
		username string
		count    int64
	}
	var contacts []pair
	for _, s := range svc.GetCachedStats() {
		if s.MyMessages > 0 {
			contacts = append(contacts, pair{s.Username, s.MyMessages})
		}
	}
	if len(contacts) == 0 {
		return nil, "", fmt.Errorf("没有找到任何「我发出」的消息")
	}
	sort.Slice(contacts, func(i, j int) bool { return contacts[i].count > contacts[j].count })

	// 构造匿名映射
	contactMap := make(map[string]string, len(contacts))
	for i, c := range contacts {
		contactMap[c.username] = fmt.Sprintf("c%02d", i+1)
	}

	pairs := make([]LoRAPair, 0, 4096)
	dupCount := make(map[string]int)
	perContact := make(map[string]int)

	for _, c := range contacts {
		if len(pairs) >= loraMaxPairs {
			break
		}
		anonID := contactMap[c.username]
		msgs := svc.ExportContactMessagesAll(c.username)
		if len(msgs) < 4 {
			continue
		}
		added := pairUpFromMessages(msgs, anonID, dupCount, &pairs, loraPerContactCap-perContact[anonID])
		perContact[anonID] += added
	}

	if len(pairs) < loraMinPairs {
		return nil, "", fmt.Errorf("可用样本太少（%d 条），需要至少 %d 条配对才有训练价值", len(pairs), loraMinPairs)
	}

	stats := computeLoRAStats(pairs, contactMap)

	// 打包 zip
	files, err := buildLoRAFiles(pairs, stats)
	if err != nil {
		return nil, "", err
	}
	zipBytes, err := makeSkillZip(files)
	if err != nil {
		return nil, "", err
	}
	filename := fmt.Sprintf("welink-self-lora-%s.zip", time.Now().Format("20060102-150405"))
	return zipBytes, filename, nil
}

// pairUpFromMessages 用滑动窗口找 (对方上一句, 我的回复) 配对
// quota 控制本联系人贡献上限（剩余配额）；返回实际新增条数
func pairUpFromMessages(msgs []service.ChatMessage, anonID string, dupCount map[string]int, out *[]LoRAPair, quota int) int {
	if quota <= 0 {
		return 0
	}
	added := 0
	// 假设 ExportContactMessagesAll 按时间序返回；最近一条对方文本消息及其时间戳
	var lastTheirContent string
	var lastTheirTs int64

	for _, m := range msgs {
		// 用 Date+Time 拼出时间戳；缺一不可
		ts := parseChatMsgTs(m)

		if !m.IsMine {
			if m.Type == 1 && strings.TrimSpace(m.Content) == "" {
				continue
			}
			if m.Type != 1 {
				// 非文本（图片/语音/红包...）也记录时间，但内容置空 → 后续配对不取
				lastTheirContent = ""
				lastTheirTs = ts
				continue
			}
			cleaned := cleanForLoRA(m.Content)
			if cleaned == "" {
				lastTheirContent = ""
				lastTheirTs = ts
				continue
			}
			lastTheirContent = cleaned
			lastTheirTs = ts
			continue
		}

		// 我的消息
		if m.Type != 1 {
			continue
		}
		if lastTheirContent == "" {
			continue // 没对方上一句可配
		}
		if loraPairWindowSec > 0 && ts > 0 && lastTheirTs > 0 && ts-lastTheirTs > loraPairWindowSec {
			continue
		}
		myCleaned := cleanForLoRA(m.Content)
		if myCleaned == "" {
			continue
		}
		if !rangeOK(myCleaned, loraOutputMinRune, loraOutputMaxRune) {
			continue
		}
		if !rangeOK(lastTheirContent, loraInputMinRune, loraInputMaxRune) {
			continue
		}
		// 去重：同一 input 最多保留 loraDupCap 条
		dupKey := lastTheirContent
		if dupCount[dupKey] >= loraDupCap {
			continue
		}
		dupCount[dupKey]++

		*out = append(*out, LoRAPair{
			Instruction: "用我的口吻回复这条消息",
			Input:       lastTheirContent,
			Output:      myCleaned,
			Meta: map[string]any{
				"contact": anonID,
				"date":    m.Date,
			},
		})
		added++
		if added >= quota {
			break
		}
	}
	return added
}

func parseChatMsgTs(m service.ChatMessage) int64 {
	if m.Date == "" || m.Time == "" {
		return 0
	}
	t, err := time.ParseInLocation("2006-01-02 15:04", m.Date+" "+m.Time, time.Local)
	if err != nil {
		return 0
	}
	return t.Unix()
}

// cleanForLoRA 复用 maskSensitive + 敏感词丢弃 + URL/base64 占位 + 微信表情清理
func cleanForLoRA(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if containsSensitive(s) {
		return ""
	}
	s = maskSensitive(s)
	s = reURL.ReplaceAllString(s, "[链接]")
	s = reLongNonText.ReplaceAllString(s, "[数据]")
	s = reWxEmoji.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// 至少含一个中英文字符
	hasText := false
	for _, r := range s {
		if (r >= 0x4E00 && r <= 0x9FFF) || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			hasText = true
			break
		}
	}
	if !hasText {
		return ""
	}
	return s
}

func rangeOK(s string, minR, maxR int) bool {
	n := 0
	for range s {
		n++
		if n > maxR {
			return false
		}
	}
	return n >= minR
}

func computeLoRAStats(pairs []LoRAPair, contactMap map[string]string) loraStats {
	perContact := make(map[string]int)
	var inSum, outSum int
	for _, p := range pairs {
		anonID, _ := p.Meta["contact"].(string)
		if anonID != "" {
			perContact[anonID]++
		}
		inSum += runeLen(p.Input)
		outSum += runeLen(p.Output)
	}
	type kv struct {
		k string
		v int
	}
	var arr []kv
	for k, v := range perContact {
		arr = append(arr, kv{k, v})
	}
	sort.Slice(arr, func(i, j int) bool { return arr[i].v > arr[j].v })
	top := make([]contactCount, 0, 10)
	for i := 0; i < len(arr) && i < 10; i++ {
		top = append(top, contactCount{ContactID: arr[i].k, Pairs: arr[i].v})
	}
	n := float64(len(pairs))
	return loraStats{
		TotalPairs:    len(pairs),
		ContactCount:  len(perContact),
		AvgInputLen:   roundTo1(float64(inSum) / n),
		AvgOutputLen:  roundTo1(float64(outSum) / n),
		GeneratedAt:   time.Now().Format(time.RFC3339),
		PerContactTop: top,
	}
}

func runeLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

func roundTo1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func buildLoRAFiles(pairs []LoRAPair, stats loraStats) (map[string][]byte, error) {
	files := make(map[string][]byte, 4)

	// data.jsonl
	var jsonlBuf bytes.Buffer
	enc := json.NewEncoder(&jsonlBuf)
	enc.SetEscapeHTML(false)
	for _, p := range pairs {
		if err := enc.Encode(p); err != nil {
			return nil, fmt.Errorf("写入 jsonl 失败: %w", err)
		}
	}
	files["data.jsonl"] = jsonlBuf.Bytes()

	// data.stats.json
	statsBytes, err := json.MarshalIndent(stats, "", "  ")
	if err != nil {
		return nil, err
	}
	files["data.stats.json"] = statsBytes

	files["README.md"] = []byte(loraReadme(stats))
	files["train.md"] = []byte(loraTrainGuide())

	return files, nil
}

func loraReadme(s loraStats) string {
	var sb strings.Builder
	sb.WriteString("# 我的写作风格 LoRA 训练集\n\n")
	sb.WriteString("从聊天记录里抽取的 (对方上一句, 我的回复) 配对，可以喂给 Unsloth / LLaMA-Factory / Axolotl 等工具微调一个用「你自己的口吻」说话的模型。\n\n")
	sb.WriteString("## 数据概览\n\n")
	sb.WriteString(fmt.Sprintf("- 总样本数: **%d** 条\n", s.TotalPairs))
	sb.WriteString(fmt.Sprintf("- 涉及联系人: %d 人（已匿名为 c01..cNN）\n", s.ContactCount))
	sb.WriteString(fmt.Sprintf("- 平均输入长度: %.1f 字\n", s.AvgInputLen))
	sb.WriteString(fmt.Sprintf("- 平均输出长度: %.1f 字\n", s.AvgOutputLen))
	sb.WriteString(fmt.Sprintf("- 生成时间: %s\n\n", s.GeneratedAt))

	sb.WriteString("## 文件\n\n")
	sb.WriteString("- `data.jsonl` — Alpaca 格式训练集，每行一个 JSON\n")
	sb.WriteString("- `data.stats.json` — 数据集统计\n")
	sb.WriteString("- `train.md` — 推荐 base model / 超参 / 训练流程\n\n")

	sb.WriteString("## 隐私警告\n\n")
	sb.WriteString("- **本文件包含你的真实聊天内容**（已脱敏手机号/邮箱/身份证/卡号/wxid）\n")
	sb.WriteString("- 联系人 wxid 已匿名化，但消息正文中可能仍含具体人名 — 训练前可视情况再过滤\n")
	sb.WriteString("- **训练产物（LoRA adapter / GGUF）不要公开分享** — 它会以你的口吻、依据你的真实经历回复\n")
	sb.WriteString("- 仅自用：本地 Ollama 运行 → 自己写邮件 / 朋友圈 / 文章草稿，避免 AI 腔\n")
	return sb.String()
}

func loraTrainGuide() string {
	return `# 训练食谱

## 推荐 base model（按显存档位）

| 显存 | 推荐底模 | 备注 |
|------|---------|------|
| 8 GB（4060Ti / M2 Pro 16G） | ` + "`Qwen2.5-3B-Instruct`" + ` 或 ` + "`Llama-3.2-3B-Instruct`" + ` | 入门档，4-bit QLoRA |
| 16 GB（4080 / M3 Max 32G） | ` + "`Qwen2.5-7B-Instruct`" + ` ⭐ 推荐 | 中文最佳平衡点 |
| 24 GB（4090 / 3090） | ` + "`Qwen2.5-14B-Instruct`" + ` | 风格还原最好 |
| 80 GB（A100 / H100） | ` + "`Qwen2.5-32B-Instruct`" + ` | 实验向，过拟合风险高 |

## 推荐工具：Unsloth

[Unsloth](https://github.com/unslothai/unsloth) 是单卡微调的事实标准，比 HuggingFace Trainer 快 2-5×、省 40% 显存。

### 一键 Colab notebook

- [Qwen2.5-7B Alpaca 模板](https://colab.research.google.com/github/unslothai/notebooks/blob/main/nb/Qwen2.5_(7B)-Alpaca.ipynb) — 直接把 ` + "`data.jsonl`" + ` 替换进去就能跑

### 本地 Linux/Mac

` + "```bash" + `
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
` + "```" + `

## 推荐超参（聊天数据微调）

` + "```python" + `
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
    max_seq_length=1024,        # 聊天数据短，1024 够用
    load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,                       # LoRA rank：聊天风格 16 已足够，过大易过拟合
    lora_alpha=32,
    lora_dropout=0.05,          # 关键 — 抑制过拟合
    target_modules=["q_proj","k_proj","v_proj","o_proj",
                    "gate_proj","up_proj","down_proj"],
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=1024,
    args=TrainingArguments(
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,  # 等效 batch=16
        warmup_steps=20,
        num_train_epochs=2,             # 2 轮通常够；3 轮起容易复读机
        learning_rate=1e-4,             # 风格学习用相对小的 lr
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=42,
        output_dir="outputs",
    ),
)
trainer.train()
` + "```" + `

## 数据格式化（Alpaca → ChatML）

` + "```python" + `
def to_chatml(ex):
    return {
        "text": (
            f"<|im_start|>user\n{ex['input']}<|im_end|>\n"
            f"<|im_start|>assistant\n{ex['output']}<|im_end|>"
        )
    }
dataset = dataset.map(to_chatml)
` + "```" + `

## 导出 GGUF + 喂给 Ollama

` + "```python" + `
# 训完后：
model.save_pretrained_gguf("my-style", tokenizer, quantization_method="q4_k_m")
` + "```" + `

生成 ` + "`my-style/Modelfile`" + `，复制到本地后：

` + "```bash" + `
cd my-style
ollama create welink-me -f Modelfile
ollama run welink-me
` + "```" + `

然后回到 WeLink 设置 → LLM provider 选 ` + "`Ollama`" + ` → 模型名 ` + "`welink-me`" + ` → AI 分身就能用你自己微调过的模型了。

## 效果验证 prompt

训完拿这几条试一下，看是否真的"像你"：

1. ` + "`今晚一起吃饭？`" + ` → 看回复语气是否符合你日常邀约风格
2. ` + "`这个我搞不定`" + ` → 看是否会用你常用的鼓励/吐槽方式
3. ` + "`周末干嘛`" + ` → 看话题方向是否符合你的兴趣
4. ` + "`好久不见`" + ` → 看寒暄风格

如果回复变成"作为一个 AI 助手"——说明欠拟合，加 epoch 或加大 rank。
如果回复全是"嗯""哦""好的"——说明过拟合，减 epoch、加 dropout、扩大数据集。

## 不要做的事

- ❌ **不要把训出来的模型公开分享** — 等同于把私聊给陌生人
- ❌ **不要用它假冒你本人对外发消息** — 法律和伦理双重风险
- ❌ **不要训超过 3 epoch** — 聊天数据高度同质，3 轮起严重过拟合，模型变成复读机
- ❌ **不要混入别人的发言（contact 类型数据）** — 那会污染你的风格特征
`
}
