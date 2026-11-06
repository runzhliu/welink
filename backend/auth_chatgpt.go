package main

// ChatGPT plan OAuth is separate from API keys and from exported preferences.
// See https://developers.openai.com/siwc/token-sharing-open-source/sign-in
import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const chatGPTResource = "https://api.openai.com/v1"
const chatGPTScope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

var chatGPTAuthURL = "https://auth.openai.com/api/accounts/authorize"
var chatGPTTokenURL = "https://auth.openai.com/api/accounts/oauth/token"
var chatGPTJWKSURL = "https://auth.openai.com/.well-known/jwks.json"
var chatGPTRevokeURL = "https://auth.openai.com/api/accounts/oauth/revoke"

type chatGPTCredential struct {
	HostID       string `json:"host_id"`
	ClientID     string `json:"client_id,omitempty"`
	Subject      string `json:"subject,omitempty"`
	Email        string `json:"email,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scopes       string `json:"scopes,omitempty"`
	ExpiresAt    int64  `json:"expires_at,omitempty"`
}
type chatGPTAttempt struct {
	state, nonce, verifier, redirectURI, clientID string
	expires                                       time.Time
}

var chatGPTMu sync.Mutex
var chatGPTPending *chatGPTAttempt
var chatGPTLastAuthError string

func chatGPTPath() string { return filepath.Join(filepath.Dir(preferencesPath()), "chatgpt-auth.json") }
func chatGPTRead() (chatGPTCredential, error) {
	var cred chatGPTCredential
	b, err := os.ReadFile(chatGPTPath())
	if os.IsNotExist(err) {
		return cred, nil
	}
	if err != nil {
		return cred, err
	}
	err = json.Unmarshal(b, &cred)
	return cred, err
}
func chatGPTWrite(cred chatGPTCredential) error {
	if err := os.MkdirAll(filepath.Dir(chatGPTPath()), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(chatGPTPath()), ".chatgpt-auth-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(f.Name(), chatGPTPath())
}
func chatGPTRandom(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Only allow browser-initiated local installations. A remote/demo deployment must
// not receive a user's subscription credentials through this local OAuth flow.
func chatGPTLocalOrigin(c *gin.Context) bool {
	if demoModeEnabled() {
		return false
	}
	origin := c.GetHeader("Origin")
	if origin == "" {
		origin = c.GetHeader("X-WeLink-Local-Origin")
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.User != nil {
		return false
	}
	h := u.Hostname()
	if h != "localhost" && h != "127.0.0.1" {
		return false
	}
	return u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

type chatGPTTokenResponse struct {
	Access  string `json:"access_token"`
	Refresh string `json:"refresh_token"`
	ID      string `json:"id_token"`
	Scope   string `json:"scope"`
	Type    string `json:"token_type"`
	Expires int64  `json:"expires_in"`
	Error   string `json:"error"`
}

func chatGPTToken(values url.Values) (chatGPTTokenResponse, error) {
	var tr chatGPTTokenResponse
	req, err := http.NewRequest(http.MethodPost, chatGPTTokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return tr, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpClientFast.Do(req)
	if err != nil {
		return tr, fmt.Errorf("无法连接 OpenAI 授权服务")
	}
	defer resp.Body.Close()
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tr); err != nil || resp.StatusCode != 200 {
		return tr, fmt.Errorf("OpenAI 授权或令牌刷新失败，请重新登录")
	}
	if tr.Access == "" || tr.Expires <= 0 || !strings.EqualFold(tr.Type, "Bearer") {
		return tr, fmt.Errorf("OpenAI 返回了无效的授权信息")
	}
	return tr, nil
}
func chatGPTHasScope(scopes, target string) bool {
	for _, s := range strings.Fields(scopes) {
		if s == target {
			return true
		}
	}
	return false
}

// Verify the ID token before associating a client or persisting credentials.
func chatGPTVerifyID(raw, clientID, nonce string) (string, string, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return "", "", fmt.Errorf("无效的身份令牌")
	}
	decode := base64.RawURLEncoding.DecodeString
	head, err := decode(parts[0])
	if err != nil {
		return "", "", fmt.Errorf("无效的身份令牌")
	}
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if json.Unmarshal(head, &hdr) != nil || hdr.Alg != "RS256" || hdr.Kid == "" {
		return "", "", fmt.Errorf("不支持的身份签名")
	}
	resp, err := httpClientFast.Get(chatGPTJWKSURL)
	if err != nil {
		return "", "", fmt.Errorf("无法获取 OpenAI 身份验证公钥")
	}
	defer resp.Body.Close()
	var keys struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&keys) != nil {
		return "", "", fmt.Errorf("无法读取 OpenAI 身份验证公钥")
	}
	var pub *rsa.PublicKey
	for _, k := range keys.Keys {
		if k.Kid == hdr.Kid && k.Kty == "RSA" {
			n, ne := decode(k.N)
			e, ee := decode(k.E)
			if ne == nil && ee == nil && len(e) <= 4 {
				exponent := 0
				for _, b := range e {
					exponent = exponent<<8 | int(b)
				}
				pub = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
			}
			break
		}
	}
	sig, err := decode(parts[2])
	if err != nil || pub == nil || pub.N.BitLen() < 2048 || pub.E < 3 {
		return "", "", fmt.Errorf("身份签名验证失败")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig) != nil {
		return "", "", fmt.Errorf("身份签名验证失败")
	}
	payload, err := decode(parts[1])
	if err != nil {
		return "", "", fmt.Errorf("无效的身份令牌")
	}
	var claims struct {
		Iss   string          `json:"iss"`
		Sub   string          `json:"sub"`
		Email string          `json:"email"`
		Nonce string          `json:"nonce"`
		Aud   json.RawMessage `json:"aud"`
		Exp   int64           `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return "", "", fmt.Errorf("无效的身份信息")
	}
	var aud string
	var audiences []string
	_ = json.Unmarshal(claims.Aud, &aud)
	_ = json.Unmarshal(claims.Aud, &audiences)
	if aud != "" {
		audiences = append(audiences, aud)
	}
	validAud := false
	for _, a := range audiences {
		if a == clientID {
			validAud = true
		}
	}
	if claims.Iss != "https://auth.openai.com" || claims.Sub == "" || !validAud || claims.Exp <= time.Now().Unix() || subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(nonce)) != 1 {
		return "", "", fmt.Errorf("身份信息校验失败")
	}
	return claims.Sub, claims.Email, nil
}

