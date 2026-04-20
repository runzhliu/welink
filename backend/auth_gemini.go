package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const (
	geminiOAuthScope     = "https://www.googleapis.com/auth/generative-language"
	geminiAuthEndpoint   = "https://accounts.google.com/o/oauth2/v2/auth"
	geminiTokenEndpoint  = "https://oauth2.googleapis.com/token"
)

// geminiAuthURL 构造 Google OAuth 授权 URL
func geminiAuthURL(clientID, redirectURI string) string {
	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	params.Set("scope", geminiOAuthScope)
	params.Set("access_type", "offline")
	params.Set("prompt", "consent") // 每次强制返回 refresh_token
	return geminiAuthEndpoint + "?" + params.Encode()
}

type geminiTokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

// geminiExchangeCode 用授权码换取访问令牌
func geminiExchangeCode(clientID, clientSecret, code, redirectURI string) (access, refresh string, expiry time.Time, err error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	resp, err := http.PostForm(geminiTokenEndpoint, data)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("换取令牌失败：%w", err)
	}
	defer resp.Body.Close()

	var tr geminiTokenResp
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return "", "", time.Time{}, fmt.Errorf("解析令牌响应失败：%w", err)
	}
	if tr.Error != "" {
		return "", "", time.Time{}, fmt.Errorf("OAuth 错误：%s — %s", tr.Error, tr.ErrorDesc)
	}
	return tr.AccessToken, tr.RefreshToken, time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second), nil
}

// geminiDoRefresh 用 refresh token 换新 access token
func geminiDoRefresh(clientID, clientSecret, refreshToken string) (access string, expiry time.Time, err error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("refresh_token", refreshToken)
	data.Set("grant_type", "refresh_token")

	resp, err := http.PostForm(geminiTokenEndpoint, data)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("刷新令牌失败：%w", err)
	}
	defer resp.Body.Close()

	var tr geminiTokenResp
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return "", time.Time{}, fmt.Errorf("解析刷新响应失败：%w", err)
	}
	if tr.Error != "" {
		return "", time.Time{}, fmt.Errorf("刷新错误：%s — %s", tr.Error, tr.ErrorDesc)
	}
	return tr.AccessToken, time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second), nil
}

// geminiValidToken 返回有效的访问令牌（若快到期则自动刷新并持久化）
func geminiValidToken(prefs *Preferences) (string, error) {
	if prefs.GeminiAccessToken == "" {
		return "", fmt.Errorf("未通过 Google 授权，请先在设置中完成授权")
	}
	// 有效期内（60 秒宽限）直接返回
	if time.Now().Add(60 * time.Second).Before(time.Unix(prefs.GeminiTokenExpiry, 0)) {
		return prefs.GeminiAccessToken, nil
	}
	// 令牌即将过期，用 refresh token 刷新
	if prefs.GeminiRefreshToken == "" {
		return "", fmt.Errorf("访问令牌已过期且无刷新令牌，请重新授权")
	}
	newToken, newExpiry, err := geminiDoRefresh(prefs.GeminiClientID, prefs.GeminiClientSecret, prefs.GeminiRefreshToken)
	if err != nil {
		return "", err
	}
	prefs.GeminiAccessToken = newToken
	prefs.GeminiTokenExpiry = newExpiry.Unix()
	_ = savePreferences(*prefs) // best-effort 持久化
	return newToken, nil
}

// geminiRedirectURI 返回 Gemini OAuth 回调地址。
// 使用服务端 oauthPublicURL()（WELINK_PUBLIC_URL 或 127.0.0.1:<port>），
// 不读任何请求头——否则 Host / X-Forwarded-Host 可被伪造，授权 code 被回传到攻击者域。
func geminiRedirectURI() string {
	return oauthPublicURL() + "/api/auth/gemini/callback"
}
