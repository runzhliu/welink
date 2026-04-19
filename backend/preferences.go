package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// resolveDownloadDir 返回当前应该写入导出文件的目录：
//   1. 用户在设置里配置的 DownloadDir（存在且可写）
//   2. 平台默认：$HOME/Downloads（Mac/Win）或 $XDG_DOWNLOAD_DIR（Linux）
// 目录必须在用户 home 之下（防止前端传入 /etc 之类触发任意写）。
func resolveDownloadDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("无法获取用户目录：%w", err)
	}

	pick := func(dir string) (string, error) {
		abs, err := filepath.Abs(dir)
		if err != nil {
			return "", fmt.Errorf("解析目录失败：%w", err)
		}
		if !strings.HasPrefix(abs, home+string(filepath.Separator)) && abs != home {
			return "", fmt.Errorf("下载目录必须在用户目录 %s 之下：%s", home, abs)
		}
		if err := os.MkdirAll(abs, 0o755); err != nil {
			return "", fmt.Errorf("创建目录失败：%w", err)
		}
		// 写权限探测
		probe := filepath.Join(abs, ".welink_write_probe")
		if f, err := os.Create(probe); err != nil {
			return "", fmt.Errorf("目录不可写：%s（%v）", abs, err)
		} else {
			f.Close()
			os.Remove(probe)
		}
		return abs, nil
	}

	p := loadPreferences()
	if strings.TrimSpace(p.DownloadDir) != "" {
		return pick(p.DownloadDir)
	}
	// 平台默认
	if xdg := os.Getenv("XDG_DOWNLOAD_DIR"); xdg != "" {
		return pick(xdg)
	}
	return pick(filepath.Join(home, "Downloads"))
}

// migrateConfigYAML 一次性迁移：仅 App 模式下，如果 config.yaml 存在，打印警告提示迁移。
// Docker 模式下 config.yaml 仍然被正常使用，不打印迁移提示。
func migrateConfigYAML() {
	if appPreferencesDir() == "" {
		return // 非 App 模式（Docker/CLI），config.yaml 正常使用，不提示迁移
	}
	if _, err := os.Stat("config.yaml"); err == nil {
		log.Printf("[MIGRATE] Found config.yaml — please migrate settings to the Settings page. config.yaml is no longer used.")
	}
}

// DataDirProfile 单个数据目录配置项（用于多账号切换）。
type DataDirProfile struct {
	ID            string `json:"id"`               // 短 UUID，前端用作 key
	Name          string `json:"name"`             // 用户起的别名，如「主号」「老婆账号」
	Path          string `json:"path"`             // 解密后 decrypted/ 目录的绝对路径
	LastIndexedAt int64  `json:"last_indexed_at,omitempty"` // 上次成功索引的 Unix 秒
}

// LLMProfile 单个 LLM 配置项，支持多 provider 并行配置与一键切换。
type LLMProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	APIKey   string `json:"api_key,omitempty"`
	BaseURL  string `json:"base_url,omitempty"`
	Model    string `json:"model,omitempty"`
	NoThink  bool   `json:"no_think,omitempty"` // Ollama 思考型模型（Qwen3+）专用：开启后在消息前加 /no_think 跳过推理
}

// Preferences 是唯一的持久化结构体，合并了用户偏好和 App 配置。
// App 模式存储在 ~/Library/Application Support/WeLink/preferences.json，
// Docker/CLI 模式存储路径由环境变量 PREFERENCES_PATH 指定，默认为工作目录的 preferences.json。
// CurrentSchemaVersion 是当前代码理解的 preferences.json 格式版本。
// 每次做带破坏性语义的改动（字段语义翻转、删除、合并）时 +1，并在 migratePreferences 加对应 case。
// 只加字段且 zero-value 兼容的改动不用升级版本。
const CurrentSchemaVersion = 1