func chatGPTValidToken() (string, error) {
	chatGPTMu.Lock()
	defer chatGPTMu.Unlock()
	cred, err := chatGPTRead()
	if err != nil {
		return "", err
	}
	if cred.AccessToken == "" || !chatGPTHasScope(cred.Scopes, "chatgpt.tokens.use.direct") {
		return "", fmt.Errorf("请先授权 ChatGPT 订阅")
	}
	if time.Now().Add(time.Minute).Unix() < cred.ExpiresAt {
		return cred.AccessToken, nil
	}
	if cred.RefreshToken == "" || cred.ClientID == "" {
		return "", fmt.Errorf("ChatGPT 授权已过期，请重新登录")
	}
	tr, err := chatGPTToken(url.Values{"grant_type": {"refresh_token"}, "client_id": {cred.ClientID}, "refresh_token": {cred.RefreshToken}, "resource": {chatGPTResource}})
	if err != nil {
		return "", err
	}
	if tr.Refresh == "" {
		return "", fmt.Errorf("刷新令牌缺失，请重新登录")
	}
	if tr.Scope != "" {
		cred.Scopes = tr.Scope
	}
	if !chatGPTHasScope(cred.Scopes, "chatgpt.tokens.use.direct") {
		return "", fmt.Errorf("ChatGPT 订阅授权已撤销")
	}
	cred.AccessToken, cred.RefreshToken, cred.ExpiresAt = tr.Access, tr.Refresh, time.Now().Unix()+tr.Expires
	if tr.ID != "" {
		cred.IDToken = tr.ID
	}
	if err = chatGPTWrite(cred); err != nil {
		return "", fmt.Errorf("无法保存更新后的授权")
	}
	return cred.AccessToken, nil
}

