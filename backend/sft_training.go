package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	sftTrainingQueueCapacity = 32
	sftLogChunkMaxBytes      = 64 * 1024
	sftDatasetFileMaxBytes   = 512 * 1024 * 1024
	sftDefaultModel          = "Qwen/Qwen3-4B-Instruct-2507"
)

type SFTGPUInfo struct {
	Vendor        string `json:"vendor"`
	Index         string `json:"index,omitempty"`
	Name          string `json:"name"`
	MemoryTotalMB int    `json:"memory_total_mb,omitempty"`
	DriverVersion string `json:"driver_version,omitempty"`
}

type SFTEnvironment struct {
	OS              string       `json:"os"`
	Arch            string       `json:"arch"`
	MSWIFTInstalled bool         `json:"ms_swift_installed"`
	MSWIFTPath      string       `json:"ms_swift_path,omitempty"`
	MSWIFTVersion   string       `json:"ms_swift_version,omitempty"`
	PythonPath      string       `json:"python_path,omitempty"`
	PythonVersion   string       `json:"python_version,omitempty"`
	TorchVersion    string       `json:"torch_version,omitempty"`
	CUDAAvailable   bool         `json:"cuda_available"`
	GPUs            []SFTGPUInfo `json:"gpus"`
	Warnings        []string     `json:"warnings"`
}

type SubmitSFTTrainingOptions struct {
	SkillID              string  `json:"skill_id"`
	Model                string  `json:"model"`
	Epochs               float64 `json:"epochs"`
	LearningRate         float64 `json:"learning_rate"`
	LoRARank             int     `json:"lora_rank"`
	MaxLength            int     `json:"max_length"`
	BatchSize            int     `json:"batch_size"`
	GradientAccumulation int     `json:"gradient_accumulation"`
	DType                string  `json:"dtype"`
}

type sftTrainingQueue struct {
	jobs    chan string
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
	started bool
}

var (
	sftQ     *sftTrainingQueue
	sftQOnce sync.Once
)

func getSFTTrainingQueue() *sftTrainingQueue {
	sftQOnce.Do(func() {
		sftQ = &sftTrainingQueue{
			jobs:    make(chan string, sftTrainingQueueCapacity),
			cancels: make(map[string]context.CancelFunc),
		}
	})
	return sftQ
}

func StartSFTTrainingWorker() {
	queue := getSFTTrainingQueue()
	queue.mu.Lock()
	if queue.started {
		queue.mu.Unlock()
		return
	}
	queue.started = true
	queue.mu.Unlock()

	if count, err := RecoverStaleSFTTrainingJobs(); err == nil && count > 0 {
		slog.Warn("sft_training: recovered stale jobs", "count", count)
	}
	go queue.runWorker()
	slog.Info("sft_training: worker started", "concurrency", 1)
}

func genSFTTrainingJobID() string {
	var random [8]byte
	_, _ = rand.Read(random[:])
	return fmt.Sprintf("%d%s", time.Now().UnixNano(), hex.EncodeToString(random[:]))
}