type Preferences struct {
	// 0 或缺失 = 旧版本（需要迁移）；>= CurrentSchemaVersion = 当前版本
	SchemaVersion int `json:"schema_version,omitempty"`

	// App 模式专用
	DataDir     string `json:"data_dir,omitempty"`
	LogDir      string `json:"log_dir,omitempty"`
	DownloadDir string `json:"download_dir,omitempty"` // 导出图片/文件的保存目录；留空 = 平台默认（~/Downloads）
	DemoMode    bool   `json:"demo_mode,omitempty"`
	// 多账号 / 多数据目录支持。当前激活的目录（DataDir）一定也存在于这个列表中。
	DataDirProfiles []DataDirProfile `json:"data_dir_profiles,omitempty"`

	// 服务器配置（修改后需重启）
	Port    string `json:"port,omitempty"`     // 默认 8080，环境变量 PORT 覆盖
	GinMode string `json:"gin_mode,omitempty"` // debug / release

	// 分析参数（支持热加载）
	Timezone             string `json:"timezone,omitempty"`                // 默认 Asia/Shanghai
	LateNightStartHour   int    `json:"late_night_start_hour,omitempty"`   // 默认 0
	LateNightEndHour     int    `json:"late_night_end_hour,omitempty"`     // 默认 5
	SessionGapSeconds    int64  `json:"session_gap_seconds,omitempty"`     // 默认 21600（6 小时）
	WorkerCount          int    `json:"worker_count,omitempty"`            // 默认 4
	LateNightMinMessages int64  `json:"late_night_min_messages,omitempty"` // 默认 100
	LateNightTopN        int    `json:"late_night_top_n,omitempty"`        // 默认 20
	DefaultInitFrom      int64  `json:"default_init_from,omitempty"`
	DefaultInitTo        int64  `json:"default_init_to,omitempty"`

	// 日志配置（支持热加载）
	LogLevel string `json:"log_level,omitempty"` // debug / info / warn / error，默认 info

	// 两种模式通用
	BlockedUsers  []string `json:"blocked_users"`
	BlockedGroups []string `json:"blocked_groups"`
	PrivacyMode   bool     `json:"privacy_mode,omitempty"`

	// 关系预测「不再推荐此人」名单（仍可在联系人/群聊中看到，只是首页 forecast 不再提醒）
	ForecastIgnored []string `json:"forecast_ignored,omitempty"`

	// LLM 配置（多 provider，支持在 AI 分析页面切换）
	LLMProfiles      []LLMProfile `json:"llm_profiles,omitempty"`
	// 以下单配置字段保持向后兼容（自动同步为 LLMProfiles[0]）
	LLMProvider      string `json:"llm_provider,omitempty"` // openai/deepseek/kimi/gemini/claude/grok/glm/ollama/custom
	LLMAPIKey        string `json:"llm_api_key,omitempty"`
	LLMBaseURL       string `json:"llm_base_url,omitempty"`
	LLMModel         string `json:"llm_model,omitempty"`
	AIAnalysisDBPath string `json:"ai_analysis_db_path,omitempty"` // 留空 = 与 preferences.json 同目录

	// Embedding 配置（向量检索，混合 RAG 模式使用）
	EmbeddingProvider string `json:"embedding_provider,omitempty"` // openai/jina/ollama/custom；默认 ollama
	EmbeddingAPIKey   string `json:"embedding_api_key,omitempty"`
	EmbeddingBaseURL  string `json:"embedding_base_url,omitempty"`
	EmbeddingModel    string `json:"embedding_model,omitempty"`
	EmbeddingDims     int    `json:"embedding_dims,omitempty"` // 0 = 由模型默认值决定

	// 向量检索缓存（内存）
	VecCacheMaxKeys int `json:"vec_cache_max_keys,omitempty"` // 最多缓存几个联系人的 embedding，0 = 默认 3

	// 记忆提炼模型（本地隐私专用，默认 Ollama）
	// 提炼时原始聊天内容只发给此模型，与主 LLM 配置隔离
	MemLLMBaseURL string `json:"mem_llm_base_url,omitempty"` // 默认 http://localhost:11434/v1
	MemLLMModel   string `json:"mem_llm_model,omitempty"`    // 默认 qwen2.5:7b

	// 自定义纪念日
	CustomAnniversaries []CustomAnniversary `json:"custom_anniversaries,omitempty"`

	// 自定义 Prompt 模板（key → prompt 文本，为空则用默认值）
	PromptTemplates map[string]string `json:"prompt_templates,omitempty"`

	// 导出中心：第三方笔记/文档平台令牌
	NotionToken      string `json:"notion_token,omitempty"`       // Notion Integration Token (secret_xxx)
	NotionParentPage string `json:"notion_parent_page,omitempty"` // 默认上传到的 Page ID（也可在导出时覆盖）
	FeishuAppID      string `json:"feishu_app_id,omitempty"`      // 飞书自建应用 App ID
	FeishuAppSecret  string `json:"feishu_app_secret,omitempty"`  // 飞书自建应用 App Secret
	FeishuFolderToken string `json:"feishu_folder_token,omitempty"` // 默认导入到的文件夹 Token（留空 = 我的空间根目录）

	// 导出中心：云盘 / 对象存储
	// WebDAV（坚果云 / Nextcloud / ownCloud / 群晖等）
	WebDAVURL      string `json:"webdav_url,omitempty"`      // 完整 URL，例 https://dav.jianguoyun.com/dav/
	WebDAVUsername string `json:"webdav_username,omitempty"`
	WebDAVPassword string `json:"webdav_password,omitempty"` // 应用密码
	WebDAVPath     string `json:"webdav_path,omitempty"`     // 上传前缀，例 WeLink-Export/

	// S3 兼容（AWS S3 / Cloudflare R2 / 阿里 OSS / 腾讯 COS / 七牛 / MinIO / Backblaze）
	S3Endpoint     string `json:"s3_endpoint,omitempty"`       // 主机名，空=AWS 官方；自定义端点用于国内云
	S3Region       string `json:"s3_region,omitempty"`
	S3Bucket       string `json:"s3_bucket,omitempty"`
	S3AccessKey    string `json:"s3_access_key,omitempty"`
	S3SecretKey    string `json:"s3_secret_key,omitempty"`
	S3PathPrefix   string `json:"s3_path_prefix,omitempty"`    // 上传前缀，例 welink-export/
	S3UsePathStyle bool   `json:"s3_use_path_style,omitempty"` // true=path-style（MinIO/R2），false=virtual-host（AWS 官方默认）

	// Dropbox（用 App Console 生成的长期 access token）
	DropboxToken string `json:"dropbox_token,omitempty"`
	DropboxPath  string `json:"dropbox_path,omitempty"` // 上传前缀，例 /Apps/WeLink/

	// Google Drive（OAuth 2.0，本地回调）
	GDriveClientID     string `json:"gdrive_client_id,omitempty"`
	GDriveClientSecret string `json:"gdrive_client_secret,omitempty"`
	GDriveAccessToken  string `json:"gdrive_access_token,omitempty"`
	GDriveRefreshToken string `json:"gdrive_refresh_token,omitempty"`
	GDriveTokenExpiry  int64  `json:"gdrive_token_expiry,omitempty"`
	GDriveFolderID     string `json:"gdrive_folder_id,omitempty"` // 留空=根目录

	// OneDrive（OAuth 2.0，Microsoft Identity Platform）
	OneDriveClientID     string `json:"onedrive_client_id,omitempty"`
	OneDriveClientSecret string `json:"onedrive_client_secret,omitempty"`
	OneDriveTenant       string `json:"onedrive_tenant,omitempty"` // 一般填 common
	OneDriveAccessToken  string `json:"onedrive_access_token,omitempty"`
	OneDriveRefreshToken string `json:"onedrive_refresh_token,omitempty"`
	OneDriveTokenExpiry  int64  `json:"onedrive_token_expiry,omitempty"`
	OneDriveFolderPath   string `json:"onedrive_folder_path,omitempty"` // 例 /WeLink-Export

	// Gemini OAuth（可选，与 API Key 二选一）
	GeminiClientID     string `json:"gemini_client_id,omitempty"`
	GeminiClientSecret string `json:"gemini_client_secret,omitempty"`
	GeminiAccessToken  string `json:"gemini_access_token,omitempty"`
	GeminiRefreshToken string `json:"gemini_refresh_token,omitempty"`
	GeminiTokenExpiry  int64  `json:"gemini_token_expiry,omitempty"` // Unix timestamp
}

