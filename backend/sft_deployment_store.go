package main

import (
	"database/sql"
	"fmt"
	"time"
)

const (
	SFTDeploymentStarting = "starting"
	SFTDeploymentRunning  = "running"
	SFTDeploymentStopped  = "stopped"
	SFTDeploymentFailed   = "failed"
)

// SFTDeployment describes one locally managed OpenAI-compatible ms-swift
// server. Only metadata is stored in SQLite; model weights remain on disk.
type SFTDeployment struct {
	ID             string `json:"id"`
	TrainingJobID  string `json:"training_job_id"`
	SkillType      string `json:"skill_type"`
	TargetUsername string `json:"target_username,omitempty"`
	TargetName     string `json:"target_name"`
	Status         string `json:"status"`
	AdapterPath    string `json:"adapter_path"`
	BaseModel      string `json:"base_model"`
	ServedModel    string `json:"served_model"`
	Backend        string `json:"backend"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	GPU            int    `json:"gpu"`
	PID            int    `json:"pid,omitempty"`
	LogPath        string `json:"log_path,omitempty"`
	ErrorMsg       string `json:"error_msg,omitempty"`
	CreatedAt      int64  `json:"created_at"`
	StartedAt      int64  `json:"started_at,omitempty"`
	StoppedAt      int64  `json:"stopped_at,omitempty"`
	UpdatedAt      int64  `json:"updated_at"`
}

func initSFTDeploymentTables() error {
	if aiDB == nil {
		return fmt.Errorf("sft_deployment_store: database not initialized")
	}
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS sft_deployments (
		id TEXT NOT NULL PRIMARY KEY,
		training_job_id TEXT NOT NULL,
		skill_type TEXT NOT NULL DEFAULT '',
		target_username TEXT NOT NULL DEFAULT '',
		target_name TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		adapter_path TEXT NOT NULL,
		base_model TEXT NOT NULL DEFAULT '',
		served_model TEXT NOT NULL,
		backend TEXT NOT NULL,
		host TEXT NOT NULL DEFAULT '127.0.0.1',
		port INTEGER NOT NULL,
		gpu INTEGER NOT NULL DEFAULT 0,
		pid INTEGER NOT NULL DEFAULT 0,
		log_path TEXT NOT NULL DEFAULT '',
		error_msg TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		started_at INTEGER NOT NULL DEFAULT 0,
		stopped_at INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("sft_deployment_store: create table: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sft_deployments_created ON sft_deployments(created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sft_deployments_target ON sft_deployments(target_username, status)`)
	_, _ = aiDB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sft_deployments_active_port
		ON sft_deployments(port) WHERE status IN ('starting', 'running')`)
	return nil
}

const sftDeploymentSelect = `SELECT id, training_job_id, skill_type, target_username,
	target_name, status, adapter_path, base_model, served_model, backend, host,
	port, gpu, pid, log_path, error_msg, created_at, started_at, stopped_at, updated_at
	FROM sft_deployments`

func scanSFTDeployment(scanner interface{ Scan(...any) error }) (*SFTDeployment, error) {
	var deployment SFTDeployment
	err := scanner.Scan(&deployment.ID, &deployment.TrainingJobID, &deployment.SkillType,
		&deployment.TargetUsername, &deployment.TargetName, &deployment.Status,
		&deployment.AdapterPath, &deployment.BaseModel, &deployment.ServedModel,
		&deployment.Backend, &deployment.Host, &deployment.Port, &deployment.GPU,
		&deployment.PID, &deployment.LogPath, &deployment.ErrorMsg,
		&deployment.CreatedAt, &deployment.StartedAt, &deployment.StoppedAt, &deployment.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &deployment, nil
}

func InsertSFTDeployment(deployment *SFTDeployment) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_deployment_store: database not initialized")
	}
	now := time.Now().Unix()
	if deployment.CreatedAt == 0 {
		deployment.CreatedAt = now
	}
	if deployment.UpdatedAt == 0 {
		deployment.UpdatedAt = now
	}
	_, err := aiDB.Exec(`INSERT INTO sft_deployments (
		id, training_job_id, skill_type, target_username, target_name, status,
		adapter_path, base_model, served_model, backend, host, port, gpu, pid,
		log_path, error_msg, created_at, started_at, stopped_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deployment.ID, deployment.TrainingJobID, deployment.SkillType,
		deployment.TargetUsername, deployment.TargetName, deployment.Status,
		deployment.AdapterPath, deployment.BaseModel, deployment.ServedModel,
		deployment.Backend, deployment.Host, deployment.Port, deployment.GPU,
		deployment.PID, deployment.LogPath, deployment.ErrorMsg,
		deployment.CreatedAt, deployment.StartedAt, deployment.StoppedAt, deployment.UpdatedAt)
	return err
}

