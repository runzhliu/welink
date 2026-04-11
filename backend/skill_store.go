/**
 * skill_store.go — Skill 炼化产物的数据库存储
 *
 * 表结构：skills
 *   id              TEXT PRIMARY KEY (uuid)
 *   skill_type      TEXT ('contact' / 'self' / 'group' / 'group-member')
 *   format          TEXT ('claude-skill' / 'claude-agent' / ...)
 *   target_username TEXT (联系人/群 username，self 时为空)
 *   target_name     TEXT (显示名，如 "Saka" 或 "更衣室")
 *   member_speaker  TEXT (仅 group-member 用)
 *   model_provider  TEXT
 *   model_name      TEXT
 *   msg_limit       INTEGER
 *   filename        TEXT (原始文件名，含中文)
 *   file_path       TEXT (服务器本地绝对路径)
 *   file_size       INTEGER
 *   created_at      INTEGER (Unix 秒)
 */

package main

import (
	"database/sql"
	"fmt"
	"time"
)

// SkillStatus 炼化任务状态
const (
	SkillStatusPending = "pending" // 已创建，等待执行
	SkillStatusRunning = "running" // 正在调用 LLM
	SkillStatusSuccess = "success" // 炼化成功
	SkillStatusFailed  = "failed"  // 炼化失败
)

type SkillRecord struct {
	ID             string `json:"id"`
	SkillType      string `json:"skill_type"`
	Format         string `json:"format"`
	TargetUsername string `json:"target_username,omitempty"`
	TargetName     string `json:"target_name"`
	MemberSpeaker  string `json:"member_speaker,omitempty"`
	ModelProvider  string `json:"model_provider"`
	ModelName      string `json:"model_name"`
	MsgLimit       int    `json:"msg_limit"`
	Filename       string `json:"filename"`
	FilePath       string `json:"file_path"`
	FileSize       int64  `json:"file_size"`
	CreatedAt      int64  `json:"created_at"`
	Status         string `json:"status"` // pending/running/success/failed
	ErrorMsg       string `json:"error_msg,omitempty"`
	UpdatedAt      int64  `json:"updated_at"`
}

func initSkillTables() error {
	if aiDB == nil {
		return fmt.Errorf("skill_store: database not initialized")
	}
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS skills (
		id              TEXT NOT NULL PRIMARY KEY,
		skill_type      TEXT NOT NULL,
		format          TEXT NOT NULL,
		target_username TEXT NOT NULL DEFAULT '',
		target_name     TEXT NOT NULL,
		member_speaker  TEXT NOT NULL DEFAULT '',
		model_provider  TEXT NOT NULL DEFAULT '',
		model_name      TEXT NOT NULL DEFAULT '',
		msg_limit       INTEGER NOT NULL DEFAULT 0,
		filename        TEXT NOT NULL,
		file_path       TEXT NOT NULL,
		file_size       INTEGER NOT NULL DEFAULT 0,
		created_at      INTEGER NOT NULL,
		status          TEXT NOT NULL DEFAULT 'success',
		error_msg       TEXT NOT NULL DEFAULT '',
		updated_at      INTEGER NOT NULL DEFAULT 0
	)`)
	if err != nil {
		return fmt.Errorf("skill_store: create table: %w", err)
	}
	// 兼容已有表：补充新字段（ALTER TABLE 如果列已存在会报错，用 PRAGMA 检查）
	addColIfMissing := func(col, def string) {
		rows, qerr := aiDB.Query(`PRAGMA table_info(skills)`)
		if qerr != nil { return }
		defer rows.Close()
		exists := false
		for rows.Next() {
			var cid int; var name, ctype string; var notnull, pk int; var dflt sql.NullString
			_ = rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk)
			if name == col { exists = true; break }
		}
		if !exists {
			_, _ = aiDB.Exec(fmt.Sprintf(`ALTER TABLE skills ADD COLUMN %s %s`, col, def))
		}
	}
	addColIfMissing("status", "TEXT NOT NULL DEFAULT 'success'")
	addColIfMissing("error_msg", "TEXT NOT NULL DEFAULT ''")
	addColIfMissing("updated_at", "INTEGER NOT NULL DEFAULT 0")
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_skills_created ON skills(created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status)`)
	return nil
}

