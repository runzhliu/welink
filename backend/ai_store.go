package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// AIMessage 与前端 AnalysisMessage 结构对应
type AIMessage struct {
	Role         string  `json:"role"`
	Content      string  `json:"content"`
	Provider     string  `json:"provider,omitempty"`
	Model        string  `json:"model,omitempty"`
	ElapsedSecs  float64 `json:"elapsedSecs,omitempty"`
	TokensPerSec int     `json:"tokensPerSec,omitempty"`
	CharCount    int     `json:"charCount,omitempty"`
}

var (
	aiDB   *sql.DB
	aiDBMu sync.Mutex
)

// aiAnalysisDBPath 返回 AI 分析数据库路径：
// 优先使用 preferences 中的自定义路径，否则与 preferences.json 同目录。
func aiAnalysisDBPath() string {
	prefs := loadPreferences()
	if prefs.AIAnalysisDBPath != "" {
		return prefs.AIAnalysisDBPath
	}
	return filepath.Join(filepath.Dir(preferencesPath()), "ai_analysis.db")
}

// InitAIDB 初始化（或重新初始化）AI 分析数据库。
// 路径变更时关闭旧连接后重新打开。
func InitAIDB() error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()

	if aiDB != nil {
		aiDB.Close()
		aiDB = nil
	}

	path := aiAnalysisDBPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("ai_store: mkdir %s: %w", filepath.Dir(path), err)
	}

	// _busy_timeout 和 _journal_mode 写在 DSN 里，确保连接池中每条连接都继承该设置。
	dsn := path + "?_journal_mode=WAL&_busy_timeout=10000"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("ai_store: open %s: %w", path, err)
	}
	// 限制为单连接，避免 WAL 下多写连接争锁（读可并发）。
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS ai_conversations (
		key        TEXT NOT NULL PRIMARY KEY,
		messages   TEXT NOT NULL DEFAULT '[]',
		updated_at INTEGER NOT NULL
	)`)
	if err != nil {
		db.Close()
		return fmt.Errorf("ai_store: create table: %w", err)
	}
	aiDB = db
	if err := initFTSTables(); err != nil {
		db.Close()
		aiDB = nil
		return fmt.Errorf("ai_store: %w", err)
	}
	if err := initVecTables(); err != nil {
		db.Close()
		aiDB = nil
		return fmt.Errorf("ai_store: %w", err)
	}
	if err := initMemTables(); err != nil {
		db.Close()
		aiDB = nil
		return fmt.Errorf("ai_store: %w", err)
	}
	if err := initCloneTables(); err != nil {
		db.Close()
		aiDB = nil
		return fmt.Errorf("ai_store: %w", err)
	}
	if err := initSkillTables(); err != nil {
		db.Close()
		aiDB = nil
		return fmt.Errorf("ai_store: %w", err)
	}
	return nil
}

// CloseAIDB 关闭 AI 数据库连接（恢复备份时需要先释放文件句柄才能 rename）。
// 调用后 aiDB 为 nil，下次请求会触发 InitAIDB 重新打开。
func CloseAIDB() error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil
	}
	err := aiDB.Close()
	aiDB = nil
	return err
}

// GetAIConversation 返回指定 key 的历史消息，不存在时返回空切片。
func GetAIConversation(key string) ([]AIMessage, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("ai_store: database not initialized")
	}

	var raw string
	err := aiDB.QueryRow("SELECT messages FROM ai_conversations WHERE key = ?", key).Scan(&raw)
	if err == sql.ErrNoRows {
		return []AIMessage{}, nil
	}
	if err != nil {
		return nil, err
	}
	var msgs []AIMessage
	if err := json.Unmarshal([]byte(raw), &msgs); err != nil {
		return []AIMessage{}, nil
	}
	return msgs, nil
}

// PutAIConversation 保存（覆盖）指定 key 的消息列表。
func PutAIConversation(key string, msgs []AIMessage) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("ai_store: database not initialized")
	}

	raw, err := json.Marshal(msgs)
	if err != nil {
		return err
	}
	_, err = aiDB.Exec(`
		INSERT INTO ai_conversations (key, messages, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`,
		key, string(raw), time.Now().Unix())
	return err
}

// ConversationEntry 列表项（不含完整消息体，只含元数据）
type ConversationEntry struct {
	Key       string `json:"key"`
	UpdatedAt int64  `json:"updated_at"`
	Preview   string `json:"preview"` // 第一条 user 消息的前 50 字符
	MsgCount  int    `json:"msg_count"`
}

// ListAIConversations 按 key 前缀列出对话记录（按 updated_at 降序）
func ListAIConversations(prefix string) ([]ConversationEntry, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("ai_store: database not initialized")
	}
	rows, err := aiDB.Query(
		`SELECT key, messages, updated_at FROM ai_conversations WHERE key LIKE ? ORDER BY updated_at DESC`,
		prefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ConversationEntry
	for rows.Next() {
		var key, raw string
		var updatedAt int64
		if err := rows.Scan(&key, &raw, &updatedAt); err != nil {
			continue
		}
		var msgs []AIMessage
		_ = json.Unmarshal([]byte(raw), &msgs)
		preview := ""
		for _, m := range msgs {
			if m.Role == "user" && m.Content != "" {
				runes := []rune(m.Content)
				if len(runes) > 50 {
					preview = string(runes[:50]) + "…"
				} else {
					preview = m.Content
				}
				break
			}
		}
		list = append(list, ConversationEntry{
			Key:       key,
			UpdatedAt: updatedAt,
			Preview:   preview,
			MsgCount:  len(msgs),
		})
	}
	return list, nil
}

// AIConvSearchHit 是 SearchAIConversations 返回的单条匹配。
// Snippets 是从消息正文里裁出的上下文片段（带匹配词前后各 ~40 字符），最多 3 条。
type AIConvSearchHit struct {
	Key       string   `json:"key"`
	UpdatedAt int64    `json:"updated_at"`
	MsgCount  int      `json:"msg_count"`
	Preview   string   `json:"preview"`
	Snippets  []string `json:"snippets"`
}

// SearchAIConversations 在所有 ai_conversations 的 JSON 消息体里做子串搜索。
// 数据量小（每联系人至多一条），LIKE 已经够用，省去维护 FTS5 的复杂度。
func SearchAIConversations(query string, limit int) ([]AIConvSearchHit, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("ai_store: database not initialized")
	}
	q := strings.TrimSpace(query)
	if q == "" {
		return []AIConvSearchHit{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	// LIKE 转义：% 和 _ 是 SQL 通配符
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	pattern := "%" + esc + "%"
	rows, err := aiDB.Query(`
		SELECT key, messages, updated_at FROM ai_conversations
		WHERE messages LIKE ? ESCAPE '\'
		ORDER BY updated_at DESC
		LIMIT ?`, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	qLower := strings.ToLower(q)
	results := make([]AIConvSearchHit, 0)
	for rows.Next() {
		var key, raw string
		var updatedAt int64
		if err := rows.Scan(&key, &raw, &updatedAt); err != nil {
			continue
		}
		var msgs []AIMessage
		_ = json.Unmarshal([]byte(raw), &msgs)

		// 从每条消息里裁 3 条命中的片段
		var snippets []string
		var preview string
		for _, m := range msgs {
			if m.Content == "" {
				continue
			}
			if preview == "" && m.Role == "user" {
				runes := []rune(m.Content)
				if len(runes) > 50 {
					preview = string(runes[:50]) + "…"
				} else {
					preview = m.Content
				}
			}
			lower := strings.ToLower(m.Content)
			idx := strings.Index(lower, qLower)
			if idx < 0 {
				continue
			}
			// 按 rune 裁上下文（不按 byte，中文友好）
			runes := []rune(m.Content)
			qLen := len([]rune(q))
			// 把 byte idx 转成 rune idx（strings.Index 返回 byte 偏移）
			runeStart := len([]rune(m.Content[:idx]))
			from := runeStart - 40
			to := runeStart + qLen + 40
			if from < 0 {
				from = 0
			}
			if to > len(runes) {
				to = len(runes)
			}
			snippet := string(runes[from:to])
			if from > 0 {
				snippet = "…" + snippet
			}
			if to < len(runes) {
				snippet += "…"
			}
			snippets = append(snippets, snippet)
			if len(snippets) >= 3 {
				break
			}
		}
		if len(snippets) == 0 {
			// LIKE 命中了但循环里没挑到，可能是 key 或别的字段命中；回落到第一条消息
			if len(msgs) > 0 {
				snippets = append(snippets, msgs[0].Content)
			}
		}
		results = append(results, AIConvSearchHit{
			Key:       key,
			UpdatedAt: updatedAt,
			MsgCount:  len(msgs),
			Preview:   preview,
			Snippets:  snippets,
		})
	}
	return results, nil
}

// AIUsageStats 是所有 ai_conversations 里 assistant 消息的聚合统计。
// Tokens 的估算：tokens_per_sec * elapsed_secs（LLM 返回的 stream 速率），
// 不准确但够用来展示"大致用了多少"。
type AIUsageStats struct {
	TotalConversations int                   `json:"total_conversations"`
	TotalAssistantMsgs int                   `json:"total_assistant_msgs"`
	TotalChars         int64                 `json:"total_chars"`
	TotalTokens        int64                 `json:"total_tokens"`
	TotalElapsedSec    float64               `json:"total_elapsed_sec"`
	ByProvider         []AIUsageProviderStat `json:"by_provider"`
}

// AIUsageProviderStat 单个 provider 的小计
type AIUsageProviderStat struct {
	Provider    string  `json:"provider"`
	Model       string  `json:"model,omitempty"`
	Count       int     `json:"count"`
	Chars       int64   `json:"chars"`
	Tokens      int64   `json:"tokens"`
	ElapsedSec  float64 `json:"elapsed_sec"`
}

// GetAIUsageStats 扫描所有 ai_conversations 汇总用量。数据量小（每联系人至多 1 条），
// 全表扫 + 每行 JSON 解析是可接受的。
func GetAIUsageStats() (*AIUsageStats, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("ai_store: database not initialized")
	}

	rows, err := aiDB.Query("SELECT messages FROM ai_conversations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := &AIUsageStats{}
	byProvider := map[string]*AIUsageProviderStat{} // key: provider|model

	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var msgs []AIMessage
		if err := json.Unmarshal([]byte(raw), &msgs); err != nil {
			continue
		}
		stats.TotalConversations++
		for _, m := range msgs {
			if m.Role != "assistant" || m.Content == "" {
				continue
			}
			stats.TotalAssistantMsgs++
			chars := int64(m.CharCount)
			if chars == 0 {
				chars = int64(len([]rune(m.Content)))
			}
			tokens := int64(float64(m.TokensPerSec) * m.ElapsedSecs)
			stats.TotalChars += chars
			stats.TotalTokens += tokens
			stats.TotalElapsedSec += m.ElapsedSecs

			key := m.Provider + "|" + m.Model
			if m.Provider == "" {
				key = "未知|"
			}
			p := byProvider[key]
			if p == nil {
				p = &AIUsageProviderStat{Provider: m.Provider, Model: m.Model}
				if p.Provider == "" {
					p.Provider = "未知"
				}
				byProvider[key] = p
			}
			p.Count++
			p.Chars += chars
			p.Tokens += tokens
			p.ElapsedSec += m.ElapsedSecs
		}
	}
	for _, v := range byProvider {
		stats.ByProvider = append(stats.ByProvider, *v)
	}
	return stats, nil
}

// DeleteAIConversation 删除指定 key 的记录。
func DeleteAIConversation(key string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil
	}
	_, err := aiDB.Exec("DELETE FROM ai_conversations WHERE key = ?", key)
	return err
}

// ── AI 分身持久化 ──

// CloneProfile 持久化的 AI 分身学习结果
type CloneProfile struct {
	Username     string `json:"username"`
	Prompt       string `json:"prompt"`
	PrivateCount int    `json:"private_count"`
	GroupCount   int    `json:"group_count"`
	HasProfile   bool   `json:"has_profile"`
	HasRecent    bool   `json:"has_recent"`
	AvgMsgLen    int    `json:"avg_msg_len"`
	EmojiPct     int    `json:"emoji_pct"`
	UpdatedAt    int64  `json:"updated_at"`
}

func initCloneTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS clone_profiles (
		username      TEXT NOT NULL PRIMARY KEY,
		prompt        TEXT NOT NULL,
		private_count INTEGER NOT NULL DEFAULT 0,
		group_count   INTEGER NOT NULL DEFAULT 0,
		has_profile   INTEGER NOT NULL DEFAULT 0,
		has_recent    INTEGER NOT NULL DEFAULT 0,
		avg_msg_len   INTEGER NOT NULL DEFAULT 0,
		emoji_pct     INTEGER NOT NULL DEFAULT 0,
		updated_at    INTEGER NOT NULL
	)`)
	return err
}

