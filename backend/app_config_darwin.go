//go:build app && darwin

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// appPreferencesDir 返回 macOS 上持久化偏好文件所在目录。
func appPreferencesDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "WeLink")
}

// demoDataDir 返回 App 模式演示数据的固定目录。
func demoDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "WeLink", "demo")
}

// defaultLogDir 返回 App 模式默认日志目录（LogDir 为空时的 fallback）。
func defaultLogDir() string {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, "Library", "Logs", "WeLink")
	os.MkdirAll(dir, 0700)
	return dir
}

// loadAppConfig 读取持久化配置中的 App 配置部分。
// DemoMode=true 时 DataDir 可以为空，视为有效配置。
func loadAppConfig() (*Preferences, bool) {
	p := loadPreferences()
	if p.DataDir == "" && !p.DemoMode {
		return nil, false
	}
	return &p, true
}

// saveAppConfig 将 App 配置写入磁盘，保留已有的黑名单等偏好字段。
func saveAppConfig(cfg *Preferences) error {
	// 读取现有偏好，只更新 App 配置字段，避免覆盖黑名单
	existing := loadPreferences()
	existing.DataDir = cfg.DataDir
	existing.LogDir = cfg.LogDir
	existing.DemoMode = cfg.DemoMode
	if err := savePreferences(existing); err != nil {
		return fmt.Errorf("save preferences: %w", err)
	}
	return nil
}

// setupLogFile 将日志输出重定向到指定目录下的 welink.log。
// 同时重定向 Gin 的请求日志（DefaultWriter / DefaultErrorWriter）。
func setupLogFile(logDir string) {
	if logDir == "" {
		logDir = defaultLogDir()
	}
	if logDir == "" {
		return
	}
	if err := os.MkdirAll(logDir, 0700); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(logDir, "welink.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	// 把 slog（含 std log 桥接）切到文件
	InitObs(f, false)
	// Gin 请求日志 + 错误日志（Gin 不走 slog，单独指过去）
	gin.DefaultWriter = f
	gin.DefaultErrorWriter = f
	log.Printf("日志已重定向到 %s", filepath.Join(logDir, "welink.log"))
}

// browseFolder 通过 osascript 弹出系统文件夹选择器，返回所选路径。
func browseFolder(prompt string) (string, error) {
	// 转义 AppleScript 字符串中的特殊字符，防止注入
	safe := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(prompt)
	script := fmt.Sprintf(`POSIX path of (choose folder with prompt "%s")`, safe)
	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return "", fmt.Errorf("cancelled")
	}
	return strings.TrimSpace(string(out)), nil
}

// revealInFileManager 在 Finder 中定位文件（open -R 会打开 Finder 并选中目标）。
func revealInFileManager(path string) error {
	return exec.Command("open", "-R", path).Start()
}

// restartApp 启动当前可执行文件的新实例，然后退出当前进程。
func restartApp() {
	exe, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Start() //nolint:errcheck
	os.Exit(0)
}
