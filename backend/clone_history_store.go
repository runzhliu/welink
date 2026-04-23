package main

// clone_history_store.go — AI 分身对话长期记忆
//
// 原本 cloneCache 是内存 map，进程重启就清空，用户每次重新打开分身
// 都是从头聊。这里做持久化：每条对话（用户消息 + 分身回复）都按时间
// 存到 ai_analysis.db，下次进入分身时用它预填消息列表。
//
// 表：clone_chat_history (id / username / role / content / created_at)
// 注意 username 是裸字段（跟 clone_profiles.username 对齐），不是带
// contact: 前缀的 contact_key。

import (
	"database/sql"
	"fmt"
	"time"
)

type CloneChatMsg struct {
	ID        int64  `json:"id"`
	Username  string `json:"username,omitempty"`
	Role      string `json:"role"` // "user" / "assistant"
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

func initCloneHistoryTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS clone_chat_history (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		username   TEXT    NOT NULL,
		role       TEXT    NOT NULL,
		content    TEXT    NOT NULL,
		created_at INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("clone_history: create table: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_clone_hist_user_time ON clone_chat_history(username, created_at ASC)`)
	return nil
}

// AppendCloneChatMsg 追加一条对话，返回自增 id。
func AppendCloneChatMsg(username, role, content string) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("clone_history: db not initialized")
	}
	if role != "user" && role != "assistant" {
		return 0, fmt.Errorf("clone_history: role must be user/assistant")
	}
	res, err := aiDB.Exec(
		`INSERT INTO clone_chat_history (username, role, content, created_at) VALUES (?, ?, ?, ?)`,
		username, role, content, time.Now().Unix(),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListCloneChatHistory 按时间升序（旧→新）返回指定 username 的历史。
//   - limit ≤ 0 时默认 200（再多的话 UI 会卡，LLM 也塞不下；
//     真有极长历史的用户可以在 UI 里拉分页）
func ListCloneChatHistory(username string, limit int) ([]CloneChatMsg, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("clone_history: db not initialized")
	}
	if limit <= 0 {
		limit = 200
	}
	// 取最近 limit 条，再按时间升序返回（所以内部两次排序）
	rows, err := aiDB.Query(`
		SELECT id, role, content, created_at FROM (
			SELECT id, role, content, created_at FROM clone_chat_history
			WHERE username = ? ORDER BY created_at DESC LIMIT ?
		) ORDER BY created_at ASC`, username, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CloneChatMsg
	for rows.Next() {
		var m CloneChatMsg
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			continue
		}
		m.Username = username
		out = append(out, m)
	}
	if out == nil {
		out = []CloneChatMsg{}
	}
	return out, nil
}

// DeleteCloneChatHistory 清空指定 username 的全部对话记忆。
func DeleteCloneChatHistory(username string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("clone_history: db not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM clone_chat_history WHERE username = ?`, username)
	return err
}

// DeleteCloneChatMsg 删除单条（用户撤回某条消息场景）。
func DeleteCloneChatMsg(id int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("clone_history: db not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM clone_chat_history WHERE id = ?`, id)
	return err
}

// 防止 database/sql 未使用（仅当前 file 没走 sql.ErrNoRows 也不会报）
var _ = sql.ErrNoRows
