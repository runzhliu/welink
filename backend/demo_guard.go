package main

// demo_guard.go — Demo 模式安全防护
//
// DEMO_MODE=true 时启用以下保护：
//  1. 禁止修改 LLM/Embedding 配置（防止 SSRF / API key 滥用）
//  2. 禁止调用 /databases/:dbName/query 原始 SQL 接口
//  3. Avatar 代理限制只允许白名单域名（防止 SSRF 探内网）
//  4. 全局限速：同一 IP 每秒最多 20 个请求（防止暴力刷接口）

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ── 1. 禁止写入 LLM 配置 ────────────────────────────────────────────────────

// demoBlockLLMWrite 在 DEMO_MODE 下拒绝 PUT /preferences/llm 等配置写入。
func demoBlockLLMWrite(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{"error": "Demo 模式下不允许修改 AI 配置"})
	c.Abort()
}

// demoBlockRawSQL 在 DEMO_MODE 下拒绝原始 SQL 查询接口。
func demoBlockRawSQL(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{"error": "Demo 模式下不允许执行原始 SQL"})
	c.Abort()
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

// ── 3. 全局限速（令牌桶，按 IP） ────────────────────────────────────────────

const (
	rateLimitPerSec = 20   // 每秒允许的最大请求数
	rateLimitBurst  = 40   // 突发上限
	rateLimitClean  = 5    // 过期条目清理间隔（分钟）
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