// CustomAnniversary 用户自定义纪念日
type CustomAnniversary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Date      string `json:"date"`               // YYYY-MM-DD
	Recurring bool   `json:"recurring"`           // 每年重复
	Username  string `json:"username,omitempty"`   // 可选关联联系人
}

// preferencesPath 返回 preferences.json 的绝对路径。
// 优先级：环境变量 PREFERENCES_PATH > 默认路径。
func preferencesPath() string {
	if v := os.Getenv("PREFERENCES_PATH"); v != "" {
		return v
	}
	if hasFrontend {
		return filepath.Join(appPreferencesDir(), "preferences.json")
	}
	return "preferences.json"
}

// loadPreferences 从磁盘读取偏好；文件不存在时返回空结构体。
func loadPreferences() Preferences {
	data, err := os.ReadFile(preferencesPath())
	if err != nil {
		return defaultPreferences()
	}
	var p Preferences
	if err := json.Unmarshal(data, &p); err != nil {
		log.Printf("[PREFS] Failed to parse preferences.json: %v", err)
		return defaultPreferences()
	}
	if p.BlockedUsers == nil {
		p.BlockedUsers = []string{}
	}
	if p.BlockedGroups == nil {
		p.BlockedGroups = []string{}
	}
	// 运行迁移并按需写回。迁移只在版本落后时真正做事；就位时 0 开销。
	migrated := migratePreferences(p)
	if migrated.SchemaVersion != p.SchemaVersion {
		log.Printf("[PREFS] schema v%d → v%d 迁移完成", p.SchemaVersion, migrated.SchemaVersion)
		if err := savePreferences(migrated); err != nil {
			log.Printf("[PREFS] 迁移后写回失败，不影响运行：%v", err)
		}
	}
	return migrated
}