func normalizeSFTTrainingOptions(opts SubmitSFTTrainingOptions) (SubmitSFTTrainingOptions, error) {
	opts.SkillID = strings.TrimSpace(opts.SkillID)
	opts.Model = strings.TrimSpace(opts.Model)
	opts.DType = strings.TrimSpace(opts.DType)
	if opts.SkillID == "" {
		return opts, fmt.Errorf("skill_id 不能为空")
	}
	if opts.Model == "" {
		opts.Model = sftDefaultModel
	}
	if len(opts.Model) > 300 || strings.HasPrefix(opts.Model, "-") || strings.ContainsAny(opts.Model, "\r\n\x00") {
		return opts, fmt.Errorf("model 格式不合法")
	}
	if opts.Epochs == 0 {
		opts.Epochs = 2
	}
	if opts.Epochs < 0.1 || opts.Epochs > 10 {
		return opts, fmt.Errorf("epochs 必须在 0.1 到 10 之间")
	}
	if opts.LearningRate == 0 {
		opts.LearningRate = 1e-4
	}
	if opts.LearningRate < 1e-7 || opts.LearningRate > 1e-2 {
		return opts, fmt.Errorf("learning_rate 必须在 1e-7 到 1e-2 之间")
	}
	if opts.LoRARank == 0 {
		opts.LoRARank = 16
	}
	validRanks := map[int]bool{4: true, 8: true, 16: true, 32: true, 64: true, 128: true}
	if !validRanks[opts.LoRARank] {
		return opts, fmt.Errorf("lora_rank 仅支持 4/8/16/32/64/128")
	}
	if opts.MaxLength == 0 {
		opts.MaxLength = 1024
	}
	if opts.MaxLength < 256 || opts.MaxLength > 8192 {
		return opts, fmt.Errorf("max_length 必须在 256 到 8192 之间")
	}
	if opts.BatchSize == 0 {
		opts.BatchSize = 1
	}
	if opts.BatchSize < 1 || opts.BatchSize > 16 {
		return opts, fmt.Errorf("batch_size 必须在 1 到 16 之间")
	}
	if opts.GradientAccumulation == 0 {
		opts.GradientAccumulation = 16
	}
	if opts.GradientAccumulation < 1 || opts.GradientAccumulation > 256 {
		return opts, fmt.Errorf("gradient_accumulation 必须在 1 到 256 之间")
	}
	if opts.DType == "" {
		opts.DType = "bfloat16"
	}
	if opts.DType != "bfloat16" && opts.DType != "float16" && opts.DType != "float32" {
		return opts, fmt.Errorf("dtype 仅支持 bfloat16/float16/float32")
	}
	return opts, nil
}

func SubmitSFTTrainingJob(opts SubmitSFTTrainingOptions) (*SFTTrainingJob, error) {
	normalized, err := normalizeSFTTrainingOptions(opts)
	if err != nil {
		return nil, err
	}
	if _, _, err := resolveMSWIFT(); err != nil {
		return nil, err
	}
	skill, err := GetSkillRecord(normalized.SkillID)
	if err != nil {
		return nil, err
	}
	if skill == nil {
		return nil, fmt.Errorf("训练数据集不存在")
	}
	if skill.Format != "lora-jsonl" || skill.Status != SkillStatusSuccess {
		return nil, fmt.Errorf("只能训练已经成功生成的 SFT / LoRA 数据集")
	}
	if skill.FilePath == "" {
		return nil, fmt.Errorf("训练数据集文件路径为空")
	}
	if _, err := os.Stat(skill.FilePath); err != nil {
		return nil, fmt.Errorf("训练数据集文件不可用: %w", err)
	}

	job := &SFTTrainingJob{
		ID:                   genSFTTrainingJobID(),
		SkillID:              skill.ID,
		DatasetName:          skill.TargetName,
		Status:               SFTJobQueued,
		Model:                normalized.Model,
		Epochs:               normalized.Epochs,
		LearningRate:         normalized.LearningRate,
		LoRARank:             normalized.LoRARank,
		MaxLength:            normalized.MaxLength,
		BatchSize:            normalized.BatchSize,
		GradientAccumulation: normalized.GradientAccumulation,
		DType:                normalized.DType,
	}
	if err := InsertSFTTrainingJob(job); err != nil {
		return nil, err
	}
	select {
	case getSFTTrainingQueue().jobs <- job.ID:
		return job, nil
	default:
		message := "训练队列已满，请稍后重试"
		_ = FailQueuedSFTTrainingJob(job.ID, message)
		return nil, fmt.Errorf("%s", message)
	}
}

