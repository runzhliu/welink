package main

// demo_guard.go — Demo 模式安全防护
//
// DEMO_MODE=true 时启用以下保护：
//  1. 禁止修改 LLM/Embedding 配置（防止 SSRF / API key 滥用）
//  2. 禁止调用 /databases/:dbName/query 原始 SQL 接口
//  3. Avatar 代理限制只允许白名单域名（防止 SSRF 探内网）
//  4. 全局限速：同一 IP 每秒最多 20 个请求（防止暴力刷接口）

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// errDemoPrivateURL 在 Demo 模式下拦截指向内网的 baseURL 时返回。
var errDemoPrivateURL = errors.New("demo 模式下不允许访问内网地址")

// ── 1. 禁止写入 LLM 配置 ────────────────────────────────────────────────────

// demoModeEnabled 返回是否处于 Demo 模式（DEMO_MODE=true）。
// 与 main() 里的 isDemoMode 取同一环境变量，供 llm.go / embedding.go 等包级函数
// 判断是否要对用户自配的 baseURL 做 SSRF 校验（本地自托管部署不限制，否则会拦掉 Ollama）。
func demoModeEnabled() bool {
	return os.Getenv("DEMO_MODE") == "true"
}

// guardOutboundURL 对将要由服务端发起请求的「用户可配 URL」做安全校验。
// 仅在 Demo 模式启用：拒绝指向内网/环回的地址，防止公开 demo 被用作 SSRF 跳板
// （探云元数据 169.254.169.254、内网服务等）。本地/自托管部署不限制——
// 那里指向 localhost:11434(Ollama) 等私网地址是正常用法，且攻击者已在本机。
func guardOutboundURL(rawURL string) error {
	if !demoModeEnabled() {
		return nil
	}
	if isPrivateURL(rawURL) {
		return errDemoPrivateURL
	}
	return nil
}

// DemoAIDisabled 返回 Demo 模式下是否禁用 AI 配置。
// Demo 默认不允许改 AI 配置（所有功能走预置的 mock 数据），
// 需显式设置 DEMO_DISABLE_AI=false 才打开配置入口。
func DemoAIDisabled() bool {
	v := strings.TrimSpace(os.Getenv("DEMO_DISABLE_AI"))
	if v == "" {
		return true
	}
	return !strings.EqualFold(v, "false")
}

// demoBlockLLMWrite 在 DEMO_MODE + DEMO_DISABLE_AI 下拒绝 AI 配置写入。
func demoBlockLLMWrite(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{"error": "Demo 模式下不允许修改 AI 配置"})
	c.Abort()
}

// demoBlockRawSQL 在 DEMO_MODE 下拒绝原始 SQL 查询接口。
func demoBlockRawSQL(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{"error": "Demo 模式下不允许执行原始 SQL"})
	c.Abort()
}

// The public demo is a shared instance, not a private training or backup space.
// In particular, never accept uploaded SFT data or expose worker credentials
// there, even if a client supplies forged loopback Origin/Referer headers.
func demoPublicSafety(c *gin.Context) {
	path := c.Request.URL.Path
	if path == "/api/sft" || strings.HasPrefix(path, "/api/sft/") || strings.HasPrefix(path, "/api/sft-") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "公开 Demo 仅展示训练流程，不支持上传训练数据或连接训练环境；请在自己的 WeLink 中使用 SFT。"})
		return
	}
	if path == "/api/preferences/export" || path == "/api/preferences/import" || path == "/api/preferences/reset" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "公开 Demo 不支持导出、导入或重置配置。"})
		return
	}
	c.Next()
}

// ── 2. Avatar 域名白名单 ─────────────────────────────────────────────────────

// avatarAllowedHosts 只允许这些域名通过 /api/avatar 代理，防止 SSRF 探内网。
var avatarAllowedHosts = []string{
	"upload.wikimedia.org",
	"thispersondoesnotexist.com",
	"i.pravatar.cc",
	"avatars.githubusercontent.com",
	"lh3.googleusercontent.com",
	"wx.qlogo.cn",
}

// demoAvatarURLAllowed 检查 URL 是否在白名单域名内。
func demoAvatarURLAllowed(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, allowed := range avatarAllowedHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

// ── 3. SSRF 防护：阻止请求内网地址 ────────────────────────────────────────────

// isPrivateURL 检查 URL 是否指向私有/内网地址。
func isPrivateURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return true // 解析失败视为不安全
	}
	host := u.Hostname()
	// 阻止常见内网地址
	if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false // 域名，允许
	}
	// RFC 1918 + 链路本地 + 环回
	privateRanges := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"169.254.0.0/16", "127.0.0.0/8", "::1/128", "fc00::/7",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network != nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

// ── 4. 全局限速（令牌桶，按 IP） ────────────────────────────────────────────

const (
	rateLimitPerSec = 20 // 每秒允许的最大请求数
	rateLimitBurst  = 40 // 突发上限
	rateLimitClean  = 5  // 过期条目清理间隔（分钟）
)

type tokenBucket struct {
	tokens    float64
	lastRefil time.Time
}

var (
	rateMu      sync.Mutex
	rateBuckets = make(map[string]*tokenBucket)
)

func init() {
	// 定期清理长时间不活跃的 IP 条目，防止内存无限增长
	go func() {
		ticker := time.NewTicker(rateLimitClean * time.Minute)
		for range ticker.C {
			cutoff := time.Now().Add(-10 * time.Minute)
			rateMu.Lock()
			for ip, b := range rateBuckets {
				if b.lastRefil.Before(cutoff) {
					delete(rateBuckets, ip)
				}
			}
			rateMu.Unlock()
		}
	}()
}

// demoRateLimit 是 Gin 中间件：Demo 模式下对每个来源 IP 做限速。
func demoRateLimit(c *gin.Context) {
	ip := realClientIP(c)

	rateMu.Lock()
	b, ok := rateBuckets[ip]
	if !ok {
		b = &tokenBucket{tokens: rateLimitBurst, lastRefil: time.Now()}
		rateBuckets[ip] = b
	}
	// 补充令牌（令牌桶算法）
	now := time.Now()
	elapsed := now.Sub(b.lastRefil).Seconds()
	b.tokens += elapsed * rateLimitPerSec
	if b.tokens > rateLimitBurst {
		b.tokens = rateLimitBurst
	}
	b.lastRefil = now

	allowed := b.tokens >= 1
	if allowed {
		b.tokens--
	}
	rateMu.Unlock()

	if !allowed {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
		c.Abort()
		return
	}
	c.Next()
}

// realClientIP 优先取 X-Forwarded-For / X-Real-IP（经过 nginx 反代时有效），
// 否则取直连 RemoteAddr。
func realClientIP(c *gin.Context) string {
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		// XFF 可能是逗号分隔列表，取第一个（最原始客户端）
		if idx := strings.IndexByte(xff, ','); idx != -1 {
			xff = xff[:idx]
		}
		xff = strings.TrimSpace(xff)
		if xff != "" {
			return xff
		}
	}
	if xri := c.GetHeader("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}
