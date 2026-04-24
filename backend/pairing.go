package main

// pairing.go — 移动端配对：让手机 App 安全地远程连 PC 上的 WeLink 后端
//
// 威胁模型：WeLink 本来只听 127.0.0.1，现在为了让局域网里的 Android
// 访问必须开 0.0.0.0 端口。家里的路由器有人能接入（同事/访客）就能
// 扫到这个 :3418，没有任何鉴权的话对方能看到所有聊天统计 / AI 分析
// 历史。所以：
//
// 1. 用户在 PC 设置页「启用移动端配对」→ 后端生成 32 字节随机 token
//    存到 preferences.MobilePairingToken
// 2. PC 把 http://<局域网IP>:3418/?token=<token> 显示为二维码
// 3. 手机扫码 → 前端取 ?token=xxx 存 localStorage；之后所有 axios
//    请求 header 带上 Authorization: Bearer <token>
// 4. 后端中间件：开启配对后，非同源请求必须带正确 token；同源请求
//    （PC 端 webview / 浏览器访问自己）直接放行保持体验
//
// 没启用配对 = 行为完全不变（向后兼容现有部署）。

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// ── token 生成 / 读取 ─────────────────────────────────────────────────────────

// generatePairingToken 生成 32 字节随机 token，hex 编码 = 64 字符。
func generatePairingToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// currentPairingToken 从 preferences 读当前 token；空串表示未启用。
func currentPairingToken() string {
	return strings.TrimSpace(loadPreferences().MobilePairingToken)
}

// ── 鉴权中间件 ────────────────────────────────────────────────────────────────

// requirePairingTokenIfEnabled 是 Gin 中间件：
//   - 配对未启用（token 为空）→ 放行（向后兼容）
//   - 启用后 → 严格鉴权：loopback 连接 / 浏览器同源 / 带正确 token 三选一
//
// 为什么要加"浏览器同源"：Docker 部署下 backend 看到的 RemoteAddr 是 nginx
// 容器的 IP（不是 loopback），如果只信 TCP loopback，PC 本机浏览器通过
// localhost:3418 访问也会全 401。
//
// 同源检查用 **url.Parse 后 exact host match** 而不是 strings.HasPrefix，
// 避免 "http://localhost.attacker.com" 这类子域名绕过。只认 localhost /
// 127.0.0.1 / ::1 三个值，不放开 .local / 局域网 IP（那些仍需 token）。
func requirePairingTokenIfEnabled(c *gin.Context) {
	tok := currentPairingToken()
	if tok == "" {
		c.Next()
		return
	}

	// 仅 pairing verify 握手端点允许未鉴权 —— 手机扫码后第一步要用它校验 token。
	// /app/info 原来也在白名单里，现在移除：启用配对后必须鉴权才能看到任何敏感字段。
	if c.Request.URL.Path == "/api/app/pairing/verify" {
		c.Next()
		return
	}

	if isLoopbackRequest(c.Request) {
		c.Next()
		return
	}

	if isSameOriginBrowserRequest(c.Request) {
		c.Next()
		return
	}

	got := extractToken(c.Request)
	if got == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "移动端配对已启用，需要 token"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(tok)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token 不匹配"})
		return
	}
	c.Next()
}

// isLoopbackRequest 判断请求来自本机 loopback 连接。只信 TCP RemoteAddr
// —— Go net/http 填入，调用方伪造不了。
func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// isSameOriginBrowserRequest 判断请求的 Origin / Referer 指向本机 loopback。
// 用 url.Parse 精确取 hostname，杜绝 HasPrefix 导致的 "localhost.attacker.com"
// 绕过。只认 localhost / 127.0.0.1 / ::1，mDNS / LAN IP 一律不信任。
func isSameOriginBrowserRequest(r *http.Request) bool {
	for _, h := range []string{"Origin", "Referer"} {
		v := r.Header.Get(h)
		if v == "" {
			continue
		}
		u, err := url.Parse(v)
		if err != nil {
			continue
		}
		host := strings.ToLower(u.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			return true
		}
	}
	return false
}

