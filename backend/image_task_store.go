package main

// image_task_store.go — 异步生图任务持久化
//
// 任务表 image_tasks 放在 ai_analysis.db。生命周期：
//   queued → running → done / failed / canceled
//
// 同 hash 提交两次时 SubmitImageTask 直接返回 done 短路（沿用本地缓存）。

import (
	"database/sql"
	"fmt"
	"time"
)

// 任务状态常量
const (
	ImageTaskQueued   = "queued"
	ImageTaskRunning  = "running"
	ImageTaskDone     = "done"
	ImageTaskFailed   = "failed"
	ImageTaskCanceled = "canceled"
)

// ImageTaskRecord 对应 image_tasks 一行。
type ImageTaskRecord struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Progress   int    `json:"progress"` // 0-100 伪进度
	Scene      string `json:"scene"`    // year_review / highlight / avatar / playground
	Prompt     string `json:"prompt"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Size       string `json:"size"`
	ProfileID  string `json:"profile_id,omitempty"`
	ResultHash string `json:"result_hash,omitempty"`
	Error      string `json:"error,omitempty"`
	StartedAt  int64  `json:"started_at,omitempty"`
	FinishedAt int64  `json:"finished_at,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	RefUser    string `json:"ref_user,omitempty"`
	RefKind    string `json:"ref_kind,omitempty"`
}

func initImageTaskTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS image_tasks (
		id           TEXT PRIMARY KEY,
		status       TEXT NOT NULL,
		progress     INTEGER NOT NULL DEFAULT 0,
		scene        TEXT NOT NULL DEFAULT '',
		prompt       TEXT NOT NULL,
		provider     TEXT NOT NULL,
		model        TEXT NOT NULL,
		size         TEXT NOT NULL,
		profile_id   TEXT NOT NULL DEFAULT '',
		result_hash  TEXT NOT NULL DEFAULT '',
		error        TEXT NOT NULL DEFAULT '',
		started_at   INTEGER NOT NULL DEFAULT 0,
		finished_at  INTEGER NOT NULL DEFAULT 0,
		created_at   INTEGER NOT NULL,
		ref_user     TEXT NOT NULL DEFAULT '',
		ref_kind     TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return fmt.Errorf("image_task_store: create: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_image_tasks_status_created ON image_tasks(status, created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_image_tasks_scene_created  ON image_tasks(scene, created_at DESC)`)
	return nil
}

// InsertImageTask 写一条 queued 任务。
func InsertImageTask(t *ImageTaskRecord) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_task_store: db not initialized")
	}
	if t.CreatedAt == 0 {
		t.CreatedAt = time.Now().Unix()
	}
	if t.Status == "" {
		t.Status = ImageTaskQueued
	}
	_, err := aiDB.Exec(`INSERT INTO image_tasks
		(id, status, progress, scene, prompt, provider, model, size, profile_id, result_hash, error, started_at, finished_at, created_at, ref_user, ref_kind)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.Status, t.Progress, t.Scene, t.Prompt, t.Provider, t.Model, t.Size, t.ProfileID,
		t.ResultHash, t.Error, t.StartedAt, t.FinishedAt, t.CreatedAt, t.RefUser, t.RefKind)
	return err
}

// GetImageTask 按 id 查任务。不存在返回 (nil, nil)。
func GetImageTask(id string) (*ImageTaskRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("image_task_store: db not initialized")
	}
	var r ImageTaskRecord
	err := aiDB.QueryRow(`SELECT id, status, progress, scene, prompt, provider, model, size, profile_id,
		result_hash, error, started_at, finished_at, created_at, ref_user, ref_kind
		FROM image_tasks WHERE id = ?`, id).Scan(
		&r.ID, &r.Status, &r.Progress, &r.Scene, &r.Prompt, &r.Provider, &r.Model, &r.Size, &r.ProfileID,
		&r.ResultHash, &r.Error, &r.StartedAt, &r.FinishedAt, &r.CreatedAt, &r.RefUser, &r.RefKind)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListImageTasks 按 status / scene 过滤 + 分页。空字符串 = 不过滤。
func ListImageTasks(status, scene string, limit, offset int) ([]ImageTaskRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("image_task_store: db not initialized")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := `SELECT id, status, progress, scene, prompt, provider, model, size, profile_id,
		result_hash, error, started_at, finished_at, created_at, ref_user, ref_kind
		FROM image_tasks`
	conds := []string{}
	args := []any{}
	if status != "" {
		conds = append(conds, "status = ?")
		args = append(args, status)
	}
	if scene != "" {
		conds = append(conds, "scene = ?")
		args = append(args, scene)
	}
	if len(conds) > 0 {
		q += " WHERE " + joinAnd(conds)
	}
	q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)
	rows, err := aiDB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImageTaskRecord
	for rows.Next() {
		var r ImageTaskRecord
		if err := rows.Scan(&r.ID, &r.Status, &r.Progress, &r.Scene, &r.Prompt, &r.Provider, &r.Model, &r.Size, &r.ProfileID,
			&r.ResultHash, &r.Error, &r.StartedAt, &r.FinishedAt, &r.CreatedAt, &r.RefUser, &r.RefKind); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

// UpdateImageTaskStatus 用于 running 进入时 + 完成时统一写状态。
//   - 不更新空字段（progress = -1 表示不动）
func UpdateImageTaskStatus(id, status string, progress int, resultHash, errMsg string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_task_store: db not initialized")
	}
	now := time.Now().Unix()
	fields := []string{"status = ?"}
	args := []any{status}
	if progress >= 0 {
		fields = append(fields, "progress = ?")
		args = append(args, progress)
	}
	if resultHash != "" {
		fields = append(fields, "result_hash = ?")
		args = append(args, resultHash)
	}
	if errMsg != "" {
		fields = append(fields, "error = ?")
		args = append(args, errMsg)
	}
	switch status {
	case ImageTaskRunning:
		fields = append(fields, "started_at = ?")
		args = append(args, now)
	case ImageTaskDone, ImageTaskFailed, ImageTaskCanceled:
		fields = append(fields, "finished_at = ?")
		args = append(args, now)
	}
	args = append(args, id)
	_, err := aiDB.Exec(`UPDATE image_tasks SET `+joinComma(fields)+` WHERE id = ?`, args...)
	return err
}

// UpdateImageTaskProgress 仅更新 progress（伪进度递增）。
func UpdateImageTaskProgress(id string, progress int) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_task_store: db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE image_tasks SET progress = ? WHERE id = ?`, progress, id)
	return err
}

// RecoverStaleRunningTasks 启动时把 status=running 的孤儿任务标 failed，
// 避免进程崩溃后任务永远卡在 running。
func RecoverStaleRunningTasks() (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("image_task_store: db not initialized")
	}
	now := time.Now().Unix()
	res, err := aiDB.Exec(`UPDATE image_tasks SET status = ?, error = ?, finished_at = ?
		WHERE status = ?`, ImageTaskFailed, "进程重启时任务未完成，已自动失败", now, ImageTaskRunning)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// 小工具：避免引入额外 strings 调用看起来更干净
func joinAnd(parts []string) string {
	return joinWith(parts, " AND ")
}
func joinComma(parts []string) string {
	return joinWith(parts, ", ")
}
func joinWith(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}
