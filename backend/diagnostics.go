package main

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DiagnosticsResult 是 /api/diagnostics 的返回结构。
// 每段都带 status: "ok" / "warn" / "error" 让前端用一致的方式着色。
type DiagnosticsResult struct {
	GeneratedAt string                  `json:"generated_at"`
	DataDir     DiagnosticsDataDir      `json:"data_dir"`
	Index       DiagnosticsIndex        `json:"index"`
	LLMProfiles []DiagnosticsLLMProfile `json:"llm_profiles"`
	Disk        DiagnosticsDisk         `json:"disk"`
}

type DiagnosticsDataDir struct {
	Status   string   `json:"status"` // ok / warn / error
	Path     string   `json:"path"`
	Message  string   `json:"message"`
	Warnings []string `json:"warnings,omitempty"`
}

type DiagnosticsIndex struct {
	Status        string `json:"status"`
	IsInitialized bool   `json:"is_initialized"`
	IsIndexing    bool   `json:"is_indexing"`
	TotalCached   int    `json:"total_cached"`
	LastError     string `json:"last_error,omitempty"`
	Message       string `json:"message"`
}

type DiagnosticsLLMProfile struct {
	Status     string `json:"status"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	BaseURL    string `json:"base_url,omitempty"`
	HasAPIKey  bool   `json:"has_api_key"`
	LatencyMs  int64  `json:"latency_ms,omitempty"`
	Message    string `json:"message"`
}

type DiagnosticsDisk struct {
	Status               string `json:"status"`
	AIAnalysisDBPath     string `json:"ai_analysis_db_path"`
	AIAnalysisDBSize     int64  `json:"ai_analysis_db_size"`
	AvatarCacheDir       string `json:"avatar_cache_dir"`
	AvatarCacheSize      int64  `json:"avatar_cache_size"`
	AvatarCacheFileCount int    `json:"avatar_cache_file_count"`
	Message              string `json:"message"`
}

// runDiagnostics 同步聚合所有诊断结果（LLM 探活并行）。
// 整个调用上限 ~6s（每个 LLM probe 最多 5s + 数据校验毫秒级）。
// indexStatus 可为 nil（服务层未就绪）；不为 nil 时应返回 ContactService.GetStatus() 的内容。
func runDiagnostics(dataDir string, indexStatus map[string]interface{}) DiagnosticsResult {
	r := DiagnosticsResult{GeneratedAt: time.Now().Format(time.RFC3339)}
	r.DataDir = diagDataDir(dataDir)
	r.Index = diagIndex(indexStatus)
	r.LLMProfiles = diagLLMProfiles()
	r.Disk = diagDisk()
	return r
}

func diagDataDir(dataDir string) DiagnosticsDataDir {
	d := DiagnosticsDataDir{Path: dataDir}
	if dataDir == "" {
		d.Status = "error"
		d.Message = "未配置数据目录"
		return d
	}
	// 复用 main.go 里 setup 用的同一个校验逻辑（结构 + 写权限）
	warnings, err := validateDataDirStandalone(dataDir)
	if err != nil {
		d.Status = "error"
		d.Message = err.Error()
		return d
	}
	d.Warnings = warnings
	if len(warnings) > 0 {
		d.Status = "warn"
		d.Message = "数据目录可用，但存在警告"
	} else {
		d.Status = "ok"
		d.Message = "数据目录健康"
	}
	return d
}

// validateDataDirStandalone 是 main.go applyConfig 里 validateDataDir 的复制版，
// 因为后者是闭包不能跨文件调用。功能完全相同。
func validateDataDirStandalone(dataDir string) (warnings []string, fatalErr error) {
	contactPath := filepath.Join(dataDir, "contact", "contact.db")
	msgDir := filepath.Join(dataDir, "message")
	if _, err := os.Stat(contactPath); err != nil {
		return nil, fmt.Errorf("找不到 %s", contactPath)
	}
	if _, err := os.Stat(msgDir); err != nil {
		return nil, fmt.Errorf("找不到 %s 目录", msgDir)
	}
	entries, err := os.ReadDir(msgDir)
	if err != nil {
		return nil, fmt.Errorf("无法读取 %s：%w", msgDir, err)
	}
	var msgDBs []string
	for _, e := range entries {
		n := e.Name()
		if strings.HasPrefix(n, "message_") && strings.HasSuffix(n, ".db") &&
			!strings.Contains(n, "fts") && !strings.Contains(n, "resource") {
			msgDBs = append(msgDBs, filepath.Join(msgDir, n))
		}
	}
	if len(msgDBs) == 0 {
		return nil, fmt.Errorf("%s 下没有 message_*.db", msgDir)
	}
	var readOnly []string
	probe := func(path string) {
		f, err := os.OpenFile(path, os.O_WRONLY, 0)
		if err != nil {
			readOnly = append(readOnly, filepath.Base(path))
			return
		}
		f.Close()
	}
	probe(contactPath)
	for _, p := range msgDBs {
		probe(p)
	}
	if len(readOnly) > 0 {
		warnings = append(warnings, fmt.Sprintf("以下数据库只读：%s", strings.Join(readOnly, ", ")))
	}
	return warnings, nil
}

func diagIndex(st map[string]interface{}) DiagnosticsIndex {
	d := DiagnosticsIndex{Status: "error", Message: "服务未就绪"}
	if st == nil {
		return d
	}
	if v, ok := st["is_initialized"].(bool); ok {
		d.IsInitialized = v
	}
	if v, ok := st["is_indexing"].(bool); ok {
		d.IsIndexing = v
	}
	if v, ok := st["total_cached"].(int); ok {
		d.TotalCached = v
	}
	if v, ok := st["last_error"].(string); ok {
		d.LastError = v
	}
	switch {
	case d.IsIndexing:
		d.Status = "warn"
		d.Message = "正在索引"
	case !d.IsInitialized && d.LastError != "":
		d.Status = "error"
		d.Message = "上次索引失败：" + d.LastError
	case !d.IsInitialized:
		d.Status = "warn"
		d.Message = "尚未开始索引"
	default:
		d.Status = "ok"
		d.Message = fmt.Sprintf("索引就绪，缓存 %d 个联系人", d.TotalCached)
	}
	return d
}

// llmProbe 对 OpenAI 兼容端点做一次 GET /models 探活，返回延迟和状态文字。
// 不兼容的 provider（claude / bedrock / vertex）返回 status="skipped"。
func llmProbe(p LLMProfile) DiagnosticsLLMProfile {
	d := DiagnosticsLLMProfile{
		Name:      p.Name,
		Provider:  p.Provider,
		Model:     p.Model,
		BaseURL:   p.BaseURL,
		HasAPIKey: p.APIKey != "",
	}
	if d.Name == "" {
		d.Name = p.Provider
	}
	switch p.Provider {
	case "claude", "bedrock", "vertex", "gemini":
		d.Status = "warn"
		d.Message = "该 provider 需自定义鉴权，已跳过探活"
		return d
	}

	cfg := llmConfig{provider: p.Provider, apiKey: p.APIKey, baseURL: p.BaseURL, model: p.Model}
	defaultsFor(&cfg)
	if cfg.baseURL == "" {
		d.Status = "error"
		d.Message = "未配置 base_url"
		return d
	}
	d.BaseURL = cfg.baseURL

	url := strings.TrimRight(cfg.baseURL, "/") + "/models"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		d.Status = "error"
		d.Message = "构造请求失败：" + err.Error()
		return d
	}
	if cfg.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	}
	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	d.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		d.Status = "error"
		d.Message = "请求失败：" + err.Error()
		return d
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == 200:
		d.Status = "ok"
		d.Message = fmt.Sprintf("HTTP 200，延迟 %dms", d.LatencyMs)
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		d.Status = "error"
		d.Message = fmt.Sprintf("HTTP %d（API Key 无效或权限不足）", resp.StatusCode)
	case resp.StatusCode == 404:
		d.Status = "warn"
		d.Message = fmt.Sprintf("HTTP 404（端点不支持 /models，但服务可达）")
	default:
		d.Status = "warn"
		d.Message = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return d
}

func diagLLMProfiles() []DiagnosticsLLMProfile {
	prefs := loadPreferences()
	profiles := prefs.LLMProfiles
	// 兼容老的单字段配置
	if len(profiles) == 0 && prefs.LLMProvider != "" {
		profiles = []LLMProfile{{
			ID: "legacy", Name: prefs.LLMProvider,
			Provider: prefs.LLMProvider, APIKey: prefs.LLMAPIKey,
			BaseURL: prefs.LLMBaseURL, Model: prefs.LLMModel,
		}}
	}
	if len(profiles) == 0 {
		return []DiagnosticsLLMProfile{}
	}
	results := make([]DiagnosticsLLMProfile, len(profiles))
	done := make(chan struct{}, len(profiles))
	for i, p := range profiles {
		go func(i int, p LLMProfile) {
			results[i] = llmProbe(p)
			done <- struct{}{}
		}(i, p)
	}
	for range profiles {
		<-done
	}
	return results
}

func diagDisk() DiagnosticsDisk {
	d := DiagnosticsDisk{Status: "ok"}
	d.AIAnalysisDBPath = aiAnalysisDBPath()
	if info, err := os.Stat(d.AIAnalysisDBPath); err == nil {
		d.AIAnalysisDBSize = info.Size()
	}
	if home, err := os.UserHomeDir(); err == nil {
		d.AvatarCacheDir = filepath.Join(home, ".welink", "avatar_cache")
		_ = filepath.WalkDir(d.AvatarCacheDir, func(_ string, e fs.DirEntry, err error) error {
			if err != nil || e.IsDir() {
				return nil
			}
			if info, ierr := e.Info(); ierr == nil {
				d.AvatarCacheSize += info.Size()
				d.AvatarCacheFileCount++
			}
			return nil
		})
	}
	d.Message = fmt.Sprintf("AI 分析库 %s，头像缓存 %d 个文件 / %s",
		humanBytes(d.AIAnalysisDBSize), d.AvatarCacheFileCount, humanBytes(d.AvatarCacheSize))
	return d
}

func humanBytes(n int64) string {
	const k = 1024
	switch {
	case n < k:
		return fmt.Sprintf("%d B", n)
	case n < k*k:
		return fmt.Sprintf("%.1f KB", float64(n)/k)
	case n < k*k*k:
		return fmt.Sprintf("%.1f MB", float64(n)/(k*k))
	default:
		return fmt.Sprintf("%.2f GB", float64(n)/(k*k*k))
	}
}