// hasValidPairingToken 判断请求是否带了正确的 pairing token（未启用时始终返回 false）。
// 用于 /api/app/info 这种默认放行、但想对"已鉴权用户"额外返回敏感字段的端点。
func hasValidPairingToken(r *http.Request) bool {
	tok := currentPairingToken()
	if tok == "" {
		return false
	}
	got := extractToken(r)
	if got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(tok)) == 1
}

func extractToken(r *http.Request) string {
	// Authorization: Bearer <token>
	if h := r.Header.Get("Authorization"); h != "" {
		if strings.HasPrefix(h, "Bearer ") {
			return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
	}
	// 兼容 X-WeLink-Token 便于前端 fetch 手写
	if h := r.Header.Get("X-WeLink-Token"); h != "" {
		return strings.TrimSpace(h)
	}
	// 注意：曾经接受 ?token=xxx 做首次扫码，但 query 会落到：
	//   - 访问日志（Docker stdout / nginx log）
	//   - 浏览器历史
	//   - Referer 头泄露给外部资源
	// 所以现在**不再**从 URL 读 token。前端扫码后只把 query 里的 token 读到
	// localStorage 并立即 history.replaceState 抹掉，之后用 header 发送。
	return ""
}

// ── 局域网 IP 嗅探 ────────────────────────────────────────────────────────────

// detectLANIPs 返回本机所有非回环的 IPv4 地址，给前端渲染二维码用。
// 用户多网卡时给多个候选让他选。
func detectLANIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var out []string
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		ip := ipnet.IP.To4()
		if ip == nil {
			continue
		}
		out = append(out, ip.String())
	}
	return out
}

// ── 端点 ──────────────────────────────────────────────────────────────────────

func registerPairingRoutes(api *gin.RouterGroup) {
	// GET /api/app/pairing/status — 当前是否启用 + token（供 PC 端展示二维码）
	// 同源才能看到 token；外部即使带了对的 token 也只返回 enabled=true
	api.GET("/app/pairing/status", func(c *gin.Context) {
		tok := currentPairingToken()
		enabled := tok != ""
		resp := gin.H{"enabled": enabled}
		if enabled && isLoopbackRequest(c.Request) {
			resp["token"] = tok
			resp["lan_ips"] = detectLANIPs()
		}
		c.JSON(http.StatusOK, resp)
	})

	// POST /api/app/pairing/enable — 开启配对，生成新 token
	api.POST("/app/pairing/enable", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) {
			c.JSON(http.StatusForbidden, gin.H{"error": "只能在 PC 本机开启"})
			return
		}
		p := loadPreferences()
		p.MobilePairingToken = generatePairingToken()
		if err := savePreferences(p); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"enabled": true,
			"token":   p.MobilePairingToken,
			"lan_ips": detectLANIPs(),
		})
	})

	// POST /api/app/pairing/disable — 关闭并清空 token（之前配过的手机全失效）
	api.POST("/app/pairing/disable", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) {
			c.JSON(http.StatusForbidden, gin.H{"error": "只能在 PC 本机关闭"})
			return
		}
		p := loadPreferences()
		p.MobilePairingToken = ""
		if err := savePreferences(p); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"enabled": false})
	})

	// POST /api/app/pairing/regen — 换新 token（老手机会失效，需要重新扫码）
	api.POST("/app/pairing/regen", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) {
			c.JSON(http.StatusForbidden, gin.H{"error": "只能在 PC 本机重新生成"})
			return
		}
		p := loadPreferences()
		p.MobilePairingToken = generatePairingToken()
		if err := savePreferences(p); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"enabled": true,
			"token":   p.MobilePairingToken,
			"lan_ips": detectLANIPs(),
		})
	})

	// POST /api/app/pairing/verify — 手机 App 拿着 token 探活，验证 OK 再存本地
	//   这个端点在白名单里（未带 token 也能访问），但需要 body 传 token
	api.POST("/app/pairing/verify", func(c *gin.Context) {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "token 必传"})
			return
		}
		tok := currentPairingToken()
		if tok == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "该服务未启用配对"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(body.Token), []byte(tok)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 不匹配"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "version": appVersion})
	})
}