func CancelSFTTrainingJob(id string) error {
	job, err := GetSFTTrainingJob(id)
	if err != nil {
		return err
	}
	if job == nil {
		return fmt.Errorf("训练任务不存在")
	}
	if job.Status == SFTJobSucceeded || job.Status == SFTJobFailed || job.Status == SFTJobCanceled {
		return nil
	}
	changed, err := CancelSFTTrainingJobRecord(id)
	if err != nil || !changed {
		return err
	}
	queue := getSFTTrainingQueue()
	queue.mu.Lock()
	cancel := queue.cancels[id]
	queue.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (queue *sftTrainingQueue) runWorker() {
	for jobID := range queue.jobs {
		queue.process(jobID)
	}
}

func (queue *sftTrainingQueue) process(jobID string) {
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("sft_training: worker panic", "job", jobID, "panic", fmt.Sprint(recovered))
			_ = FailQueuedSFTTrainingJob(jobID, fmt.Sprintf("worker panic: %v", recovered))
			_, _ = FinishSFTTrainingJob(jobID, SFTJobFailed, fmt.Sprintf("worker panic: %v", recovered), "")
		}
	}()

	job, err := GetSFTTrainingJob(jobID)
	if err != nil || job == nil || job.Status != SFTJobQueued {
		return
	}
	skill, err := GetSkillRecord(job.SkillID)
	if err != nil || skill == nil || skill.Status != SkillStatusSuccess || skill.Format != "lora-jsonl" {
		_ = FailQueuedSFTTrainingJob(jobID, "关联的 SFT 数据集不存在或不可用")
		return
	}

	jobDir, err := sftTrainingJobDir(jobID)
	if err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, err.Error())
		return
	}
	datasetDir := filepath.Join(jobDir, "dataset")
	outputDir := filepath.Join(jobDir, "output")
	logPath := filepath.Join(jobDir, "train.log")
	if err := os.MkdirAll(datasetDir, 0700); err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, "创建训练目录失败: "+err.Error())
		return
	}
	if err := extractSFTDataset(skill.FilePath, datasetDir); err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, "解包训练数据失败: "+err.Error())
		return
	}
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, "创建输出目录失败: "+err.Error())
		return
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, "创建训练日志失败: "+err.Error())
		return
	}
	defer logFile.Close()

	swiftPath, swiftVersion, err := resolveMSWIFT()
	if err != nil {
		_ = FailQueuedSFTTrainingJob(jobID, err.Error())
		return
	}
	args := buildSFTTrainingArgs(job, datasetDir, outputDir)
	_, _ = fmt.Fprintf(logFile, "WeLink SFT job %s\nms-swift: %s %s\nmodel: %s\nstarted: %s\n\n",
		job.ID, swiftPath, swiftVersion, job.Model, time.Now().Format(time.RFC3339))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	queue.mu.Lock()
	queue.cancels[jobID] = cancel
	queue.mu.Unlock()
	defer func() {
		queue.mu.Lock()
		delete(queue.cancels, jobID)
		queue.mu.Unlock()
	}()

	started, err := MarkSFTTrainingJobRunning(jobID, outputDir, logPath, 0)
	if err != nil || !started {
		return
	}
	if ctx.Err() != nil {
		return
	}

	cmd := exec.Command(swiftPath, args...)
	cmd.Dir = datasetDir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	configureSFTProcess(cmd)
	if err := cmd.Start(); err != nil {
		_, _ = FinishSFTTrainingJob(jobID, SFTJobFailed, "启动 ms-swift 失败: "+err.Error(), "")
		return
	}
	_ = UpdateSFTTrainingJobPID(jobID, cmd.Process.Pid)

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var runErr error
	select {
	case runErr = <-done:
	case <-ctx.Done():
		terminateSFTProcess(cmd)
		select {
		case runErr = <-done:
		case <-time.After(8 * time.Second):
			killSFTProcess(cmd)
			runErr = <-done
		}
	}

	current, _ := GetSFTTrainingJob(jobID)
	if current == nil || current.Status == SFTJobCanceled {
		_, _ = fmt.Fprintf(logFile, "\ntraining canceled: %s\n", time.Now().Format(time.RFC3339))
		return
	}
	if runErr != nil {
		message := conciseProcessError(runErr)
		_, _ = fmt.Fprintf(logFile, "\ntraining failed: %s\n", message)
		_, _ = FinishSFTTrainingJob(jobID, SFTJobFailed, message, "")
		return
	}
	adapterPath := findSFTAdapterPath(outputDir)
	if adapterPath == "" {
		adapterPath = outputDir
		_, _ = fmt.Fprintln(logFile, "\nwarning: adapter_config.json not found; using output directory")
	}
	_, _ = fmt.Fprintf(logFile, "\ntraining succeeded: %s\nadapter: %s\n", time.Now().Format(time.RFC3339), adapterPath)
	_, _ = FinishSFTTrainingJob(jobID, SFTJobSucceeded, "", adapterPath)
}