// defaultPreferences 返回带有最新 schema_version 的空配置（首次启动用）。
func defaultPreferences() Preferences {
	return Preferences{
		SchemaVersion: CurrentSchemaVersion,
		BlockedUsers:  []string{},
		BlockedGroups: []string{},
	}
}

// sanitizeForExport 返回用于导出的 Preferences 副本：
//   - 机器特定字段（绝对路径、数据目录列表）始终清空，因为换机器没法用
//   - stripSecrets=true 时，所有 API Key / OAuth token / 密码也清空
func sanitizeForExport(p Preferences, stripSecrets bool) Preferences {
	// 机器特定 —— 无论如何都清空
	p.DataDir = ""
	p.LogDir = ""
	p.DownloadDir = ""
	p.AIAnalysisDBPath = ""
	p.DataDirProfiles = nil

	if !stripSecrets {
		return p
	}

	// LLM / Embedding
	p.LLMAPIKey = ""
	p.EmbeddingAPIKey = ""
	for i := range p.LLMProfiles {
		p.LLMProfiles[i].APIKey = ""
	}

	// 云笔记
	p.NotionToken = ""
	p.FeishuAppSecret = ""

	// 对象存储
	p.WebDAVPassword = ""
	p.S3SecretKey = ""
	p.DropboxToken = ""

	// OAuth — client secret + 动态 token 一起清（token 单独留着没意义）
	p.GDriveClientSecret = ""
	p.GDriveAccessToken = ""
	p.GDriveRefreshToken = ""
	p.GDriveTokenExpiry = 0

	p.OneDriveClientSecret = ""
	p.OneDriveAccessToken = ""
	p.OneDriveRefreshToken = ""
	p.OneDriveTokenExpiry = 0

	p.GeminiClientSecret = ""
	p.GeminiAccessToken = ""
	p.GeminiRefreshToken = ""
	p.GeminiTokenExpiry = 0

	return p
}

// mergeImported 导入新配置时的合并策略：
//   - 非机器字段全部用 imported 覆盖（LLM / 偏好 / 凭证等）
//   - 机器特定字段保留当前值（新机器上为空，用户会被引导重选；老机器上已配好不丢）
func mergeImported(current, imported Preferences) Preferences {
	imported.DataDir = current.DataDir
	imported.LogDir = current.LogDir
	imported.DownloadDir = current.DownloadDir
	imported.AIAnalysisDBPath = current.AIAnalysisDBPath
	imported.DataDirProfiles = current.DataDirProfiles
	return imported
}

