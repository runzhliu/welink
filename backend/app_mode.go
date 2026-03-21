//go:build app

package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	webview "github.com/webview/webview_go"
)

// openURL 用系统默认浏览器打开外部 URL（仅允许 https 协议）。
func openURL(url string) error {
	if !strings.HasPrefix(url, "https://") {
		return nil
	}
	return exec.Command("open", url).Start()
}

// macOS GUI (WKWebView / AppKit) must run on the main OS thread.
// LockOSThread in init() pins the main goroutine to thread-1 before
// any other goroutine is spawned, satisfying this requirement.
func init() {
	runtime.LockOSThread()
}

// serverPortCh receives the port string once the HTTP server is ready to accept connections.
var serverPortCh = make(chan string, 1)

// signalServerReady is called by serverMain() once Gin is listening.
func signalServerReady(port string) {
	serverPortCh <- port
}

// startApp creates the WKWebView window on the main thread immediately —
// before any DB or server work — so macOS doesn't report "not responding".
// It shows a loading screen until the server signals readiness.
func startApp() {
	w := webview.New(false)
	defer w.Destroy()

	// 添加标准 macOS Application/Edit 菜单（提供 Cmd+Q、Cmd+C 等系统级快捷键）
	setupNativeMenu()

	w.SetTitle("WeLink — 微信聊天数据分析")
	w.SetSize(1440, 900, webview.HintNone)

	// Show a native-looking loading screen right away
	w.SetHtml(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #1d1d1f;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh;
    font-family: -apple-system, "PingFang SC", sans-serif;
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

	// Cmd+Q / Ctrl+Q → 正常退出
	w.Bind("__welinkQuit", func() { os.Exit(0) })
	w.Init(`document.addEventListener('keydown', function(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'q') {
			if (window.__welinkQuit) window.__welinkQuit();
		}
	});`)

	// Wait for server in background, then navigate
	go func() {
		port := <-serverPortCh
		waitForServer(port)
		w.Dispatch(func() {
			w.Navigate("http://localhost:" + port)
			// 导航后窗口已就绪，开启全屏支持
			enableWindowFullScreen()
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

// appDataDir returns the decrypted/ directory sitting next to WeLink.app, if present.
func appDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	// WeLink.app/Contents/MacOS/WeLink → ../../.. → folder containing WeLink.app
	appParent := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	candidate := filepath.Join(appParent, "decrypted")
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		return candidate
	}
	return ""
}
