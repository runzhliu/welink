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

	// 启动加载页
	w.SetHtml(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #1d1d1f;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #fff;
    gap: 20px;
  }
  .dot-row { display:flex; gap:10px; }
  .dot {
    width:10px; height:10px; border-radius:50%;
    background:#07c160;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay:.2s; }
  .dot:nth-child(3) { animation-delay:.4s; }
  @keyframes pulse {
    0%,100% { opacity:.2; transform:scale(.8); }
    50%      { opacity:1;  transform:scale(1.2); }
  }
  p { font-size:15px; color:#888; }
</style></head><body>
  <div class="dot-row"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <p>WeLink 正在启动…</p>
</body></html>`)

	// 后台等待服务器就绪后跳转
	go func() {
		port := <-serverPortCh
		waitForServer(port)
		w.Dispatch(func() {
			w.Navigate("http://localhost:" + port)
		})
	}()

	w.Run()
	os.Exit(0)
}

// waitForServer polls /api/health until the server is up (up to 30 s).
func waitForServer(port string) {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	for range 75 {
		if resp, err := client.Get("http://localhost:" + port + "/api/health"); err == nil {
			resp.Body.Close()
			return
		}
		time.Sleep(400 * time.Millisecond)
	}
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