func buildSFTTrainingArgs(job *SFTTrainingJob, datasetDir, outputDir string) []string {
	return []string{
		"sft",
		"--model", job.Model,
		"--dataset", filepath.Join(datasetDir, "train.jsonl"),
		"--val_dataset", filepath.Join(datasetDir, "validation.jsonl"),
		"--tuner_type", "lora",
		"--target_modules", "all-linear",
		"--lora_rank", strconv.Itoa(job.LoRARank),
		"--lora_alpha", strconv.Itoa(job.LoRARank * 2),
		"--lora_dropout", "0.05",
		"--torch_dtype", job.DType,
		"--num_train_epochs", strconv.FormatFloat(job.Epochs, 'f', -1, 64),
		"--learning_rate", strconv.FormatFloat(job.LearningRate, 'g', -1, 64),
		"--per_device_train_batch_size", strconv.Itoa(job.BatchSize),
		"--per_device_eval_batch_size", strconv.Itoa(job.BatchSize),
		"--gradient_accumulation_steps", strconv.Itoa(job.GradientAccumulation),
		"--max_length", strconv.Itoa(job.MaxLength),
		"--eval_steps", "50",
		"--save_steps", "50",
		"--logging_steps", "5",
		"--save_total_limit", "2",
		"--output_dir", outputDir,
	}
}

func conciseProcessError(err error) string {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return fmt.Sprintf("ms-swift 退出，exit code %d；请查看训练日志", exitErr.ExitCode())
	}
	return "ms-swift 运行失败: " + err.Error()
}

func sftTrainingRoot() string {
	return filepath.Join(filepath.Dir(preferencesPath()), "sft-training")
}

func sftTrainingJobDir(jobID string) (string, error) {
	if jobID == "" || strings.ContainsAny(jobID, `/\\`) || strings.Contains(jobID, "..") {
		return "", fmt.Errorf("训练任务 ID 不合法")
	}
	return filepath.Join(sftTrainingRoot(), jobID), nil
}

func extractSFTDataset(zipPath, targetDir string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer reader.Close()
	allowed := map[string]bool{
		"train.jsonl": true, "validation.jsonl": true, "test.jsonl": true,
		"manifest.json": true, "data.stats.json": true,
	}
	foundTrain := false
	foundValidation := false
	for _, file := range reader.File {
		name := filepath.ToSlash(file.Name)
		if !allowed[name] || file.FileInfo().IsDir() || file.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if file.UncompressedSize64 > sftDatasetFileMaxBytes {
			return fmt.Errorf("%s 超过单文件大小限制", name)
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		targetPath := filepath.Join(targetDir, name)
		target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			source.Close()
			return err
		}
		written, copyErr := io.Copy(target, io.LimitReader(source, sftDatasetFileMaxBytes+1))
		closeErr := target.Close()
		source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if written > sftDatasetFileMaxBytes {
			return fmt.Errorf("%s 解压后超过单文件大小限制", name)
		}
		if name == "train.jsonl" && written > 0 {
			foundTrain = true
		}
		if name == "validation.jsonl" && written > 0 {
			foundValidation = true
		}
	}
	if !foundTrain || !foundValidation {
		return fmt.Errorf("zip 缺少非空的 train.jsonl 或 validation.jsonl")
	}
	return nil
}

func findSFTAdapterPath(outputDir string) string {
	var bestPath string
	var bestTime time.Time
	_ = filepath.WalkDir(outputDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() && path != outputDir {
			rel, relErr := filepath.Rel(outputDir, path)
			if relErr != nil || strings.Count(filepath.ToSlash(rel), "/") > 4 {
				return filepath.SkipDir
			}
		}
		if entry.IsDir() || entry.Name() != "adapter_config.json" {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr == nil && (bestPath == "" || info.ModTime().After(bestTime)) {
			bestPath = filepath.Dir(path)
			bestTime = info.ModTime()
		}
		return nil
	})
	return bestPath
}

