package main

import (
	"database/sql"
	"fmt"
	"time"
)

const (
	SFTJobQueued    = "queued"
	SFTJobRunning   = "running"
	SFTJobSucceeded = "succeeded"
	SFTJobFailed    = "failed"
	SFTJobCanceled  = "canceled"
)

// SFTTrainingJob is the durable state for one local ms-swift process. Dataset
// contents stay on disk and are never stored in SQLite.
type SFTTrainingJob struct {
	ID                   string  `json:"id"`
	SkillID              string  `json:"skill_id"`
	DatasetName          string  `json:"dataset_name"`
	Status               string  `json:"status"`
	Model                string  `json:"model"`
	Epochs               float64 `json:"epochs"`
	LearningRate         float64 `json:"learning_rate"`
	LoRARank             int     `json:"lora_rank"`
	MaxLength            int     `json:"max_length"`
	BatchSize            int     `json:"batch_size"`
	GradientAccumulation int     `json:"gradient_accumulation"`
	DType                string  `json:"dtype"`
	OutputDir            string  `json:"output_dir,omitempty"`
	LogPath              string  `json:"log_path,omitempty"`
	AdapterPath          string  `json:"adapter_path,omitempty"`
	PID                  int     `json:"pid,omitempty"`
	ErrorMsg             string  `json:"error_msg,omitempty"`
	CreatedAt            int64   `json:"created_at"`
	StartedAt            int64   `json:"started_at,omitempty"`
	FinishedAt           int64   `json:"finished_at,omitempty"`
	UpdatedAt            int64   `json:"updated_at"`
}

