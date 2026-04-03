package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

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
type Preferences struct {
	// App 模式专用
	DataDir  string `json:"data_dir,omitempty"`
	LogDir   string `json:"log_dir,omitempty"`
	DemoMode bool   `json:"demo_mode,omitempty"`

	// 两种模式通用
	BlockedUsers  []string `json:"blocked_users"`
	BlockedGroups []string `json:"blocked_groups"`
	PrivacyMode   bool     `json:"privacy_mode,omitempty"`

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
		return Preferences{}
	}
	var p Preferences
	if err := json.Unmarshal(data, &p); err != nil {
		log.Printf("[PREFS] Failed to parse preferences.json: %v", err)
		return Preferences{}
	}
	if p.BlockedUsers == nil {
		p.BlockedUsers = []string{}
	}
	if p.BlockedGroups == nil {
		p.BlockedGroups = []string{}
	}
	return p
}

// sanitizeForResponse 返回去除敏感字段的 Preferences 副本，用于 API 响应。
func sanitizeForResponse(p Preferences) Preferences {
	mask := func(s string) string {
		if len(s) <= 4 {
			return "****"
		}
		return s[:2] + "****" + s[len(s)-2:]
	}
	out := p
	if out.LLMAPIKey != "" {
		out.LLMAPIKey = mask(out.LLMAPIKey)
	}
	if out.EmbeddingAPIKey != "" {
		out.EmbeddingAPIKey = mask(out.EmbeddingAPIKey)
	}
	if out.GeminiClientSecret != "" {
		out.GeminiClientSecret = mask(out.GeminiClientSecret)
	}
	out.GeminiAccessToken = ""
	out.GeminiRefreshToken = ""
	// LLMProfiles 中的 APIKey 也需要脱敏
	if len(out.LLMProfiles) > 0 {
		sanitized := make([]LLMProfile, len(out.LLMProfiles))
		copy(sanitized, out.LLMProfiles)
		for i := range sanitized {
			if sanitized[i].APIKey != "" {
				sanitized[i].APIKey = mask(sanitized[i].APIKey)
			}
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
