package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// ─── 类型 ─────────────────────────────────────────────────────────────────────

// ExportContentType 导出的内容类型
type ExportContentType string

const (
	ExportYearReview   ExportContentType = "year_review"   // 年度回顾（全局）
	ExportConversation ExportContentType = "conversation"  // 对话归档
	ExportAIHistory    ExportContentType = "ai_history"    // AI 对话历史
	ExportMemoryGraph  ExportContentType = "memory_graph"  // 记忆图谱
)

// ExportTarget 导出目标
type ExportTarget string

const (
	TargetMarkdown ExportTarget = "markdown"
	TargetNotion   ExportTarget = "notion"
	TargetFeishu   ExportTarget = "feishu"
	TargetWebDAV   ExportTarget = "webdav"
	TargetS3       ExportTarget = "s3"
	TargetDropbox  ExportTarget = "dropbox"
	TargetGDrive   ExportTarget = "gdrive"
	TargetOneDrive ExportTarget = "onedrive"
)

// ExportItem 单条导出条目
type ExportItem struct {
	Type     ExportContentType `json:"type"`
	Username string            `json:"username,omitempty"`  // 联系人/群聊 username
	IsGroup  bool              `json:"is_group,omitempty"`  // 是否群聊
	Year     int               `json:"year,omitempty"`      // 年度回顾的年份；0 = 全部
	From     int64             `json:"from,omitempty"`      // 对话归档时间区间（unix 秒）
	To       int64             `json:"to,omitempty"`
	AIKey    string            `json:"ai_key,omitempty"`    // AI 对话 key
	Title    string            `json:"title,omitempty"`     // 标题覆盖（可选）
}

// ExportRequest 导出请求
type ExportRequest struct {
	Items            []ExportItem `json:"items"`
	Target           ExportTarget `json:"target"`
	NotionParentPage string       `json:"notion_parent_page,omitempty"` // 覆盖 prefs 里的默认值
	FeishuFolderToken string      `json:"feishu_folder_token,omitempty"`
}

// ExportDoc 单个生成的文档（中间表示）
type ExportDoc struct {
	Title    string // 文档标题
	Filename string // 建议文件名（不含扩展名）
	Markdown string // 已渲染好的 Markdown 正文
}

// ExportResult 单条导出结果
type ExportResult struct {
	Title  string `json:"title"`
	OK     bool   `json:"ok"`
	URL    string `json:"url,omitempty"`     // 远端创建后的页面 URL（Notion/飞书）
	Error  string `json:"error,omitempty"`
	Bytes  int    `json:"bytes,omitempty"`
}

// ExportConfigDTO 暴露给前端的配置（敏感字段已脱敏）
type ExportConfigDTO struct {
	NotionToken       string `json:"notion_token"`
	NotionParentPage  string `json:"notion_parent_page"`
	FeishuAppID       string `json:"feishu_app_id"`
	FeishuAppSecret   string `json:"feishu_app_secret"`
	FeishuFolderToken string `json:"feishu_folder_token"`

	// WebDAV
	WebDAVURL      string `json:"webdav_url"`
	WebDAVUsername string `json:"webdav_username"`
	WebDAVPassword string `json:"webdav_password"`
	WebDAVPath     string `json:"webdav_path"`

	// S3 兼容
	S3Endpoint     string `json:"s3_endpoint"`
	S3Region       string `json:"s3_region"`
	S3Bucket       string `json:"s3_bucket"`
	S3AccessKey    string `json:"s3_access_key"`
	S3SecretKey    string `json:"s3_secret_key"`
	S3PathPrefix   string `json:"s3_path_prefix"`
	S3UsePathStyle bool   `json:"s3_use_path_style"`

	// Dropbox
	DropboxToken string `json:"dropbox_token"`
	DropboxPath  string `json:"dropbox_path"`

	// Google Drive
	GDriveClientID     string `json:"gdrive_client_id"`
	GDriveClientSecret string `json:"gdrive_client_secret"`
	GDriveFolderID     string `json:"gdrive_folder_id"`
	GDriveConnected    bool   `json:"gdrive_connected"` // 是否已授权（refresh token 存在）

	// OneDrive
	OneDriveClientID     string `json:"onedrive_client_id"`
	OneDriveClientSecret string `json:"onedrive_client_secret"`
	OneDriveTenant       string `json:"onedrive_tenant"`
	OneDriveFolderPath   string `json:"onedrive_folder_path"`
	OneDriveConnected    bool   `json:"onedrive_connected"`
}

// ─── 路由注册 ─────────────────────────────────────────────────────────────────