func initSFTTrainingTables() error {
	if aiDB == nil {
		return fmt.Errorf("sft_training_store: database not initialized")
	}
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS sft_training_jobs (
		id                    TEXT NOT NULL PRIMARY KEY,
		skill_id              TEXT NOT NULL,
		dataset_name          TEXT NOT NULL DEFAULT '',
		status                TEXT NOT NULL,
		model                 TEXT NOT NULL,
		epochs                REAL NOT NULL,
		learning_rate         REAL NOT NULL,
		lora_rank             INTEGER NOT NULL,
		max_length            INTEGER NOT NULL,
		batch_size            INTEGER NOT NULL,
		gradient_accumulation INTEGER NOT NULL,
		dtype                 TEXT NOT NULL DEFAULT 'bfloat16',
		output_dir            TEXT NOT NULL DEFAULT '',
		log_path              TEXT NOT NULL DEFAULT '',
		adapter_path          TEXT NOT NULL DEFAULT '',
		pid                   INTEGER NOT NULL DEFAULT 0,
		error_msg             TEXT NOT NULL DEFAULT '',
		created_at            INTEGER NOT NULL,
		started_at            INTEGER NOT NULL DEFAULT 0,
		finished_at           INTEGER NOT NULL DEFAULT 0,
		updated_at            INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("sft_training_store: create table: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sft_jobs_created ON sft_training_jobs(created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sft_jobs_status ON sft_training_jobs(status)`)
	return nil
}

func InsertSFTTrainingJob(job *SFTTrainingJob) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	if job.CreatedAt == 0 {
		job.CreatedAt = now
	}
	if job.UpdatedAt == 0 {
		job.UpdatedAt = now
	}
	_, err := aiDB.Exec(`INSERT INTO sft_training_jobs (
		id, skill_id, dataset_name, status, model, epochs, learning_rate,
		lora_rank, max_length, batch_size, gradient_accumulation, dtype,
		output_dir, log_path, adapter_path, pid, error_msg,
		created_at, started_at, finished_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.SkillID, job.DatasetName, job.Status, job.Model, job.Epochs, job.LearningRate,
		job.LoRARank, job.MaxLength, job.BatchSize, job.GradientAccumulation, job.DType,
		job.OutputDir, job.LogPath, job.AdapterPath, job.PID, job.ErrorMsg,
		job.CreatedAt, job.StartedAt, job.FinishedAt, job.UpdatedAt)
	return err
}

func scanSFTTrainingJob(scanner interface{ Scan(...any) error }) (*SFTTrainingJob, error) {
	var job SFTTrainingJob
	err := scanner.Scan(
		&job.ID, &job.SkillID, &job.DatasetName, &job.Status, &job.Model,
		&job.Epochs, &job.LearningRate, &job.LoRARank, &job.MaxLength,
		&job.BatchSize, &job.GradientAccumulation, &job.DType,
		&job.OutputDir, &job.LogPath, &job.AdapterPath, &job.PID, &job.ErrorMsg,
		&job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

const sftTrainingSelect = `SELECT id, skill_id, dataset_name, status, model,
	epochs, learning_rate, lora_rank, max_length, batch_size,
	gradient_accumulation, dtype, output_dir, log_path, adapter_path, pid,
	error_msg, created_at, started_at, finished_at, updated_at
	FROM sft_training_jobs`

func GetSFTTrainingJob(id string) (*SFTTrainingJob, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("sft_training_store: database not initialized")
	}
	job, err := scanSFTTrainingJob(aiDB.QueryRow(sftTrainingSelect+` WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return job, err
}

func ListSFTTrainingJobs(limit int) ([]SFTTrainingJob, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("sft_training_store: database not initialized")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := aiDB.Query(sftTrainingSelect+` ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := make([]SFTTrainingJob, 0)
	for rows.Next() {
		job, scanErr := scanSFTTrainingJob(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		jobs = append(jobs, *job)
	}
	return jobs, rows.Err()
}

// MarkSFTTrainingJobRunning is a compare-and-set transition. It prevents a
// queued job canceled just before worker pickup from being started anyway.
func MarkSFTTrainingJobRunning(id, outputDir, logPath string, pid int) (bool, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return false, fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	result, err := aiDB.Exec(`UPDATE sft_training_jobs
		SET status = ?, output_dir = ?, log_path = ?, pid = ?, started_at = ?, updated_at = ?
		WHERE id = ? AND status = ?`,
		SFTJobRunning, outputDir, logPath, pid, now, now, id, SFTJobQueued)
	if err != nil {
		return false, err
	}
	changed, _ := result.RowsAffected()
	return changed == 1, nil
}

func FinishSFTTrainingJob(id, status, errorMsg, adapterPath string) (bool, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return false, fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	result, err := aiDB.Exec(`UPDATE sft_training_jobs
		SET status = ?, error_msg = ?, adapter_path = ?, pid = 0, finished_at = ?, updated_at = ?
		WHERE id = ? AND status = ?`,
		status, errorMsg, adapterPath, now, now, id, SFTJobRunning)
	if err != nil {
		return false, err
	}
	changed, _ := result.RowsAffected()
	return changed == 1, nil
}

func CancelSFTTrainingJobRecord(id string) (bool, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return false, fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	result, err := aiDB.Exec(`UPDATE sft_training_jobs
		SET status = ?, error_msg = ?, pid = 0, finished_at = ?, updated_at = ?
		WHERE id = ? AND status IN (?, ?)`,
		SFTJobCanceled, "用户取消", now, now, id, SFTJobQueued, SFTJobRunning)
	if err != nil {
		return false, err
	}
	changed, _ := result.RowsAffected()
	return changed == 1, nil
}

func FailQueuedSFTTrainingJob(id, errorMsg string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	_, err := aiDB.Exec(`UPDATE sft_training_jobs
		SET status = ?, error_msg = ?, finished_at = ?, updated_at = ?
		WHERE id = ? AND status = ?`, SFTJobFailed, errorMsg, now, now, id, SFTJobQueued)
	return err
}

func RecoverStaleSFTTrainingJobs() (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("sft_training_store: database not initialized")
	}
	now := time.Now().Unix()
	result, err := aiDB.Exec(`UPDATE sft_training_jobs
		SET status = ?, error_msg = ?, pid = 0, finished_at = ?, updated_at = ?
		WHERE status IN (?, ?)`,
		SFTJobFailed, "WeLink 进程重启，原训练进程状态无法确认", now, now,
		SFTJobQueued, SFTJobRunning)
	if err != nil {
		return 0, err
	}
	count, _ := result.RowsAffected()
	return count, nil
}

func DeleteSFTTrainingJobRecord(id string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_training_store: database not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM sft_training_jobs WHERE id = ?`, id)
	return err
}
