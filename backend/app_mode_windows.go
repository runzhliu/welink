//go:build app && windows

package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	webview "github.com/jchv/go-webview2"
)

// appVersion 由 Makefile 通过 -ldflags "-X main.appVersion=x.y.z" 注入。
var appVersion = "dev"

// openURL 用系统默认浏览器打开外部 URL（仅允许 https 协议）。
func openURL(url string) error {
	if !strings.HasPrefix(url, "https://") {
		return nil
	}
	return exec.Command("cmd", "/c", "start", url).Start()
}

// serverPortCh receives the port string once the HTTP server is ready to accept connections.
var serverPortCh = make(chan string, 1)

// signalServerReady is called by serverMain() once Gin is listening.
func signalServerReady(port string) {
	serverPortCh <- port
}

// startApp creates the WebView2 window and blocks until the window is closed.
func startApp() {
	w := webview.NewWithOptions(webview.WebViewOptions{
		Debug:  false,
		Window: nil,
	})
	if w == nil {
		showFatalDialog("WeLink 启动失败", "无法初始化 WebView2。\n\n请确认已安装 Microsoft Edge WebView2 Runtime：\nhttps://developer.microsoft.com/microsoft-edge/webview2/")
		os.Exit(1)
	}
	defer w.Destroy()

	w.SetTitle("WeLink — 微信聊天数据分析")
	w.SetSize(1440, 900, webview.HintNone)

	// 启动加载页（浅色背景，支持暗色模式）
	w.SetHtml(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #f8f9fb;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #1d1d1f;
    gap: 16px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1e; color: #e0e0e0; }
    .subtitle { color: #666 !important; }
    .status { color: #555 !important; }
  }
  .logo { width: 64px; height: 64px; box-shadow: 0 8px 24px rgba(7, 193, 96, 0.2); }
  .title { font-size: 24px; font-weight: 900; }
  .subtitle { font-size: 14px; color: #999; }
  .dot-row { display: flex; gap: 8px; margin-top: 8px; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #07c160;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: .2s; }
  .dot:nth-child(3) { animation-delay: .4s; }
  @keyframes pulse {
    0%,100% { opacity: .2; transform: scale(.8); }
    50%     { opacity: 1;  transform: scale(1.2); }
  }
  .status { font-size: 13px; color: #aaa; margin-top: 4px; }
  .error { color: #fa5151; font-size: 13px; margin-top: 12px; max-width: 500px; text-align: center; line-height: 1.6; display: none; }
</style></head><body>
  <div class="logo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
      <rect width="32" height="32" rx="7" fill="#07c160"/>
      <g transform="translate(6, 6)">
        <rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/>
        <line x1="5" y1="6" x2="15" y2="6" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="5" y1="10" x2="12" y2="10" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
        <polyline points="3,15 1,20 6,17" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/>
      </g>
    </svg>
  </div>
  <div class="title">WeLink</div>
  <div class="subtitle">微信聊天数据分析</div>
  <div class="dot-row"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <div class="status" id="status">正在启动服务…</div>
  <div class="error" id="error"></div>
</body></html>`)

	// 后台等待服务器就绪后跳转
	go func() {
		port := <-serverPortCh
		w.Dispatch(func() {
			w.Eval(`document.getElementById('status').textContent = '正在初始化数据库…'`)
		})
		ok := waitForServer(port)
		if !ok {
			w.Dispatch(func() {
				w.Eval(`document.getElementById('status').textContent = '启动超时'`)
				w.Eval(`var e = document.getElementById('error'); e.style.display='block'; e.textContent = '服务启动超时（30秒），请检查 decrypted 数据目录是否存在。'`)
			})
			time.Sleep(2 * time.Second)
		}
		w.Dispatch(func() {
			w.Navigate("http://localhost:" + port)
		})
	}()

	w.Run()
	os.Exit(0)
}

// waitForServer polls /api/health until the server is up (up to 30 s). Returns false on timeout.
func waitForServer(port string) bool {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	for range 75 {
		if resp, err := client.Get("http://localhost:" + port + "/api/health"); err == nil {
			resp.Body.Close()
			return true
		}
		time.Sleep(400 * time.Millisecond)
	}
	return false
}

// appDataDir returns the decrypted/ directory sitting next to WeLink.exe, if present.
func appDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	candidate := filepath.Join(filepath.Dir(exe), "decrypted")
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		return candidate
	}
	return ""
}

// setupNativeMenu is a no-op on Windows; WebView2 has no native menu system.
func setupNativeMenu() {}

// enableWindowFullScreen is a no-op on Windows.
func enableWindowFullScreen() {}

// showFatalDialog displays a blocking error message box via PowerShell when WebView2 is missing.
func showFatalDialog(title, msg string) {
	safeTitle := strings.ReplaceAll(title, "'", "''")
	safeMsg := strings.ReplaceAll(msg, "'", "''")
	script := "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; " +
		"[System.Windows.Forms.MessageBox]::Show('" + safeMsg + "', '" + safeTitle + "', " +
		"[System.Windows.Forms.MessageBoxButtons]::OK, " +
		"[System.Windows.Forms.MessageBoxIcon]::Error)"
	exec.Command("powershell", "-Sta", "-NoProfile", "-NonInteractive", "-Command", script).Run() //nolint:errcheck
}
