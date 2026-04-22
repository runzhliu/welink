package main

// podcast_store.go — 播客脚本持久化
//
// 每次 /podcast/generate-script 成功都落库一条，允许用户回到历史列表
// 选一条重新播放（免掉重新调 LLM + TTS 再合成的成本）。
// 表 podcast_scripts 放在 ai_analysis.db。

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PodcastScriptRecord 对应 podcast_scripts 表一行。
// Lines 存成 JSON（A/B speaker + text 对白序列）。
type PodcastScriptRecord struct {
	ID              int64         `json:"id"`
	ContactUsername string        `json:"contact_username"`
	ContactName     string        `json:"contact_name"`
	DurationMin     int           `json:"duration_min"`
	Title           string        `json:"title"`
	Lines           []PodcastLine `json:"lines"`
	Summary         string        `json:"summary,omitempty"`
	CreatedAt       int64         `json:"created_at"`
}

func initPodcastTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS podcast_scripts (
		id                INTEGER PRIMARY KEY AUTOINCREMENT,
		contact_username  TEXT    NOT NULL,
		contact_name      TEXT    NOT NULL DEFAULT '',
		duration_min      INTEGER NOT NULL DEFAULT 5,
		title             TEXT    NOT NULL DEFAULT '',
		lines_json        TEXT    NOT NULL DEFAULT '[]',
		summary           TEXT    NOT NULL DEFAULT '',
		created_at        INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("podcast: create table: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_podcast_contact_time ON podcast_scripts(contact_username, created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_podcast_time ON podcast_scripts(created_at DESC)`)
	return nil
}

// SavePodcastScript 落一条新记录，返回自增 id。
func SavePodcastScript(r *PodcastScriptRecord) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("podcast_store: database not initialized")
	}
	linesJSON, err := json.Marshal(r.Lines)
	if err != nil {
		return 0, fmt.Errorf("podcast: marshal lines: %w", err)
	}
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	res, err := aiDB.Exec(
		`INSERT INTO podcast_scripts
			(contact_username, contact_name, duration_min, title, lines_json, summary, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ContactUsername, r.ContactName, r.DurationMin, r.Title, string(linesJSON), r.Summary, r.CreatedAt,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListPodcastScripts 返回历史列表（按 created_at 降序）。
//   - contactUsername 非空时只返回该联系人的；空返所有
//   - limit ≤ 0 时默认 50
func ListPodcastScripts(contactUsername string, limit int) ([]PodcastScriptRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("podcast_store: database not initialized")
	}
	if limit <= 0 {
		limit = 50
	}
	var (
		rows *sql.Rows
		err  error
	)
	if contactUsername == "" {
		rows, err = aiDB.Query(
			`SELECT id, contact_username, contact_name, duration_min, title, lines_json, summary, created_at
			 FROM podcast_scripts ORDER BY created_at DESC LIMIT ?`, limit)
	} else {
		rows, err = aiDB.Query(
			`SELECT id, contact_username, contact_name, duration_min, title, lines_json, summary, created_at
			 FROM podcast_scripts WHERE contact_username = ? ORDER BY created_at DESC LIMIT ?`,
			contactUsername, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PodcastScriptRecord
	for rows.Next() {
		var r PodcastScriptRecord
		var linesJSON string
		if err := rows.Scan(&r.ID, &r.ContactUsername, &r.ContactName, &r.DurationMin, &r.Title,
			&linesJSON, &r.Summary, &r.CreatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(linesJSON), &r.Lines)
		out = append(out, r)
	}
	if out == nil {
		out = []PodcastScriptRecord{}
	}
	return out, nil
}

// GetPodcastScript 按 id 取单条完整记录。
func GetPodcastScript(id int64) (*PodcastScriptRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("podcast_store: database not initialized")
	}
	var r PodcastScriptRecord
	var linesJSON string
	err := aiDB.QueryRow(
		`SELECT id, contact_username, contact_name, duration_min, title, lines_json, summary, created_at
		 FROM podcast_scripts WHERE id = ?`, id,
	).Scan(&r.ID, &r.ContactUsername, &r.ContactName, &r.DurationMin, &r.Title, &linesJSON, &r.Summary, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(linesJSON), &r.Lines)
	return &r, nil
}

// DeletePodcastScript 删除一条。
func DeletePodcastScript(id int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("podcast_store: database not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM podcast_scripts WHERE id = ?`, id)
	return err
}
