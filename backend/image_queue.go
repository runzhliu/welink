package main

// image_queue.go — 异步生图任务队列
//
// 关键设计：
//   - 单进程内 goroutine pool（默认 2 个 worker）
//   - 任务状态全走 ai_analysis.db.image_tasks 表，进程崩了重启能恢复（标 failed）
//   - 取消：DELETE 时通过 cancels[id]() 触发 ctx 取消；目前没把 ctx 真传到 HTTP 请求
//     （Phase 2 留给 future：让 doubaoGenerateImage 等接受 ctx），先按"软取消"做 —— 任务
//     还没真正调外部 API 时取消生效（status=queued）；已经调用 API 的取消会到完成后才能感知
//     但任务已经被标 canceled，结果图丢弃不写回 result_hash
//   - 伪进度：worker 跑起来后开个 ticker 每秒 +2%，封顶 85%；调用 API 拿到字节后 90%；写盘 100%

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"
)

const (
	imageWorkerCountDefault = 2
	imageQueueCapacity      = 64 // jobs channel 缓冲，超出时 SubmitImageTask 阻塞
)

// imageQueue 是单例。
type imageQueue struct {
	jobs    chan string
	cancels map[string]chan struct{}
	mu      sync.Mutex
	started bool
}

var (
	imgQ     *imageQueue
	imgQOnce sync.Once
)

// getImageQueue 返回全局 queue 单例（延迟初始化）。
func getImageQueue() *imageQueue {
	imgQOnce.Do(func() {
		imgQ = &imageQueue{
			jobs:    make(chan string, imageQueueCapacity),
			cancels: make(map[string]chan struct{}),
		}
	})
	return imgQ
}

// StartImageWorkers 启动 worker goroutines。重复调用是 no-op（受 started 保护）。
// 在 main.go InitAIDB 之后调用。
func StartImageWorkers(workerCount int) {
	q := getImageQueue()
	q.mu.Lock()
	if q.started {
		q.mu.Unlock()
		return
	}
	q.started = true
	q.mu.Unlock()

	if workerCount <= 0 {
		workerCount = imageWorkerCountDefault
	}
	// 启动时把上次崩溃留下的 running 任务标 failed
	if n, err := RecoverStaleRunningTasks(); err == nil && n > 0 {
		slog.Info("image_queue: 重启时清理孤儿任务", "count", n)
	}

	for i := 0; i < workerCount; i++ {
		go q.runWorker(i)
	}
	slog.Info("image_queue: workers 启动完成", "count", workerCount)
}

// genImageTaskID 用 16 字节随机 + 时间戳前缀拼一个有序短 id。
func genImageTaskID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%d%s", time.Now().UnixNano(), hex.EncodeToString(b[:]))
}

// SubmitImageOptions 提交一个生图任务所需的全部参数。
type SubmitImageOptions struct {
	Prompt    string
	Size      string
	Scene     string
	ProfileID string
	RefUser   string
	RefKind   string
}

// SubmitImageTask 提交任务到队列，立即返回 task id。
// 若同 hash 已成功过（本地缓存命中），直接落一条 done 记录返回，不入队。
func SubmitImageTask(opts SubmitImageOptions) (string, error) {
	if opts.Prompt == "" {
		return "", fmt.Errorf("prompt 不能为空")
	}
	prefs := loadPreferences()
	if !prefs.ImageEnabled && !DemoMockActive() {
		return "", fmt.Errorf("AI 生图未启用")
	}
	cfg := imageConfigFromProfile(prefs, opts.ProfileID)
	if cfg.APIKey == "" && !DemoMockActive() {
		return "", fmt.Errorf("未配置生图 API Key")
	}
	if opts.Size == "" {
		opts.Size = "1024x1024"
	}

	taskID := genImageTaskID()
	rec := &ImageTaskRecord{
		ID:        taskID,
		Status:    ImageTaskQueued,
		Progress:  0,
		Scene:     opts.Scene,
		Prompt:    opts.Prompt,
		Provider:  cfg.Provider,
		Model:     cfg.Model,
		Size:      opts.Size,
		ProfileID: opts.ProfileID,
		RefUser:   opts.RefUser,
		RefKind:   opts.RefKind,
	}

	// 短路：本地已有缓存，直接落 done
	hashV2 := imageHashV2(cfg.Provider, cfg.Model, opts.Size, opts.Prompt)
	if path, ok := imageCachePath(hashV2); ok {
		if _, err := os.Stat(path); err == nil {
			rec.Status = ImageTaskDone
			rec.Progress = 100
			rec.ResultHash = hashV2
			now := time.Now().Unix()
			rec.StartedAt = now
			rec.FinishedAt = now
			if err := InsertImageTask(rec); err != nil {
				return "", err
			}
			// 同步入画廊（已存在的会被复活 deleted_at=0）
			var usedIn []UsedInEntry
			if opts.RefKind != "" || opts.RefUser != "" {
				usedIn = []UsedInEntry{{Kind: opts.RefKind, Ref: opts.RefUser, At: now}}
			}
			_ = UpsertImageRecord(&ImageRecord{
				Hash: hashV2, Prompt: opts.Prompt, Scene: opts.Scene,
				Provider: cfg.Provider, Model: cfg.Model, Size: opts.Size,
				TaskID: taskID, UsedIn: usedIn,
			})
			return taskID, nil
		}
	}

	if err := InsertImageTask(rec); err != nil {
		return "", err
	}

	// 投到 jobs channel；若已满则阻塞，由调用方感知
	getImageQueue().jobs <- taskID
	return taskID, nil
}

