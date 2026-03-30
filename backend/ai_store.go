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