// GetCloneProfile 获取缓存的分身档案
func GetCloneProfile(username string) (*CloneProfile, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("ai_store: database not initialized")
	}
	var p CloneProfile
	var hasProfile, hasRecent int
	err := aiDB.QueryRow(`SELECT username, prompt, private_count, group_count, has_profile, has_recent, avg_msg_len, emoji_pct, updated_at
		FROM clone_profiles WHERE username = ?`, username).Scan(
		&p.Username, &p.Prompt, &p.PrivateCount, &p.GroupCount, &hasProfile, &hasRecent, &p.AvgMsgLen, &p.EmojiPct, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.HasProfile = hasProfile != 0
	p.HasRecent = hasRecent != 0
	return &p, nil
}

// PutCloneProfile 保存分身档案
func PutCloneProfile(p *CloneProfile) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("ai_store: database not initialized")
	}
	hasProfile, hasRecent := 0, 0
	if p.HasProfile {
		hasProfile = 1
	}
	if p.HasRecent {
		hasRecent = 1
	}
	_, err := aiDB.Exec(`INSERT INTO clone_profiles (username, prompt, private_count, group_count, has_profile, has_recent, avg_msg_len, emoji_pct, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(username) DO UPDATE SET prompt=excluded.prompt, private_count=excluded.private_count, group_count=excluded.group_count,
		has_profile=excluded.has_profile, has_recent=excluded.has_recent, avg_msg_len=excluded.avg_msg_len, emoji_pct=excluded.emoji_pct, updated_at=excluded.updated_at`,
		p.Username, p.Prompt, p.PrivateCount, p.GroupCount, hasProfile, hasRecent, p.AvgMsgLen, p.EmojiPct, p.UpdatedAt)
	return err
}
