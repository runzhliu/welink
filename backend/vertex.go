/*
 * Google Vertex AI provider
 *
 * 认证：Service Account JSON → RS256 JWT → OAuth2 access token（自动缓存刷新）
 * 调用：走 Vertex AI 的 OpenAI 兼容端点，复用 streamOpenAICompat / completeOpenAICompatSync
 *
 * 配置方式（无额外字段，和其他 provider 一致）：
 *   Provider: "vertex"
 *   APIKey:   完整的 Service Account JSON 字符串
 *   BaseURL:  https://{region}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{region}/endpoints/openapi
 *   Model:    例如 google/gemini-2.0-flash-001
 */

package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ─── Service Account JSON 解析 ───────────────────────────────────────────────

type vertexSAKey struct {
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"` // PEM
	ClientEmail  string `json:"client_email"`
	TokenURI     string `json:"token_uri"`
}

// ─── Token 缓存 ──────────────────────────────────────────────────────────────

type vertexTokenEntry struct {
	token  string
	expiry time.Time
}

var (
	vtxCache   = make(map[string]vertexTokenEntry)
	vtxCacheMu sync.Mutex
)

// vertexAccessToken 从 SA JSON 换取 access token（带缓存）
func vertexAccessToken(saJSON string) (string, error) {
	sa, err := parseVertexSA(saJSON)
	if err != nil {
		return "", err
	}

	vtxCacheMu.Lock()
	if e, ok := vtxCache[sa.ClientEmail]; ok && time.Now().Before(e.expiry.Add(-2*time.Minute)) {
		t := e.token
		vtxCacheMu.Unlock()
		return t, nil
	}
	vtxCacheMu.Unlock()

	jwt, err := buildVertexJWT(sa)
	if err != nil {
		return "", err
	}

	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {jwt}}
	resp, err := http.Post(sa.TokenURI, "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("Vertex AI token 请求失败: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Vertex AI token 错误 %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil || tr.AccessToken == "" {
		return "", fmt.Errorf("Vertex AI token 响应解析失败")
	}

	vtxCacheMu.Lock()
	vtxCache[sa.ClientEmail] = vertexTokenEntry{token: tr.AccessToken, expiry: time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)}
	vtxCacheMu.Unlock()
	return tr.AccessToken, nil
}

func parseVertexSA(saJSON string) (*vertexSAKey, error) {
	var sa vertexSAKey
	if err := json.Unmarshal([]byte(strings.TrimSpace(saJSON)), &sa); err != nil {
		return nil, fmt.Errorf("Service Account JSON 解析失败: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, fmt.Errorf("Service Account JSON 缺少 client_email 或 private_key")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &sa, nil
}

func buildVertexJWT(sa *vertexSAKey) (string, error) {
	now := time.Now().Unix()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": sa.PrivateKeyID})
	claims, _ := json.Marshal(map[string]any{
		"iss": sa.ClientEmail, "scope": "https://www.googleapis.com/auth/cloud-platform",
		"aud": sa.TokenURI, "iat": now, "exp": now + 3600,
	})
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)

	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return "", fmt.Errorf("private_key PEM 解析失败")
	}
	var privKey *rsa.PrivateKey
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		var ok bool
		if privKey, ok = k.(*rsa.PrivateKey); !ok {
			return "", fmt.Errorf("private_key 不是 RSA 密钥")
		}
	} else if k2, err2 := x509.ParsePKCS1PrivateKey(block.Bytes); err2 == nil {
		privKey = k2
	} else {
		return "", fmt.Errorf("private_key 解析失败")
	}

	h := crypto.SHA256.New()
	h.Write([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, h.Sum(nil))
	if err != nil {
		return "", fmt.Errorf("JWT 签名失败: %w", err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// ─── Vertex 流式 / 非流式（复用 OpenAI 兼容代码）─────────────────────────────

// streamVertex 流式调用 Vertex AI
func streamVertex(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	token, err := vertexAccessToken(cfg.apiKey)
	if err != nil {
		return err
	}
	resolved := cfg
	resolved.apiKey = token
	return streamOpenAICompat(send, msgs, resolved)
}

// completVertexSync 非流式调用 Vertex AI
func completVertexSync(msgs []LLMMessage, cfg llmConfig) (string, error) {
	token, err := vertexAccessToken(cfg.apiKey)
	if err != nil {
		return "", err
	}
	resolved := cfg
	resolved.apiKey = token
	return completeOpenAICompatSync(msgs, resolved)
}

// ─── 测试 ────────────────────────────────────────────────────────────────────

func testVertexConn(cfg llmConfig) (string, error) {
	token, err := vertexAccessToken(cfg.apiKey)
	if err != nil {
		return cfg.model, err
	}
	resolved := cfg
	resolved.apiKey = token
	body, _ := json.Marshal(openAIRequest{Model: resolved.model, Messages: []LLMMessage{{Role: "user", Content: "Hi"}}, Stream: true})
	req, err := http.NewRequest("POST", resolved.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return cfg.model, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+resolved.apiKey)
	resp, err := httpClientFast.Do(req)
	if err != nil {
		return cfg.model, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		return cfg.model, fmt.Errorf("Vertex AI 测试失败 %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	return cfg.model, nil
}