// CancelImageTask 取消一个任务。queued → 直接置 canceled；running → signal cancel chan。
func CancelImageTask(taskID string) error {
	rec, err := GetImageTask(taskID)
	if err != nil {
		return err
	}
	if rec == nil {
		return fmt.Errorf("任务不存在")
	}
	switch rec.Status {
	case ImageTaskDone, ImageTaskFailed, ImageTaskCanceled:
		return nil // 已终态，no-op
	}
	q := getImageQueue()
	q.mu.Lock()
	if ch, ok := q.cancels[taskID]; ok {
		close(ch)
		delete(q.cancels, taskID)
	}
	q.mu.Unlock()
	return UpdateImageTaskStatus(taskID, ImageTaskCanceled, -1, "", "用户取消")
}

// runWorker 单个 worker 循环。
func (q *imageQueue) runWorker(idx int) {
	for taskID := range q.jobs {
		q.process(taskID, idx)
	}
}

// process 处理单个任务。
func (q *imageQueue) process(taskID string, workerIdx int) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("image_queue: worker panic", "task", taskID, "worker", workerIdx, "panic", fmt.Sprint(r))
			_ = UpdateImageTaskStatus(taskID, ImageTaskFailed, -1, "", fmt.Sprintf("worker panic: %v", r))
		}
	}()

	rec, err := GetImageTask(taskID)
	if err != nil || rec == nil {
		slog.Warn("image_queue: 任务读取失败", "task", taskID, "err", err)
		return
	}
	// 用户已经在排队时就取消了
	if rec.Status == ImageTaskCanceled {
		return
	}
	// 标 running + 注册 cancel chan
	cancelCh := make(chan struct{})
	q.mu.Lock()
	q.cancels[taskID] = cancelCh
	q.mu.Unlock()
	defer func() {
		q.mu.Lock()
		delete(q.cancels, taskID)
		q.mu.Unlock()
	}()

	_ = UpdateImageTaskStatus(taskID, ImageTaskRunning, 5, "", "")

	// 启动伪进度 ticker
	stopProgress := make(chan struct{})
	go func() {
		progress := 5
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopProgress:
				return
			case <-ticker.C:
				if progress < 85 {
					progress += 2
					_ = UpdateImageTaskProgress(taskID, progress)
				}
			}
		}
	}()

	// 真正调外部 API。
	// 当前 GenerateImage 不接受 ctx —— 取消只能"软"：调用返回后检查任务是否已被取消，若是则丢弃结果。
	prefs := loadPreferences()
	cfg := imageConfigFromProfile(prefs, rec.ProfileID)
	// 已被前面 cancel？直接终止
	select {
	case <-cancelCh:
		close(stopProgress)
		return
	default:
	}

	hash, genErr := GenerateImage(rec.Prompt, rec.Size, cfg)
	close(stopProgress)

	// 调用完成后再检查一次 cancel —— 如果用户取消了，扔掉结果
	select {
	case <-cancelCh:
		// 已被取消，状态早已被 CancelImageTask 置为 canceled，不覆盖
		slog.Info("image_queue: 任务取消后完成，丢弃结果", "task", taskID)
		return
	default:
	}

	if genErr != nil {
		slog.Warn("image_queue: 生图失败", "task", taskID, "err", genErr)
		_ = UpdateImageTaskStatus(taskID, ImageTaskFailed, -1, "", genErr.Error())
		return
	}
	if err := UpdateImageTaskStatus(taskID, ImageTaskDone, 100, hash, ""); err != nil {
		slog.Warn("image_queue: 更新 done 失败", "task", taskID, "err", err)
	}

	// 落画廊：失败 / 取消 不入库
	var usedIn []UsedInEntry
	if rec.RefKind != "" || rec.RefUser != "" {
		usedIn = []UsedInEntry{{Kind: rec.RefKind, Ref: rec.RefUser, At: time.Now().Unix()}}
	}
	if err := UpsertImageRecord(&ImageRecord{
		Hash:     hash,
		Prompt:   rec.Prompt,
		Scene:    rec.Scene,
		Provider: rec.Provider,
		Model:    rec.Model,
		Size:     rec.Size,
		TaskID:   taskID,
		UsedIn:   usedIn,
	}); err != nil {
		slog.Warn("image_queue: 画廊入库失败", "task", taskID, "err", err)
	}
}

// GenerateImageSync 是给老调用方（/image/generate 同步、ai_avatar）用的同步包装：
// 提交任务 + 在本地等到 done / failed / canceled。
// 等待超过 6 分钟 → 返回超时错（前端会卡，对应 LLMSync 超时上限）。
func GenerateImageSync(opts SubmitImageOptions) (string, error) {
	taskID, err := SubmitImageTask(opts)
	if err != nil {
		return "", err
	}
	deadline := time.Now().Add(6 * time.Minute)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		rec, err := GetImageTask(taskID)
		if err != nil {
			return "", err
		}
		if rec == nil {
			return "", fmt.Errorf("任务消失")
		}
		switch rec.Status {
		case ImageTaskDone:
			return rec.ResultHash, nil
		case ImageTaskFailed:
			if rec.Error != "" {
				return "", fmt.Errorf("%s", rec.Error)
			}
			return "", fmt.Errorf("生图失败")
		case ImageTaskCanceled:
			return "", fmt.Errorf("生图任务已取消")
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("生图超时")
		}
		<-ticker.C
	}
}
