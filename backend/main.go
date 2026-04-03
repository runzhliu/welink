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
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
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

// safePercent 安全计算百分比，避免除零
func safePercent(part, total int) int {
	if total == 0 {
		return 0
	}
	return part * 100 / total
}

// sampleEvenly 从切片中均匀采样 n 个元素（保持原始顺序）
func sampleEvenly(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	result := make([]string, 0, n)
	step := float64(len(items)) / float64(n)
	for i := 0; i < n; i++ {
		idx := int(float64(i) * step)
		result = append(result, items[idx])
	}
	return result
}

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
	isDemoMode := os.Getenv("DEMO_MODE") == "true"
	if isDemoMode {
		demoDir := cfg.Data.Dir
		log.Printf("[DEMO] Demo mode enabled, generating sample databases")
		if err := seed.Generate(demoDir); err != nil {
			log.Fatalf("Failed to generate demo databases: %v", err)
		}
		// Demo 模式自动全量索引（无时间限制），用非零 to 触发 NewContactService 自动初始化
		cfg.Analysis.DefaultInitFrom = 0
		cfg.Analysis.DefaultInitTo = time.Now().Unix() + 365*24*3600*10 // 10年后
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
	// 将 AI 分析库注册到 DBManager，使数据库页面可查看和查询
	if dbMgr != nil {
		dbMgr.RegisterExtraDB("ai_analysis.db", aiAnalysisDBPath())
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

	// Demo 模式：全局限速（每 IP 每秒 20 请求）
	if isDemoMode {
		r.Use(demoRateLimit)
	}

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
			Encoding string `json:"encoding"` // "base64" → 解码后写入（用于 PNG 等二进制文件）
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
		var fileBytes []byte
		if body.Encoding == "base64" {
			decoded, decErr := base64.StdEncoding.DecodeString(body.Content)
			if decErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "base64 解码失败: " + decErr.Error()})
				return
			}
			fileBytes = decoded
		} else {
			fileBytes = []byte(body.Content)
		}
		savePath := filepath.Join(homeDir, "Downloads", body.Filename)
		if err := os.WriteFile(savePath, fileBytes, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"path": savePath})
	})

	// 前端日志收集：接收前端 console.error / window.onerror 等日志
	api.POST("/app/frontend-log", func(c *gin.Context) {
		var body struct {
			Logs []struct {
				Level   string `json:"level"`
				Message string `json:"message"`
				Time    string `json:"time"`
			} `json:"logs"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || len(body.Logs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的日志数据"})
			return
		}
		pref := loadPreferences()
		logDir := pref.LogDir
		if logDir == "" {
			logDir = defaultLogDir()
		}
		if logDir == "" {
			c.JSON(http.StatusOK, gin.H{"ok": true}) // 非 App 模式且没配目录，静默丢弃
			return
		}
		_ = os.MkdirAll(logDir, 0700)
		f, err := os.OpenFile(filepath.Join(logDir, "frontend.log"),
			os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入日志失败"})
			return
		}
		defer f.Close()
		for _, entry := range body.Logs {
			fmt.Fprintf(f, "[%s] [%s] %s\n", entry.Time, entry.Level, entry.Message)
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// 日志打包：把 log_dir 下的 *.log 文件打成 zip 返回路径
	api.POST("/app/bundle-logs", func(c *gin.Context) {
		pref := loadPreferences()
		logDir := pref.LogDir
		if logDir == "" {
			// 未配置日志目录时使用默认路径
			logDir = defaultLogDir()
			if logDir == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置日志目录"})
				return
			}
		}
		zipPath := filepath.Join(logDir, fmt.Sprintf("welink-logs-%s.zip", time.Now().Format("20060102-150405")))
		zf, err := os.Create(zipPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建 zip 失败: " + err.Error()})
			return
		}
		defer zf.Close()

		// 收集需要脱敏的 API Key（防止日志中泄露）
		var sensitiveKeys []string
		if pref.LLMAPIKey != "" { sensitiveKeys = append(sensitiveKeys, pref.LLMAPIKey) }
		if pref.GeminiAccessToken != "" { sensitiveKeys = append(sensitiveKeys, pref.GeminiAccessToken) }
		if pref.GeminiRefreshToken != "" { sensitiveKeys = append(sensitiveKeys, pref.GeminiRefreshToken) }
		if pref.EmbeddingAPIKey != "" { sensitiveKeys = append(sensitiveKeys, pref.EmbeddingAPIKey) }
		for _, p := range pref.LLMProfiles {
			if p.APIKey != "" { sensitiveKeys = append(sensitiveKeys, p.APIKey) }
		}

		// 只打包 WeLink 自己的日志文件，不包含目录下的其他无关日志
		welinkLogFiles := []string{"welink.log", "frontend.log"}

		zw := zip.NewWriter(zf)
		for _, name := range welinkLogFiles {
			raw, err := os.ReadFile(filepath.Join(logDir, name))
			if err != nil {
				continue // 文件不存在则跳过
			}
			// 脱敏：将所有 API Key 替换为 [REDACTED]
			content := string(raw)
			for _, key := range sensitiveKeys {
				if len(key) > 0 {
					content = strings.ReplaceAll(content, key, "[REDACTED]")
				}
			}
			w, err := zw.Create(name)
			if err != nil {
				continue
			}
			w.Write([]byte(content))
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

	// 自定义纪念日保存
	api.PUT("/preferences/anniversaries", func(c *gin.Context) {
		var body struct {
			CustomAnniversaries []CustomAnniversary `json:"custom_anniversaries"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		existing.CustomAnniversaries = body.CustomAnniversaries
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, existing.CustomAnniversaries)
	})

	// LLM 配置单独保存，避免与屏蔽名单 PUT 冲突
	api.PUT("/preferences/llm", func(c *gin.Context) {
		// Demo 模式下禁止修改（防止 SSRF / API key 滥用）
		if isDemoMode {
			demoBlockLLMWrite(c)
			return
		}
		var incoming struct {
			LLMProfiles        []LLMProfile `json:"llm_profiles"`
			LLMProvider        string       `json:"llm_provider"`
			LLMAPIKey          string       `json:"llm_api_key"`
			LLMBaseURL         string       `json:"llm_base_url"`
			LLMModel           string       `json:"llm_model"`
			GeminiClientID     string       `json:"gemini_client_id"`
			GeminiClientSecret string       `json:"gemini_client_secret"`
			AIAnalysisDBPath   string       `json:"ai_analysis_db_path"`
			EmbeddingProvider  string       `json:"embedding_provider"`
			EmbeddingAPIKey    string       `json:"embedding_api_key"`
			EmbeddingBaseURL   string       `json:"embedding_base_url"`
			EmbeddingModel     string       `json:"embedding_model"`
			EmbeddingDims      int          `json:"embedding_dims"`
			MemLLMBaseURL      string       `json:"mem_llm_base_url"`
			MemLLMModel        string       `json:"mem_llm_model"`
		}
		if err := c.ShouldBindJSON(&incoming); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		pathChanged := existing.AIAnalysisDBPath != incoming.AIAnalysisDBPath
		existing.LLMProfiles = incoming.LLMProfiles
		// 将第一个 profile 同步到单配置字段（向后兼容 CompleteLLM 等内部调用）
		if len(incoming.LLMProfiles) > 0 {
			p := incoming.LLMProfiles[0]
			existing.LLMProvider = p.Provider
			existing.LLMAPIKey = p.APIKey
			existing.LLMBaseURL = p.BaseURL
			existing.LLMModel = p.Model
		} else {
			existing.LLMProvider = incoming.LLMProvider
			existing.LLMAPIKey = incoming.LLMAPIKey
			existing.LLMBaseURL = incoming.LLMBaseURL
			existing.LLMModel = incoming.LLMModel
		}
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
		// 路径变更时重新初始化 AI 数据库，并同步更新 DBManager 注册
		if pathChanged {
			if err := InitAIDB(); err != nil {
				log.Printf("[WARN] Re-init AI DB failed: %v", err)
			}
			if m := getMgr(); m != nil {
				m.RegisterExtraDB("ai_analysis.db", aiAnalysisDBPath())
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
			Username  string       `json:"username"`
			IsGroup   bool         `json:"is_group"`
			From      int64        `json:"from"`
			To        int64        `json:"to"`
			Messages  []LLMMessage `json:"messages"`
			ProfileID string       `json:"profile_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if cfg.apiKey == "" && cfg.provider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}
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
		streamLLMCoreWithProfile(sendChunk, body.Messages, prefs, body.ProfileID)
	})

	// ── AI 分身：三层记忆 + session 机制 ──
	var (
		cloneCache   = make(map[string]string) // session_id → system prompt
		cloneCacheMu sync.RWMutex
		cloneSeq     int64
	)

	// GET /api/ai/clone/session/:username — 检查是否有缓存的分身档案
	api.GET("/ai/clone/session/:username", func(c *gin.Context) {
		uname := c.Param("username")
		p, err := GetCloneProfile(uname)
		if err != nil || p == nil {
			c.JSON(http.StatusOK, gin.H{"exists": false})
			return
		}
		// 恢复到内存缓存
		cloneCacheMu.Lock()
		cloneSeq++
		sid := fmt.Sprintf("clone-%s-%d", uname, cloneSeq)
		cloneCache[sid] = p.Prompt
		cloneCacheMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"exists":        true,
			"session_id":    sid,
			"private_count": p.PrivateCount,
			"group_count":   p.GroupCount,
			"has_profile":   p.HasProfile,
			"has_recent":    p.HasRecent,
			"avg_msg_len":   p.AvgMsgLen,
			"emoji_pct":     p.EmojiPct,
			"updated_at":    p.UpdatedAt,
		})
	})

	// POST /api/ai/clone/learn — 多步学习（SSE 进度推送）
	// 步骤: 加载消息 → 统计分析 → LLM提炼长期档案 → LLM提炼中期近况 → 组装prompt
	api.POST("/ai/clone/learn", func(c *gin.Context) {
		var body struct {
			Username string   `json:"username"`
			Count    int      `json:"count"`
			Groups         []string `json:"groups"`
			Bio            string   `json:"bio"`
			ExtractProfile bool     `json:"extract_profile"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}

		prefs := loadPreferences()
		hasLLM := prefs.LLMProvider != "" && (prefs.LLMAPIKey != "" || prefs.LLMProvider == "ollama")

		// SSE 进度推送
		flusher, fOk := c.Writer.(http.Flusher)
		if !fOk {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		sendProgress := func(step string, detail string) {
			data, _ := json.Marshal(gin.H{"step": step, "detail": detail})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
		}

		// ─── Step 1: 加载消息 ───
		sendProgress("loading", "正在加载聊天记录...")

		limit := body.Count
		if limit <= 0 {
			limit = 0
		}

		allMsgs := getSvc().ExportContactMessages(body.Username, 0, 0)

		// 对方文本消息——全量加载，用户选多少给多少
		var theirTexts []string
		for _, m := range allMsgs {
			if !m.IsMine && m.Type == 1 && m.Content != "" {
				theirTexts = append(theirTexts, m.Content)
			}
		}
		if limit > 0 && len(theirTexts) > limit {
			theirTexts = theirTexts[len(theirTexts)-limit:]
		}
		if limit <= 0 && len(theirTexts) > 2000 {
			theirTexts = theirTexts[len(theirTexts)-2000:]
		}

		// 群聊发言（每个群各取最近 limit 条）
		var groupSamples []string
		if len(body.Groups) > 0 {
			groupLimit := limit
			if groupLimit <= 0 {
				groupLimit = 500 // "全部"模式下每个群兜底 500 条
			}
			groupSamples = getSvc().ExtractContactGroupMessages(body.Username, body.Groups, groupLimit)
		}

		// 获取显示名
		displayName := body.Username
		for _, s := range getSvc().GetCachedStats() {
			if s.Username == body.Username {
				if s.Remark != "" {
					displayName = s.Remark
				} else if s.Nickname != "" {
					displayName = s.Nickname
				}
				break
			}
		}

		// ─── Step 2: 统计分析 ───
		sendProgress("analyzing", "正在分析聊天特征...")

		allTheirTexts := theirTexts
		if len(groupSamples) > 0 {
			allTheirTexts = append(append([]string{}, theirTexts...), groupSamples...)
		}
		var totalLen int
		for _, t := range allTheirTexts {
			totalLen += len([]rune(t))
		}
		avgLen := 0
		if len(allTheirTexts) > 0 {
			avgLen = totalLen / len(allTheirTexts)
		}
		msgWithEmoji := 0
		for _, t := range allTheirTexts {
			for _, r := range t {
				if r >= 0x1F600 && r <= 0x1FAF8 || r >= 0x2600 && r <= 0x27BF || r >= 0xFE00 && r <= 0xFEFF {
					msgWithEmoji++
					break
				}
			}
		}
		emojiPct := 0
		if len(allTheirTexts) > 0 {
			emojiPct = msgWithEmoji * 100 / len(allTheirTexts)
		}

		// ─── Step 3: LLM 提炼人物特征（用户可选） ───
		var profileText string
		if body.ExtractProfile && hasLLM && len(allTheirTexts) >= 50 {
			sendProgress("profile", "AI 正在提炼人物特征...")
			profileSamples := sampleEvenly(allTheirTexts, 200)
			profilePrompt := fmt.Sprintf(`请用 3-5 句话简要概括「%s」的说话风格特点（口头禅、语气、性格）。

消息样本：
%s

直接输出，不要分点、不要标题。`, displayName, strings.Join(profileSamples, "\n"))

			result, err := CompleteLLM([]LLMMessage{
				{Role: "user", Content: profilePrompt},
			}, prefs)
			if err == nil && result != "" {
				profileText = result
			}
		}

		// ─── Step 4: 组装 prompt ───
		sendProgress("building", "正在构建 AI 分身...")

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("你现在要扮演「%s」，完全模拟 TA 的说话风格与我对话。\n", displayName))
		sb.WriteString(fmt.Sprintf("当前时间：%s\n\n", time.Now().Format("2006年1月2日")))

		// 背景（用户填写）
		if bio := strings.TrimSpace(body.Bio); bio != "" {
			sb.WriteString("背景：" + bio + "\n\n")
		}

		// LLM 提炼的简短风格总结（辅助）
		if profileText != "" {
			sb.WriteString("风格总结：" + profileText + "\n\n")
		}

		// 核心：用户选的全部原始消息，不做裁剪
		if len(theirTexts) > 0 {
			sb.WriteString(fmt.Sprintf("以下是「%s」最近的 %d 条真实私聊消息，这是你模仿的核心依据——逐条感受 TA 的用词、断句、语气、长度、emoji 习惯：\n\n", displayName, len(theirTexts)))
			sb.WriteString(strings.Join(theirTexts, "\n"))
			sb.WriteString("\n\n")
		}
		if len(groupSamples) > 0 {
			sb.WriteString(fmt.Sprintf("TA 在群聊中的 %d 条发言：\n\n", len(groupSamples)))
			sb.WriteString(strings.Join(groupSamples, "\n"))
			sb.WriteString("\n\n")
		}

		// 精简规则
		sb.WriteString(fmt.Sprintf(`规则：
1. 你的每条回复必须读起来和上面的真实消息一模一样——相同的长度、断句、语气词、标点
2. TA 平均每条 %d 字，严格保持这个长度
3. TA %d%% 的消息含 emoji，按这个频率用，不多不少
4. 绝对不暴露你是 AI
5. 保持 TA 原本的交流温度，不要更热情或更客套`, avgLen, emojiPct))

		sysPrompt := sb.String()

		cloneCacheMu.Lock()
		cloneSeq++
		sessionID := fmt.Sprintf("clone-%s-%d", body.Username, cloneSeq)
		cloneCache[sessionID] = sysPrompt
		cloneCacheMu.Unlock()

		// 持久化到数据库
		_ = PutCloneProfile(&CloneProfile{
			Username:     body.Username,
			Prompt:       sysPrompt,
			PrivateCount: len(theirTexts),
			GroupCount:   len(groupSamples),
			HasProfile:   profileText != "",
			HasRecent:    false,
			AvgMsgLen:    avgLen,
			EmojiPct:     emojiPct,
			UpdatedAt:    time.Now().Unix(),
		})

		// 最终结果
		result, _ := json.Marshal(gin.H{
			"done":           true,
			"session_id":     sessionID,
			"sample_count":   len(theirTexts) + len(groupSamples),
			"private_count":  len(theirTexts),
			"group_count":    len(groupSamples),
			"has_profile":    profileText != "",
			"has_recent":     false,
			"avg_msg_len":    avgLen,
			"emoji_pct":      emojiPct,
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", result)
		flusher.Flush()
	})

	// POST /api/ai/clone/chat — 对话：通过 session_id 复用缓存的 system prompt
	api.POST("/ai/clone/chat", func(c *gin.Context) {
		var body struct {
			SessionID string       `json:"session_id"`
			Messages  []LLMMessage `json:"messages"`
			ProfileID string       `json:"profile_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if cfg.apiKey == "" && cfg.provider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 API Key 或完成 Google 授权"})
			return
		}

		cloneCacheMu.RLock()
		sysPrompt, ok := cloneCache[body.SessionID]
		cloneCacheMu.RUnlock()
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "会话已过期，请重新学习"})
			return
		}

		llmMessages := []LLMMessage{{Role: "system", Content: sysPrompt}}
		llmMessages = append(llmMessages, body.Messages...)

		flusher, fOk := c.Writer.(http.Flusher)
		if !fOk {
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
		streamLLMCoreWithProfile(sendChunk, llmMessages, prefs, body.ProfileID)
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

	// ── AI 群聊模拟（SSE 流式）────────────────────────────────────────────
	// POST /api/ai/group-sim — 模拟群聊：按成员发言比例和风格生成对话
	api.POST("/ai/group-sim", func(c *gin.Context) {
		var body struct {
			GroupUsername string `json:"group_username"`
			MessageCount int    `json:"message_count"`
			ProfileID    string `json:"profile_id"`
			UserMessage  string `json:"user_message"`
			History      []struct {
				Speaker string `json:"speaker"`
				Content string `json:"content"`
			} `json:"history"`
			Rounds  int      `json:"rounds"`
			Topic   string   `json:"topic"`   // 话题/场景设定
			Mood    string   `json:"mood"`     // 聊天氛围
			Members []string `json:"members"` // 指定参与成员（为空则自动选 top 10）
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if body.MessageCount <= 0 { body.MessageCount = 1000 }
		if body.Rounds <= 0 { body.Rounds = 5 }
		if body.Rounds > 20 { body.Rounds = 20 }

		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}

		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		// 1. 加载最近 N 条群消息
		msgs := svc.ExportGroupMessages(body.GroupUsername, 0, 0)
		if len(msgs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该群聊没有消息记录"})
			return
		}
		// 取最后 N 条
		if len(msgs) > body.MessageCount {
			msgs = msgs[len(msgs)-body.MessageCount:]
		}

		// 2. 统计成员发言比例 + 风格特征
		type memberInfo struct {
			Name       string
			Count      int
			Samples    []string  // 文本消息样本
			TotalChars int       // 总字符数
			TextCount  int       // 文本消息数
			EmojiCount int       // 含表情的消息数
			QMarkCount int       // 含问号的消息数（爱提问）
			ExclCount  int       // 含感叹号的消息数（情绪化）
			ShortCount int       // <=5字的消息数（简短回复型）
			LongCount  int       // >=50字的消息数（长篇大论型）
		}
		memberMap := make(map[string]*memberInfo)
		for _, m := range msgs {
			if m.Speaker == "" || m.Speaker == "未知" { continue }
			mi, ok := memberMap[m.Speaker]
			if !ok {
				mi = &memberInfo{Name: m.Speaker}
				memberMap[m.Speaker] = mi
			}
			mi.Count++
			if m.Type == 1 && len(m.Content) > 0 {
				mi.TextCount++
				charLen := len([]rune(m.Content))
				mi.TotalChars += charLen
				if charLen <= 5 { mi.ShortCount++ }
				if charLen >= 50 { mi.LongCount++ }
				if strings.ContainsAny(m.Content, "？?") { mi.QMarkCount++ }
				if strings.ContainsAny(m.Content, "！!") { mi.ExclCount++ }
				if strings.ContainsAny(m.Content, "😂🤣😄😁😆😅😊😉😎🥰😍") || strings.Contains(m.Content, "[") { mi.EmojiCount++ }
				// 保留样本（均匀抽样：前中后各取一些）
				if len(mi.Samples) < 30 {
					mi.Samples = append(mi.Samples, m.Content)
				}
			}
		}

		// 筛选参与成员（用户指定 or 自动取 top 10）
		members := make([]*memberInfo, 0, len(memberMap))
		if len(body.Members) > 0 {
			allowed := make(map[string]bool)
			for _, name := range body.Members { allowed[name] = true }
			for _, mi := range memberMap {
				if allowed[mi.Name] { members = append(members, mi) }
			}
		} else {
			for _, mi := range memberMap { members = append(members, mi) }
		}
		sort.Slice(members, func(i, j int) bool { return members[i].Count > members[j].Count })
		if len(members) > 10 { members = members[:10] }

		totalCount := 0
		for _, mi := range members { totalCount += mi.Count }

		// 3. 构造系统 prompt（含风格特征画像）
		var sb strings.Builder
		sb.WriteString("你正在模拟一个微信群聊。每个成员有独特的说话风格，你必须严格区分不同成员的性格和表达方式。\n\n")

		// 话题设定
		if body.Topic != "" {
			sb.WriteString(fmt.Sprintf("【话题/场景设定】\n群友们正在讨论：%s\n请围绕这个话题展开对话。\n\n", body.Topic))
		}
		// 氛围设定
		if body.Mood != "" {
			moodDesc := map[string]string{
				"casual":    "日常闲聊，轻松随意，偶尔开玩笑",
				"heated":    "激烈讨论，大家积极发表不同观点，可以有争论和反驳",
				"latenight": "深夜吐槽模式，放松、随性、偶尔感性",
				"funny":     "搞笑模式，大家互相调侃、发段子、斗图",
				"serious":   "正经严肃的讨论，逻辑清晰、观点明确",
			}
			if desc, ok := moodDesc[body.Mood]; ok {
				sb.WriteString(fmt.Sprintf("【聊天氛围】\n%s\n\n", desc))
			}
		}

		sb.WriteString("【重要规则】\n")
		sb.WriteString("1. 每个成员的说话风格差异很大，不能千篇一律\n")
		sb.WriteString("2. 注意模仿每个人的用词习惯、语气、消息长度、是否用表情\n")
		sb.WriteString("3. 承接上文话题，不要重复已说过的话\n")
		sb.WriteString("4. 如果有人（包括「我」）刚说了话，后续成员应该自然回应\n\n")
		sb.WriteString("【群成员画像】\n")
		for _, mi := range members {
			pct := float64(mi.Count) / float64(totalCount) * 100
			sb.WriteString(fmt.Sprintf("\n## %s（发言占比 %.0f%%）\n", mi.Name, pct))

			// 生成风格标签
			sb.WriteString("性格特征：")
			var traits []string
			if mi.TextCount > 0 {
				avgLen := mi.TotalChars / mi.TextCount
				if avgLen <= 8 { traits = append(traits, "惜字如金，回复简短") }
				if avgLen >= 30 { traits = append(traits, "话多，经常长篇大论") }
				if avgLen > 8 && avgLen < 30 { traits = append(traits, fmt.Sprintf("消息平均%d字", avgLen)) }
			}
			if mi.TextCount > 0 {
				emojiPct := float64(mi.EmojiCount) / float64(mi.TextCount) * 100
				if emojiPct > 30 { traits = append(traits, "爱用表情") }
				if emojiPct < 5 { traits = append(traits, "很少用表情") }
			}
			if mi.TextCount > 0 {
				qPct := float64(mi.QMarkCount) / float64(mi.TextCount) * 100
				if qPct > 20 { traits = append(traits, "爱提问") }
			}
			if mi.TextCount > 0 {
				exclPct := float64(mi.ExclCount) / float64(mi.TextCount) * 100
				if exclPct > 25 { traits = append(traits, "语气强烈，常用感叹号") }
			}
			if mi.TextCount > 0 {
				shortPct := float64(mi.ShortCount) / float64(mi.TextCount) * 100
				if shortPct > 40 { traits = append(traits, "经常几个字就回复") }
			}
			if len(traits) == 0 { traits = append(traits, "风格中等") }
			sb.WriteString(strings.Join(traits, "、") + "\n")

			// 样本消息
			sb.WriteString("说话样本：\n")
			sampleCount := len(mi.Samples)
			if sampleCount > 10 { sampleCount = 10 }
			for _, s := range mi.Samples[:sampleCount] {
				if len(s) > 100 { s = s[:100] + "…" }
				sb.WriteString(fmt.Sprintf("- 「%s」\n", s))
			}
		}
		sb.WriteString("\n【最近的群聊记录】\n")
		recentStart := len(msgs) - 50
		if recentStart < 0 { recentStart = 0 }
		for _, m := range msgs[recentStart:] {
			if m.Content != "" {
				sb.WriteString(fmt.Sprintf("%s：%s\n", m.Speaker, m.Content))
			}
		}

		systemPrompt := sb.String()

		// 4. SSE 流式输出
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")

		type SimMessage struct {
			Speaker string `json:"speaker"`
			Content string `json:"content"`
			Done    bool   `json:"done"`
			Error   string `json:"error,omitempty"`
		}
		sendSim := func(msg SimMessage) {
			data, _ := json.Marshal(msg)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
		}

		// 构建对话上下文
		var simContext strings.Builder
		// 已有历史
		for _, h := range body.History {
			simContext.WriteString(fmt.Sprintf("%s：%s\n", h.Speaker, h.Content))
		}
		// 用户插入的消息（只加入上下文，不重复推送——前端已展示）
		if body.UserMessage != "" {
			simContext.WriteString(fmt.Sprintf("我：%s\n", body.UserMessage))
		}

		// 5. 用多轮对话方式逐轮生成（LLM 能"记住"已生成内容，避免重复）
		llmMsgs := []LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "以下是最近的群聊对话，请在此基础上继续模拟：\n\n" + simContext.String()},
		}

		for round := 0; round < body.Rounds; round++ {
			// 按概率随机选成员
			r := rand.Intn(totalCount)
			var chosen *memberInfo
			cumulative := 0
			for _, mi := range members {
				cumulative += mi.Count
				if r < cumulative {
					chosen = mi
					break
				}
			}
			if chosen == nil { chosen = members[0] }

			// 追加指令到对话历史
			instruction := fmt.Sprintf(
				"现在请以【%s】的身份和风格，生成一条自然的群聊消息。\n"+
					"要求：只输出消息内容本身，不加角色前缀或引号；模仿该成员的用词和语气；承接上文不要重复已说过的话；长度适中。",
				chosen.Name,
			)
			llmMsgs = append(llmMsgs, LLMMessage{Role: "user", Content: instruction})

			// 收集完整回复
			var reply strings.Builder
			streamLLMCoreWithProfile(func(chunk StreamChunk) {
				if chunk.Delta != "" {
					reply.WriteString(chunk.Delta)
				}
			}, llmMsgs, prefs, body.ProfileID)

			content := strings.TrimSpace(reply.String())
			if content == "" { continue }

			// 清理可能的角色前缀
			content = strings.TrimPrefix(content, chosen.Name+"：")
			content = strings.TrimPrefix(content, chosen.Name+":")

			// 将生成结果作为 assistant 回复加入对话历史，LLM 下一轮能看到
			llmMsgs = append(llmMsgs, LLMMessage{Role: "assistant", Content: content})

			sendSim(SimMessage{Speaker: chosen.Name, Content: content})
		}

		sendSim(SimMessage{Done: true})
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
			"running":    !p.Done && p.Error == "" && !p.Paused,
			"step":       p.Step,
			"current":    p.Current,
			"total":      p.Total,
			"done":       p.Done,
			"paused":     p.Paused,
			"error":      p.Error,
			"fact_count": p.FactCount,
		})
	})

	// POST /api/ai/vec/test-embedding — 验证 embedding 配置是否可用
	api.POST("/ai/vec/test-embedding", func(c *gin.Context) {
		if isDemoMode {
			demoBlockLLMWrite(c)
			return
		}
		prefs := loadPreferences()
		cfg := defaultEmbeddingConfig(prefs)
		_, err := GetEmbeddingsBatch([]string{"测试"}, cfg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "provider": cfg.Provider, "model": cfg.Model})
	})

	// POST /api/ai/llm/test — 验证 LLM 配置是否可用（可指定 profile_id）
	api.POST("/ai/llm/test", func(c *gin.Context) {
		if isDemoMode {
			demoBlockLLMWrite(c)
			return
		}
		var body struct {
			ProfileID string `json:"profile_id"`
		}
		_ = c.ShouldBindJSON(&body) // 允许空 body
		prefs := loadPreferences()
		model, err := testLLMConnProfile(body.ProfileID, prefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		c.JSON(http.StatusOK, gin.H{"ok": true, "provider": cfg.provider, "model": model})
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
		if job.Step != "" && !job.Done && job.Error == "" && !job.Paused {
			job.mu.Unlock()
			c.JSON(http.StatusOK, gin.H{"started": false, "reason": "already running"})
			return
		}
		abortCh := make(chan struct{})
		job.Step = "extracting"
		job.Done = false
		job.Paused = false
		job.Error = ""
		job.FactCount = 0
		job.abort = abortCh
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
				abortCh,
			)

			if extractErr == ErrAborted {
				// 暂停：保留检查点，等待用户继续
				job.mu.Lock()
				job.Step = "paused"
				job.Paused = true
				job.Done = false
				job.Error = ""
				job.mu.Unlock()
				return
			}

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

	// POST /api/ai/mem/pause?key= — 暂停正在运行的记忆提炼
	api.POST("/ai/mem/pause", func(c *gin.Context) {
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
			return
		}
		vecJobsMu.Lock()
		job, ok := vecJobs[key]
		vecJobsMu.Unlock()
		if !ok {
			c.JSON(http.StatusOK, gin.H{"paused": false, "reason": "no job"})
			return
		}
		job.mu.Lock()
		abortCh := job.abort
		running := job.Step == "extracting" && !job.Done && !job.Paused
		job.mu.Unlock()
		if !running || abortCh == nil {
			c.JSON(http.StatusOK, gin.H{"paused": false, "reason": "not running"})
			return
		}
		close(abortCh)
		c.JSON(http.StatusOK, gin.H{"paused": true})
	})

	// POST /api/ai/rag  body: {key, messages, search_query?}
	api.POST("/ai/rag", func(c *gin.Context) {
		var body struct {
			Key         string       `json:"key"`
			Messages    []LLMMessage `json:"messages"`
			SearchQuery string       `json:"search_query"`
			ProfileID   string       `json:"profile_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}
		if cfg.apiKey == "" && cfg.provider != "ollama" {
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
		streamLLMCoreWithProfile(sendChunk, llmMsgs, prefs, body.ProfileID)
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

		// 纪念日 & 提醒
		registerAnniversaryRoutes(prot, getSvc)

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

		// 群聊人物关系
		prot.GET("/groups/relationships", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetGroupRelationships(uname))
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
			// Demo 模式下禁止执行原始 SQL（防止数据泄露）
			if isDemoMode {
				demoBlockRawSQL(c)
				return
			}
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

	// 头像代理：将外部头像 URL（微信 CDN）通过后端转发，避免前端 Canvas CORS 污染
	api.GET("/avatar", func(c *gin.Context) {
		rawURL := c.Query("url")
		if rawURL == "" || (!strings.HasPrefix(rawURL, "https://") && !strings.HasPrefix(rawURL, "http://")) {
			c.Status(http.StatusBadRequest)
			return
		}
		// Demo 模式：只允许白名单域名，防止 SSRF 探测内网
		if isDemoMode && !demoAvatarURLAllowed(rawURL) {
			c.Status(http.StatusForbidden)
			return
		}

		// Build a stable cache path: ~/.welink/avatar_cache/<md5(url)>
		sum := md5.Sum([]byte(rawURL))
		cacheKey := hex.EncodeToString(sum[:])
		homeDir, _ := os.UserHomeDir()
		cacheDir := filepath.Join(homeDir, ".welink", "avatar_cache")
		cachePath := filepath.Join(cacheDir, cacheKey)

		// Serve from disk cache if available
		if data, readErr := os.ReadFile(cachePath); readErr == nil {
			ct := http.DetectContentType(data)
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
			c.Data(http.StatusOK, ct, data)
			return
		}

		req, _ := http.NewRequest("GET", rawURL, nil) // #nosec G107 — URL 来自受信任的数据库记录
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; WelinkApp/1.0)")
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			c.Status(http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			c.Status(http.StatusBadGateway)
			return
		}

		// Persist to disk cache (best-effort, ignore errors)
		if mkErr := os.MkdirAll(cacheDir, 0o755); mkErr == nil {
			_ = os.WriteFile(cachePath, body, 0o644)
		}

		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = http.DetectContentType(body)
		}
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.Data(http.StatusOK, ct, body)
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
