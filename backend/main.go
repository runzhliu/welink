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
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // 嵌入时区数据库，确保 App 打包后 LoadLocation 正常工作

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

// gitCommit 由 -ldflags "-X main.gitCommit=abc123" 注入，用于启动日志和调试。
var gitCommit = "unknown"

// analysisParamsFromPrefs 从 Preferences 提取分析参数。
func analysisParamsFromPrefs(p Preferences) service.AnalysisParams {
	return service.AnalysisParams{
		Timezone:             p.Timezone,
		LateNightStartHour:   p.LateNightStartHour,
		LateNightEndHour:     p.LateNightEndHour,
		SessionGapSeconds:    p.SessionGapSeconds,
		WorkerCount:          p.WorkerCount,
		LateNightMinMessages: p.LateNightMinMessages,
		LateNightTopN:        p.LateNightTopN,
	}
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
	// 1. 加载配置（preferences.json > 环境变量 > 默认值）
	prefs := effectiveConfig(loadPreferences())
	// 检查是否有旧 config.yaml 需要迁移
	migrateConfigYAML()

	// 服务层：受 svcMu 保护，支持运行时热替换
	var (
		svcMu       sync.RWMutex
		contactSvc  *service.ContactService
		dbMgr       *db.DBManager
		lastInitErr string // 最近一次 reinitSvc 失败的原因（供 /api/app/info 返回）
	)

	// reinitSvc 用新数据目录替换数据库连接和服务层（线程安全）。
	reinitSvc := func(dataDir string, params service.AnalysisParams, initFrom, initTo int64) error {
		newMgr, err := db.NewDBManager(dataDir)
		if err != nil {
			svcMu.Lock()
			lastInitErr = err.Error()
			svcMu.Unlock()
			return err
		}
		newSvc := service.NewContactService(newMgr, params, initFrom, initTo)
		svcMu.Lock()
		if dbMgr != nil {
			dbMgr.Close()
		}
		dbMgr = newMgr
		contactSvc = newSvc
		lastInitErr = ""
		svcMu.Unlock()
		return nil
	}

	// probeDataDirs 列出启动时检查过的候选数据目录（用于 /api/app/info 前端提示）。
	probeDataDirs := func(current string) []string {
		var paths []string
		seen := map[string]bool{}
		add := func(p string) {
			if p == "" || seen[p] {
				return
			}
			seen[p] = true
			paths = append(paths, p)
		}
		add(current)
		if env := os.Getenv("WELINK_DATA_DIR"); env != "" {
			add(env)
		}
		add("/data/decrypted") // Docker 容器内常用挂载点
		if cwd, err := os.Getwd(); err == nil {
			add(filepath.Join(cwd, "decrypted"))
		}
		if dir := appDataDir(); dir != "" {
			add(dir) // .app/.exe 同级目录（仅桌面版返回非空）
		}
		return paths
	}

	// App 模式：优先从持久化配置读取目录，其次检查 .app 同级的 decrypted/
	if hasFrontend {
		if appCfg, ok := loadAppConfig(); ok {
			if appCfg.DemoMode {
				// 用户可能手动删了 demo 数据目录想退出 demo 模式 ——
				// 这种情况下不应该静默重建，而是把 demo_mode 重置后回到 Setup 页让用户选择。
				demoDir := demoDataDir()
				if _, err := os.Stat(filepath.Join(demoDir, "contact", "contact.db")); os.IsNotExist(err) {
					log.Printf("[APP] demo_mode=true 但 %s 已被用户删除，重置为未配置状态", demoDir)
					appCfg.DemoMode = false
					appCfg.DataDir = ""
					_ = saveAppConfig(appCfg)
					// prefs.DataDir 保持空，下面 reinitSvc 会失败 → 前端展示 Setup 页
				} else {
					os.Setenv("DEMO_MODE", "true")
					prefs.DataDir = demoDir
				}
			} else {
				prefs.DataDir = appCfg.DataDir
			}
			setupLogFile(appCfg.LogDir)
		} else if dir := appDataDir(); dir != "" {
			prefs.DataDir = dir
		}
	}

	dataLabel := prefs.DataDir
	if dataLabel == "" {
		dataLabel = "(demo)"
	} else {
		dataLabel = "(configured)"
	}
	log.Printf("WeLink %s (commit %s) starting...", appVersion, gitCommit)
	log.Printf("WeLink config: data_dir=%s port=%s timezone=%s workers=%d",
		dataLabel, prefs.Port, prefs.Timezone, prefs.WorkerCount)

	// 2. 初始化数据库管理器（DEMO_MODE 时先生成示例数据）
	isDemoMode := os.Getenv("DEMO_MODE") == "true"
	if isDemoMode {
		demoDir := prefs.DataDir
		log.Printf("[DEMO] Demo mode enabled, generating sample databases")
		if err := seed.Generate(demoDir); err != nil {
			log.Fatalf("Failed to generate demo databases: %v", err)
		}
		// Demo 模式自动全量索引（无时间限制），用非零 to 触发 NewContactService 自动初始化
		prefs.DefaultInitFrom = 0
		prefs.DefaultInitTo = time.Now().Unix() + 365*24*3600*10 // 10年后

		if DemoAIDisabled() {
			log.Printf("[DEMO] AI configuration disabled via DEMO_DISABLE_AI=true")
		}
	}

	if prefs.GinMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	if err := reinitSvc(prefs.DataDir, analysisParamsFromPrefs(prefs), prefs.DefaultInitFrom, prefs.DefaultInitTo); err != nil {
		// 服务层保持 nil —— 前端通过 /api/app/info 识别并引导用户
		candidates := probeDataDirs(prefs.DataDir)
		log.Printf("────────────────────────────────────────────────────────────────")
		log.Printf("[SETUP REQUIRED] WeLink 未找到微信解密数据：%v", err)
		log.Printf("已探测的候选目录：")
		for _, p := range candidates {
			log.Printf("  - %s", p)
		}
		switch {
		case hasFrontend:
			log.Printf("→ 请在应用首页选择 decrypted/ 目录，或点击「使用 Demo 数据」体验。")
		case runtime.GOOS == "linux":
			log.Printf("→ Docker：确认 docker-compose.yml 中已挂载 decrypted/，例如：")
			log.Printf("    volumes:")
			log.Printf("      - ./decrypted:/data/decrypted:ro")
			log.Printf("   或设置环境变量 DEMO_MODE=true 使用演示数据。")
		default:
			log.Printf("→ 本地开发：把 decrypted/ 放到仓库根目录，或设置 WELINK_DATA_DIR；亦可 DEMO_MODE=true 体验演示数据。")
		}
		log.Printf("HTTP 服务已启动，前端会展示配置引导。就绪后刷新页面即可。")
		log.Printf("────────────────────────────────────────────────────────────────")
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
		if origin == "http://localhost:3418" || origin == "http://localhost:5173" {
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

	// App 状态：前端用于判断是否需要显示 Setup 页面 / 未配置横幅。
	// 所有运行模式（App / Docker / 本地）共用这个端点，靠 app_mode + platform 区分提示文案。
	api.GET("/app/info", func(c *gin.Context) {
		_, configured := loadAppConfig()
		svcMu.RLock()
		ready := contactSvc != nil
		reason := lastInitErr
		svcMu.RUnlock()
		// needs_setup：桌面版看是否走过 setup；Docker/本地模式直接看服务是否就绪
		needsSetup := !ready
		if hasFrontend {
			needsSetup = !configured || !ready
		}
		// "我"的信息（wxid + 头像 + 昵称）：服务就绪时从私聊消息 sender 反推
		var selfInfo interface{}
		if ready {
			svcMu.RLock()
			if contactSvc != nil {
				selfInfo = contactSvc.GetSelfInfo()
			}
			svcMu.RUnlock()
		}

		c.JSON(http.StatusOK, gin.H{
			"app_mode":     hasFrontend,
			"needs_setup":  needsSetup,
			"ready":        ready,
			"version":      appVersion,
			"platform":     runtime.GOOS,
			"data_dir":     prefs.DataDir,
			"reason":       reason,
			"probed_paths": probeDataDirs(prefs.DataDir),
			"can_demo":     hasFrontend,
			"self_info":    selfInfo,
		})
	})

	// 检查更新：调 GitHub API 获取最新 release，与当前版本比较
	var (
		updateCache     gin.H
		updateCacheTime time.Time
		updateCacheMu   sync.Mutex
	)
	api.GET("/app/check-update", func(c *gin.Context) {
		updateCacheMu.Lock()
		if updateCache != nil && time.Since(updateCacheTime) < time.Hour {
			cached := updateCache
			updateCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		updateCacheMu.Unlock()

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Get("https://api.github.com/repos/runzhliu/welink/releases/latest")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"error": "无法连接 GitHub，请检查网络", "current": appVersion})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			c.JSON(http.StatusOK, gin.H{"error": "GitHub API 请求失败", "current": appVersion})
			return
		}
		var release struct {
			TagName string `json:"tag_name"`
			Body    string `json:"body"`
			HTMLURL string `json:"html_url"`
			Assets  []struct {
				Name               string `json:"name"`
				BrowserDownloadURL string `json:"browser_download_url"`
				Size               int64  `json:"size"`
			} `json:"assets"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
			c.JSON(http.StatusOK, gin.H{"error": "解析 GitHub 响应失败", "current": appVersion})
			return
		}

		// 构建资产下载链接（仅 GitHub 官方直链，不再提供第三方加速镜像）
		type assetInfo struct {
			Name string `json:"name"`
			Size int64  `json:"size"`
			URL  string `json:"url"`
		}
		var assets []assetInfo
		for _, a := range release.Assets {
			assets = append(assets, assetInfo{
				Name: a.Name,
				Size: a.Size,
				URL:  a.BrowserDownloadURL,
			})
		}

		// 判断是否有新版本
		latestTag := strings.TrimPrefix(release.TagName, "v")
		currentTag := strings.TrimPrefix(appVersion, "v")
		currentTag = strings.TrimPrefix(currentTag, "dev-")
		hasUpdate := release.TagName != "" && latestTag != currentTag && !strings.HasPrefix(currentTag, latestTag)

		// changelog 截取前 500 字符
		changelog := release.Body
		if len([]rune(changelog)) > 500 {
			changelog = string([]rune(changelog)[:500]) + "…"
		}

		result := gin.H{
			"current":    appVersion,
			"latest":     release.TagName,
			"has_update": hasUpdate,
			"changelog":  changelog,
			"url":        release.HTMLURL,
			"assets":     assets,
		}

		updateCacheMu.Lock()
		updateCache = result
		updateCacheTime = time.Now()
		updateCacheMu.Unlock()

		c.JSON(http.StatusOK, result)
	})

	// 保存文件到用户配置的下载目录（供 App 模式下的前端调用，绕过 WebView 的 blob 下载限制）
	// 目录优先级：preferences.download_dir（配置过）> ~/Downloads（平台默认）
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
		// 安全校验：防止路径穿越
		cleanName := filepath.Base(body.Filename)
		if cleanName == "." || cleanName == ".." || cleanName != body.Filename {
			c.JSON(http.StatusBadRequest, gin.H{"error": "文件名不合法"})
			return
		}
		saveDir, err := resolveDownloadDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		savePath := filepath.Join(saveDir, cleanName)
		if err := os.WriteFile(savePath, fileBytes, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"path": savePath})
	})

	// 在系统文件管理器中定位一个文件（Mac: Finder / Windows: Explorer）。
	// 仅允许前端通过 /app/save-file 写出的文件路径，避免暴露任意读。
	api.POST("/app/reveal", func(c *gin.Context) {
		if !hasFrontend {
			c.JSON(http.StatusNotFound, gin.H{"error": "only available in app mode"})
			return
		}
		var body struct {
			Path string `json:"path"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少路径"})
			return
		}
		// 安全校验：路径必须在下载目录之下
		saveDir, err := resolveDownloadDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		abs, err := filepath.Abs(body.Path)
		if err != nil || !strings.HasPrefix(abs, saveDir+string(filepath.Separator)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "路径不在下载目录下"})
			return
		}
		if err := revealInFileManager(abs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
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

	// validateDataDir 在配置时做一次预检查，避免索引跑半天才发现目录有问题。
	// 返回值：fatalErr 阻止配置继续；warnings 是非致命问题（如部分库只读），允许继续但提示用户。
	validateDataDir := func(dataDir string) (warnings []string, fatalErr error) {
		// 1. 目录结构
		contactPath := filepath.Join(dataDir, "contact", "contact.db")
		msgDir := filepath.Join(dataDir, "message")
		if _, err := os.Stat(contactPath); err != nil {
			return nil, fmt.Errorf("找不到 %s（确认 decrypted 目录结构是否完整）", contactPath)
		}
		if _, err := os.Stat(msgDir); err != nil {
			return nil, fmt.Errorf("找不到 %s 目录", msgDir)
		}

		// 2. 列出 message_*.db
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
			return nil, fmt.Errorf("%s 下没有找到 message_*.db 文件", msgDir)
		}

		// 3. 写权限测试：尝试用 O_WRONLY 打开（不真的写），失败就算只读
		// 只读会跳过查询索引创建，让全量分析慢 10–100 倍。
		var readOnly []string
		checkWritable := func(path string) {
			f, err := os.OpenFile(path, os.O_WRONLY, 0)
			if err != nil {
				readOnly = append(readOnly, filepath.Base(path))
				return
			}
			f.Close()
		}
		checkWritable(contactPath)
		for _, p := range msgDBs {
			checkWritable(p)
		}

		if len(readOnly) > 0 {
			warnings = append(warnings,
				fmt.Sprintf("以下数据库只读，将跳过查询索引创建，分析速度会显著变慢（建议复制到可写目录后再选择）：%s",
					strings.Join(readOnly, ", ")))
		}
		log.Printf("[APP] 数据目录预检通过：contact + %d 个 message DB（%d 个只读）", len(msgDBs), len(readOnly))
		return warnings, nil
	}

	// applyConfig 将配置落盘并热替换服务层；data_dir 为空时启用演示模式。
	applyConfig := func(body Preferences) error {
		if body.DataDir == "" {
			body.DemoMode = true
			body.DataDir = demoDataDir()
			os.Setenv("DEMO_MODE", "true")
			if err := seed.Generate(body.DataDir); err != nil {
				return fmt.Errorf("生成演示数据失败：%w", err)
			}
			// Demo 模式：直接用 10 年范围自动跑全量索引，省去 WelcomePage 的二次选择
			// 与启动时的 DEMO_MODE=true 路径保持一致（main.go:serverMain）
			body.DefaultInitFrom = 0
			body.DefaultInitTo = time.Now().Unix() + 365*24*3600*10
		} else {
			body.DemoMode = false
			os.Unsetenv("DEMO_MODE")
		}
		merged := effectiveConfig(body)
		if err := reinitSvc(merged.DataDir, analysisParamsFromPrefs(merged), merged.DefaultInitFrom, merged.DefaultInitTo); err != nil {
			return fmt.Errorf("无效的数据库目录：%w", err)
		}
		if err := saveAppConfig(&body); err != nil {
			log.Printf("[APP] Failed to save config: %v", err)
		}
		setupLogFile(body.LogDir)
		prefs.DataDir = body.DataDir
		return nil
	}

	// App Setup：保存配置并热替换服务层
	api.POST("/app/setup", func(c *gin.Context) {
		var body Preferences
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		// 真实数据目录：先做预检查，致命问题立刻 400 + 详情返回；只读警告允许继续但前端会展示。
		var warnings []string
		if strings.TrimSpace(body.DataDir) != "" {
			ws, err := validateDataDir(body.DataDir)
			if err != nil {
				log.Printf("[APP] setup validation failed: %v", err)
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			warnings = ws
		}
		if err := applyConfig(body); err != nil {
			log.Printf("[APP] setup failed: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "配置失败：" + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "warnings": warnings})
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
		c.JSON(http.StatusOK, sanitizeForResponse(loadPreferences()))
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
		c.JSON(http.StatusOK, sanitizeForResponse(existing))
	})

	// 导出文件的下载目录（仅 App 模式用）。单独一个端点：改这个不应触发重建索引。
	// 空值 = 清空用户配置，回落到平台默认（~/Downloads）。
	api.PUT("/preferences/download-dir", func(c *gin.Context) {
		var body struct {
			DownloadDir string `json:"download_dir"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		trimmed := strings.TrimSpace(body.DownloadDir)
		// 先预保存（用 resolveDownloadDir 校验），避免保存了坏值导致后续所有导出都失败
		existing.DownloadDir = trimmed
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		// 验证一次，顺带把"实际生效的目录"返回给前端
		effective, verr := resolveDownloadDir()
		if verr != nil {
			// 校验失败时：把用户输入回滚，避免下次导出整体失败
			existing.DownloadDir = ""
			_ = savePreferences(existing)
			c.JSON(http.StatusBadRequest, gin.H{"error": verr.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "effective": effective})
	})

	// 读取当前的下载目录（用户配置 + 实际生效值）
	api.GET("/preferences/download-dir", func(c *gin.Context) {
		p := loadPreferences()
		effective, err := resolveDownloadDir()
		resp := gin.H{"configured": p.DownloadDir}
		if err == nil {
			resp["effective"] = effective
		} else {
			resp["error"] = err.Error()
		}
		c.JSON(http.StatusOK, resp)
	})

	// 关系预测「不再推荐此人」名单保存
	api.PUT("/preferences/forecast-ignored", func(c *gin.Context) {
		var body struct {
			ForecastIgnored []string `json:"forecast_ignored"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if body.ForecastIgnored == nil {
			body.ForecastIgnored = []string{}
		}
		existing := loadPreferences()
		existing.ForecastIgnored = body.ForecastIgnored
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"forecast_ignored": existing.ForecastIgnored})
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

	// Prompt 模板保存
	api.PUT("/preferences/prompts", func(c *gin.Context) {
		var body struct {
			PromptTemplates map[string]string `json:"prompt_templates"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		existing.PromptTemplates = body.PromptTemplates
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// LLM 配置单独保存，避免与屏蔽名单 PUT 冲突
	api.PUT("/preferences/llm", func(c *gin.Context) {
		// 公有云 Demo 模式下禁止修改（防止 SSRF / API key 滥用）
		if isDemoMode && DemoAIDisabled() {
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

		// API Key 保护逻辑：
		// - 空值 "" 或占位符 "__HAS_KEY__" → 用户没有修改，保留原始 key
		// - 含 "****" → 旧版脱敏值兼容，保留原始 key
		// - 其他非空值 → 用户输入了新 key，覆盖
		keepOld := func(newKey string) bool {
			return newKey == "" || newKey == hasKeyPlaceholder || strings.Contains(newKey, "****")
		}

		// LLM Profiles: 逐个按 ID 匹配，保护未修改的 key
		for i, p := range incoming.LLMProfiles {
			if keepOld(p.APIKey) {
				restored := false
				for _, old := range existing.LLMProfiles {
					if old.ID == p.ID {
						// 只有 provider 没变时才恢复旧 key
						// provider 变了 → 旧 key 属于旧 provider，不应该保留
						if old.Provider == p.Provider {
							incoming.LLMProfiles[i].APIKey = old.APIKey
							restored = true
						}
						break
					}
				}
				if !restored {
					incoming.LLMProfiles[i].APIKey = ""
				}
			}
		}

		existing.LLMProfiles = incoming.LLMProfiles
		// 将第一个 profile 同步到单配置字段（向后兼容）
		if len(incoming.LLMProfiles) > 0 {
			p := incoming.LLMProfiles[0]
			existing.LLMProvider = p.Provider
			existing.LLMAPIKey = p.APIKey
			existing.LLMBaseURL = p.BaseURL
			existing.LLMModel = p.Model
		} else {
			existing.LLMProvider = incoming.LLMProvider
			if !keepOld(incoming.LLMAPIKey) {
				existing.LLMAPIKey = incoming.LLMAPIKey
			}
			existing.LLMBaseURL = incoming.LLMBaseURL
			existing.LLMModel = incoming.LLMModel
		}
		if keepOld(incoming.GeminiClientSecret) {
			// 保留原值
		} else {
			existing.GeminiClientSecret = incoming.GeminiClientSecret
		}
		existing.GeminiClientID = incoming.GeminiClientID
		existing.AIAnalysisDBPath = incoming.AIAnalysisDBPath
		existing.EmbeddingProvider = incoming.EmbeddingProvider
		if !keepOld(incoming.EmbeddingAPIKey) {
			existing.EmbeddingAPIKey = incoming.EmbeddingAPIKey
		}
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

	// ── 配置热加载 ──────────────────────────────────────────────────────────
	api.PUT("/preferences/config", func(c *gin.Context) {
		var incoming struct {
			Timezone             string `json:"timezone"`
			LateNightStartHour   int    `json:"late_night_start_hour"`
			LateNightEndHour     int    `json:"late_night_end_hour"`
			SessionGapSeconds    int64  `json:"session_gap_seconds"`
			WorkerCount          int    `json:"worker_count"`
			LateNightMinMessages int64  `json:"late_night_min_messages"`
			LateNightTopN        int    `json:"late_night_top_n"`
			LogLevel             string `json:"log_level"`
			GinMode              string `json:"gin_mode"`
			Port                 string `json:"port"`
		}
		if err := c.ShouldBindJSON(&incoming); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		needsRestart := false
		if incoming.Port != "" && incoming.Port != existing.Port {
			needsRestart = true
		}
		if incoming.GinMode != "" && incoming.GinMode != existing.GinMode {
			needsRestart = true
		}
		// 更新字段
		if incoming.Timezone != "" {
			existing.Timezone = incoming.Timezone
		}
		if incoming.LateNightStartHour != 0 || incoming.LateNightEndHour != 0 {
			existing.LateNightStartHour = incoming.LateNightStartHour
			existing.LateNightEndHour = incoming.LateNightEndHour
		}
		if incoming.SessionGapSeconds != 0 {
			existing.SessionGapSeconds = incoming.SessionGapSeconds
		}
		if incoming.WorkerCount != 0 {
			existing.WorkerCount = incoming.WorkerCount
		}
		if incoming.LateNightMinMessages != 0 {
			existing.LateNightMinMessages = incoming.LateNightMinMessages
		}
		if incoming.LateNightTopN != 0 {
			existing.LateNightTopN = incoming.LateNightTopN
		}
		if incoming.LogLevel != "" {
			existing.LogLevel = incoming.LogLevel
		}
		if incoming.GinMode != "" {
			existing.GinMode = incoming.GinMode
		}
		if incoming.Port != "" {
			existing.Port = incoming.Port
		}
		if err := savePreferences(existing); err != nil {
			log.Printf("[PREFS] Failed to save config preferences: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		// 热加载分析参数并重新索引
		svcMu.RLock()
		svc := contactSvc
		svcMu.RUnlock()
		if svc != nil {
			svc.UpdateParams(analysisParamsFromPrefs(effectiveConfig(existing)))
			// 参数变更后需要重新索引才能让深夜时段、时区等变化生效
			go svc.Reinitialize(0, 0)
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "needs_restart": needsRestart})
	})

	// ── AI 分析历史持久化 ──────────────────────────────────────────────────
	// GET  /api/ai/conversations?key=contact:username    — 获取单条对话
	// GET  /api/ai/conversations?prefix=ai-home:        — 按前缀列出对话历史
	api.GET("/ai/conversations", func(c *gin.Context) {
		if prefix := c.Query("prefix"); prefix != "" {
			list, err := ListAIConversations(prefix)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if list == nil { list = []ConversationEntry{} }
			c.JSON(http.StatusOK, gin.H{"conversations": list})
			return
		}
		key := c.Query("key")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 或 prefix 参数"})
			return
		}
		msgs, err := GetAIConversation(key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"messages": msgs})
	})

	// GET /api/ai/usage-stats — 汇总所有 AI 对话的 token / 字符用量
	api.GET("/ai/usage-stats", func(c *gin.Context) {
		stats, err := GetAIUsageStats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, stats)
	})

	// GET /api/ai/conversations/search?q=xxx&limit=30 — 在所有 AI 对话里做子串搜索
	api.GET("/ai/conversations/search", func(c *gin.Context) {
		q := c.Query("q")
		limit := 30
		if l := c.Query("limit"); l != "" {
			if v, err := strconv.Atoi(l); err == nil {
				limit = v
			}
		}
		hits, err := SearchAIConversations(q, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"hits": hits})
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

	// POST /api/ai/clone/continue — 对话续写：AI 模拟双方继续聊天
	api.POST("/ai/clone/continue", func(c *gin.Context) {
		var body struct {
			SessionID string `json:"session_id"`
			ProfileID string `json:"profile_id"`
			Rounds    int    `json:"rounds"`
			Topic     string `json:"topic"`
			MyName    string `json:"my_name"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if body.Rounds <= 0 { body.Rounds = 10 }
		if body.Rounds > 30 { body.Rounds = 30 }
		if body.MyName == "" { body.MyName = "我" }

		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}

		cloneCacheMu.RLock()
		sysPrompt, ok := cloneCache[body.SessionID]
		cloneCacheMu.RUnlock()
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "会话已过期，请重新学习"})
			return
		}

		// 构造续写 prompt
		continuePrompt := fmt.Sprintf(`基于你已经学习的这个人的聊天风格，现在请模拟「%s」和「TA」之间的一段自然对话。

要求：
1. 交替生成双方的消息，共 %d 轮（每轮一问一答）
2.「TA」的风格严格按照你学习到的说话习惯（用词、语气、长度、表情）
3.「%s」的风格也要自然，像真实的微信聊天
4. 每条消息单独一行，格式严格为：
   %s：消息内容
   TA：消息内容
5. 不要加任何其他说明文字、括号注释或旁白
6. 内容要自然流畅，承接上下文`, body.MyName, body.Rounds, body.MyName, body.MyName)

		if body.Topic != "" {
			continuePrompt += fmt.Sprintf("\n7. 话题从「%s」开始", body.Topic)
		}

		llmMessages := []LLMMessage{
			{Role: "system", Content: sysPrompt},
			{Role: "user", Content: continuePrompt},
		}

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

	// ── Skill 炼化：导出 Claude Code / Codex / OpenCode / Cursor / generic 格式 ──
	// POST /api/ai/forge-skill  body: { skill_type, username, member_speaker, format, profile_id, msg_limit }
	api.POST("/ai/forge-skill", func(c *gin.Context) {
		var body struct {
			SkillType     string `json:"skill_type"`
			Username      string `json:"username"`
			MemberSpeaker string `json:"member_speaker"`
			Format        string `json:"format"`
			ProfileID     string `json:"profile_id"`
			MsgLimit      int    `json:"msg_limit"`
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
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未就绪"})
			return
		}
		// 解析目标名（用于列表展示）
		targetName := body.Username
		if body.SkillType == "self" {
			targetName = "我"
		} else if body.SkillType == "contact" && svc != nil {
			for _, c := range svc.GetCachedStats() {
				if c.Username == body.Username {
					if c.Remark != "" { targetName = c.Remark } else if c.Nickname != "" { targetName = c.Nickname }
					break
				}
			}
		} else if (body.SkillType == "group" || body.SkillType == "group-member") && svc != nil {
			for _, g := range svc.GetGroups() {
				if g.Username == body.Username {
					targetName = g.Name
					break
				}
			}
			if body.SkillType == "group-member" && body.MemberSpeaker != "" {
				targetName = body.MemberSpeaker + "（来自 " + targetName + "）"
			}
		}

		// 生成 ID 并立即创建 pending 记录
		skillID := fmt.Sprintf("%d%04d", time.Now().UnixNano(), rand.Intn(10000))
		pendingRec := &SkillRecord{
			ID:             skillID,
			SkillType:      body.SkillType,
			Format:         body.Format,
			TargetUsername: body.Username,
			TargetName:     targetName,
			MemberSpeaker:  body.MemberSpeaker,
			ModelProvider:  cfg.provider,
			ModelName:      cfg.model,
			MsgLimit:       body.MsgLimit,
			Filename:       "",
			FilePath:       "",
			FileSize:       0,
			Status:         SkillStatusPending,
		}
		if err := InsertSkillRecord(pendingRec); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建任务失败: " + err.Error()})
			return
		}

		// 异步执行炼化
		go func(id string, opts ForgeOptions, p Preferences, s *service.ContactService) {
			// 标记为运行中
			_ = UpdateSkillStatus(id, SkillStatusRunning, "", "", 0, "")

			zipBytes, filename, err := ForgeSkillZip(s, opts, p)
			if err != nil {
				log.Printf("[skill %s] forge failed: %v", id, err)
				_ = UpdateSkillStatus(id, SkillStatusFailed, err.Error(), "", 0, "")
				return
			}

			// 保存到持久化目录
			skillsDir := filepath.Join(filepath.Dir(preferencesPath()), "skills", id)
			if err := os.MkdirAll(skillsDir, 0755); err != nil {
				_ = UpdateSkillStatus(id, SkillStatusFailed, "创建 skill 目录失败: "+err.Error(), "", 0, "")
				return
			}
			filePath := filepath.Join(skillsDir, filename)
			if err := os.WriteFile(filePath, zipBytes, 0644); err != nil {
				_ = UpdateSkillStatus(id, SkillStatusFailed, "保存 skill 文件失败: "+err.Error(), "", 0, "")
				return
			}

			if err := UpdateSkillStatus(id, SkillStatusSuccess, "", filePath, int64(len(zipBytes)), filename); err != nil {
				log.Printf("[skill %s] update status failed: %v", id, err)
			}
			log.Printf("[skill %s] forge success: %s (%d bytes)", id, filename, len(zipBytes))
		}(skillID, ForgeOptions{
			SkillType:     body.SkillType,
			Username:      body.Username,
			MemberSpeaker: body.MemberSpeaker,
			Format:        body.Format,
			ProfileID:     body.ProfileID,
			MsgLimit:      body.MsgLimit,
		}, prefs, svc)

		// 立即返回 pending 状态
		c.JSON(http.StatusAccepted, gin.H{
			"id":     skillID,
			"status": SkillStatusPending,
			"record": pendingRec,
		})
	})

	// GET /api/skills/:id — 获取单个 skill 的状态
	api.GET("/skills/:id", func(c *gin.Context) {
		id := c.Param("id")
		rec, err := GetSkillRecord(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if rec == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		c.JSON(http.StatusOK, rec)
	})

	// GET /api/skills — 列出所有已炼化的 skill
	api.GET("/skills", func(c *gin.Context) {
		list, err := ListSkillRecords()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if list == nil {
			list = []SkillRecord{}
		}
		c.JSON(http.StatusOK, gin.H{"skills": list})
	})

	// GET /api/skills/:id/download — 重新下载指定 skill 的 zip
	api.GET("/skills/:id/download", func(c *gin.Context) {
		id := c.Param("id")
		rec, err := GetSkillRecord(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if rec == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		data, err := os.ReadFile(rec.FilePath)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "文件已丢失: " + err.Error()})
			return
		}
		asciiFallback := "skill.zip"
		utf8Encoded := url.PathEscape(rec.Filename)
		c.Header("Content-Type", "application/zip")
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, asciiFallback, utf8Encoded))
		c.Data(http.StatusOK, "application/zip", data)
	})

	// DELETE /api/skills/:id — 删除指定 skill 记录和文件
	api.DELETE("/skills/:id", func(c *gin.Context) {
		id := c.Param("id")
		rec, err := GetSkillRecord(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if rec == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		// 删除文件和所在目录
		_ = os.Remove(rec.FilePath)
		_ = os.Remove(filepath.Dir(rec.FilePath))
		if err := DeleteSkillRecord(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
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

		// 1. 加载最近 N 条群消息（只加载需要的量，避免全量加载 36 万条）
		msgs := svc.ExportGroupMessagesRecent(body.GroupUsername, body.MessageCount)
		if len(msgs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该群聊没有消息记录"})
			return
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

		// 5. 一次 LLM 调用生成多条消息（避免 N 次调用，每次都重复处理巨大上下文）
		// 构造成员顺序（按概率预先选好参与者序列）
		var speakerOrder []string
		for round := 0; round < body.Rounds; round++ {
			r := rand.Intn(totalCount)
			var chosen *memberInfo
			cumulative := 0
			for _, mi := range members {
				cumulative += mi.Count
				if r < cumulative { chosen = mi; break }
			}
			if chosen == nil { chosen = members[0] }
			speakerOrder = append(speakerOrder, chosen.Name)
		}

		instruction := fmt.Sprintf(
			"请继续模拟群聊对话，生成 %d 条消息。\n"+
				"发言顺序：%s\n"+
				"格式要求：每条消息一行，严格用「成员名：消息内容」格式，不加编号或其他标注。\n"+
				"承接上文已有对话，模仿每个人各自的风格，内容自然不重复。",
			body.Rounds,
			strings.Join(speakerOrder, " → "),
		)

		llmMsgs := []LLMMessage{
			{Role: "system", Content: systemPrompt},
		}
		if simContext.Len() > 0 {
			llmMsgs = append(llmMsgs, LLMMessage{Role: "user", Content: "以下是最近的群聊对话，请在此基础上继续模拟：\n\n" + simContext.String() + "\n" + instruction})
		} else {
			llmMsgs = append(llmMsgs, LLMMessage{Role: "user", Content: instruction})
		}

		// 流式输出，实时解析每行 "成员名：消息内容" 并逐条推送
		var lineBuf strings.Builder
		memberSet := make(map[string]bool)
		for _, mi := range members { memberSet[mi.Name] = true }

		streamLLMCoreWithProfile(func(chunk StreamChunk) {
			if chunk.Delta == "" { return }
			lineBuf.WriteString(chunk.Delta)

			// 逐行解析
			for {
				text := lineBuf.String()
				nlIdx := strings.Index(text, "\n")
				if nlIdx < 0 { break }

				line := strings.TrimSpace(text[:nlIdx])
				lineBuf.Reset()
				lineBuf.WriteString(text[nlIdx+1:])

				if line == "" { continue }

				// 尝试解析 "成员名：内容" 或 "成员名:内容"
				var speaker, content string
				for name := range memberSet {
					if strings.HasPrefix(line, name+"：") {
						speaker = name
						content = strings.TrimSpace(line[len(name)+len("："):])
						break
					}
					if strings.HasPrefix(line, name+":") {
						speaker = name
						content = strings.TrimSpace(line[len(name)+1:])
						break
					}
				}
				if speaker == "" || content == "" { continue }

				sendSim(SimMessage{Speaker: speaker, Content: content})
			}
		}, llmMsgs, prefs, body.ProfileID)

		// 处理最后一行（可能没有换行符）
		if lastLine := strings.TrimSpace(lineBuf.String()); lastLine != "" {
			for name := range memberSet {
				if strings.HasPrefix(lastLine, name+"：") {
					sendSim(SimMessage{Speaker: name, Content: strings.TrimSpace(lastLine[len(name)+len("："):])})
					break
				}
				if strings.HasPrefix(lastLine, name+":") {
					sendSim(SimMessage{Speaker: name, Content: strings.TrimSpace(lastLine[len(name)+1:])})
					break
				}
			}
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
		if isDemoMode && DemoAIDisabled() {
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
		if isDemoMode && DemoAIDisabled() {
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
		// Token 预算：根据模型的 context window 动态调整
		// 大约 1 中文字 ≈ 2 token，留 20% 余量给 system prompt + 用户消息 + 输出
		ragCfg := llmConfigForProfile(body.ProfileID, prefs)
		maxContextChars := 50000 // 默认 ~100K token，适合 128K 模型
		switch ragCfg.provider {
		case "kimi":
			maxContextChars = 400000 // Kimi 支持 1M token
		case "gemini":
			maxContextChars = 400000 // Gemini 支持 1M token
		case "claude":
			maxContextChars = 80000 // Claude 支持 200K token
		case "deepseek":
			maxContextChars = 50000 // DeepSeek 128K token
		case "openai":
			maxContextChars = 50000 // GPT-4o 128K token
		}
		totalResults := len(results) // 截断前总数

		// 第一轮：优先放入命中的消息（isHit=true），这些是检索的核心结果
		type indexedResult struct {
			idx  int
			line string
			r    RAGResult
			hit  bool
		}
		var allIndexed []indexedResult
		for i, r := range results {
			line := fmt.Sprintf("[%s] %s：%s", r.Datetime, r.Sender, r.Content)
			isHit := hitSeqs != nil && hitSeqs[r.Seq]
			allIndexed = append(allIndexed, indexedResult{idx: i, line: line, r: r, hit: isHit})
		}

		selected := make(map[int]bool)
		totalChars := 0

		// 第一轮：放入所有命中消息
		for _, ir := range allIndexed {
			if !ir.hit { continue }
			if totalChars+len(ir.line) > maxContextChars { break }
			selected[ir.idx] = true
			totalChars += len(ir.line)
		}

		// 第二轮：用窗口上下文消息填充剩余预算
		for _, ir := range allIndexed {
			if selected[ir.idx] { continue }
			if totalChars+len(ir.line) > maxContextChars { break }
			selected[ir.idx] = true
			totalChars += len(ir.line)
		}

		// 按原始顺序（时间顺序）输出
		var ctxLines []string
		snipets := make([]RagSnipet, 0, len(selected))
		for _, ir := range allIndexed {
			if !selected[ir.idx] { continue }
			ctxLines = append(ctxLines, ir.line)
			snipets = append(snipets, RagSnipet{
				Datetime: ir.r.Datetime,
				Sender:   ir.r.Sender,
				Content:  ir.r.Content,
				IsHit:    ir.hit,
			})
		}
		ctxText := strings.Join(ctxLines, "\n")

		// 先推送 RAG 元数据（含命中消息列表）
		truncated := len(snipets) < totalResults
		sendChunk(StreamChunk{RagMeta: &RagMeta{
			Hits:      len(hitSeqs),
			Retrieved: len(snipets),
			Total:     totalResults,
			Truncated: truncated,
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

		// 秘语雷达 — 某联系人相对活跃联系人池的 TF-IDF Top 5"专属词"
		// 首次调用会同步构建全局 DF（扫描 Top 50 活跃联系人词云，可能需要几秒），之后命中缓存
		prot.GET("/contacts/secret-words", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			topN := 5
			if v := c.Query("top"); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 30 {
					topN = n
				}
			}
			c.JSON(http.StatusOK, gin.H{"words": getSvc().GetSecretWords(uname, topN)})
		})

		// 群聊列表
		prot.GET("/groups", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetGroups())
		})

		// 时光轴（聊天日历）
		registerCalendarRoutes(prot, getSvc)

		// 纪念日 & 提醒
		registerAnniversaryRoutes(prot, getSvc)

		// 关系动态预测
		registerForecastRoutes(prot, getSvc)

		// AI 开场白草稿
		registerIcebreakerRoutes(prot, getSvc)

		// 群聊 AI 年报
		registerGroupYearReviewRoutes(prot, getSvc)

		// 导出中心（Markdown / Notion / 飞书）
		registerExportRoutes(prot, getSvc)

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

		// 群聊搜索聊天记录（支持按发言人过滤）
		prot.GET("/groups/search", func(c *gin.Context) {
			uname := c.Query("username")
			q := c.Query("q")
			speaker := c.Query("speaker")
			if uname == "" || q == "" {
				c.JSON(400, gin.H{"error": "username and q required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().SearchGroupMessages(uname, q, speaker))
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

		// 红包/转账全局总览
		prot.GET("/contacts/money-overview", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetMoneyOverview())
		})

		// URL 收藏夹
		prot.GET("/contacts/urls", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetURLCollection())
		})

		// 每日社交广度
		prot.GET("/contacts/social-breadth", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetSocialBreadth())
		})

		// 个人自画像
		prot.GET("/contacts/self-portrait", func(c *gin.Context) {
			c.JSON(http.StatusOK, getSvc().GetSelfPortrait())
		})

		// 共同社交圈（两个联系人的共同群 + 共同好友推测）
		prot.GET("/contacts/common-circle", func(c *gin.Context) {
			u1 := c.Query("user1")
			u2 := c.Query("user2")
			if u1 == "" || u2 == "" {
				c.JSON(400, gin.H{"error": "user1 and user2 required"})
				return
			}
			c.JSON(http.StatusOK, getSvc().GetCommonCircle(u1, u2))
		})

		// 联系人相似度分析（谁最像谁）
		prot.GET("/contacts/similarity", func(c *gin.Context) {
			topN := 20
			if n := c.Query("top"); n != "" {
				if v, err := strconv.Atoi(n); err == nil && v > 0 {
					topN = v
				}
			}
			c.JSON(http.StatusOK, getSvc().GetContactSimilarity(topN))
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

		// AI 摘要数据（统计特征 + 采样消息，用于生成 AI 报告/日记/画像卡）
		prot.GET("/contacts/ai-summary", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 username 参数"})
				return
			}
			svc := getSvc()

			// 1. 从缓存获取基础统计
			var stats *service.ContactStatsExtended
			for _, s := range svc.GetCachedStats() {
				if s.Username == uname {
					stats = &s
					break
				}
			}
			if stats == nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
				return
			}

			// 2. 获取详情（会懒加载）
			detail := svc.GetContactDetail(uname)

			// 3. 采样消息：每月取最多 3 条代表性消息（低 token 消耗）
			msgs := svc.ExportContactMessages(uname, 0, 0)
			type sampledMsg struct {
				Date    string `json:"date"`
				Time    string `json:"time"`
				Content string `json:"content"`
				IsMine  bool   `json:"is_mine"`
			}
			monthSamples := make(map[string][]sampledMsg)
			for _, m := range msgs {
				if m.Type != 1 || m.Content == "" { continue } // 只要文本
				month := ""
				if m.Date != "" { month = m.Date[:7] } else { continue }
				if len(monthSamples[month]) >= 3 { continue }
				content := m.Content
				if len([]rune(content)) > 80 {
					content = string([]rune(content)[:80]) + "…"
				}
				monthSamples[month] = append(monthSamples[month], sampledMsg{
					Date: m.Date, Time: m.Time, Content: content, IsMine: m.IsMine,
				})
			}

			// 4. 构造月度摘要
			type monthSummary struct {
				Month   string       `json:"month"`
				Their   int          `json:"their"`
				Mine    int          `json:"mine"`
				Total   int          `json:"total"`
				Samples []sampledMsg `json:"samples"`
			}
			var monthly []monthSummary
			if detail != nil {
				months := make(map[string]bool)
				for m := range detail.TheirMonthlyTrend { months[m] = true }
				for m := range detail.MyMonthlyTrend { months[m] = true }
				for m := range months {
					their := detail.TheirMonthlyTrend[m]
					mine := detail.MyMonthlyTrend[m]
					monthly = append(monthly, monthSummary{
						Month: m, Their: their, Mine: mine, Total: their + mine,
						Samples: monthSamples[m],
					})
				}
				sort.Slice(monthly, func(i, j int) bool { return monthly[i].Month < monthly[j].Month })
			}

			// 5. 计算额外特征
			displayName := stats.Remark
			if displayName == "" { displayName = stats.Nickname }
			if displayName == "" { displayName = stats.Username }
			daysKnown := 0
			if stats.FirstMessage != "" && stats.FirstMessage != "-" {
				if t, err := time.Parse("2006-01-02", stats.FirstMessage); err == nil {
					daysKnown = int(time.Since(t).Hours() / 24)
				}
			}
			initiationPct := 0
			if detail != nil && detail.TotalSessions > 0 {
				initiationPct = int(detail.InitiationCnt * 100 / detail.TotalSessions)
			}
			lateNightPct := 0
			if detail != nil && stats.TotalMessages > 0 {
				lateNightPct = int(detail.LateNightCount * 100 / stats.TotalMessages)
			}

			// token 预估
			tokenEstimate := len(monthly)*50 + 500 // 粗略估算

			c.JSON(http.StatusOK, gin.H{
				"display_name":    displayName,
				"username":        uname,
				"first_message":   stats.FirstMessage,
				"last_message":    stats.LastMessage,
				"first_msg":       stats.FirstMsg,
				"days_known":      daysKnown,
				"total_messages":  stats.TotalMessages,
				"their_messages":  stats.TheirMessages,
				"my_messages":     stats.MyMessages,
				"their_chars":     stats.TheirChars,
				"my_chars":        stats.MyChars,
				"avg_msg_len":     stats.AvgMsgLen,
				"peak_monthly":    stats.PeakMonthly,
				"peak_period":     stats.PeakPeriod,
				"recent_monthly":  stats.RecentMonthly,
				"recall_count":    stats.RecallCount,
				"money_count":     stats.MoneyCount,
				"emoji_count":     stats.EmojiCnt,
				"shared_groups":   stats.SharedGroupsCount,
				"type_cnt":        stats.TypeCnt,
				"initiation_pct":  initiationPct,
				"late_night_pct":  lateNightPct,
				"late_night_count": func() int64 { if detail != nil { return detail.LateNightCount }; return 0 }(),
				"total_sessions":  func() int64 { if detail != nil { return detail.TotalSessions }; return 0 }(),
				"hourly_dist":     func() [24]int { if detail != nil { return detail.HourlyDist }; return [24]int{} }(),
				"monthly":         monthly,
				"token_estimate":  tokenEstimate,
			})
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

		// POST /api/databases/nl-query — 自然语言查数据：LLM 生成 SQL → 执行 → 返回
		// 支持两种模式：
		//   mode="direct"          — 单库直查（LLM 返回 {db, sql}）
		//   mode="contact_messages" — 跨库联系人消息查询（LLM 返回 {contact_hint, message_sql}，
		//                             后端自动查联系人 → 计算 Chat_ 表名 → 找到 message DB → 执行）
		prot.POST("/databases/nl-query", func(c *gin.Context) {
			if isDemoMode {
				demoBlockRawSQL(c)
				return
			}
			var body struct {
				Question  string `json:"question"`
				ProfileID string `json:"profile_id"`
			}
			if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Question) == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "请输入问题"})
				return
			}

			prefs := loadPreferences()
			cfg := llmConfigForProfile(body.ProfileID, prefs)
			if cfg.provider == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
				return
			}

			schema := getMgr().GetSchemaContext()
			systemPrompt := `你是一个 SQLite 专家。用户会用中文问关于微信聊天数据的问题。
你要根据提供的数据库 schema，生成可执行的查询。

支持两种模式（根据问题自动选择）：

模式 1 — 单库直查（不涉及特定联系人的消息内容时用这个）：
  {"mode":"direct", "db":"数据库名.db", "sql":"SELECT ...", "explain":"说明"}

模式 2 — 联系人消息查询（涉及"某个人的消息/聊天记录"时用这个）：
  {"mode":"contact_messages", "contact_hint":"老婆", "message_sql":"SELECT ... FROM [{{TABLE}}] ...", "explain":"说明"}
  - contact_hint 是联系人的备注名/昵称/关键词（后端会自动在 contact 表里模糊查找）
  - message_sql 里用 {{TABLE}} 占位符代替实际表名（后端会自动替换为 Chat_<md5>）
  - 后端会自动找到正确的 message_N.db 并执行

规则：
1. 只返回裸 JSON，不要 markdown code fence
2. 只允许 SELECT / PRAGMA
3. LIMIT 50（除非用户要更多）
4. 时间戳转日期：datetime(create_time, 'unixepoch', 'localtime')
5. 如果无法回答：{"mode":"direct", "db":"", "sql":"", "explain":"无法回答：原因"}`

			userPrompt := fmt.Sprintf("数据库 schema：\n%s\n用户问题：%s", schema, body.Question)

			raw, err := CompleteLLM([]LLMMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userPrompt},
			}, prefs)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败：" + err.Error()})
				return
			}

			// 清理 markdown fence
			raw = strings.TrimSpace(raw)
			if strings.HasPrefix(raw, "```") {
				if idx := strings.Index(raw, "\n"); idx >= 0 { raw = raw[idx+1:] }
				if idx := strings.LastIndex(raw, "```"); idx >= 0 { raw = raw[:idx] }
				raw = strings.TrimSpace(raw)
			}

			var parsed struct {
				Mode         string `json:"mode"`
				DB           string `json:"db"`
				SQL          string `json:"sql"`
				ContactHint  string `json:"contact_hint"`
				MessageSQL   string `json:"message_sql"`
				Explain      string `json:"explain"`
			}
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				c.JSON(http.StatusOK, gin.H{"generated_sql": raw, "error": "LLM 返回格式异常"})
				return
			}

			switch parsed.Mode {
			case "contact_messages":
				// 跨库联系人消息查询
				if parsed.ContactHint == "" || parsed.MessageSQL == "" {
					c.JSON(http.StatusOK, gin.H{"explain": parsed.Explain, "error": "缺少 contact_hint 或 message_sql"})
					return
				}
				// Step 1: 查联系人
				hint := parsed.ContactHint
				contactResult := getMgr().ExecQuery("contact.db", fmt.Sprintf(
					"SELECT username, COALESCE(remark,'') AS remark, nick_name FROM contact WHERE remark LIKE '%%%s%%' OR nick_name LIKE '%%%s%%' LIMIT 1",
					hint, hint))
				if contactResult.Error != "" || len(contactResult.Rows) == 0 {
					c.JSON(http.StatusOK, gin.H{
						"explain": parsed.Explain,
						"error":   fmt.Sprintf("找不到匹配「%s」的联系人", hint),
					})
					return
				}
				username := ""
				if s, ok := contactResult.Rows[0][0].(string); ok { username = s }
				if username == "" {
					c.JSON(http.StatusOK, gin.H{"error": "联系人 username 为空"})
					return
				}
				contactName := ""
				if s, ok := contactResult.Rows[0][1].(string); ok && s != "" { contactName = s }
				if contactName == "" {
					if s, ok := contactResult.Rows[0][2].(string); ok { contactName = s }
				}

				// Step 2: 计算表名 + 找到 DB + 执行
				tableName := db.GetTableName(username)
				finalSQL := strings.ReplaceAll(parsed.MessageSQL, "{{TABLE}}", tableName)

				// 遍历 message DBs 找到有这张表的那个
				var result *db.QueryResult
				var usedDB string
				for _, mdb := range getMgr().MessageDBs {
					var cnt int
					if err := mdb.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='%s'", tableName)).Scan(&cnt); err != nil || cnt == 0 {
						continue
					}
					// 找到了，直接在这个连接上执行
					r := db.ExecQueryOnDB(mdb, finalSQL)
					result = r
					// 找 DB 文件名
					dbRows, _ := mdb.Query("PRAGMA database_list")
					if dbRows != nil {
						for dbRows.Next() {
							var seq int; var name, file string
							dbRows.Scan(&seq, &name, &file)
							if seq == 0 { usedDB = filepath.Base(file); break }
						}
						dbRows.Close()
					}
					break
				}
				if result == nil {
					c.JSON(http.StatusOK, gin.H{
						"explain": fmt.Sprintf("联系人「%s」(%s) 的消息表 %s 未找到", contactName, username, tableName),
						"error":   "消息表不存在",
					})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"generated_sql": fmt.Sprintf("-- 联系人: %s (%s)\n-- 表: %s @ %s\n%s", contactName, username, tableName, usedDB, finalSQL),
					"db":            usedDB,
					"explain":       fmt.Sprintf("%s（联系人: %s）", parsed.Explain, contactName),
					"result":        result,
				})

			default:
				// 单库直查（原逻辑）
				if parsed.SQL == "" || parsed.DB == "" {
					c.JSON(http.StatusOK, gin.H{"explain": parsed.Explain, "error": parsed.Explain})
					return
				}
				result := getMgr().ExecQuery(parsed.DB, parsed.SQL)
				c.JSON(http.StatusOK, gin.H{
					"generated_sql": parsed.SQL,
					"db":            parsed.DB,
					"explain":       parsed.Explain,
					"result":        result,
				})
			}
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

		// 取消正在进行的索引（前端 InitializingScreen 的「取消」按钮）
		prot.POST("/cancel-index", func(c *gin.Context) {
			cancelled := getSvc().CancelIndexing()
			c.JSON(200, gin.H{"cancelled": cancelled})
		})

		// GET /api/fun/companion-time — 每个联系人的陪伴时长（session-based）
		// 内部缓存 10 分钟；refresh=1 强制刷新
		prot.GET("/fun/companion-time", func(c *gin.Context) {
			refresh := c.Query("refresh") == "1"
			stats, err := getSvc().GetCompanionStats(refresh)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, stats)
		})

		// GET /api/fun/ghost-months — 曾经熟悉、后来忽然"消失"的朋友（单月消息骤降 ≥80%）
		// 内部缓存 30 分钟；refresh=1 强制刷新。
		prot.GET("/fun/ghost-months", func(c *gin.Context) {
			refresh := c.Query("refresh") == "1"
			result, err := getSvc().GetGhostMonths(refresh)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// GET /api/fun/like-me — 聊天风格最接近"我的平均对话基线"的联系人 Top 5
		// 内部缓存 30 分钟；refresh=1 强制刷新。
		prot.GET("/fun/like-me", func(c *gin.Context) {
			refresh := c.Query("refresh") == "1"
			result, err := getSvc().GetLikeMeFriends(refresh)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// GET /api/fun/word-almanac — 每年"我发送的消息"的代表词（最高频词 + 亚军）
		// 缓存 2 小时。
		prot.GET("/fun/word-almanac", func(c *gin.Context) {
			refresh := c.Query("refresh") == "1"
			result, err := getSvc().GetWordAlmanac(refresh)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// GET /api/fun/insomnia-top — 凌晨 2-4 点我呼叫后最常被回应的 Top 5
		// 缓存 30 分钟。
		prot.GET("/fun/insomnia-top", func(c *gin.Context) {
			refresh := c.Query("refresh") == "1"
			result, err := getSvc().GetInsomniaTop(refresh)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, result)
		})

	}

	// 诊断：聚合「数据目录健康 / 索引状态 / LLM 探活 / 磁盘大小」一次返回
	// 不需要服务层就绪（数据目录无效时也要能跑），所以挂在 api 而不是 prot 上
	api.GET("/diagnostics", func(c *gin.Context) {
		var indexStatus map[string]interface{}
		if svc := getSvc(); svc != nil {
			indexStatus = svc.GetStatus()
		}
		diag := runDiagnostics(prefs.DataDir, indexStatus)
		c.JSON(http.StatusOK, diag)
	})

	// 数据目录 profile 管理（多账号切换）
	api.GET("/app/data-profiles", func(c *gin.Context) {
		p := loadPreferences()
		c.JSON(http.StatusOK, gin.H{
			"profiles":   p.DataDirProfiles,
			"active_dir": p.DataDir,
		})
	})

	// 新增 / 更新 / 删除一个 profile（按 id 匹配；id 为空表示新增）
	api.PUT("/app/data-profiles", func(c *gin.Context) {
		var body struct {
			Profiles []DataDirProfile `json:"profiles"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		// 给所有缺 id 的 profile 补一个简单的时间戳 id
		for i := range body.Profiles {
			if body.Profiles[i].ID == "" {
				body.Profiles[i].ID = fmt.Sprintf("p%d", time.Now().UnixNano())
			}
		}
		existing := loadPreferences()
		existing.DataDirProfiles = body.Profiles
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"profiles": existing.DataDirProfiles})
	})

	// 切换激活的数据目录（热替换 contactSvc，无需重启）
	api.POST("/app/switch-profile", func(c *gin.Context) {
		var body struct {
			ID string `json:"id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.ID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 profile id"})
			return
		}
		existing := loadPreferences()
		var picked *DataDirProfile
		for i := range existing.DataDirProfiles {
			if existing.DataDirProfiles[i].ID == body.ID {
				picked = &existing.DataDirProfiles[i]
				break
			}
		}
		if picked == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "profile 不存在"})
			return
		}
		// 复用 setup 的预检逻辑
		warnings, verr := validateDataDir(picked.Path)
		if verr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": verr.Error()})
			return
		}
		// 热替换：新建 DBManager + ContactService
		merged := effectiveConfig(existing)
		merged.DataDir = picked.Path
		os.Unsetenv("DEMO_MODE")
		if err := reinitSvc(merged.DataDir, analysisParamsFromPrefs(merged), 0, 0); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "切换失败：" + err.Error()})
			return
		}
		// 更新 prefs
		existing.DataDir = picked.Path
		existing.DemoMode = false
		picked.LastIndexedAt = time.Now().Unix()
		if err := savePreferences(existing); err != nil {
			log.Printf("[PROFILE] Failed to save active profile: %v", err)
		}
		prefs.DataDir = picked.Path
		c.JSON(http.StatusOK, gin.H{"status": "ok", "warnings": warnings, "active_dir": picked.Path})
	})

	// 流式下载 AI 数据库（Docker / 浏览器模式专用）。
	// App 模式应优先用 POST /app/ai-backup（写到下载目录），
	// 因为 macOS WebView 对 attachment 下载的支持很差。
	api.GET("/ai-backup-download", func(c *gin.Context) {
		src := aiAnalysisDBPath()
		if _, err := os.Stat(src); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "AI 数据库不存在：" + err.Error()})
			return
		}
		fname := fmt.Sprintf("welink-ai-backup-%s.db", time.Now().Format("20060102-150405"))
		// 用 VACUUM INTO 生成自洽快照到临时文件后再 stream，避免 stream 中途有写入
		tmp := src + ".download.tmp"
		_ = os.Remove(tmp)
		tdb, err := sql.Open("sqlite", src+"?mode=ro")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "打开 AI 库失败：" + err.Error()})
			return
		}
		_, err = tdb.Exec("VACUUM INTO ?", tmp)
		tdb.Close()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败：" + err.Error()})
			return
		}
		defer os.Remove(tmp)
		c.Header("Content-Disposition", "attachment; filename=\""+fname+"\"")
		c.Header("Content-Type", "application/octet-stream")
		c.File(tmp)
	})

	// AI 数据备份（App 模式）：把 ai_analysis.db 复制到下载目录，返回路径供前端展示 + reveal
	api.POST("/app/ai-backup", func(c *gin.Context) {
		if !hasFrontend {
			c.JSON(http.StatusNotFound, gin.H{"error": "App 模式专用，Docker 请用 GET /api/ai-backup-download"})
			return
		}
		src := aiAnalysisDBPath()
		if _, err := os.Stat(src); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "AI 数据库不存在：" + err.Error()})
			return
		}
		dlDir, err := resolveDownloadDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		fname := fmt.Sprintf("welink-ai-backup-%s.db", time.Now().Format("20060102-150405"))
		dst := filepath.Join(dlDir, fname)
		// 用 SQLite VACUUM INTO 而不是裸 cp，保证生成自洽快照（避免 WAL/journal 半完成状态）
		// 注意：VACUUM INTO 要求目标文件不存在
		_ = os.Remove(dst)
		// 用一个临时新连接执行（不走业务连接池，避免 PRAGMA 状态干扰）
		tdb, err := sql.Open("sqlite", src+"?mode=ro")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "打开 AI 库失败：" + err.Error()})
			return
		}
		defer tdb.Close()
		if _, err := tdb.Exec("VACUUM INTO ?", dst); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败：" + err.Error()})
			return
		}
		info, _ := os.Stat(dst)
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		c.JSON(http.StatusOK, gin.H{"path": dst, "size": size})
	})

	// AI 数据恢复：上传 .db 文件覆盖现有 ai_analysis.db
	// 步骤：1) 写入临时文件；2) 用只读连接 sanity-check（确保是 sqlite + 含 skills 表）；
	//        3) 当前 ai_analysis.db rename 为 .bak；4) 临时文件 rename 为正式路径；5) InitAIDB 重新打开
	api.POST("/app/ai-restore", func(c *gin.Context) {
		// 上传走 multipart，无论 App / Docker / 浏览器都能用
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未上传文件"})
			return
		}
		if fileHeader.Size > 500*1024*1024 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "文件超过 500MB，恢复已中止"})
			return
		}
		dst := aiAnalysisDBPath()
		tmp := dst + ".restore.tmp"
		_ = os.Remove(tmp)
		if err := c.SaveUploadedFile(fileHeader, tmp); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入临时文件失败：" + err.Error()})
			return
		}
		// sanity check
		tdb, err := sql.Open("sqlite", tmp+"?mode=ro")
		if err != nil {
			os.Remove(tmp)
			c.JSON(http.StatusBadRequest, gin.H{"error": "不是有效的 SQLite 文件：" + err.Error()})
			return
		}
		var hasSkills int
		err = tdb.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('skills','mem_facts','chat_history')").Scan(&hasSkills)
		tdb.Close()
		if err != nil || hasSkills == 0 {
			os.Remove(tmp)
			c.JSON(http.StatusBadRequest, gin.H{"error": "不是 WeLink 的 AI 备份文件（找不到预期的表）"})
			return
		}
		// 关闭当前 AI 连接 + 重命名
		if err := CloseAIDB(); err != nil {
			log.Printf("[AI-RESTORE] CloseAIDB warn: %v", err)
		}
		if _, err := os.Stat(dst); err == nil {
			bak := dst + "." + time.Now().Format("20060102-150405") + ".bak"
			if err := os.Rename(dst, bak); err != nil {
				os.Remove(tmp)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "备份原文件失败：" + err.Error()})
				return
			}
			log.Printf("[AI-RESTORE] 原 AI 库已备份为：%s", bak)
		}
		if err := os.Rename(tmp, dst); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "替换文件失败：" + err.Error()})
			return
		}
		if err := InitAIDB(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "恢复后重新打开数据库失败：" + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// POST /api/preferences/reset — 重置用户配置
	// body: {"hard": bool}
	//   hard=false（默认 / 软重置）：仅清空 preferences.json（写回 defaultPreferences），保留 ai_analysis.db
	//   hard=true（硬重置）：同时删除 ai_analysis.db（会先备份为 .bak）
	// 旧 preferences.json 总会被 rename 为 preferences.json.<ts>.bak 保底。
	api.POST("/preferences/reset", func(c *gin.Context) {
		var body struct {
			Hard bool `json:"hard"`
		}
		_ = c.ShouldBindJSON(&body)

		backups := []string{}
		// 备份并替换 preferences.json
		prefPath := preferencesPath()
		if _, err := os.Stat(prefPath); err == nil {
			bak := prefPath + "." + time.Now().Format("20060102-150405") + ".bak"
			if err := os.Rename(prefPath, bak); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "备份 preferences.json 失败：" + err.Error()})
				return
			}
			backups = append(backups, bak)
		}
		if err := savePreferences(defaultPreferences()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入空配置失败：" + err.Error()})
			return
		}

		if body.Hard {
			// 硬重置：AI 库也干掉，先备份
			dbPath := aiAnalysisDBPath()
			if _, err := os.Stat(dbPath); err == nil {
				if err := CloseAIDB(); err != nil {
					log.Printf("[RESET] CloseAIDB warn: %v", err)
				}
				bak := dbPath + "." + time.Now().Format("20060102-150405") + ".bak"
				if err := os.Rename(dbPath, bak); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "备份 ai_analysis.db 失败：" + err.Error()})
					return
				}
				backups = append(backups, bak)
				if err := InitAIDB(); err != nil {
					log.Printf("[RESET] re-InitAIDB warn: %v", err)
				}
			}
		}

		log.Printf("[RESET] hard=%v backups=%v", body.Hard, backups)
		c.JSON(http.StatusOK, gin.H{"status": "ok", "hard": body.Hard, "backups": backups})
	})

	// GET /api/preferences/export — 导出当前配置为 JSON
	// ?include_secrets=1 时把 API Key / OAuth token / 密码一起导出（默认 0，安全起见）。
	// 机器特定字段（DataDir / LogDir / DownloadDir / AIAnalysisDBPath / DataDirProfiles）始终清空。
	api.GET("/preferences/export", func(c *gin.Context) {
		includeSecrets := c.Query("include_secrets") == "1"
		p := loadPreferences()
		exported := sanitizeForExport(p, !includeSecrets)
		data, err := json.MarshalIndent(exported, "", "  ")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化配置失败：" + err.Error()})
			return
		}
		fname := fmt.Sprintf("welink-config-%s.json", time.Now().Format("20060102-150405"))
		c.Header("Content-Disposition", "attachment; filename=\""+fname+"\"")
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
	})

	// POST /api/preferences/import — 上传 JSON 覆盖当前配置
	// 合并策略：imported 覆盖非机器字段（LLM / 偏好 / 凭证等），当前机器特定字段（DataDir 等）保留。
	// 原 preferences.json 会被 rename 为 .bak.<ts> 保底。
	api.POST("/preferences/import", func(c *gin.Context) {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未上传文件"})
			return
		}
		if fileHeader.Size > 5*1024*1024 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "配置文件超过 5MB，已中止"})
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "打开上传文件失败：" + err.Error()})
			return
		}
		defer f.Close()
		raw, err := io.ReadAll(f)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取上传文件失败：" + err.Error()})
			return
		}
		var imported Preferences
		if err := json.Unmarshal(raw, &imported); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不是合法的 WeLink 配置 JSON：" + err.Error()})
			return
		}

		current := loadPreferences()
		merged := mergeImported(current, imported)
		merged = migratePreferences(merged)

		// 先 rename 原文件为 .bak 再写入（写入失败时能回滚）
		prefPath := preferencesPath()
		var bak string
		if _, err := os.Stat(prefPath); err == nil {
			bak = prefPath + "." + time.Now().Format("20060102-150405") + ".bak"
			if err := os.Rename(prefPath, bak); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "备份原配置失败：" + err.Error()})
				return
			}
		}
		if err := savePreferences(merged); err != nil {
			if bak != "" {
				_ = os.Rename(bak, prefPath)
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入新配置失败：" + err.Error()})
			return
		}

		needsDataDir := merged.DataDir == "" && len(merged.DataDirProfiles) == 0
		log.Printf("[IMPORT] backup=%s needs_data_dir=%v", bak, needsDataDir)
		c.JSON(http.StatusOK, gin.H{
			"status":          "ok",
			"backup":          bak,
			"needs_data_dir":  needsDataDir, // 前端可据此提示用户重新选数据目录
		})
	})

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
		// Demo 模式：只允许白名单域名
		if isDemoMode && !demoAvatarURLAllowed(rawURL) {
			c.Status(http.StatusForbidden)
			return
		}
		// 所有模式：阻止请求内网地址（防止 SSRF）
		if isPrivateURL(rawURL) {
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

	// 默认仅监听 127.0.0.1，避免新增的 /api/export/* 等端点暴露在 LAN 上
	// 造成凭据/聊天数据泄漏。Docker/反代部署可显式打开 WELINK_LISTEN_LAN=1。
	host := "127.0.0.1"
	if os.Getenv("WELINK_LISTEN_LAN") == "1" {
		host = ""
	}

	// App 模式下，若首选 port 被占（例如 Docker 同名镜像在跑），自动递增找一个
	// 空闲端口而不是静默失败后让 webview 连到别人的服务上看见 404。
	listener, actualPort, err := listenWithFallback(host, prefs.Port, hasFrontend)
	if err != nil {
		log.Fatalf("WeLink 后端无法监听端口：%v", err)
	}
	log.Printf("WeLink Backend serving on %s:%s", host, actualPort)

	if hasFrontend {
		// App 模式：用已绑定的 listener 服务 webview，通知 ready 后阻塞
		go func() {
			if err := http.Serve(listener, r); err != nil {
				log.Fatalf("WeLink HTTP server 崩溃：%v", err)
			}
		}()
		signalServerReady(actualPort)
		select {} // 等 webview 窗口关闭后 os.Exit
	}

	if err := http.Serve(listener, r); err != nil {
		log.Fatalf("WeLink HTTP server 崩溃：%v", err)
	}
}

