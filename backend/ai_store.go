package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
