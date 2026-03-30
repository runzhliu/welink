/*
 * WeLink — 微信聊天数据分析平台
 * Copyright (C) 2026 runzhliu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"welink/backend/config"
	"welink/backend/pkg/db"
	"welink/backend/pkg/seed"
	"welink/backend/service"

	"github.com/gin-gonic/gin"
)

func main() {
	if hasFrontend {
		// App 模式：webview 必须在进程启动后立刻创建，否则 macOS 报「没有响应」。
		// 所有 DB/服务器初始化放进后台 goroutine，webview 窗口在主线程立即弹出。
		go serverMain()
		startApp() // 阻塞直到窗口关闭
		return
	}
	serverMain()
}

func serverMain() {
	// 1. 加载配置（config.yaml > 环境变量 > 默认值）
	cfg := config.Load("")

	// 服务层：受 svcMu 保护，支持运行时热替换
	var (
		svcMu      sync.RWMutex
		contactSvc *service.ContactService
		dbMgr      *db.DBManager
	)

	// reinitSvc 用新数据目录替换数据库连接和服务层（线程安全）。
	reinitSvc := func(dataDir string) error {
		newMgr, err := db.NewDBManager(dataDir)
		if err != nil {
			return err
		}
		newSvc := service.NewContactService(newMgr, cfg)
		svcMu.Lock()
		if dbMgr != nil {
			dbMgr.Close()
		}
		dbMgr = newMgr
		contactSvc = newSvc
		svcMu.Unlock()
		return nil
	}

	// App 模式：优先从持久化配置读取目录，其次检查 .app 同级的 decrypted/
	if hasFrontend {
		if appCfg, ok := loadAppConfig(); ok {
			if appCfg.DemoMode {
				os.Setenv("DEMO_MODE", "true")
				cfg.Data.Dir = demoDataDir()
			} else {
				cfg.Data.Dir = appCfg.DataDir
			}
			setupLogFile(appCfg.LogDir)
		} else if dir := appDataDir(); dir != "" {
			cfg.Data.Dir = dir
		}
	}

	dataLabel := cfg.Data.Dir
	if dataLabel == "" {
		dataLabel = "(demo)"
	} else {
		dataLabel = "(configured)"
	}
	log.Printf("WeLink config: data_dir=%s port=%s timezone=%s workers=%d",
		dataLabel, cfg.Server.Port, cfg.Analysis.Timezone, cfg.Analysis.WorkerCount)

	// 2. 初始化数据库管理器（DEMO_MODE 时先生成示例数据）
	if os.Getenv("DEMO_MODE") == "true" {
		demoDir := cfg.Data.Dir
		log.Printf("[DEMO] Demo mode enabled, generating sample databases")
		if err := seed.Generate(demoDir); err != nil {
			log.Fatalf("Failed to generate demo databases: %v", err)
		}
	}

	if err := reinitSvc(cfg.Data.Dir); err != nil {
		// App 模式或数据目录无效时：服务层保持 nil，前端会收到 503 并提示用户
		// Docker 模式下请检查 volumes 中 decrypted/ 目录是否挂载正确
		log.Printf("[WARN] Init DB failed: %v — service unavailable until data is ready", err)
	}

	// 初始化 AI 分析历史数据库
	if err := InitAIDB(); err != nil {
		log.Printf("[WARN] AI analysis DB init failed: %v — history will not be persisted", err)
	}

	// 服务层访问助手（线程安全）
	getSvc := func() *service.ContactService {
		svcMu.RLock()
		defer svcMu.RUnlock()
		return contactSvc
	}
	getMgr := func() *db.DBManager {
		svcMu.RLock()
		defer svcMu.RUnlock()
		return dbMgr
	}

	// 4. 初始化 Gin 路由
	r := gin.Default()

	// 跨域设置：仅允许 localhost 来源（开发调试用），生产流量通过 Nginx 反代不需要 CORS
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "http://localhost:3000" || origin == "http://localhost:5173" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")

	// ── App 配置相关（无需服务层） ──────────────────────────────────────────

	// App 状态：前端用于判断是否需要显示 Setup 页面
	api.GET("/app/info", func(c *gin.Context) {
		_, configured := loadAppConfig()
		needsSetup := hasFrontend && !configured
		svcMu.RLock()
		ready := contactSvc != nil
		svcMu.RUnlock()
		c.JSON(http.StatusOK, gin.H{
			"app_mode":    hasFrontend,
			"needs_setup": needsSetup,
			"ready":       ready,
			"version":     appVersion,
		})
	})

	// 保存文件到 ~/Downloads（供 App 模式下的前端调用，绕过 WebView 的 blob 下载限制）
	// 非 App 模式返回 404，前端据此 fallback 到 Blob 下载。
	api.POST("/app/save-file", func(c *gin.Context) {
		if !hasFrontend {
			c.JSON(http.StatusNotFound, gin.H{"error": "only available in app mode"})
			return
		}
		var body struct {
			Filename string `json:"filename"`
			Content  string `json:"content"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Filename == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
			return
		}
		homeDir, err := os.UserHomeDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法获取用户目录"})
			return
		}
		savePath := filepath.Join(homeDir, "Downloads", body.Filename)
		if err := os.WriteFile(savePath, []byte(body.Content), 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"path": savePath})
	})

	// 日志打包：把 log_dir 下的 *.log 文件打成 zip 返回路径
	api.POST("/app/bundle-logs", func(c *gin.Context) {
		pref := loadPreferences()
		logDir := pref.LogDir
		if logDir == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置日志目录"})
			return
		}
		entries, err := os.ReadDir(logDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取日志目录失败: " + err.Error()})
			return
		}
		zipPath := filepath.Join(logDir, fmt.Sprintf("welink-logs-%s.zip", time.Now().Format("20060102-150405")))
		zf, err := os.Create(zipPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建 zip 失败: " + err.Error()})
			return
		}
		defer zf.Close()
		zw := zip.NewWriter(zf)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
				continue
			}
			src, err := os.Open(filepath.Join(logDir, e.Name()))
			if err != nil {
				continue
			}
			w, err := zw.Create(e.Name())
			if err != nil {
				src.Close()
				continue
			}
			io.Copy(w, src)
			src.Close()
		}
		zw.Close()
		c.JSON(http.StatusOK, gin.H{"path": zipPath})
	})

	// applyConfig 将配置落盘并热替换服务层；data_dir 为空时启用演示模式。
	applyConfig := func(body Preferences) error {
		if body.DataDir == "" {
			body.DemoMode = true
			body.DataDir = demoDataDir()
			os.Setenv("DEMO_MODE", "true")
			if err := seed.Generate(body.DataDir); err != nil {
				return fmt.Errorf("生成演示数据失败：%w", err)
			}
		} else {
			body.DemoMode = false
			os.Unsetenv("DEMO_MODE")
		}
		if err := reinitSvc(body.DataDir); err != nil {
			return fmt.Errorf("无效的数据库目录：%w", err)
		}
		if err := saveAppConfig(&body); err != nil {
			log.Printf("[APP] Failed to save config: %v", err)
		}
		setupLogFile(body.LogDir)
		cfg.Data.Dir = body.DataDir
		return nil
	}

	// App Setup：保存配置并热替换服务层
	api.POST("/app/setup", func(c *gin.Context) {
		var body Preferences
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if err := applyConfig(body); err != nil {
			log.Printf("[APP] setup failed: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "配置失败，请检查目录是否正确"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// App 当前配置读取
	api.GET("/app/config", func(c *gin.Context) {
		if cfg, ok := loadAppConfig(); ok {
			c.JSON(http.StatusOK, cfg)
		} else {
			c.JSON(http.StatusOK, Preferences{})
		}
	})

	// App 重启：保存新配置后重启进程
	api.POST("/app/restart", func(c *gin.Context) {
		var body Preferences
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if err := applyConfig(body); err != nil {
			log.Printf("[APP] restart config failed: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "配置失败，请检查目录是否正确"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "restarting"})
		go func() {
			time.Sleep(300 * time.Millisecond)
			restartApp()
		}()
	})

	// App 文件夹选择器（macOS 原生）
	api.GET("/app/browse", func(c *gin.Context) {
		if !hasFrontend {
			c.JSON(http.StatusNotFound, gin.H{"error": "only available in app mode"})
			return
		}
		prompt := c.DefaultQuery("prompt", "选择目录")
		path, err := browseFolder(prompt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cancelled"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"path": path})
	})

	// ── 用户偏好（两种模式通用） ────────────────────────────────────────────

	api.GET("/preferences", func(c *gin.Context) {
		c.JSON(http.StatusOK, loadPreferences())
	})

	api.PUT("/preferences", func(c *gin.Context) {
		var incoming Preferences
		if err := c.ShouldBindJSON(&incoming); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		// read-modify-write：只更新屏蔽名单和隐私模式，保留 App 配置字段
		existing := loadPreferences()
		existing.BlockedUsers = incoming.BlockedUsers
		existing.BlockedGroups = incoming.BlockedGroups
		existing.PrivacyMode = incoming.PrivacyMode
		if err := savePreferences(existing); err != nil {
			log.Printf("[PREFS] Failed to save preferences: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(http.StatusOK, existing)
	})

	// LLM 配置单独保存，避免与屏蔽名单 PUT 冲突
	api.PUT("/preferences/llm", func(c *gin.Context) {
		var incoming struct {
			LLMProvider        string `json:"llm_provider"`
			LLMAPIKey          string `json:"llm_api_key"`
			LLMBaseURL         string `json:"llm_base_url"`
			LLMModel           string `json:"llm_model"`
			GeminiClientID     string `json:"gemini_client_id"`
			GeminiClientSecret string `json:"gemini_client_secret"`
			AIAnalysisDBPath   string `json:"ai_analysis_db_path"`
			EmbeddingProvider  string `json:"embedding_provider"`
			EmbeddingAPIKey    string `json:"embedding_api_key"`
			EmbeddingBaseURL   string `json:"embedding_base_url"`
			EmbeddingModel     string `json:"embedding_model"`
			EmbeddingDims      int    `json:"embedding_dims"`
			MemLLMBaseURL      string `json:"mem_llm_base_url"`
			MemLLMModel        string `json:"mem_llm_model"`
		}
		if err := c.ShouldBindJSON(&incoming); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		pathChanged := existing.AIAnalysisDBPath != incoming.AIAnalysisDBPath
		existing.LLMProvider = incoming.LLMProvider
		existing.LLMAPIKey = incoming.LLMAPIKey
		existing.LLMBaseURL = incoming.LLMBaseURL
		existing.LLMModel = incoming.LLMModel
		existing.GeminiClientID = incoming.GeminiClientID
		existing.GeminiClientSecret = incoming.GeminiClientSecret
		existing.AIAnalysisDBPath = incoming.AIAnalysisDBPath
		existing.EmbeddingProvider = incoming.EmbeddingProvider
		existing.EmbeddingAPIKey = incoming.EmbeddingAPIKey
		existing.EmbeddingBaseURL = incoming.EmbeddingBaseURL
		existing.EmbeddingModel = incoming.EmbeddingModel
		existing.EmbeddingDims = incoming.EmbeddingDims
		existing.MemLLMBaseURL = incoming.MemLLMBaseURL
		existing.MemLLMModel = incoming.MemLLMModel
		if err := savePreferences(existing); err != nil {
			log.Printf("[PREFS] Failed to save LLM preferences: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		// 路径变更时重新初始化 AI 数据库
		if pathChanged {
			if err := InitAIDB(); err != nil {
				log.Printf("[WARN] Re-init AI DB failed: %v", err)
			}
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// ── AI 分析历史持久化 ──────────────────────────────────────────────────
	// GET  /api/ai/conversations?key=contact:username
	api.GET("/ai/conversations", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		msgs, err := GetAIConversation(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"messages": msgs})
	})

	// PUT /api/ai/conversations  body: {key, messages}
	api.PUT("/ai/conversations", func(c *gin.Context) {
		var body struct {
			Key      string      `json:"key"`
			Messages []AIMessage `json:"messages"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if err := PutAIConversation(body.Key, body.Messages); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// DELETE /api/ai/conversations?key=contact:username
	api.DELETE("/ai/conversations", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		if err := DeleteAIConversation(key); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// ── Gemini OAuth ──────────────────────────────────────────────────────
	// GET /api/auth/gemini/url — 返回 Google 授权 URL（前端打开新标签）
	api.GET("/auth/gemini/url", func(c *gin.Context) {
		prefs := loadPreferences()
		if prefs.GeminiClientID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先填写并保存 Client ID"})
			return
		}
		redirectURI := geminiRedirectURI(c.Request)
		c.JSON(http.StatusOK, gin.H{"url": geminiAuthURL(prefs.GeminiClientID, redirectURI)})
	})

	// GET /api/auth/gemini/callback — Google 授权回调
	api.GET("/auth/gemini/callback", func(c *gin.Context) {
		successHTML := `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;color:#1d1d1f">
<h2 style="color:#07c160;font-size:28px;margin-bottom:12px">✓ 授权成功！</h2>
<p style="color:#666;font-size:15px">请返回 WeLink 应用，页面将自动更新。</p>
<p style="color:#aaa;font-size:13px;margin-top:24px">此窗口将在 3 秒后自动关闭…</p>
<script>setTimeout(()=>window.close(),3000)</script></body></html>`

		failHTML := func(msg string) string {
			return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px">
<h2 style="color:#e74c3c">授权失败</h2><p>` + msg + `</p><p style="color:#aaa;font-size:13px">请关闭此窗口并重试。</p></body></html>`
		}

		if errParam := c.Query("error"); errParam != "" {
			c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(failHTML(errParam)))
			return
		}
		code := c.Query("code")
		if code == "" {
			c.Data(http.StatusBadRequest, "text/html; charset=utf-8", []byte(failHTML("无效回调，缺少 code 参数")))
			return
		}
		prefs := loadPreferences()
		redirectURI := geminiRedirectURI(c.Request)
		access, refresh, expiry, err := geminiExchangeCode(prefs.GeminiClientID, prefs.GeminiClientSecret, code, redirectURI)
		if err != nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(failHTML(err.Error())))
			return
		}
		prefs.GeminiAccessToken = access
		prefs.GeminiRefreshToken = refresh
		prefs.GeminiTokenExpiry = expiry.Unix()
		if err := savePreferences(prefs); err != nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(failHTML("保存令牌失败："+err.Error())))
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(successHTML))
	})

	// GET /api/auth/gemini/status — 查询授权状态（前端轮询用）
	api.GET("/auth/gemini/status", func(c *gin.Context) {
		prefs := loadPreferences()
		c.JSON(http.StatusOK, gin.H{"authorized": prefs.GeminiAccessToken != ""})
	})

	// DELETE /api/auth/gemini — 撤销授权
	api.DELETE("/auth/gemini", func(c *gin.Context) {
		prefs := loadPreferences()
		prefs.GeminiAccessToken = ""
		prefs.GeminiRefreshToken = ""
		prefs.GeminiTokenExpiry = 0
		if err := savePreferences(prefs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// ── AI 分析（SSE 流式）────────────────────────────────────────────────
	// POST /api/ai/analyze  body: { username, is_group, from, to, messages: [{role,content}] }
	// 后端拉取聊天记录 → 构造 prompt → 流式转发 LLM 响应
	api.POST("/ai/analyze", func(c *gin.Context) {
		var body struct {
			Username string       `json:"username"`
			IsGroup  bool         `json:"is_group"`
			From     int64        `json:"from"`
			To       int64        `json:"to"`
			Messages []LLMMessage `json:"messages"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		if prefs.LLMProvider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if prefs.LLMAPIKey == "" && !(prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "") && prefs.LLMProvider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}
		StreamLLM(c.Writer, body.Messages, prefs)
	})

	// POST /api/ai/complete — 非流式单次补全（用于分段摘要）
	api.POST("/ai/complete", func(c *gin.Context) {
		var body struct {
			Messages []LLMMessage `json:"messages"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		if prefs.LLMProvider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if prefs.LLMAPIKey == "" && !(prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "") && prefs.LLMProvider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}
		content, err := CompleteLLM(body.Messages, prefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, CompleteResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusOK, CompleteResponse{Content: content})
	})

	// ── RAG 索引（需要服务层） ────────────────────────────────────────────
	// GET /api/ai/rag/index-status?key=contact:username
	api.GET("/ai/rag/index-status", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		status, err := GetFTSIndexStatus(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, status)
	})

	// POST /api/ai/rag/build-index  body: {key, username, is_group}
	api.POST("/ai/rag/build-index", func(c *gin.Context) {
		var body struct {
			Key      string `json:"key"`
			Username string `json:"username"`
			IsGroup  bool   `json:"is_group"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Key == "" || body.Username == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		BuildFTSIndex(c.Writer, body.Key, body.Username, body.IsGroup, getSvc())
	})

	// ── 向量索引（混合 RAG） ──────────────────────────────────────────────
	// GET /api/ai/vec/index-status?key=...
	api.GET("/ai/vec/index-status", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		status, err := GetVecIndexStatus(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, status)
	})

	// POST /api/ai/vec/build-index  body: {key, username, is_group}
	api.POST("/ai/vec/build-index", func(c *gin.Context) {
		var body struct {
			Key      string `json:"key"`
			Username string `json:"username"`
			IsGroup  bool   `json:"is_group"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Key == "" || body.Username == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		StartVecIndexBackground(body.Key, body.Username, body.IsGroup, getSvc(), loadPreferences())
		c.JSON(http.StatusOK, gin.H{"started": true})
	})

	// GET /api/ai/vec/build-progress?key=... — 轮询后台构建进度
	api.GET("/ai/vec/build-progress", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		p := GetVecBuildProgress(key)
		if p == nil {
			c.JSON(http.StatusOK, gin.H{"running": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"running":    !p.Done && p.Error == "",
			"step":       p.Step,
			"current":    p.Current,
			"total":      p.Total,
			"done":       p.Done,
			"error":      p.Error,
			"fact_count": p.FactCount,
		})
	})

	// POST /api/ai/vec/test-embedding — 验证 embedding 配置是否可用
	api.POST("/ai/vec/test-embedding", func(c *gin.Context) {
		prefs := loadPreferences()
		cfg := defaultEmbeddingConfig(prefs)
		_, err := GetEmbeddingsBatch([]string{"测试"}, cfg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "provider": cfg.Provider, "model": cfg.Model})
	})

	// POST /api/ai/llm/test — 验证主 LLM 配置是否可用
	api.POST("/ai/llm/test", func(c *gin.Context) {
		prefs := loadPreferences()
		model, err := testLLMConn(prefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "provider": prefs.LLMProvider, "model": model})
	})

	// POST /api/ai/mem/test — 验证记忆提炼本地模型配置是否可用
	api.POST("/ai/mem/test", func(c *gin.Context) {
		prefs := loadPreferences()
		memPrefs := memLLMPrefs(prefs)
		model, err := testLLMConn(memPrefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "provider": memPrefs.LLMProvider, "model": model})
	})

	// GET /api/ai/mem/status?key=...
	api.GET("/ai/mem/status", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		count, err := GetMemFactsCount(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"fact_count": count})
	})

	// GET /api/ai/mem/facts?key=...
	api.GET("/ai/mem/facts", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		facts, err := GetMemFacts(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"facts": facts})
	})

	// POST /api/ai/mem/build?key= — 独立触发记忆事实提炼（无需重建向量索引）
	api.POST("/ai/mem/build", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		job := getOrCreateJob(key)
		job.mu.Lock()
		if job.Step != "" && !job.Done && job.Error == "" {
			job.mu.Unlock()
			c.JSON(http.StatusOK, gin.H{"started": false, "reason": "already running"})
			return
		}
		job.Step = "extracting"
		job.Done = false
		job.Error = ""
		job.FactCount = 0
		job.mu.Unlock()

		prefs := loadPreferences()
		go func() {
			aiDBMu.Lock()
			db := aiDB
			aiDBMu.Unlock()
			setErr := func(msg string) {
				job.mu.Lock()
				job.Step = "error"
				job.Error = msg
				job.Done = true
				job.mu.Unlock()
			}
			if db == nil {
				setErr("数据库未初始化")
				return
			}
			rows, err := db.Query(
				`SELECT datetime, sender, content FROM vec_messages WHERE contact_key = ? ORDER BY seq`, key)
			if err != nil {
				setErr(err.Error())
				return
			}
			var msgs []rawMsg
			for rows.Next() {
				var m rawMsg
				rows.Scan(&m.DateTime, &m.Sender, &m.Content)
				msgs = append(msgs, m)
			}
			rows.Close()
			if len(msgs) == 0 {
				setErr("语义向量索引为空，请先构建索引")
				return
			}
			cfg := defaultEmbeddingConfig(prefs)
			totalChunks := (len(msgs) + memExtractChunkSize - 1) / memExtractChunkSize

			// ── 检查点：判断是续传还是全新开始 ──────────────────────────────────
			startChunk := 0
			var prevOffset int = -1
			db.QueryRow("SELECT extract_offset FROM vec_index_status WHERE contact_key = ?", key).Scan(&prevOffset)
			if prevOffset >= 0 && prevOffset < totalChunks {
				// 上次中断于 prevOffset 批（已完成），从下一批续传
				startChunk = prevOffset + 1
			} else {
				// 全新开始：清空旧事实，reset 检查点
				if _, err := db.Exec("DELETE FROM mem_facts WHERE contact_key = ?", key); err != nil {
					setErr("清理旧记忆失败：" + err.Error())
					return
				}
			}
			// 记录本次起始偏移，表示提炼进行中
			db.Exec(`UPDATE vec_index_status SET extract_offset = ? WHERE contact_key = ?`,
				startChunk-1, key) // 上一批已完成的索引（-1 表示尚未完成任何批次）

			// 统计已有事实数（续传时保留）
			var prevFactCount int
			db.QueryRow("SELECT COUNT(*) FROM mem_facts WHERE contact_key = ?", key).Scan(&prevFactCount)

			job.mu.Lock()
			job.Total = totalChunks
			job.Current = startChunk // 已完成批数（续传时为非零）
			job.mu.Unlock()

			newFacts, extractErr := extractAndStoreFacts(key, msgs, prefs, db, cfg,
				startChunk,
				func(done, total int) {
					job.mu.Lock()
					job.Current = done
					job.Total = total
					job.mu.Unlock()
				},
				func(chunkIdx int) {
					// 每批完成后写检查点，服务重启后可续传
					db.Exec(`UPDATE vec_index_status SET extract_offset = ? WHERE contact_key = ?`,
						chunkIdx, key)
				},
			)

			// 全部完成，清除检查点
			db.Exec(`UPDATE vec_index_status SET extract_offset = -1 WHERE contact_key = ?`, key)

			factCount := prevFactCount + newFacts
			job.mu.Lock()
			job.Step = "done"
			job.Done = true
			job.FactCount = factCount
			if newFacts == 0 && extractErr != nil {
				job.Error = "提炼失败：" + extractErr.Error()
			}
			job.mu.Unlock()
		}()
		c.JSON(http.StatusOK, gin.H{"started": true})
	})

	// POST /api/ai/rag  body: {key, messages, search_query?}
	api.POST("/ai/rag", func(c *gin.Context) {
		var body struct {
			Key         string       `json:"key"`
			Messages    []LLMMessage `json:"messages"`
			SearchQuery string       `json:"search_query"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		if prefs.LLMProvider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if prefs.LLMAPIKey == "" && !(prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "") && prefs.LLMProvider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}

		// 以最后一条用户消息作为检索词（如未指定）
		searchQ := body.SearchQuery
		if searchQ == "" {
			for i := len(body.Messages) - 1; i >= 0; i-- {
				if body.Messages[i].Role == "user" {
					searchQ = body.Messages[i].Content
					break
				}
			}
		}

		// 查询改写：将自然语言问题转为检索关键词，提升跨概念召回
		rewrittenQ := rewriteSearchQuery(searchQ, prefs)

		// 混合检索：向量搜索 + FTS，任一有结果即可
		// 向量搜索用原始问题（保留疑问语义），FTS 用改写后关键词（提升词形覆盖）
		vecResults, vecHitSeqs, _ := SearchVec(body.Key, searchQ, 20, prefs)
		ftsResults, ftsHitSeqs, ftsErr := SearchFTS(body.Key, rewrittenQ, 20)
		results, hitSeqs := mergeRAGResults(vecResults, vecHitSeqs, ftsResults, ftsHitSeqs)

		// 从记忆事实库检索相关事实（有则补充，无则跳过）
		memFacts, _ := SearchMemFacts(body.Key, searchQ, 10, prefs)

		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")

		sendChunk := func(chunk StreamChunk) {
			data, _ := json.Marshal(chunk)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
		}

		if len(results) == 0 {
			msg := "未在索引中找到相关内容，请尝试换一种表达方式，或切换回全量分析模式。"
			if ftsErr != nil && len(vecResults) == 0 {
				msg = "检索失败：" + ftsErr.Error()
			}
			sendChunk(StreamChunk{Delta: msg})
			sendChunk(StreamChunk{Done: true, RagMeta: &RagMeta{Hits: 0, Retrieved: 0}})
			return
		}

		// 构建检索到的上下文 + snipets（带命中标记）
		var ctxLines []string
		snipets := make([]RagSnipet, 0, len(results))
		for _, r := range results {
			ctxLines = append(ctxLines, fmt.Sprintf("[%s] %s：%s", r.Datetime, r.Sender, r.Content))
			snipets = append(snipets, RagSnipet{
				Datetime: r.Datetime,
				Sender:   r.Sender,
				Content:  r.Content,
				IsHit:    hitSeqs != nil && hitSeqs[r.Seq],
			})
		}
		ctxText := strings.Join(ctxLines, "\n")

		// 先推送 RAG 元数据（含命中消息列表）
		sendChunk(StreamChunk{RagMeta: &RagMeta{
			Hits:      len(hitSeqs),
			Retrieved: len(results),
			Messages:  snipets,
		}})

		// 构造 LLM 消息（注入检索上下文 + 记忆事实）
		var memSection string
		if len(memFacts) > 0 {
			memSection = "\n\n【关于对方的已知事实（由 AI 从历史聊天中提炼）】\n"
			for _, f := range memFacts {
				memSection += "- " + f + "\n"
			}
		}
		sysPrompt := fmt.Sprintf(
			"你是一个聊天记录分析助手。以下是从聊天记录中混合检索（语义向量 + 关键词）到的相关片段（命中 %d 条，含上下文共 %d 条）：\n\n%s%s\n\n请根据以上内容回答用户问题，分析时请客观有洞察力，用中文回答。",
			len(hitSeqs), len(results), ctxText, memSection,
		)
		llmMsgs := append([]LLMMessage{{Role: "system", Content: sysPrompt}}, body.Messages...)
		streamLLMCore(sendChunk, llmMsgs, prefs)
	})

	// POST /api/ai/day-rag  body: {date, messages, search_query?}
	// 跨联系人/群聊的日期混合检索，用于时光机 AI 分析
	api.POST("/ai/day-rag", func(c *gin.Context) {
		var body struct {
			Date        string       `json:"date"`
			Messages    []LLMMessage `json:"messages"`
			SearchQuery string       `json:"search_query"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Date == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		if prefs.LLMProvider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if prefs.LLMAPIKey == "" && !(prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "") && prefs.LLMProvider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}

		searchQ := body.SearchQuery
		if searchQ == "" {
			for i := len(body.Messages) - 1; i >= 0; i-- {
				if body.Messages[i].Role == "user" {
					searchQ = body.Messages[i].Content
					break
				}
			}
		}

		rewrittenQ := rewriteSearchQuery(searchQ, prefs)
		results, hitCount, _ := SearchFTSAcrossDate(body.Date, rewrittenQ, 30)

		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")

		sendChunk := func(chunk StreamChunk) {
			data, _ := json.Marshal(chunk)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
		}

		if len(results) == 0 {
			sendChunk(StreamChunk{Delta: fmt.Sprintf("未在 %s 的索引中找到相关内容。提示：需要先在联系人/群聊详情中为相关对话构建 FTS 索引（混合检索 → 构建索引），或切换为全量分析模式。", body.Date)})
			sendChunk(StreamChunk{Done: true, RagMeta: &RagMeta{Hits: 0, Retrieved: 0}})
			return
		}

		var ctxLines []string
		for _, r := range results {
			ctxLines = append(ctxLines, fmt.Sprintf("[%s] %s：%s", r.Datetime, r.Sender, r.Content))
		}

		sendChunk(StreamChunk{RagMeta: &RagMeta{Hits: hitCount, Retrieved: len(results)}})

		systemMsg := LLMMessage{
			Role:    "system",
			Content: fmt.Sprintf("你是微信聊天数据分析助手。以下是 %s 这一天检索到的相关聊天记录片段（来自多个联系人/群聊）：\n\n%s\n\n请基于以上检索内容回答用户的问题。", body.Date, strings.Join(ctxLines, "\n")),
		}
		msgs := append([]LLMMessage{systemMsg}, body.Messages...)
		StreamLLM(c.Writer, msgs, prefs)
	})

	// ── 需要服务层的路由（未初始化时返回 503） ─────────────────────────────

	prot := api.Group("/")
	prot.Use(func(c *gin.Context) {
		svcMu.RLock()
		ready := contactSvc != nil
		svcMu.RUnlock()
		if !ready {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "not_configured"})
			c.Abort()
			return
		}
		c.Next()
	})

	{
		// 极速获取缓存后的统计信息
		prot.GET("/contacts/stats", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetCachedStats())
		})

		// 获取全局统计数据
		prot.GET("/global", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetGlobal())
		})

		// 获取词云数据
		prot.GET("/contacts/wordcloud", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, getSvc().GetWordCloud(uname, includeMine))
		})

		// 群聊列表
		prot.GET("/groups", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetGroups())
		})

		// 时光轴（聊天日历）
		registerCalendarRoutes(prot, getSvc)

		// 群聊某天聊天记录
		prot.GET("/groups/messages", func(c *gin.Context) {
			uname := c.Query("username")
			date := c.Query("date")
			if uname == "" || date == "" {
				c.JSON(400, gin.H{"error": "username and date required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetGroupDayMessages(uname, date))
		})

		// 群聊搜索聊天记录
		prot.GET("/groups/search", func(c *gin.Context) {
			uname := c.Query("username")
			q := c.Query("q")
			if uname == "" || q == "" {
				c.JSON(400, gin.H{"error": "username and q required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().SearchGroupMessages(uname, q))
		})

		// 群聊深度画像
		prot.GET("/groups/detail", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetGroupDetail(uname))
		})

		// 获取与联系人的共同群聊
		prot.GET("/contacts/common-groups", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetCommonGroups(uname))
		})

		// 获取联系人深度分析（小时/周/日历/深夜/红包/主动率）
		prot.GET("/contacts/detail", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetContactDetail(uname))
		})

		// 某天的聊天记录（日历点击）
		prot.GET("/contacts/messages", func(c *gin.Context) {
			uname := c.Query("username")
			date := c.Query("date") // "2024-03-15"
			if uname == "" || date == "" {
				c.JSON(400, gin.H{"error": "username and date required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetDayMessages(uname, date))
		})

		// 搜索联系人聊天记录
		prot.GET("/contacts/search", func(c *gin.Context) {
			uname := c.Query("username")
			q := c.Query("q")
			if uname == "" || q == "" {
				c.JSON(400, gin.H{"error": "username and q required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, getSvc().SearchMessages(uname, q, includeMine))
		})

		// 导出联系人全量聊天记录（最多 50000 条）
		prot.GET("/contacts/export", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 username 参数"})
				return
			}
			var from, to int64
			fmt.Sscanf(c.Query("from"), "%d", &from)
			fmt.Sscanf(c.Query("to"), "%d", &to)
			c.JSON(http.StatusOK, getSvc().ExportContactMessages(uname, from, to))
		})

		// 导出群聊全量聊天记录（最多 50000 条）
		prot.GET("/groups/export", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 username 参数"})
				return
			}
			var from, to int64
			fmt.Sscanf(c.Query("from"), "%d", &from)
			fmt.Sscanf(c.Query("to"), "%d", &to)
			c.JSON(http.StatusOK, getSvc().ExportGroupMessages(uname, from, to))
		})

		// 关系降温榜
		prot.GET("/contacts/cooling", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetCoolingRanking())
		})

		// 全局跨联系人消息搜索
		prot.GET("/search", func(c *gin.Context) {
			q := c.Query("q")
			if q == "" {
				c.JSON(400, gin.H{"error": "q required"})
				return
			}
			searchType := c.DefaultQuery("type", "all")
			c.JSON(http.StatusOK, getSvc().GlobalSearch(q, searchType))
		})

		// 某月的文本消息（情感分析详情）
		prot.GET("/contacts/messages/month", func(c *gin.Context) {
			uname := c.Query("username")
			month := c.Query("month") // "2024-03"
			if uname == "" || month == "" {
				c.JSON(400, gin.H{"error": "username and month required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, getSvc().GetMonthMessages(uname, month, includeMine))
		})

		// 情感分析
		prot.GET("/contacts/sentiment", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, getSvc().GetSentimentAnalysis(uname, includeMine))
		})

		// 时间范围过滤统计（from/to 为 Unix 秒时间戳）
		prot.GET("/stats/filter", func(c *gin.Context) {
			var from, to int64
			fmt.Sscanf(c.Query("from"), "%d", &from)
			fmt.Sscanf(c.Query("to"), "%d", &to)
			result := getSvc().AnalyzeWithFilter(from, to)
			if result == nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "analysis failed"})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// 获取数据库管理信息
		prot.GET("/databases", func(c *gin.Context) {
			c.JSON(http.StatusOK, getMgr().GetDBInfos())
		})

		// 获取指定数据库的表列表
		prot.GET("/databases/:dbName/tables", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tables, err := getMgr().GetTables(dbName)
			if err != nil {
				log.Printf("[DB] GetTables %s: %v", dbName, err)
				c.JSON(http.StatusBadRequest, gin.H{"error": "数据库不存在"})
				return
			}
			c.JSON(http.StatusOK, tables)
		})

		// 获取表结构
		prot.GET("/databases/:dbName/tables/:tableName/schema", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tableName := c.Param("tableName")
			cols, err := getMgr().GetTableSchema(dbName, tableName)
			if err != nil {
				log.Printf("[DB] GetTableSchema %s/%s: %v", dbName, tableName, err)
				c.JSON(http.StatusBadRequest, gin.H{"error": "表不存在"})
				return
			}
			c.JSON(http.StatusOK, cols)
		})

		// 获取表数据（分页）
		prot.GET("/databases/:dbName/tables/:tableName/data", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tableName := c.Param("tableName")
			offset := 0
			limit := 50
			if v := c.Query("offset"); v != "" {
				fmt.Sscanf(v, "%d", &offset)
			}
			if v := c.Query("limit"); v != "" {
				fmt.Sscanf(v, "%d", &limit)
				if limit > 200 {
					limit = 200
				}
			}
			data, err := getMgr().GetTableData(dbName, tableName, offset, limit)
			if err != nil {
				log.Printf("[DB] GetTableData %s/%s: %v", dbName, tableName, err)
				c.JSON(http.StatusBadRequest, gin.H{"error": "查询失败"})
				return
			}
			c.JSON(http.StatusOK, data)
		})

		// 在指定数据库执行 SQL 查询（只读）
		prot.POST("/databases/:dbName/query", func(c *gin.Context) {
			dbName := c.Param("dbName")
			var body struct {
				SQL string `json:"sql"`
			}
			if err := c.ShouldBindJSON(&body); err != nil || body.SQL == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 sql 参数"})
				return
			}
			result := getMgr().ExecQuery(dbName, body.SQL)
			c.JSON(http.StatusOK, result)
		})

		// 初始化/重新索引（前端传入时间范围后调用）
		prot.POST("/init", func(c *gin.Context) {
			var body struct {
				From int64 `json:"from"`
				To   int64 `json:"to"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(400, gin.H{"error": "invalid body"})
				return
			}
			getSvc().Reinitialize(body.From, body.To)
			c.JSON(200, gin.H{"status": "indexing"})
		})

	}

	// /api/status：未配置时也返回 200，前端 useBackendStatus 靠它判断后端是否可达
	api.GET("/status", func(c *gin.Context) {
		svcMu.RLock()
		svc := contactSvc
		svcMu.RUnlock()
		if svc == nil {
			c.JSON(200, gin.H{"is_initialized": false, "is_indexing": false, "total_cached": 0})
			return
		}
		c.JSON(200, svc.GetStatus())
	})

	// App 模式：用系统浏览器打开外部 URL（仅允许 https）
	api.GET("/open-url", func(c *gin.Context) {
		url := c.Query("url")
		if err := openURL(url); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无法打开链接"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 健康检查
	api.GET("/health", func(c *gin.Context) {
		svcMu.RLock()
		mgr := dbMgr
		svcMu.RUnlock()
		connected := 0
		if mgr != nil {
			connected = len(mgr.MessageDBs)
		}
		c.JSON(200, gin.H{"status": "ok", "db_connected": connected})
	})

	// OpenAPI 规范
	api.GET("/swagger.json", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json", swaggerSpec())
	})

	// Swagger UI
	r.GET("/swagger", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/swagger/")
	})
	r.GET("/swagger/", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", swaggerUI())
	})

	// App 模式：内嵌前端静态文件，Go 直接服务 SPA + API
	if hasFrontend {
		sub, err := fs.Sub(embeddedFrontend, "static")
		if err != nil {
			log.Fatalf("Failed to get embedded frontend: %v", err)
		}
		staticServer := http.FS(sub)
		r.NoRoute(func(c *gin.Context) {
			p := strings.TrimPrefix(c.Request.URL.Path, "/")
			// API 和 Swagger 路由由 Gin 自己处理，NoRoute 不干预
			if strings.HasPrefix(p, "api/") || strings.HasPrefix(p, "swagger") {
				c.Status(http.StatusNotFound)
				return
			}
			// 尝试精确匹配非 index 文件（assets/、favicon 等）
			if p != "" && p != "index.html" {
				if f, err := sub.Open(p); err == nil {
					f.Close()
					c.FileFromFS(p, staticServer)
					return
				}
			}
			// SPA 回退：直接写入 index.html 字节，避免 Go FileServer
			// 将 /index.html 重定向到 / 导致的无限 301 循环
			content, err := fs.ReadFile(sub, "index.html")
			if err != nil {
				c.Status(http.StatusInternalServerError)
				return
			}
			c.Data(http.StatusOK, "text/html; charset=utf-8", content)
		})
	}

	log.Printf("WeLink Backend serving on :%s", cfg.Server.Port)

	if hasFrontend {
		// App 模式：通知 webview 服务器已就绪，然后阻塞
		go r.Run(":" + cfg.Server.Port) //nolint:errcheck
		signalServerReady(cfg.Server.Port)
		select {} // 等 webview 窗口关闭后 os.Exit
	}

	r.Run(":" + cfg.Server.Port) //nolint:errcheck
}