// listenWithFallback 绑定到 host:port。App 模式（fallback=true）下，如果首选
// port 被占，会递增尝试最多 20 个端口，返回实际使用的 listener 和端口号。
// Server 模式下只尝试一次以保留「端口由运维显式指定」的语义。
func listenWithFallback(host, port string, fallback bool) (net.Listener, string, error) {
	if host == "" {
		// ":port" 语义：绑所有网卡
		if l, err := net.Listen("tcp", ":"+port); err == nil {
			return l, port, nil
		} else if !fallback {
			return nil, "", err
		}
	} else {
		if l, err := net.Listen("tcp", host+":"+port); err == nil {
			return l, port, nil
		} else if !fallback {
			return nil, "", err
		}
	}

	// App 模式端口递增回退
	basePort, err := strconv.Atoi(port)
	if err != nil {
		return nil, "", fmt.Errorf("端口号 %q 解析失败：%w", port, err)
	}
	for i := 1; i <= 20; i++ {
		cand := strconv.Itoa(basePort + i)
		addr := host + ":" + cand
		if host == "" {
			addr = ":" + cand
		}
		if l, err := net.Listen("tcp", addr); err == nil {
			log.Printf("端口 %s 被占用，回退到 %s", port, cand)
			return l, cand, nil
		}
	}
	return nil, "", fmt.Errorf("端口 %s 以及后续 20 个备选端口全部被占用", port)
}