func GetSFTDeployment(id string) (*SFTDeployment, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	deployment, err := scanSFTDeployment(aiDB.QueryRow(sftDeploymentSelect+` WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return deployment, err
}

func ListSFTDeployments(limit int, status string) ([]SFTDeployment, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := sftDeploymentSelect
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := aiDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deployments := make([]SFTDeployment, 0)
	for rows.Next() {
		deployment, scanErr := scanSFTDeployment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		deployments = append(deployments, *deployment)
	}
	return deployments, rows.Err()
}

func GetRunningSFTDeploymentForTarget(username string) (*SFTDeployment, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	deployment, err := scanSFTDeployment(aiDB.QueryRow(sftDeploymentSelect+
		` WHERE target_username = ? AND status = ? ORDER BY created_at DESC LIMIT 1`, username, SFTDeploymentRunning))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return deployment, err
}

func IsSFTDeploymentPortActive(port int) (bool, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return false, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	var count int
	err := aiDB.QueryRow(`SELECT COUNT(*) FROM sft_deployments WHERE port = ? AND status IN (?, ?)`,
		port, SFTDeploymentStarting, SFTDeploymentRunning).Scan(&count)
	return count > 0, err
}

func UpdateSFTDeploymentProcess(id, status string, pid int, errorMsg string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_deployment_store: database not initialized")
	}
	now := time.Now().Unix()
	startedAt := int64(0)
	if status == SFTDeploymentRunning {
		startedAt = now
	}
	_, err := aiDB.Exec(`UPDATE sft_deployments SET status = ?, pid = ?, error_msg = ?,
		started_at = CASE WHEN ? > 0 THEN ? ELSE started_at END, updated_at = ?
		WHERE id = ? AND status = ?`,
		status, pid, errorMsg, startedAt, startedAt, now, id, SFTDeploymentStarting)
	return err
}

func HasActiveSFTDeploymentForTrainingJob(trainingJobID string) (bool, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return false, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	var count int
	err := aiDB.QueryRow(`SELECT COUNT(*) FROM sft_deployments
		WHERE training_job_id = ? AND status IN (?, ?)`, trainingJobID,
		SFTDeploymentStarting, SFTDeploymentRunning).Scan(&count)
	return count > 0, err
}

func StopSFTDeploymentRecord(id, status, errorMsg string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_deployment_store: database not initialized")
	}
	now := time.Now().Unix()
	_, err := aiDB.Exec(`UPDATE sft_deployments SET status = ?, pid = 0, error_msg = ?,
		stopped_at = ?, updated_at = ? WHERE id = ?`, status, errorMsg, now, now, id)
	return err
}

func RecoverStaleSFTDeployments() (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("sft_deployment_store: database not initialized")
	}
	now := time.Now().Unix()
	result, err := aiDB.Exec(`UPDATE sft_deployments SET status = ?, pid = 0,
		error_msg = ?, stopped_at = ?, updated_at = ? WHERE status IN (?, ?)`,
		SFTDeploymentStopped, "WeLink 进程重启，请重新启动部署", now, now,
		SFTDeploymentStarting, SFTDeploymentRunning)
	if err != nil {
		return 0, err
	}
	count, _ := result.RowsAffected()
	return count, nil
}

func DeleteSFTDeploymentRecord(id string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_deployment_store: database not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM sft_deployments WHERE id = ?`, id)
	return err
}
