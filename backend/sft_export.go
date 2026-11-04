package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"welink/backend/service"
)

const (
	sftSchemaVersion     = "welink-sft/v1"
	sftDefaultMaxSamples = 20000
	sftMinSamples        = 500
	sftSessionGapSeconds = int64(10 * 60)
	sftContextTurns      = 8
)

// SFTExportOptions describes the local dataset to build. TargetType is either
// "self" (learn the current user's replies) or "contact" (learn one contact).
type SFTExportOptions struct {
	TargetType  string
	Username    string
	MaxExamples int
}

type SFTMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type SFTExample struct {
	Messages []SFTMessage `json:"messages"`
	Meta     SFTMeta      `json:"meta,omitempty"`
}

type SFTMeta struct {
	ContactID string `json:"contact_id,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Date      string `json:"date,omitempty"`
}

type sftCandidate struct {
	Example   SFTExample
	Timestamp int64
	SessionID string
}

type sftSourceStats struct {
	SourceMessages   int `json:"source_messages"`
	TextMessages     int `json:"text_messages"`
	DroppedSensitive int `json:"dropped_sensitive"`
	DroppedInvalid   int `json:"dropped_invalid"`
}

type sftDatasetStats struct {
	SchemaVersion      string         `json:"schema_version"`
	TargetType         string         `json:"target_type"`
	TotalExamples      int            `json:"total_examples"`
	TrainExamples      int            `json:"train_examples"`
	ValidationExamples int            `json:"validation_examples"`
	TestExamples       int            `json:"test_examples"`
	SessionCount       int            `json:"session_count"`
	ContactCount       int            `json:"contact_count"`
	AverageTurns       float64        `json:"average_turns"`
	AverageReplyRunes  float64        `json:"average_reply_runes"`
	Source             sftSourceStats `json:"source"`
	GeneratedAt        string         `json:"generated_at"`
}

type sftManifest struct {
	SchemaVersion string   `json:"schema_version"`
	Format        string   `json:"format"`
	TargetType    string   `json:"target_type"`
	Splits        []string `json:"splits"`
	Framework     string   `json:"framework"`
	DefaultModel  string   `json:"default_model"`
	DatasetSHA256 string   `json:"dataset_sha256"`
	Privacy       string   `json:"privacy"`
}

type sftTurn struct {
	Role      string
	Content   string
	Timestamp int64
	Date      string
}

// BuildSFTExportZip builds an ms-swift-ready messages dataset without invoking
// an LLM or sending any chat data over the network.
func BuildSFTExportZip(svc *service.ContactService, opts SFTExportOptions) ([]byte, string, error) {
	if svc == nil {
		return nil, "", fmt.Errorf("服务未就绪")
	}
	if opts.TargetType != "self" && opts.TargetType != "contact" {
		return nil, "", fmt.Errorf("SFT 训练集仅支持 self 或 contact 类型")
	}
	if opts.TargetType == "contact" && strings.TrimSpace(opts.Username) == "" {
		return nil, "", fmt.Errorf("联系人 SFT 训练集必须指定 username")
	}

	maxExamples := opts.MaxExamples
	if maxExamples <= 0 {
		maxExamples = sftDefaultMaxSamples
	}
	if maxExamples < sftMinSamples {
		maxExamples = sftMinSamples
	}
	if maxExamples > sftDefaultMaxSamples {
		maxExamples = sftDefaultMaxSamples
	}

	var (
		candidates   []sftCandidate
		source       sftSourceStats
		contactCount int
	)

	if opts.TargetType == "contact" {
		msgs := svc.ExportContactMessagesAll(opts.Username)
		var oneStats sftSourceStats
		candidates, oneStats = buildSFTCandidates(msgs, false, "c01")
		source = addSFTSourceStats(source, oneStats)
		if len(candidates) > 0 {
			contactCount = 1
		}
	} else {
		type contactActivity struct {
			username string
			count    int64
		}
		contacts := make([]contactActivity, 0)
		contactBuckets := make([][]sftCandidate, 0)
		for _, stat := range svc.GetCachedStats() {
			if stat.MyMessages > 0 {
				contacts = append(contacts, contactActivity{username: stat.Username, count: stat.MyMessages})
			}
		}
		sort.Slice(contacts, func(i, j int) bool { return contacts[i].count > contacts[j].count })
		for i, contact := range contacts {
			contactID := fmt.Sprintf("c%02d", i+1)
			built, oneStats := buildSFTCandidates(svc.ExportContactMessagesAll(contact.username), true, contactID)
			source = addSFTSourceStats(source, oneStats)
			if len(built) == 0 {
				continue
			}
			built = dedupeSFTCandidates(built)
			contactCount++
			if len(built) > maxExamples {
				built = sampleSFTCandidatesEvenly(built, maxExamples)
			}
			contactBuckets = append(contactBuckets, built)
		}
		totalCandidates := 0
		for _, bucket := range contactBuckets {
			totalCandidates += len(bucket)
		}
		// Round-robin the complete pool before global deduplication. This lets
		// later unique samples refill slots occupied by generic duplicate replies.
		candidates = dedupeSFTCandidates(roundRobinSFTCandidates(contactBuckets, totalCandidates))
		if len(candidates) > maxExamples {
			candidates = candidates[:maxExamples]
		}
	}

	candidates = dedupeSFTCandidates(candidates)
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Timestamp == candidates[j].Timestamp {
			return candidates[i].SessionID < candidates[j].SessionID
		}
		return candidates[i].Timestamp < candidates[j].Timestamp
	})
	if len(candidates) > maxExamples {
		candidates = sampleSFTCandidatesEvenly(candidates, maxExamples)
	}
	if len(candidates) < sftMinSamples {
		return nil, "", fmt.Errorf("可用样本太少（%d 条），需要至少 %d 条才能训练", len(candidates), sftMinSamples)
	}
	if sessionCount := countSFTSessions(candidates); sessionCount < 3 {
		return nil, "", fmt.Errorf("有效会话太少（%d 个），至少需要 3 个独立会话才能安全切分训练、验证和测试集", sessionCount)
	}

	train, validation, test := splitSFTCandidates(candidates)
	files, err := buildSFTFiles(candidates, train, validation, test, contactCount, source, opts.TargetType)
	if err != nil {
		return nil, "", err
	}
	zipBytes, err := makeSkillZip(files)
	if err != nil {
		return nil, "", err
	}
	filename := fmt.Sprintf("welink-%s-sft-%s.zip", opts.TargetType, time.Now().Format("20060102-150405"))
	return zipBytes, filename, nil
}

// roundRobinSFTCandidates prevents one high-volume contact from drowning out
// every other writing context. When smaller buckets are exhausted, larger ones
// continue filling the requested limit, so users with only one or two contacts
// can still reach the minimum sample threshold.
func roundRobinSFTCandidates(buckets [][]sftCandidate, limit int) []sftCandidate {
	positions := make([]int, len(buckets))
	out := make([]sftCandidate, 0, limit)
	for len(out) < limit {
		added := false
		for i, bucket := range buckets {
			if positions[i] >= len(bucket) {
				continue
			}
			out = append(out, bucket[positions[i]])
			positions[i]++
			added = true
			if len(out) >= limit {
				break
			}
		}
		if !added {
			break
		}
	}
	return out
}

func addSFTSourceStats(a, b sftSourceStats) sftSourceStats {
	a.SourceMessages += b.SourceMessages
	a.TextMessages += b.TextMessages
	a.DroppedSensitive += b.DroppedSensitive
	a.DroppedInvalid += b.DroppedInvalid
	return a
}

// buildSFTCandidates maps a two-party conversation into training examples. A
// candidate always ends in the target person's assistant reply and carries up
// to sftContextTurns prior turns from the same session.
func buildSFTCandidates(msgs []service.ChatMessage, targetIsMine bool, contactID string) ([]sftCandidate, sftSourceStats) {
	stats := sftSourceStats{SourceMessages: len(msgs)}
	turns := make([]sftTurn, 0, len(msgs))
	appendBreak := func(msg service.ChatMessage) {
		if len(turns) > 0 && turns[len(turns)-1].Role != "break" {
			turns = append(turns, sftTurn{Role: "break", Timestamp: parseChatMsgTs(msg), Date: msg.Date})
		}
	}
	for _, msg := range msgs {
		if msg.Type != 1 {
			stats.DroppedInvalid++
			appendBreak(msg)
			continue
		}
		if containsSensitive(msg.Content) {
			stats.DroppedSensitive++
			appendBreak(msg)
			continue
		}
		content := cleanForLoRA(msg.Content)
		if content == "" || !rangeOK(content, 1, 500) {
			stats.DroppedInvalid++
			appendBreak(msg)
			continue
		}
		stats.TextMessages++
		isTarget := msg.IsMine == targetIsMine
		role := "user"
		if isTarget {
			role = "assistant"
		}
		turn := sftTurn{
			Role:      role,
			Content:   content,
			Timestamp: parseChatMsgTs(msg),
			Date:      msg.Date,
		}
		if len(turns) > 0 {
			last := &turns[len(turns)-1]
			gap := turn.Timestamp - last.Timestamp
			if last.Role == turn.Role && (turn.Timestamp == 0 || last.Timestamp == 0 || gap <= sftSessionGapSeconds) {
				last.Content += "\n" + turn.Content
				last.Timestamp = turn.Timestamp
				last.Date = turn.Date
				continue
			}
		}
		turns = append(turns, turn)
	}

	var out []sftCandidate
	sessionStart := 0
	sessionSeq := 0
	flush := func(end int) {
		if end <= sessionStart {
			return
		}
		sessionSeq++
		sessionID := fmt.Sprintf("%s-s%06d", contactID, sessionSeq)
		out = append(out, sftExamplesFromSession(turns[sessionStart:end], contactID, sessionID)...)
	}
	for i := 1; i < len(turns); i++ {
		if turns[i].Role == "break" {
			flush(i)
			sessionStart = i + 1
			continue
		}
		if turns[i-1].Role == "break" {
			sessionStart = i
			continue
		}
		if turns[i].Timestamp > 0 && turns[i-1].Timestamp > 0 && turns[i].Timestamp-turns[i-1].Timestamp > sftSessionGapSeconds {
			flush(i)
			sessionStart = i
		}
	}
	flush(len(turns))
	return out, stats
}

func sftExamplesFromSession(turns []sftTurn, contactID, sessionID string) []sftCandidate {
	out := make([]sftCandidate, 0)
	for end, turn := range turns {
		if turn.Role != "assistant" {
			continue
		}
		start := end - sftContextTurns + 1
		if start < 0 {
			start = 0
		}
		for start < end && turns[start].Role != "user" {
			start++
		}
		if start >= end || turns[start].Role != "user" {
			continue
		}
		messages := make([]SFTMessage, 0, end-start+2)
		messages = append(messages, SFTMessage{
			Role:    "system",
			Content: "这是私人聊天。请以目标人物平时的口吻自然回复，不解释角色设定，不声称自己是通用 AI 助手。",
		})
		for _, item := range turns[start : end+1] {
			messages = append(messages, SFTMessage{Role: item.Role, Content: item.Content})
		}
		out = append(out, sftCandidate{
			Example: SFTExample{
				Messages: messages,
				Meta:     SFTMeta{ContactID: contactID, SessionID: sessionID, Date: turn.Date},
			},
			Timestamp: turn.Timestamp,
			SessionID: sessionID,
		})
	}
	return out
}

func dedupeSFTCandidates(in []sftCandidate) []sftCandidate {
	seen := make(map[string]struct{}, len(in))
	out := make([]sftCandidate, 0, len(in))
	for _, candidate := range in {
		var key strings.Builder
		for _, msg := range candidate.Example.Messages {
			key.WriteString(msg.Role)
			key.WriteByte(0)
			key.WriteString(msg.Content)
			key.WriteByte(0)
		}
		sum := sha256.Sum256([]byte(key.String()))
		hash := hex.EncodeToString(sum[:])
		if _, ok := seen[hash]; ok {
			continue
		}
		seen[hash] = struct{}{}
		out = append(out, candidate)
	}
	return out
}

func sampleSFTCandidatesEvenly(in []sftCandidate, limit int) []sftCandidate {
	if limit <= 0 || len(in) <= limit {
		return in
	}
	out := make([]sftCandidate, 0, limit)
	step := float64(len(in)) / float64(limit)
	for i := 0; i < limit; i++ {
		idx := int(float64(i) * step)
		if idx >= len(in) {
			idx = len(in) - 1
		}
		out = append(out, in[idx])
	}
	return out
}

func countSFTSessions(candidates []sftCandidate) int {
	sessions := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		sessions[candidate.SessionID] = struct{}{}
	}
	return len(sessions)
}

// splitSFTCandidates performs an 80/10/10 chronological split while keeping
// every session in exactly one split to prevent near-duplicate leakage.
func splitSFTCandidates(in []sftCandidate) (train, validation, test []sftCandidate) {
	if len(in) == 0 {
		return nil, nil, nil
	}
	type sessionGroup struct {
		id    string
		first int64
		items []sftCandidate
	}
	byID := make(map[string]*sessionGroup)
	for _, candidate := range in {
		group := byID[candidate.SessionID]
		if group == nil {
			group = &sessionGroup{id: candidate.SessionID, first: candidate.Timestamp}
			byID[candidate.SessionID] = group
		}
		if group.first == 0 || candidate.Timestamp < group.first {
			group.first = candidate.Timestamp
		}
		group.items = append(group.items, candidate)
	}
	groups := make([]*sessionGroup, 0, len(byID))
	for _, group := range byID {
		groups = append(groups, group)
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].first == groups[j].first {
			return groups[i].id < groups[j].id
		}
		return groups[i].first < groups[j].first
	})

	if len(groups) < 3 {
		// Never split examples from one session merely to force non-empty files.
		// BuildSFTExportZip rejects this case with a user-facing error.
		return append(train, in...), nil, nil
	}

	trainTarget := len(in) * 8 / 10
	validationTarget := len(in) * 9 / 10
	count := 0
	groupIndex := 0
	for groupIndex < len(groups)-2 {
		group := groups[groupIndex]
		train = append(train, group.items...)
		count += len(group.items)
		groupIndex++
		if count >= trainTarget {
			break
		}
	}
	for groupIndex < len(groups)-1 {
		group := groups[groupIndex]
		validation = append(validation, group.items...)
		count += len(group.items)
		groupIndex++
		if count >= validationTarget {
			break
		}
	}
	for ; groupIndex < len(groups); groupIndex++ {
		test = append(test, groups[groupIndex].items...)
	}
	return train, validation, test
}

func buildSFTFiles(all, train, validation, test []sftCandidate, contactCount int, source sftSourceStats, targetType string) (map[string][]byte, error) {
	allJSONL, err := encodeSFTJSONL(all)
	if err != nil {
		return nil, err
	}
	trainJSONL, err := encodeSFTJSONL(train)
	if err != nil {
		return nil, err
	}
	validationJSONL, err := encodeSFTJSONL(validation)
	if err != nil {
		return nil, err
	}
	testJSONL, err := encodeSFTJSONL(test)
	if err != nil {
		return nil, err
	}

	stats := computeSFTDatasetStats(all, train, validation, test, contactCount, source, targetType)
	statsJSON, err := json.MarshalIndent(stats, "", "  ")
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(allJSONL)
	manifest := sftManifest{
		SchemaVersion: sftSchemaVersion,
		Format:        "messages-jsonl",
		TargetType:    targetType,
		Splits:        []string{"train.jsonl", "validation.jsonl", "test.jsonl"},
		Framework:     "ms-swift",
		DefaultModel:  "Qwen/Qwen3-4B-Instruct-2507",
		DatasetSHA256: hex.EncodeToString(digest[:]),
		Privacy:       "local-only; review samples before training; do not share datasets or adapters",
	}
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}

	return map[string][]byte{
		"data.jsonl":       allJSONL, // backward-compatible complete dataset
		"train.jsonl":      trainJSONL,
		"validation.jsonl": validationJSONL,
		"test.jsonl":       testJSONL,
		"data.stats.json":  statsJSON,
		"manifest.json":    manifestJSON,
		"README.md":        []byte(sftReadme(stats)),
		"train.sh":         []byte(sftTrainScript()),
		"deploy.sh":        []byte(sftDeployScript()),
	}, nil
}

func encodeSFTJSONL(candidates []sftCandidate) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	for _, candidate := range candidates {
		if err := encoder.Encode(candidate.Example); err != nil {
			return nil, fmt.Errorf("写入 SFT jsonl 失败: %w", err)
		}
	}
	return buf.Bytes(), nil
}

func computeSFTDatasetStats(all, train, validation, test []sftCandidate, contactCount int, source sftSourceStats, targetType string) sftDatasetStats {
	sessions := make(map[string]struct{})
	turns := 0
	replyRunes := 0
	for _, candidate := range all {
		sessions[candidate.SessionID] = struct{}{}
		turns += len(candidate.Example.Messages) - 1 // exclude system
		if messages := candidate.Example.Messages; len(messages) > 0 {
			replyRunes += runeLen(messages[len(messages)-1].Content)
		}
	}
	denominator := float64(max(1, len(all)))
	return sftDatasetStats{
		SchemaVersion:      sftSchemaVersion,
		TargetType:         targetType,
		TotalExamples:      len(all),
		TrainExamples:      len(train),
		ValidationExamples: len(validation),
		TestExamples:       len(test),
		SessionCount:       len(sessions),
		ContactCount:       contactCount,
		AverageTurns:       roundTo1(float64(turns) / denominator),
		AverageReplyRunes:  roundTo1(float64(replyRunes) / denominator),
		Source:             source,
		GeneratedAt:        time.Now().Format(time.RFC3339),
	}
}

func sftReadme(stats sftDatasetStats) string {
	return fmt.Sprintf(`# WeLink SFT / LoRA 训练集

这是从本地聊天记录构造的 ms-swift messages 格式数据集。训练目标为 **%s**。

## 数据概览

- 训练样本：%d
- 验证样本：%d
- 测试样本：%d
- 会话数：%d
- 联系人数：%d
- 平均上下文轮数：%.1f
- 平均目标回复长度：%.1f 字

## 文件

- `+"`train.jsonl`"+` / `+"`validation.jsonl`"+` / `+"`test.jsonl`"+`：按会话隔离、按时间顺序切分
- `+"`data.jsonl`"+`：完整数据集，向后兼容
- `+"`manifest.json`"+`：数据格式、默认模型与 SHA-256
- `+"`train.sh`"+`：ms-swift LoRA 训练命令
- `+"`deploy.sh`"+`：启动 OpenAI 兼容推理服务

## 开始训练

先安装并检查与你的 CUDA/PyTorch 环境兼容的 ms-swift，再执行：

`+"```bash"+`
bash train.sh
`+"```"+`

可以覆盖默认模型和输出目录：

`+"```bash"+`
MODEL=Qwen/Qwen3-4B-Instruct-2507 OUTPUT_DIR=outputs/welink-personal bash train.sh
`+"```"+`

## 隐私

数据经过手机号、邮箱、身份证、银行卡号和 wxid 基础脱敏，但仍可能包含姓名、地址、公司、项目或私人事件。训练前务必抽查 JSONL；数据集、LoRA adapter 和合并模型都不要公开分享。
`, stats.TargetType, stats.TrainExamples, stats.ValidationExamples, stats.TestExamples, stats.SessionCount, stats.ContactCount, stats.AverageTurns, stats.AverageReplyRunes)
}

func sftTrainScript() string {
	return `#!/usr/bin/env bash
set -euo pipefail

MODEL="${MODEL:-Qwen/Qwen3-4B-Instruct-2507}"
OUTPUT_DIR="${OUTPUT_DIR:-outputs/welink-personal}"

swift sft \
  --model "$MODEL" \
  --dataset train.jsonl \
  --val_dataset validation.jsonl \
  --tuner_type lora \
  --target_modules all-linear \
  --lora_rank 16 \
  --lora_alpha 32 \
  --lora_dropout 0.05 \
  --torch_dtype bfloat16 \
  --num_train_epochs 2 \
  --learning_rate 1e-4 \
  --per_device_train_batch_size 1 \
  --per_device_eval_batch_size 1 \
  --gradient_accumulation_steps 16 \
  --max_length 1024 \
  --eval_steps 50 \
  --save_steps 50 \
  --logging_steps 5 \
  --save_total_limit 2 \
  --output_dir "$OUTPUT_DIR"
`
}

func sftDeployScript() string {
	return `#!/usr/bin/env bash
set -euo pipefail

ADAPTER="${1:?usage: bash deploy.sh /path/to/checkpoint}"
PORT="${PORT:-8000}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-welink-personal}"

swift deploy \
  --adapters "$ADAPTER" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --served_model_name "$SERVED_MODEL_NAME"
`
}
