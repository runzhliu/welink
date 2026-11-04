package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	sftDeploymentDefaultPort = 8000
	sftDeploymentReadyWait   = 20 * time.Minute
	sftEvaluationMaxSamples  = 20
)

type StartSFTDeploymentOptions struct {
	TrainingJobID string `json:"training_job_id"`
	Backend       string `json:"backend"`
	Port          int    `json:"port"`
	GPU           int    `json:"gpu"`
	ServedModel   string `json:"served_model"`
}

type sftDeploymentProcess struct {
	cancel context.CancelFunc
	cmd    *exec.Cmd
}

type sftDeploymentSupervisor struct {
	mu        sync.Mutex
	processes map[string]*sftDeploymentProcess
}

var (
	sftDeployments     *sftDeploymentSupervisor
	sftDeploymentsOnce sync.Once
)

func getSFTDeploymentSupervisor() *sftDeploymentSupervisor {
	sftDeploymentsOnce.Do(func() {
		sftDeployments = &sftDeploymentSupervisor{processes: make(map[string]*sftDeploymentProcess)}
	})
	return sftDeployments
}

func StartSFTDeploymentSupervisor() {
	getSFTDeploymentSupervisor()
	if count, err := RecoverStaleSFTDeployments(); err == nil && count > 0 {
		slog.Warn("sft_deployment: recovered stale deployments", "count", count)
	}
}

var sftServedModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

func normalizeSFTDeploymentOptions(opts StartSFTDeploymentOptions) (StartSFTDeploymentOptions, error) {
	opts.TrainingJobID = strings.TrimSpace(opts.TrainingJobID)
	opts.Backend = strings.TrimSpace(opts.Backend)
	opts.ServedModel = strings.TrimSpace(opts.ServedModel)
	if opts.TrainingJobID == "" || strings.ContainsAny(opts.TrainingJobID, `/\\`) || strings.Contains(opts.TrainingJobID, "..") {
		return opts, fmt.Errorf("training_job_id 不合法")
	}
	if opts.Backend == "" {
		opts.Backend = "transformers"
	}
	if opts.Backend != "transformers" && opts.Backend != "vllm" {
		return opts, fmt.Errorf("backend 仅支持 transformers 或 vllm")
	}
	if opts.Port == 0 {
		opts.Port = sftDeploymentDefaultPort
	}
	if opts.Port < 1024 || opts.Port > 65535 {
		return opts, fmt.Errorf("port 必须在 1024 到 65535 之间")
	}
	if opts.GPU < 0 || opts.GPU > 127 {
		return opts, fmt.Errorf("gpu 必须在 0 到 127 之间")
	}
	if opts.ServedModel != "" && !sftServedModelPattern.MatchString(opts.ServedModel) {
		return opts, fmt.Errorf("served_model 只能包含字母、数字、点、下划线和连字符")
	}
	return opts, nil
}

