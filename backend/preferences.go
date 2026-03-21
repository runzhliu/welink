package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

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
}

// preferencesPath 返回 preferences.json 的绝对路径。
// 优先级：环境变量 PREFERENCES_PATH > 默认路径。
func preferencesPath() string {
	if v := os.Getenv("PREFERENCES_PATH"); v != "" {
		return v
	}
	if hasFrontend {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "WeLink", "preferences.json")
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
