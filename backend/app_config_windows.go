//go:build app && windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// appPreferencesDir 返回 Windows 上持久化偏好文件所在目录。
func appPreferencesDir() string {
	return filepath.Join(os.Getenv("APPDATA"), "WeLink")
}

// demoDataDir 返回 App 模式演示数据的固定目录。
func demoDataDir() string {
	return filepath.Join(os.Getenv("APPDATA"), "WeLink", "demo")
}

// loadAppConfig 读取持久化配置中的 App 配置部分。
func loadAppConfig() (*Preferences, bool) {
	p := loadPreferences()
	if p.DataDir == "" && !p.DemoMode {
		return nil, false
	}
	return &p, true
}

// saveAppConfig 将 App 配置写入磁盘，保留已有的黑名单等偏好字段。
func saveAppConfig(cfg *Preferences) error {
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
func setupLogFile(logDir string) {
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
	log.SetOutput(f)
	log.Printf("日志已重定向到 %s/welink.log", logDir)
}

// browseFolder 通过 PowerShell 弹出系统文件夹选择器，返回所选路径。
// 使用 -Sta 确保 Windows Forms 对话框可在单线程 COM 公寓中正常弹出。
func browseFolder(prompt string) (string, error) {
	safe := strings.ReplaceAll(prompt, "'", "''")
	script := "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; " +
		"$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; " +
		"$dlg.Description = '" + safe + "'; " +
		"$dlg.ShowNewFolderButton = $true; " +
		"if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }"
	out, err := exec.Command(
		"powershell", "-Sta", "-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return "", fmt.Errorf("cancelled")
	}
	return strings.TrimSpace(string(out)), nil
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