func StartSFTDeployment(opts StartSFTDeploymentOptions) (*SFTDeployment, error) {
	normalized, err := normalizeSFTDeploymentOptions(opts)
	if err != nil {
		return nil, err
	}
	if _, _, err := resolveMSWIFT(); err != nil {
		return nil, err
	}
	job, err := GetSFTTrainingJob(normalized.TrainingJobID)
	if err != nil {
		return nil, err
	}
	if job == nil || job.Status != SFTJobSucceeded || job.AdapterPath == "" {
		return nil, fmt.Errorf("只能部署已经成功并找到 adapter 的训练任务")
	}
	if info, statErr := os.Stat(job.AdapterPath); statErr != nil || !info.IsDir() {
		return nil, fmt.Errorf("adapter 路径不可用")
	}
	skill, err := GetSkillRecord(job.SkillID)
	if err != nil || skill == nil {
		return nil, fmt.Errorf("关联训练数据集不存在")
	}
	active, err := IsSFTDeploymentPortActive(normalized.Port)
	if err != nil {
		return nil, err
	}
	if active {
		return nil, fmt.Errorf("端口 %d 已被另一个 SFT 部署使用", normalized.Port)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", normalized.Port))
	if err != nil {
		return nil, fmt.Errorf("端口 %d 不可用: %w", normalized.Port, err)
	}
	_ = listener.Close()

	id := genSFTTrainingJobID()
	servedModel := normalized.ServedModel
	if servedModel == "" {
		servedModel = "welink-sft-" + id[len(id)-8:]
	}
	deploymentDir, err := sftDeploymentDir(id)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(deploymentDir, 0700); err != nil {
		return nil, fmt.Errorf("创建部署目录失败: %w", err)
	}
	deployment := &SFTDeployment{
		ID: id, TrainingJobID: job.ID, SkillType: skill.SkillType,
		TargetUsername: skill.TargetUsername, TargetName: skill.TargetName,
		Status: SFTDeploymentStarting, AdapterPath: job.AdapterPath,
		BaseModel: job.Model, ServedModel: servedModel, Backend: normalized.Backend,
		Host: "127.0.0.1", Port: normalized.Port, GPU: normalized.GPU,
		LogPath: filepath.Join(deploymentDir, "deploy.log"),
	}
	if err := InsertSFTDeployment(deployment); err != nil {
		_ = os.RemoveAll(deploymentDir)
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	supervisor := getSFTDeploymentSupervisor()
	supervisor.mu.Lock()
	supervisor.processes[id] = &sftDeploymentProcess{cancel: cancel}
	supervisor.mu.Unlock()
	go supervisor.run(ctx, deployment)
	return deployment, nil
}

func (supervisor *sftDeploymentSupervisor) run(ctx context.Context, deployment *SFTDeployment) {
	defer func() {
		supervisor.mu.Lock()
		delete(supervisor.processes, deployment.ID)
		supervisor.mu.Unlock()
	}()
	logFile, err := os.OpenFile(deployment.LogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		_ = StopSFTDeploymentRecord(deployment.ID, SFTDeploymentFailed, "创建部署日志失败: "+err.Error())
		return
	}
	defer logFile.Close()

	swiftPath, version, err := resolveMSWIFT()
	if err != nil {
		_ = StopSFTDeploymentRecord(deployment.ID, SFTDeploymentFailed, err.Error())
		return
	}
	args := buildSFTDeploymentArgs(deployment)
	_, _ = fmt.Fprintf(logFile, "WeLink SFT deployment %s\nms-swift: %s %s\nadapter: %s\nendpoint: %s\nstarted: %s\n\n",
		deployment.ID, swiftPath, version, deployment.AdapterPath, deployment.BaseURL(), time.Now().Format(time.RFC3339))
	cmd := exec.Command(swiftPath, args...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = append(os.Environ(), fmt.Sprintf("CUDA_VISIBLE_DEVICES=%d", deployment.GPU))
	configureSFTProcess(cmd)

	supervisor.mu.Lock()
	if process := supervisor.processes[deployment.ID]; process != nil {
		process.cmd = cmd
	}
	supervisor.mu.Unlock()
	if ctx.Err() != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		_ = StopSFTDeploymentRecord(deployment.ID, SFTDeploymentFailed, "启动 ms-swift 部署失败: "+err.Error())
		return
	}
	_ = UpdateSFTDeploymentProcess(deployment.ID, SFTDeploymentStarting, cmd.Process.Pid, "")

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	deadline := time.NewTimer(sftDeploymentReadyWait)
	defer deadline.Stop()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	ready := false
	for !ready {
		select {
		case runErr := <-done:
			supervisor.finishUnexpected(deployment.ID, runErr, false)
			return
		case <-ctx.Done():
			stopManagedSFTProcess(cmd, done)
			return
		case <-deadline.C:
			terminateSFTProcess(cmd)
			stopManagedSFTProcess(cmd, done)
			_ = StopSFTDeploymentRecord(deployment.ID, SFTDeploymentFailed, "部署启动超时，请查看日志")
			return
		case <-ticker.C:
			if probeSFTDeployment(deployment) == nil {
				ready = true
				_ = UpdateSFTDeploymentProcess(deployment.ID, SFTDeploymentRunning, cmd.Process.Pid, "")
				_, _ = fmt.Fprintf(logFile, "\nready: %s\n", time.Now().Format(time.RFC3339))
			}
		}
	}

	select {
	case runErr := <-done:
		supervisor.finishUnexpected(deployment.ID, runErr, true)
	case <-ctx.Done():
		stopManagedSFTProcess(cmd, done)
	}
}

func stopManagedSFTProcess(cmd *exec.Cmd, done <-chan error) {
	terminateSFTProcess(cmd)
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		killSFTProcess(cmd)
		<-done
	}
}

func (supervisor *sftDeploymentSupervisor) finishUnexpected(id string, runErr error, wasReady bool) {
	current, _ := GetSFTDeployment(id)
	if current == nil || current.Status == SFTDeploymentStopped {
		return
	}
	message := "ms-swift 部署进程已退出"
	var exitErr *exec.ExitError
	if errors.As(runErr, &exitErr) {
		message = fmt.Sprintf("ms-swift 部署退出，exit code %d；请查看部署日志", exitErr.ExitCode())
	} else if runErr != nil {
		message += ": " + runErr.Error()
	} else if wasReady {
		message = "ms-swift 部署进程意外结束"
	}
	_ = StopSFTDeploymentRecord(id, SFTDeploymentFailed, message)
}

func StopSFTDeployment(id string) error {
	deployment, err := GetSFTDeployment(id)
	if err != nil {
		return err
	}
	if deployment == nil {
		return fmt.Errorf("部署不存在")
	}
	if deployment.Status == SFTDeploymentStopped || deployment.Status == SFTDeploymentFailed {
		return nil
	}
	if err := StopSFTDeploymentRecord(id, SFTDeploymentStopped, ""); err != nil {
		return err
	}
	supervisor := getSFTDeploymentSupervisor()
	supervisor.mu.Lock()
	process := supervisor.processes[id]
	supervisor.mu.Unlock()
	if process != nil {
		process.cancel()
	}
	return nil
}

func buildSFTDeploymentArgs(deployment *SFTDeployment) []string {
	return []string{
		"deploy",
		"--adapters", deployment.AdapterPath,
		"--infer_backend", deployment.Backend,
		"--host", deployment.Host,
		"--port", strconv.Itoa(deployment.Port),
		"--served_model_name", deployment.ServedModel,
		"--temperature", "0.3",
		"--max_new_tokens", "1024",
	}
}

func (deployment SFTDeployment) BaseURL() string {
	return fmt.Sprintf("http://%s:%d/v1", deployment.Host, deployment.Port)
}

func probeSFTDeployment(deployment *SFTDeployment) error {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, deployment.BaseURL()+"/models", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}

func sftDeploymentRoot() string {
	return filepath.Join(filepath.Dir(preferencesPath()), "sft-deployments")
}

func sftDeploymentDir(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\\`) || strings.Contains(id, "..") {
		return "", fmt.Errorf("部署 ID 不合法")
	}
	return filepath.Join(sftDeploymentRoot(), id), nil
}

func readSFTDeploymentLog(deployment *SFTDeployment, offset int64) (string, int64, bool, bool, error) {
	job := &SFTTrainingJob{LogPath: deployment.LogPath, Status: deployment.Status}
	content, next, truncated, _, err := readSFTTrainingLog(job, offset)
	eof := !truncated && deployment.Status != SFTDeploymentStarting && deployment.Status != SFTDeploymentRunning
	return content, next, truncated, eof, err
}

type sftEvaluationSample struct {
	Prompt      string  `json:"prompt"`
	Expected    string  `json:"expected"`
	Generated   string  `json:"generated"`
	BigramF1    float64 `json:"bigram_f1"`
	LengthRatio float64 `json:"length_ratio"`
	Error       string  `json:"error,omitempty"`
}

type sftEvaluationResult struct {
	DeploymentID       string                `json:"deployment_id"`
	Samples            []sftEvaluationSample `json:"samples"`
	AverageF1          float64               `json:"average_bigram_f1"`
	AverageLengthRatio float64               `json:"average_length_ratio"`
	EvaluatedAt        int64                 `json:"evaluated_at"`
	Note               string                `json:"note"`
}

func evaluateSFTDeployment(deployment *SFTDeployment, limit int) (sftEvaluationResult, error) {
	if deployment.Status != SFTDeploymentRunning {
		return sftEvaluationResult{}, fmt.Errorf("部署尚未就绪")
	}
	if limit <= 0 {
		limit = 5
	}
	if limit > sftEvaluationMaxSamples {
		limit = sftEvaluationMaxSamples
	}
	jobDir, err := sftTrainingJobDir(deployment.TrainingJobID)
	if err != nil {
		return sftEvaluationResult{}, err
	}
	examples, err := readSFTEvaluationExamples(filepath.Join(jobDir, "dataset", "test.jsonl"), limit)
	if err != nil {
		return sftEvaluationResult{}, err
	}
	result := sftEvaluationResult{
		DeploymentID: deployment.ID, Samples: make([]sftEvaluationSample, 0, len(examples)),
		EvaluatedAt: time.Now().Unix(),
		Note:        "字符二元组 F1 只用于同版本纵向比较，不代表语义正确性或真实人格相似度。",
	}
	for _, example := range examples {
		messages, expected, ok := splitSFTEvaluationExample(example)
		if !ok {
			continue
		}
		generated, callErr := completeSFTDeployment(deployment, messages)
		sample := sftEvaluationSample{
			Prompt: messages[len(messages)-1].Content, Expected: expected, Generated: generated,
			BigramF1: charBigramF1(generated, expected), LengthRatio: textLengthRatio(generated, expected),
		}
		if callErr != nil {
			sample.Error = callErr.Error()
		}
		result.Samples = append(result.Samples, sample)
		result.AverageF1 += sample.BigramF1
		result.AverageLengthRatio += sample.LengthRatio
	}
	if len(result.Samples) == 0 {
		return result, fmt.Errorf("测试集没有可评估样本")
	}
	result.AverageF1 /= float64(len(result.Samples))
	result.AverageLengthRatio /= float64(len(result.Samples))
	return result, nil
}

func readSFTEvaluationExamples(path string, limit int) ([]SFTExample, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("读取测试集失败: %w", err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	examples := make([]SFTExample, 0, limit)
	for scanner.Scan() && len(examples) < limit {
		var example SFTExample
		if json.Unmarshal(scanner.Bytes(), &example) == nil && len(example.Messages) >= 2 {
			examples = append(examples, example)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return examples, nil
}

func splitSFTEvaluationExample(example SFTExample) ([]LLMMessage, string, bool) {
	last := len(example.Messages) - 1
	if last < 1 || example.Messages[last].Role != "assistant" || strings.TrimSpace(example.Messages[last].Content) == "" {
		return nil, "", false
	}
	messages := make([]LLMMessage, 0, last)
	for _, message := range example.Messages[:last] {
		if message.Role == "user" || message.Role == "assistant" || message.Role == "system" {
			messages = append(messages, LLMMessage{Role: message.Role, Content: message.Content})
		}
	}
	if len(messages) == 0 || messages[len(messages)-1].Role != "user" {
		return nil, "", false
	}
	return messages, example.Messages[last].Content, true
}

func completeSFTDeployment(deployment *SFTDeployment, messages []LLMMessage) (string, error) {
	body, _ := json.Marshal(openAIRequest{Model: deployment.ServedModel, Messages: messages, Stream: false})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, deployment.BaseURL()+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer EMPTY")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("推理请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("推理 API %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if len(payload.Choices) == 0 {
		return "", fmt.Errorf("推理 API 没有返回 choice")
	}
	return payload.Choices[0].Message.Content, nil
}

func charBigramF1(actual, expected string) float64 {
	a := bigramCounts([]rune(strings.TrimSpace(actual)))
	b := bigramCounts([]rune(strings.TrimSpace(expected)))
	if len(a) == 0 || len(b) == 0 {
		if strings.TrimSpace(actual) == strings.TrimSpace(expected) && strings.TrimSpace(actual) != "" {
			return 1
		}
		return 0
	}
	intersection, totalA, totalB := 0, 0, 0
	for key, count := range a {
		totalA += count
		if other := b[key]; other < count {
			intersection += other
		} else {
			intersection += count
		}
	}
	for _, count := range b {
		totalB += count
	}
	if intersection == 0 {
		return 0
	}
	precision := float64(intersection) / float64(totalA)
	recall := float64(intersection) / float64(totalB)
	return 2 * precision * recall / (precision + recall)
}

func bigramCounts(runes []rune) map[string]int {
	counts := make(map[string]int)
	for i := 0; i+1 < len(runes); i++ {
		counts[string(runes[i:i+2])]++
	}
	return counts
}

func textLengthRatio(actual, expected string) float64 {
	a, b := len([]rune(strings.TrimSpace(actual))), len([]rune(strings.TrimSpace(expected)))
	if b == 0 {
		return 0
	}
	ratio := float64(a) / float64(b)
	if ratio > 4 {
		return 4
	}
	return ratio
}

func registerSFTDeploymentRoutes(local *gin.RouterGroup) {
	local.POST("/deployments", func(c *gin.Context) {
		var body StartSFTDeploymentOptions
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		deployment, err := StartSFTDeployment(body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusAccepted, deployment)
	})
	local.GET("/deployments", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		status := strings.TrimSpace(c.Query("status"))
		deployments, err := ListSFTDeployments(limit, status)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deployments": deployments})
	})
	local.GET("/deployments/:id", func(c *gin.Context) {
		deployment, err := GetSFTDeployment(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if deployment == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "部署不存在"})
			return
		}
		c.JSON(http.StatusOK, deployment)
	})
	local.GET("/deployments/:id/log", func(c *gin.Context) {
		deployment, err := GetSFTDeployment(c.Param("id"))
		if err != nil || deployment == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "部署不存在"})
			return
		}
		offset, _ := strconv.ParseInt(c.Query("offset"), 10, 64)
		content, next, truncated, eof, err := readSFTDeploymentLog(deployment, offset)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"content": content, "next_offset": next, "truncated": truncated, "eof": eof})
	})
	local.POST("/deployments/:id/stop", func(c *gin.Context) {
		if err := StopSFTDeployment(c.Param("id")); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	local.POST("/deployments/:id/evaluate", func(c *gin.Context) {
		var body struct {
			Limit int `json:"limit"`
		}
		_ = c.ShouldBindJSON(&body)
		deployment, err := GetSFTDeployment(c.Param("id"))
		if err != nil || deployment == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "部署不存在"})
			return
		}
		result, err := evaluateSFTDeployment(deployment, body.Limit)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, result)
	})
	local.DELETE("/deployments/:id", func(c *gin.Context) {
		id := c.Param("id")
		deployment, err := GetSFTDeployment(id)
		if err != nil || deployment == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "部署不存在"})
			return
		}
		if deployment.Status == SFTDeploymentStarting || deployment.Status == SFTDeploymentRunning {
			c.JSON(http.StatusConflict, gin.H{"error": "请先停止部署"})
			return
		}
		dir, err := sftDeploymentDir(id)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := os.RemoveAll(dir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "删除部署日志失败: " + err.Error()})
			return
		}
		if err := DeleteSFTDeploymentRecord(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}