// registerExportRoutes 在受保护路由组中挂载导出中心相关接口。
// getSvc 用于按需取联系人服务（统计/消息查询都来自这里）。
func registerExportRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/export/preview", exportPreviewHandler(getSvc))
	prot.POST("/export/markdown", exportMarkdownHandler(getSvc))
	prot.POST("/export/notion", exportNotionHandler(getSvc))
	prot.POST("/export/feishu", exportFeishuHandler(getSvc))
	prot.POST("/export/webdav", exportWebDAVHandler(getSvc))
	prot.POST("/export/s3", exportS3Handler(getSvc))
	prot.POST("/export/dropbox", exportDropboxHandler(getSvc))
	prot.POST("/export/gdrive", exportGDriveHandler(getSvc))
	prot.POST("/export/onedrive", exportOneDriveHandler(getSvc))
	prot.GET("/export/config", exportConfigGetHandler())
	prot.PUT("/export/config", exportConfigPutHandler())

	// OAuth 回调（无需鉴权的子路由将在 main.go 单独挂载，这里挂在 prot 供手动触发授权）
	prot.GET("/export/oauth/gdrive/start", gdriveOAuthStartHandler())
	prot.GET("/export/oauth/gdrive/callback", gdriveOAuthCallbackHandler())
	prot.GET("/export/oauth/onedrive/start", onedriveOAuthStartHandler())
	prot.GET("/export/oauth/onedrive/callback", onedriveOAuthCallbackHandler())
}

// ─── 处理函数 ─────────────────────────────────────────────────────────────────

// POST /api/export/preview
// 预览：把请求中的所有 item 渲染成 Markdown，返回 [{title, markdown}, ...]，不写文件不发请求。
func exportPreviewHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]gin.H, 0, len(docs))
		for _, d := range docs {
			out = append(out, gin.H{
				"title":    d.Title,
				"filename": d.Filename + ".md",
				"markdown": d.Markdown,
			})
		}
		c.JSON(http.StatusOK, gin.H{"docs": out})
	}
}

// POST /api/export/markdown
// 单文件 → 直接返回 .md；多文件 → 打成 .zip。
func exportMarkdownHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if len(docs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "没有可导出的内容"})
			return
		}

		if len(docs) == 1 {
			d := docs[0]
			fname := safeFilename(d.Filename) + ".md"
			c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fname))
			c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(d.Markdown))
			return
		}

		// 多文件 → zip
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		for _, d := range docs {
			f, err := zw.Create(safeFilename(d.Filename) + ".md")
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			f.Write([]byte(d.Markdown))
		}
		zw.Close()

		zipName := fmt.Sprintf("welink-export-%s.zip", time.Now().Format("20060102-150405"))
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipName))
		c.Data(http.StatusOK, "application/zip", buf.Bytes())
	}
}

// POST /api/export/notion
// 把每个 doc 作为一个新 Page 推送到 Notion；返回每条的成功状态 + URL。
func exportNotionHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		token := strings.TrimSpace(prefs.NotionToken)
		if token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 Notion Integration Token"})
			return
		}
		parent := strings.TrimSpace(req.NotionParentPage)
		if parent == "" {
			parent = strings.TrimSpace(prefs.NotionParentPage)
		}
		if parent == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未指定 Notion 父 Page ID"})
			return
		}
		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			url, err := pushToNotion(token, parent, d)
			r := ExportResult{Title: d.Title, OK: err == nil}
			if err != nil {
				r.Error = err.Error()
			} else {
				r.URL = url
				r.Bytes = len(d.Markdown)
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// POST /api/export/feishu
// 把每个 doc 作为一个新文档导入飞书云空间；返回每条的成功状态 + URL。
func exportFeishuHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		appID := strings.TrimSpace(prefs.FeishuAppID)
		secret := strings.TrimSpace(prefs.FeishuAppSecret)
		if appID == "" || secret == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置飞书 App ID / App Secret"})
			return
		}
		folder := strings.TrimSpace(req.FeishuFolderToken)
		if folder == "" {
			folder = strings.TrimSpace(prefs.FeishuFolderToken)
		}

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		token, err := getFeishuTenantToken(appID, secret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "获取飞书 access_token 失败：" + err.Error()})
			return
		}

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			url, err := pushToFeishu(token, folder, d)
			r := ExportResult{Title: d.Title, OK: err == nil}
			if err != nil {
				r.Error = err.Error()
			} else {
				r.URL = url
				r.Bytes = len(d.Markdown)
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// GET /api/export/config
// 返回脱敏后的导出中心配置（前端用于回填表单）。
func exportConfigGetHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		p := loadPreferences()
		dto := ExportConfigDTO{
			NotionParentPage:  p.NotionParentPage,
			FeishuAppID:       p.FeishuAppID,
			FeishuFolderToken: p.FeishuFolderToken,

			WebDAVURL:      p.WebDAVURL,
			WebDAVUsername: p.WebDAVUsername,
			WebDAVPath:     p.WebDAVPath,

			S3Endpoint:     p.S3Endpoint,
			S3Region:       p.S3Region,
			S3Bucket:       p.S3Bucket,
			S3AccessKey:    p.S3AccessKey,
			S3PathPrefix:   p.S3PathPrefix,
			S3UsePathStyle: p.S3UsePathStyle,

			DropboxPath: p.DropboxPath,

			GDriveClientID:  p.GDriveClientID,
			GDriveFolderID:  p.GDriveFolderID,
			GDriveConnected: p.GDriveRefreshToken != "",

			OneDriveClientID:   p.OneDriveClientID,
			OneDriveTenant:     p.OneDriveTenant,
			OneDriveFolderPath: p.OneDriveFolderPath,
			OneDriveConnected:  p.OneDriveRefreshToken != "",
		}
		if p.NotionToken != "" {
			dto.NotionToken = hasKeyPlaceholder
		}
		if p.FeishuAppSecret != "" {
			dto.FeishuAppSecret = hasKeyPlaceholder
		}
		if p.WebDAVPassword != "" {
			dto.WebDAVPassword = hasKeyPlaceholder
		}
		if p.S3SecretKey != "" {
			dto.S3SecretKey = hasKeyPlaceholder
		}
		if p.DropboxToken != "" {
			dto.DropboxToken = hasKeyPlaceholder
		}
		if p.GDriveClientSecret != "" {
			dto.GDriveClientSecret = hasKeyPlaceholder
		}
		if p.OneDriveClientSecret != "" {
			dto.OneDriveClientSecret = hasKeyPlaceholder
		}
		c.JSON(http.StatusOK, dto)
	}
}

