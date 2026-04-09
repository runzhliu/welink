/**
 * skill_store.go — Skill 炼化产物的数据库存储
 *
 * 表结构：skills
 *   id              TEXT PRIMARY KEY (uuid)
 *   skill_type      TEXT ('contact' / 'self' / 'group' / 'group-member')
 *   format          TEXT ('claude-skill' / 'claude-agent' / ...)
 *   target_username TEXT (联系人/群 username，self 时为空)
 *   target_name     TEXT (显示名，如 "老婆" 或 "工作群")
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
		created_at      INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("skill_store: create table: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_skills_created ON skills(created_at DESC)`)
	return nil
}

// InsertSkillRecord 插入一条新炼化记录。
func InsertSkillRecord(r *SkillRecord) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("skill_store: database not initialized")
	}
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	_, err := aiDB.Exec(`INSERT INTO skills
		(id, skill_type, format, target_username, target_name, member_speaker,
		 model_provider, model_name, msg_limit, filename, file_path, file_size, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.SkillType, r.Format, r.TargetUsername, r.TargetName, r.MemberSpeaker,
		r.ModelProvider, r.ModelName, r.MsgLimit, r.Filename, r.FilePath, r.FileSize, r.CreatedAt)
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
		model_provider, model_name, msg_limit, filename, file_path, file_size, created_at
		FROM skills ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SkillRecord
	for rows.Next() {
		var r SkillRecord
		if err := rows.Scan(&r.ID, &r.SkillType, &r.Format, &r.TargetUsername, &r.TargetName, &r.MemberSpeaker,
			&r.ModelProvider, &r.ModelName, &r.MsgLimit, &r.Filename, &r.FilePath, &r.FileSize, &r.CreatedAt); err != nil {
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
		model_provider, model_name, msg_limit, filename, file_path, file_size, created_at
		FROM skills WHERE id = ?`, id).Scan(&r.ID, &r.SkillType, &r.Format, &r.TargetUsername, &r.TargetName, &r.MemberSpeaker,
		&r.ModelProvider, &r.ModelName, &r.MsgLimit, &r.Filename, &r.FilePath, &r.FileSize, &r.CreatedAt)
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