// InsertSkillRecord 插入一条新炼化记录。
func InsertSkillRecord(r *SkillRecord) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("skill_store: database not initialized")
	}
	now := time.Now().Unix()
	if r.CreatedAt == 0 { r.CreatedAt = now }
	if r.UpdatedAt == 0 { r.UpdatedAt = now }
	if r.Status == "" { r.Status = SkillStatusSuccess }
	_, err := aiDB.Exec(`INSERT INTO skills
		(id, skill_type, format, target_username, target_name, member_speaker,
		 model_provider, model_name, msg_limit, filename, file_path, file_size,
		 created_at, status, error_msg, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.SkillType, r.Format, r.TargetUsername, r.TargetName, r.MemberSpeaker,
		r.ModelProvider, r.ModelName, r.MsgLimit, r.Filename, r.FilePath, r.FileSize,
		r.CreatedAt, r.Status, r.ErrorMsg, r.UpdatedAt)
	return err
}

// UpdateSkillStatus 更新指定记录的状态（用于异步任务完成/失败）。
func UpdateSkillStatus(id string, status string, errMsg string, filePath string, fileSize int64, filename string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("skill_store: database not initialized")
	}
	_, err := aiDB.Exec(`UPDATE skills
		SET status = ?, error_msg = ?, file_path = ?, file_size = ?, filename = CASE WHEN ? = '' THEN filename ELSE ? END, updated_at = ?
		WHERE id = ?`,
		status, errMsg, filePath, fileSize, filename, filename, time.Now().Unix(), id)
	return err
}

// ListSkillRecords 按 created_at 降序返回所有记录。
func ListSkillRecords() ([]SkillRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("skill_store: database not initialized")
	}
	rows, err := aiDB.Query(`SELECT id, skill_type, format, target_username, target_name, member_speaker,
		model_provider, model_name, msg_limit, filename, file_path, file_size, created_at,
		status, error_msg, updated_at
		FROM skills ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SkillRecord
	for rows.Next() {
		var r SkillRecord
		if err := rows.Scan(&r.ID, &r.SkillType, &r.Format, &r.TargetUsername, &r.TargetName, &r.MemberSpeaker,
			&r.ModelProvider, &r.ModelName, &r.MsgLimit, &r.Filename, &r.FilePath, &r.FileSize, &r.CreatedAt,
			&r.Status, &r.ErrorMsg, &r.UpdatedAt); err != nil {
			continue
		}
		list = append(list, r)
	}
	return list, nil
}

// GetSkillRecord 按 ID 取单条记录。
func GetSkillRecord(id string) (*SkillRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("skill_store: database not initialized")
	}
	var r SkillRecord
	err := aiDB.QueryRow(`SELECT id, skill_type, format, target_username, target_name, member_speaker,
		model_provider, model_name, msg_limit, filename, file_path, file_size, created_at,
		status, error_msg, updated_at
		FROM skills WHERE id = ?`, id).Scan(&r.ID, &r.SkillType, &r.Format, &r.TargetUsername, &r.TargetName, &r.MemberSpeaker,
		&r.ModelProvider, &r.ModelName, &r.MsgLimit, &r.Filename, &r.FilePath, &r.FileSize, &r.CreatedAt,
		&r.Status, &r.ErrorMsg, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &r, err
}

// DeleteSkillRecord 按 ID 删除一条记录（不删除文件，由调用方处理）。
func DeleteSkillRecord(id string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("skill_store: database not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM skills WHERE id = ?`, id)
	return err
}