// PUT /api/export/config
// 保存导出中心配置；遇到 hasKeyPlaceholder 时保留原值（与 LLM 配置同样的语义）。
func exportConfigPutHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var in ExportConfigDTO
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		keepOld := func(v string) bool {
			return v == "" || v == hasKeyPlaceholder || strings.Contains(v, "****")
		}
		p := loadPreferences()
		if !keepOld(in.NotionToken) {
			p.NotionToken = strings.TrimSpace(in.NotionToken)
		}
		p.NotionParentPage = strings.TrimSpace(in.NotionParentPage)
		p.FeishuAppID = strings.TrimSpace(in.FeishuAppID)
		if !keepOld(in.FeishuAppSecret) {
			p.FeishuAppSecret = strings.TrimSpace(in.FeishuAppSecret)
		}
		p.FeishuFolderToken = strings.TrimSpace(in.FeishuFolderToken)

		// WebDAV
		p.WebDAVURL = strings.TrimSpace(in.WebDAVURL)
		p.WebDAVUsername = strings.TrimSpace(in.WebDAVUsername)
		if !keepOld(in.WebDAVPassword) {
			p.WebDAVPassword = in.WebDAVPassword
		}
		p.WebDAVPath = strings.TrimSpace(in.WebDAVPath)

		// S3
		p.S3Endpoint = strings.TrimSpace(in.S3Endpoint)
		p.S3Region = strings.TrimSpace(in.S3Region)
		p.S3Bucket = strings.TrimSpace(in.S3Bucket)
		p.S3AccessKey = strings.TrimSpace(in.S3AccessKey)
		if !keepOld(in.S3SecretKey) {
			p.S3SecretKey = strings.TrimSpace(in.S3SecretKey)
		}
		p.S3PathPrefix = strings.TrimSpace(in.S3PathPrefix)
		p.S3UsePathStyle = in.S3UsePathStyle

		// Dropbox
		if !keepOld(in.DropboxToken) {
			p.DropboxToken = strings.TrimSpace(in.DropboxToken)
		}
		p.DropboxPath = strings.TrimSpace(in.DropboxPath)

		// Google Drive
		p.GDriveClientID = strings.TrimSpace(in.GDriveClientID)
		if !keepOld(in.GDriveClientSecret) {
			p.GDriveClientSecret = strings.TrimSpace(in.GDriveClientSecret)
		}
		p.GDriveFolderID = strings.TrimSpace(in.GDriveFolderID)

		// OneDrive
		p.OneDriveClientID = strings.TrimSpace(in.OneDriveClientID)
		if !keepOld(in.OneDriveClientSecret) {
			p.OneDriveClientSecret = strings.TrimSpace(in.OneDriveClientSecret)
		}
		p.OneDriveTenant = strings.TrimSpace(in.OneDriveTenant)
		p.OneDriveFolderPath = strings.TrimSpace(in.OneDriveFolderPath)

		if err := savePreferences(p); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

// safeFilename 去掉文件名中可能有问题的字符（路径分隔符、控制字符等）。
func safeFilename(name string) string {
	if name == "" {
		return "export"
	}
	repl := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	out := repl.Replace(name)
	out = strings.TrimSpace(out)
	if out == "" {
		out = "export"
	}
	if r := []rune(out); len(r) > 80 {
		out = string(r[:80])
	}
	return out
}