func resolveMSWIFT() (path, version string, err error) {
	configured := strings.TrimSpace(os.Getenv("WELINK_SWIFT_BIN"))
	if configured != "" {
		path = configured
		if !filepath.IsAbs(path) {
			return "", "", fmt.Errorf("WELINK_SWIFT_BIN 必须是绝对路径")
		}
		if info, statErr := os.Stat(path); statErr != nil || info.IsDir() || info.Mode()&0111 == 0 {
			return "", "", fmt.Errorf("WELINK_SWIFT_BIN 不可执行")
		}
	} else {
		path, err = exec.LookPath("swift")
		if err != nil {
			return "", "", fmt.Errorf("未找到 ms-swift CLI；请先安装 ms-swift，或设置 WELINK_SWIFT_BIN")
		}
	}
	versionOutput, _ := runProbeCommand(5*time.Second, path, "--version")
	helpOutput, _ := runProbeCommand(5*time.Second, path, "--help")
	combined := strings.ToLower(versionOutput + "\n" + helpOutput)
	if strings.Contains(combined, "apple swift") || (!strings.Contains(combined, "sft") && configured == "") {
		return "", "", fmt.Errorf("PATH 中的 swift 不是 ModelScope ms-swift CLI；请设置 WELINK_SWIFT_BIN")
	}
	version = firstNonEmptyLine(versionOutput)
	if version == "" {
		version = "已检测"
	}
	return path, version, nil
}

func firstNonEmptyLine(value string) string {
	for _, line := range strings.Split(value, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			if len(trimmed) > 200 {
				return trimmed[:200]
			}
			return trimmed
		}
	}
	return ""
}

func runProbeCommand(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if len(output) > 16*1024 {
		output = output[:16*1024]
	}
	return strings.TrimSpace(string(output)), err
}

func ProbeSFTEnvironment() SFTEnvironment {
	environment := SFTEnvironment{OS: runtime.GOOS, Arch: runtime.GOARCH, GPUs: []SFTGPUInfo{}, Warnings: []string{}}
	if path, version, err := resolveMSWIFT(); err == nil {
		environment.MSWIFTInstalled = true
		environment.MSWIFTPath = path
		environment.MSWIFTVersion = version
	} else {
		environment.Warnings = append(environment.Warnings, err.Error())
	}

	pythonPath := ""
	if environment.MSWIFTPath != "" {
		candidate := filepath.Join(filepath.Dir(environment.MSWIFTPath), "python")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			pythonPath = candidate
		}
	}
	if pythonPath == "" {
		pythonPath, _ = exec.LookPath("python3")
	}
	if pythonPath != "" {
		environment.PythonPath = pythonPath
		environment.PythonVersion, _ = runProbeCommand(3*time.Second, pythonPath, "--version")
		torchProbe := `import torch; print(torch.__version__); print("cuda=" + str(torch.cuda.is_available()).lower())`
		if output, err := runProbeCommand(10*time.Second, pythonPath, "-c", torchProbe); err == nil {
			lines := strings.Split(output, "\n")
			if len(lines) > 0 {
				environment.TorchVersion = strings.TrimSpace(lines[0])
			}
			environment.CUDAAvailable = strings.Contains(strings.ToLower(output), "cuda=true")
		}
	}

	if nvidiaSMI, err := exec.LookPath("nvidia-smi"); err == nil {
		output, _ := runProbeCommand(5*time.Second, nvidiaSMI,
			"--query-gpu=index,name,memory.total,driver_version", "--format=csv,noheader,nounits")
		for _, line := range strings.Split(output, "\n") {
			parts := strings.Split(line, ",")
			if len(parts) < 4 {
				continue
			}
			memoryMB, _ := strconv.Atoi(strings.TrimSpace(parts[2]))
			environment.GPUs = append(environment.GPUs, SFTGPUInfo{
				Vendor: "NVIDIA", Index: strings.TrimSpace(parts[0]), Name: strings.TrimSpace(parts[1]),
				MemoryTotalMB: memoryMB, DriverVersion: strings.TrimSpace(parts[3]),
			})
		}
	}
	if len(environment.GPUs) == 0 {
		environment.Warnings = append(environment.Warnings, "未检测到 NVIDIA GPU；仍可提交任务，但默认 4B 模型可能无法在当前机器训练")
	}
	if environment.MSWIFTInstalled && environment.TorchVersion == "" {
		environment.Warnings = append(environment.Warnings, "未能从 ms-swift 环境检测 PyTorch，请确认 CLI 与 Python 来自同一虚拟环境")
	}
	return environment
}

