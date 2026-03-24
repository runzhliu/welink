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
		// read-modify-write：只更新 blocked 字段，保留 App 配置字段
		existing := loadPreferences()
		existing.BlockedUsers = incoming.BlockedUsers
		existing.BlockedGroups = incoming.BlockedGroups
		if err := savePreferences(existing); err != nil {
			log.Printf("[PREFS] Failed to save preferences: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(http.StatusOK, existing)
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