func registerChatGPTRoutes(r *gin.Engine, api *gin.RouterGroup) {
	api.POST("/auth/chatgpt/start", func(c *gin.Context) {
		if !chatGPTLocalOrigin(c) {
			c.JSON(403, gin.H{"error": "ChatGPT 订阅登录仅支持本机访问"})
			return
		}
		originHeader := c.GetHeader("Origin")
		if originHeader == "" {
			originHeader = c.GetHeader("X-WeLink-Local-Origin")
		}
		origin, _ := url.Parse(originHeader)
		port := origin.Port()
		if port == "" {
			port = "80"
		}
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			c.JSON(400, gin.H{"error": "无效的本机端口"})
			return
		}
		chatGPTMu.Lock()
		defer chatGPTMu.Unlock()
		chatGPTLastAuthError = ""
		cred, err := chatGPTRead()
		if err != nil {
			c.JSON(500, gin.H{"error": "无法读取本地授权"})
			return
		}
		if cred.HostID == "" {
			host, e := chatGPTRandom(24)
			if e != nil {
				c.Status(500)
				return
			}
			cred.HostID = "urn:uuid:" + newChatGPTUUID(host)
			if chatGPTWrite(cred) != nil {
				c.JSON(500, gin.H{"error": "无法保存本机标识"})
				return
			}
		}
		state, e1 := chatGPTRandom(32)
		nonce, e2 := chatGPTRandom(32)
		verifier, e3 := chatGPTRandom(48)
		if e1 != nil || e2 != nil || e3 != nil {
			c.Status(500)
			return
		}
		redirect := "http://" + net.JoinHostPort("127.0.0.1", port) + "/auth/callback"
		client := cred.ClientID
		if client == "" {
			client = "dynamic_agent_client"
		}
		chatGPTPending = &chatGPTAttempt{state, nonce, verifier, redirect, client, time.Now().Add(10 * time.Minute)}
		hash := sha256.Sum256([]byte(verifier))
		q := url.Values{"client_id": {client}, "ext_agent_host_id": {cred.HostID}, "response_type": {"code"}, "redirect_uri": {redirect}, "scope": {chatGPTScope}, "resource": {chatGPTResource}, "state": {state}, "nonce": {nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}}
		if client == "dynamic_agent_client" {
			q.Set("agent_name_hint", "WeLink")
		}
		c.JSON(200, gin.H{"url": chatGPTAuthURL + "?" + q.Encode()})
	})
	r.GET("/auth/callback", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		chatGPTMu.Lock()
		defer chatGPTMu.Unlock()
		fail := func() {
			chatGPTLastAuthError = "ChatGPT 授权失败或已取消，请重新登录。"
			c.Data(400, "text/html; charset=utf-8", []byte("<!doctype html><meta charset=utf-8><p>ChatGPT 授权失败或已取消，请关闭页面并在 WeLink 重试。</p>"))
		}
		if demoModeEnabled() {
			c.Status(403)
			return
		}
		pending := chatGPTPending
		if pending == nil || time.Now().After(pending.expires) || subtle.ConstantTimeCompare([]byte(pending.state), []byte(c.Query("state"))) != 1 {
			c.Status(400)
			return
		}
		chatGPTPending = nil
		if c.Query("error") != "" {
			fail()
			return
		}
		client := pending.clientID
		issued := c.Query("client_id")
		if client == "dynamic_agent_client" {
			if issued == "" || issued == client {
				fail()
				return
			}
			client = issued
		} else if issued != "" && issued != client {
			fail()
			return
		}
		if c.Query("code") == "" {
			fail()
			return
		}
		tr, err := chatGPTToken(url.Values{"grant_type": {"authorization_code"}, "client_id": {client}, "code": {c.Query("code")}, "code_verifier": {pending.verifier}, "redirect_uri": {pending.redirectURI}, "resource": {chatGPTResource}})
		if err != nil || tr.ID == "" || tr.Refresh == "" || !chatGPTHasScope(tr.Scope, "chatgpt.tokens.use.direct") {
			fail()
			return
		}
		sub, email, err := chatGPTVerifyID(tr.ID, client, pending.nonce)
		if err != nil {
			fail()
			return
		}
		cred, err := chatGPTRead()
		if err != nil || (cred.ClientID != "" && (cred.ClientID != client || cred.Subject != sub)) {
			fail()
			return
		}
		cred.ClientID, cred.Subject, cred.Email, cred.IDToken = client, sub, email, tr.ID
		cred.AccessToken, cred.RefreshToken, cred.Scopes, cred.ExpiresAt = tr.Access, tr.Refresh, tr.Scope, time.Now().Unix()+tr.Expires
		if chatGPTWrite(cred) != nil {
			fail()
			return
		}
		c.Data(200, "text/html; charset=utf-8", []byte("<!doctype html><meta charset=utf-8><p>ChatGPT 授权成功，可以关闭此页面并返回 WeLink。</p>"))
	})
	api.GET("/auth/chatgpt/status", func(c *gin.Context) {
		if !chatGPTLocalOrigin(c) {
			c.Status(403)
			return
		}
		chatGPTMu.Lock()
		defer chatGPTMu.Unlock()
		cred, err := chatGPTRead()
		if err != nil {
			c.Status(500)
			return
		}
		c.JSON(200, gin.H{"authorized": cred.RefreshToken != "" && chatGPTHasScope(cred.Scopes, "chatgpt.tokens.use.direct"), "email": cred.Email, "error": chatGPTLastAuthError})
	})
	api.DELETE("/auth/chatgpt", func(c *gin.Context) {
		if !chatGPTLocalOrigin(c) {
			c.Status(403)
			return
		}
		chatGPTMu.Lock()
		defer chatGPTMu.Unlock()
		cred, err := chatGPTRead()
		if err != nil {
			c.Status(500)
			return
		}
		revoked := true
		if cred.RefreshToken != "" {
			req, e := http.NewRequest("POST", chatGPTRevokeURL, strings.NewReader(url.Values{"token": {cred.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {cred.ClientID}}.Encode()))
			if e == nil {
				req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				resp, e := httpClientFast.Do(req)
				if e == nil {
					revoked = resp.StatusCode == 200
					resp.Body.Close()
				} else {
					revoked = false
				}
			} else {
				revoked = false
			}
		}
		cred.AccessToken, cred.RefreshToken, cred.IDToken, cred.Scopes, cred.ExpiresAt = "", "", "", "", 0
		if chatGPTWrite(cred) != nil {
			c.Status(500)
			return
		}
		c.JSON(200, gin.H{"ok": true, "revoked": revoked})
	})
}

func newChatGPTUUID(seed string) string {
	h := sha256.Sum256([]byte(seed))
	h[6] = h[6]&0x0f | 0x40
	h[8] = h[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", h[0:4], h[4:6], h[6:8], h[8:10], h[10:16])
}
