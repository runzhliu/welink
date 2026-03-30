package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ─── 表初始化 ─────────────────────────────────────────────────────────────────

// initMemTables 在 aiDB 中创建记忆事实表。
// 必须在 aiDBMu 持有期间调用（由 InitAIDB 调用）。
func initMemTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS mem_facts (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		contact_key TEXT    NOT NULL,
		fact        TEXT    NOT NULL,
		source_from INTEGER NOT NULL DEFAULT 0,
		source_to   INTEGER NOT NULL DEFAULT 0,
		embedding   BLOB    NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("mem: mem_facts: %w", err)
	}
	_, err = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_mem_contact ON mem_facts(contact_key)`)
	if err != nil {
		return fmt.Errorf("mem: idx_mem_contact: %w", err)
	}
	return nil
}

// ─── 状态查询 ─────────────────────────────────────────────────────────────────

// GetMemFactsCount 返回指定 key 已提炼的事实数量。
func GetMemFactsCount(key string) (int, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return 0, nil
	}
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM mem_facts WHERE contact_key = ?", key).Scan(&count)
	return count, err
}

// MemFact 是单条记忆事实的展示结构。
type MemFact struct {
	ID         int    `json:"id"`
	Fact       string `json:"fact"`
	SourceFrom int    `json:"source_from"`
	SourceTo   int    `json:"source_to"`
}

// GetMemFacts 返回指定 key 的所有事实（按 id 升序）。
func GetMemFacts(key string) ([]MemFact, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return nil, nil
	}
	rows, err := db.Query(
		"SELECT id, fact, source_from, source_to FROM mem_facts WHERE contact_key = ? ORDER BY id",
		key,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var facts []MemFact
	for rows.Next() {
		var f MemFact
		rows.Scan(&f.ID, &f.Fact, &f.SourceFrom, &f.SourceTo)
		facts = append(facts, f)
	}
	if facts == nil {
		facts = []MemFact{}
	}
	return facts, nil
}

// ─── LLM 提炼 ─────────────────────────────────────────────────────────────────

const memExtractChunkSize = 80 // 每批送给 LLM 的消息条数

// extractAndStoreFacts 将消息分批送给 LLM 提炼事实，再对事实做 embedding 存库。
//
//   - startChunk：从哪个批次开始（0 = 全新，>0 = 续传）。调用方负责在续传时不清空 mem_facts。
//   - onProgress：每批完成后回调 (当前已完成批数, 总批数)，可为 nil。
//   - onChunkDone：每批完成后回调该批的索引（用于写检查点），可为 nil。
//
// 返回本次新增的事实数；若所有批次均失败则同时返回最后一个错误。
func extractAndStoreFacts(
	key string, msgs []rawMsg, prefs Preferences, db *sql.DB, embCfg EmbeddingConfig,
	startChunk int,
	onProgress func(done, total int),
	onChunkDone func(chunkIdx int),
) (int, error) {
	totalChunks := (len(msgs) + memExtractChunkSize - 1) / memExtractChunkSize
	total := 0
	var lastErr error

	for chunkIdx := startChunk; chunkIdx < totalChunks; chunkIdx++ {
		i := chunkIdx * memExtractChunkSize
		end := i + memExtractChunkSize
		if end > len(msgs) {
			end = len(msgs)
		}
		chunk := msgs[i:end]

		facts, err := extractFactsFromChunk(chunk, memLLMPrefs(prefs))
		if err != nil {
			lastErr = err
		} else if len(facts) > 0 {
			embeddings, err := GetEmbeddingsBatch(facts, embCfg)
			if err != nil {
				lastErr = err
			} else {
				tx, err := db.Begin()
				if err == nil {
					stmt, err := tx.Prepare(
						"INSERT INTO mem_facts(contact_key, fact, source_from, source_to, embedding) VALUES(?,?,?,?,?)")
					if err != nil {
						tx.Rollback()
					} else {
						for j, emb := range embeddings {
							if emb == nil || j >= len(facts) {
								continue
							}
							if _, err := stmt.Exec(key, facts[j], i, end-1, encodeVec(emb)); err == nil {
								total++
							}
						}
						stmt.Close()
						tx.Commit()
					}
				}
			}
		}
		// 每批完成后先写检查点，再上报进度
		if onChunkDone != nil {
			onChunkDone(chunkIdx)
		}
		if onProgress != nil {
			onProgress(chunkIdx+1, totalChunks) // chunkIdx+1 = 含本批在内的已完成批数
		}
	}
	if total == 0 && lastErr != nil {
		return 0, lastErr
	}
	return total, nil
}

// memLLMPrefs 返回用于记忆提炼的 Preferences 副本。
// - 若用户配置了 MemLLMBaseURL 或 MemLLMModel，则使用本地 Ollama 专用配置（隐私保护）。
// - 若两者均为空，则直接复用主 LLM 配置（与 AI 分析使用同一模型）。
func memLLMPrefs(prefs Preferences) Preferences {
	if prefs.MemLLMBaseURL == "" && prefs.MemLLMModel == "" {
		// 未配置专用模型，沿用主 LLM
		return prefs
	}
	p := prefs
	p.LLMProvider = "ollama"
	p.LLMAPIKey = ""
	if prefs.MemLLMBaseURL != "" {
		p.LLMBaseURL = prefs.MemLLMBaseURL
	} else {
		p.LLMBaseURL = "http://localhost:11434/v1"
	}
	if prefs.MemLLMModel != "" {
		p.LLMModel = prefs.MemLLMModel
	} else {
		p.LLMModel = "qwen2.5:7b"
	}
	return p
}

// extractFactsFromChunk 调用 LLM 从一批消息中提炼事实列表。
func extractFactsFromChunk(chunk []rawMsg, prefs Preferences) ([]string, error) {
	var sb strings.Builder
	for _, m := range chunk {
		sb.WriteString(m.DateTime)
		sb.WriteString(" ")
		sb.WriteString(m.Sender)
		sb.WriteString(": ")
		sb.WriteString(truncateRunes(m.Content, 80))
		sb.WriteString("\n")
	}

	prompt := "从以下聊天记录中提取关键事实，以JSON数组格式输出。\n" +
		"规则：\n" +
		"1. 每条事实是一句完整的中文陈述\n" +
		"2. 只提取有价值的信息：喜好、经历、观点、习惯、工作、地点、人际关系等\n" +
		"3. 忽略寒暄、日常问候、无意义闲聊\n" +
		"4. 用【对方】指代聊天对象\n" +
		"5. 只输出JSON数组，不加任何解释，例如：[\"对方喜欢爬山\", \"对方在北京工作\"]\n" +
		"6. 如果没有有价值的事实，输出：[]\n\n" +
		"聊天记录：\n" + sb.String() + "\n输出："

	reply, err := CompleteLLM([]LLMMessage{{Role: "user", Content: prompt}}, prefs)
	if err != nil {
		return nil, err
	}

	reply = strings.TrimSpace(reply)
	// 有些模型会在 JSON 前后加文字，尝试提取 [...] 部分
	if start := strings.Index(reply, "["); start >= 0 {
		if end := strings.LastIndex(reply, "]"); end > start {
			reply = reply[start : end+1]
		}
	}

	var facts []string
	if err := json.Unmarshal([]byte(reply), &facts); err != nil {
		return nil, fmt.Errorf("解析JSON失败：%w (原文：%s)", err, truncate(reply, 120))
	}

	out := facts[:0]
	for _, f := range facts {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out, nil
}

// ─── 检索 ─────────────────────────────────────────────────────────────────────

// SearchMemFacts 对 mem_facts 执行语义检索，返回 top-K 最相关事实。
func SearchMemFacts(key, query string, topK int, prefs Preferences) ([]string, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return nil, nil
	}

	cfg := defaultEmbeddingConfig(prefs)
	queryEmbs, err := GetEmbeddingsBatch([]string{query}, cfg)
	if err != nil || len(queryEmbs) == 0 || queryEmbs[0] == nil {
		return nil, err
	}
	queryVec := queryEmbs[0]

	rows, err := db.Query(`SELECT fact, embedding FROM mem_facts WHERE contact_key = ?`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type scored struct {
		fact string
		sim  float32
	}
	var candidates []scored
	for rows.Next() {
		var fact string
		var blob []byte
		rows.Scan(&fact, &blob)
		vec := decodeVec(blob)
		if len(vec) != len(queryVec) {
			continue
		}
		candidates = append(candidates, scored{fact, cosineSimilarity(queryVec, vec)})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].sim > candidates[j].sim
	})
	if len(candidates) > topK {
		candidates = candidates[:topK]
	}

	out := make([]string, len(candidates))
	for i, c := range candidates {
		out[i] = c.fact
	}
	return out, nil
}