// migratePreferences 把老 schema 的 preferences 升到最新。每步 migration 只做
// "本版本加进来的破坏性改动"，按版本号 case-by-case。新加字段但 zero-value 兼容
// 的情况不需要在这里写东西；写在这里的都是语义翻转 / 字段合并 / 字段拆分之类。
func migratePreferences(p Preferences) Preferences {
	// v0 → v1：给第一次见到 schema_version 字段的老用户打版本号。
	// 目前还没有破坏性改动，这里只是落版本号，为将来升级预留入口。
	if p.SchemaVersion < 1 {
		p.SchemaVersion = 1
	}
	// 未来升级在这里加：
	// if p.SchemaVersion < 2 { ... ; p.SchemaVersion = 2 }
	// if p.SchemaVersion < 3 { ... ; p.SchemaVersion = 3 }
	return p
}

// effectiveConfig 返回合并了默认值和环境变量覆盖的 Preferences。
func effectiveConfig(p Preferences) Preferences {
	if p.Port == "" {
		p.Port = "8080"
	}
	if p.Timezone == "" {
		p.Timezone = "Asia/Shanghai"
	}
	if p.LateNightEndHour == 0 {
		p.LateNightEndHour = 5
	}
	if p.SessionGapSeconds == 0 {
		p.SessionGapSeconds = 21600
	}
	if p.WorkerCount == 0 {
		p.WorkerCount = 4
	}
	if p.LateNightMinMessages == 0 {
		p.LateNightMinMessages = 100
	}
	if p.LateNightTopN == 0 {
		p.LateNightTopN = 20
	}
	if p.LogLevel == "" {
		p.LogLevel = "info"
	}
	if p.GinMode == "" {
		p.GinMode = "debug"
	}
	// 环境变量覆盖
	if v := os.Getenv("DATA_DIR"); v != "" {
		p.DataDir = v
	}
	if v := os.Getenv("PORT"); v != "" {
		p.Port = v
	}
	return p
}

// hasKeyPlaceholder 是 API 响应中用于标记"已设置 key"的占位符。
// 前端看到此值 → 显示"已保存"提示；保存时传回此值或空 → 后端保留原值。
const hasKeyPlaceholder = "__HAS_KEY__"

// sanitizeForResponse 返回去除敏感字段的 Preferences 副本，用于 API 响应。
// API Key 不返回脱敏值，只返回占位符标记是否已设置。
func sanitizeForResponse(p Preferences) Preferences {
	redact := func(s string) string {
		if s == "" { return "" }
		return hasKeyPlaceholder
	}
	out := p
	out.LLMAPIKey = redact(out.LLMAPIKey)
	out.EmbeddingAPIKey = redact(out.EmbeddingAPIKey)
	out.GeminiClientSecret = redact(out.GeminiClientSecret)
	out.GeminiAccessToken = ""
	out.GeminiRefreshToken = ""
	out.NotionToken = redact(out.NotionToken)
	out.FeishuAppSecret = redact(out.FeishuAppSecret)
	out.WebDAVPassword = redact(out.WebDAVPassword)
	out.S3SecretKey = redact(out.S3SecretKey)
	out.DropboxToken = redact(out.DropboxToken)
	out.GDriveClientSecret = redact(out.GDriveClientSecret)
	out.GDriveAccessToken = ""
	out.GDriveRefreshToken = ""
	out.OneDriveClientSecret = redact(out.OneDriveClientSecret)
	out.OneDriveAccessToken = ""
	out.OneDriveRefreshToken = ""
	if len(out.LLMProfiles) > 0 {
		sanitized := make([]LLMProfile, len(out.LLMProfiles))
		copy(sanitized, out.LLMProfiles)
		for i := range sanitized {
			sanitized[i].APIKey = redact(sanitized[i].APIKey)
		}
		out.LLMProfiles = sanitized
	}
	return out
}

// savePreferences 将偏好写入磁盘。
func savePreferences(p Preferences) error {
	path := preferencesPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
