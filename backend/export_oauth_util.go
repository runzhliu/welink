package main

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// oauthPublicURL 返回 OAuth 回调使用的 base URL（无末尾斜杠）。
//
// 优先级：
//  1. 环境变量 WELINK_PUBLIC_URL（供反代场景显式指定，例如 https://welink.example.com）
//  2. 默认 http://127.0.0.1:<prefs.Port>
//
// 注意：过去该函数读 X-Forwarded-Proto / X-Forwarded-Host 来适配反代，
// 但这些 header 完全由请求方控制——局域网/恶意浏览器页面可伪造它们，
// 让授权服务器把 code 回传到攻击者的域名。现已改为仅信任服务端配置。
func oauthPublicURL() string {
	if v := strings.TrimRight(os.Getenv("WELINK_PUBLIC_URL"), "/"); v != "" {
		return v
	}
	port := loadPreferences().Port
	if port == "" {
		port = "8080"
	}
	return "http://127.0.0.1:" + port
}

// oauthRedirectURI 拼接完整回调 URL。保留 *gin.Context 参数仅为 API 兼容，
// 不再读取任何请求头。
func oauthRedirectURI(_ *gin.Context, path string) string {
	return oauthPublicURL() + path
}

// ─── OAuth state store — 防 CSRF ──────────────────────────────────────────
//
// 无 state 的 OAuth 回调允许攻击者诱导受害者浏览器 GET
//   /api/export/oauth/gdrive/callback?code=ATTACKER_CODE
// 从而把攻击者自己账号的 refresh token 写入受害者 preferences.json，
// 让后续所有导出默默上传到攻击者的 Drive。
//
// 本模块提供一次性、有 TTL 的随机 state：
//  - Start handler 调 newOAuthState() 生成并写入 URL 的 state 参数
//  - Callback handler 调 validateOAuthState() 校验并删除；失败即拒绝

const oauthStateTTL = 30 * time.Minute

var oauthStates sync.Map // key: state(string), value: expireAt(time.Time)

// newOAuthState 生成 32 字节 crypto/rand 的 state 并记录过期时间。
func newOAuthState() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	s := base64.RawURLEncoding.EncodeToString(buf[:])
	oauthStates.Store(s, time.Now().Add(oauthStateTTL))
	return s, nil
}

// validateOAuthState 校验 state 是否存在且未过期，并消费掉（一次性）。
func validateOAuthState(s string) bool {
	if s == "" {
		return false
	}
	v, ok := oauthStates.LoadAndDelete(s)
	if !ok {
		return false
	}
	exp, ok := v.(time.Time)
	if !ok {
		return false
	}
	return time.Now().Before(exp)
}