func UpdateSFTTrainingJobPID(id string, pid int) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("sft_training_store: database not initialized")
	}
	_, err := aiDB.Exec(`UPDATE sft_training_jobs SET pid = ?, updated_at = ? WHERE id = ? AND status = ?`,
		pid, time.Now().Unix(), id, SFTJobRunning)
	return err
}

func readSFTTrainingLog(job *SFTTrainingJob, offset int64) (content string, nextOffset int64, truncated bool, eof bool, err error) {
	if job.LogPath == "" {
		return "", 0, false, job.Status != SFTJobRunning, nil
	}
	file, err := os.Open(job.LogPath)
	if os.IsNotExist(err) {
		return "", 0, false, job.Status != SFTJobRunning, nil
	}
	if err != nil {
		return "", offset, false, false, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", offset, false, false, err
	}
	if offset < 0 {
		offset = 0
	}
	if offset > info.Size() {
		offset = info.Size()
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return "", offset, false, false, err
	}
	buffer := make([]byte, sftLogChunkMaxBytes)
	count, readErr := file.Read(buffer)
	if readErr != nil && readErr != io.EOF {
		return "", offset, false, false, readErr
	}
	nextOffset = offset + int64(count)
	truncated = nextOffset < info.Size()
	eof = !truncated && job.Status != SFTJobRunning && job.Status != SFTJobQueued
	return string(buffer[:count]), nextOffset, truncated, eof, nil
}

func registerSFTTrainingRoutes(api *gin.RouterGroup) {
	local := api.Group("/sft-local")
	local.Use(func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "SFT 训练管理仅允许从本机界面访问"})
			return
		}
		c.Next()
	})

	local.GET("/environment", func(c *gin.Context) {
		c.JSON(http.StatusOK, ProbeSFTEnvironment())
	})
	local.POST("/jobs", func(c *gin.Context) {
		var body SubmitSFTTrainingOptions
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		job, err := SubmitSFTTrainingJob(body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusAccepted, job)
	})
	local.GET("/jobs", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		jobs, err := ListSFTTrainingJobs(limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"jobs": jobs})
	})
	local.GET("/jobs/:id", func(c *gin.Context) {
		job, err := GetSFTTrainingJob(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if job == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "训练任务不存在"})
			return
		}
		c.JSON(http.StatusOK, job)
	})
	local.GET("/jobs/:id/log", func(c *gin.Context) {
		job, err := GetSFTTrainingJob(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if job == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "训练任务不存在"})
			return
		}
		offset, _ := strconv.ParseInt(c.Query("offset"), 10, 64)
		content, nextOffset, truncated, eof, err := readSFTTrainingLog(job, offset)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"content": content, "next_offset": nextOffset, "truncated": truncated, "eof": eof})
	})
	local.POST("/jobs/:id/cancel", func(c *gin.Context) {
		if err := CancelSFTTrainingJob(c.Param("id")); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	local.DELETE("/jobs/:id", func(c *gin.Context) {
		id := c.Param("id")
		job, err := GetSFTTrainingJob(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if job == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "训练任务不存在"})
			return
		}
		if job.Status == SFTJobQueued || job.Status == SFTJobRunning {
			c.JSON(http.StatusConflict, gin.H{"error": "请先取消正在运行的训练任务"})
			return
		}
		if active, checkErr := HasActiveSFTDeploymentForTrainingJob(id); checkErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": checkErr.Error()})
			return
		} else if active {
			c.JSON(http.StatusConflict, gin.H{"error": "请先停止使用该 Adapter 的部署"})
			return
		}
		jobDir, dirErr := sftTrainingJobDir(id)
		if dirErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": dirErr.Error()})
			return
		}
		if err := os.RemoveAll(jobDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "删除训练文件失败: " + err.Error()})
			return
		}
		if err := DeleteSFTTrainingJobRecord(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	registerSFTDeploymentRoutes(local)
}
