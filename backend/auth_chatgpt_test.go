package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func signedChatGPTID(t *testing.T, key *rsa.PrivateKey, client, nonce string) string {
	t.Helper()
	encode := base64.RawURLEncoding.EncodeToString
	head := encode([]byte(`{"alg":"RS256","kid":"test"}`))
	b, _ := json.Marshal(map[string]any{"iss": "https://auth.openai.com", "sub": "account-1", "aud": client, "nonce": nonce, "exp": time.Now().Add(time.Hour).Unix(), "email": "example@example.test"})
	prefix := head + "." + encode(b)
	sum := sha256.Sum256([]byte(prefix))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return prefix + "." + encode(sig)
}

func TestChatGPTSubscriptionOAuthAndRefresh(t *testing.T) {
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	t.Setenv("DEMO_MODE", "false")
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var nonce string
	var refreshes int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "RSA", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
		case "/token":
			_ = r.ParseForm()
			if r.Form.Get("grant_type") == "refresh_token" {
				refreshes++
				_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600, "token_type": "Bearer"})
				return
			}
			if r.Form.Get("client_id") != "issued-client" || r.Form.Get("code_verifier") == "" || r.Form.Get("resource") != chatGPTResource {
				t.Error("invalid token exchange parameters")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "access", "refresh_token": "refresh", "expires_in": 1, "token_type": "Bearer", "scope": chatGPTScope, "id_token": signedChatGPTID(t, key, "issued-client", nonce)})
		case "/revoke":
			w.WriteHeader(200)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	oldToken, oldKeys, oldRevoke := chatGPTTokenURL, chatGPTJWKSURL, chatGPTRevokeURL
	chatGPTTokenURL, chatGPTJWKSURL, chatGPTRevokeURL = upstream.URL+"/token", upstream.URL+"/jwks", upstream.URL+"/revoke"
	defer func() {
		chatGPTTokenURL, chatGPTJWKSURL, chatGPTRevokeURL = oldToken, oldKeys, oldRevoke
		chatGPTPending = nil
	}()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	registerChatGPTRoutes(router, api)
	start := httptest.NewRequest("POST", "/api/auth/chatgpt/start", nil)
	start.Header.Set("Origin", "http://localhost:3418")
	result := httptest.NewRecorder()
	router.ServeHTTP(result, start)
	if result.Code != 200 {
		t.Fatalf("start: %d %s", result.Code, result.Body.String())
	}
	var begin struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(result.Body.Bytes(), &begin) != nil {
		t.Fatal("invalid start response")
	}
	auth, _ := url.Parse(begin.URL)
	nonce = auth.Query().Get("nonce")
	state := auth.Query().Get("state")
	if auth.Query().Get("redirect_uri") != "http://127.0.0.1:3418/auth/callback" || auth.Query().Get("code_challenge_method") != "S256" {
		t.Fatal("invalid authorization request")
	}
	invalid := httptest.NewRecorder()
	router.ServeHTTP(invalid, httptest.NewRequest("GET", "/auth/callback?state=wrong", nil))
	if invalid.Code != 400 || chatGPTPending == nil {
		t.Fatal("invalid callback consumed pending authorization")
	}
	callback := httptest.NewRecorder()
	router.ServeHTTP(callback, httptest.NewRequest("GET", "/auth/callback?"+url.Values{"state": {state}, "code": {"one-time-code"}, "client_id": {"issued-client"}}.Encode(), nil))
	if callback.Code != 200 {
		t.Fatalf("callback status: %d", callback.Code)
	}
	cred, err := chatGPTRead()
	if err != nil || cred.Subject != "account-1" || cred.ClientID != "issued-client" {
		t.Fatalf("credentials were not saved")
	}
	info, err := os.Stat(chatGPTPath())
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credential file permissions are not private")
	}
	token, err := chatGPTValidToken()
	if err != nil || token != "new-access" || refreshes != 1 {
		t.Fatalf("refresh failed: %v", err)
	}
	token, err = chatGPTValidToken()
	if err != nil || token != "new-access" || refreshes != 1 {
		t.Fatal("refreshed token was not reused")
	}
	cfg := llmConfigForProfile("subscription", Preferences{LLMProfiles: []LLMProfile{{ID: "subscription", Provider: "chatgpt", Model: "test-model", BaseURL: "https://untrusted.example"}}})
	if cfg.apiKey != "new-access" || cfg.baseURL != chatGPTResource {
		t.Fatal("profile did not use the protected subscription token and pinned endpoint")
	}
	statusReq := httptest.NewRequest("GET", "/api/auth/chatgpt/status", nil)
	statusReq.Header.Set("X-WeLink-Local-Origin", "http://localhost:3418")
	status := httptest.NewRecorder()
	router.ServeHTTP(status, statusReq)
	if strings.Contains(status.Body.String(), "new-access") || strings.Contains(status.Body.String(), "new-refresh") {
		t.Fatal("status leaked token")
	}
	logoutReq := httptest.NewRequest("DELETE", "/api/auth/chatgpt", nil)
	logoutReq.Header.Set("Origin", "http://localhost:3418")
	logout := httptest.NewRecorder()
	router.ServeHTTP(logout, logoutReq)
	if logout.Code != 200 || !strings.Contains(logout.Body.String(), `"revoked":true`) {
		t.Fatal("logout failed")
	}
	cred, _ = chatGPTRead()
	if cred.AccessToken != "" || cred.RefreshToken != "" || cred.ClientID != "issued-client" {
		t.Fatal("logout did not clear credentials while retaining registration")
	}
	foreign := httptest.NewRequest("POST", "/api/auth/chatgpt/start", nil)
	foreign.Header.Set("Origin", "https://example.com")
	rejected := httptest.NewRecorder()
	router.ServeHTTP(rejected, foreign)
	if rejected.Code != 403 {
		t.Fatal("nonlocal origin accepted")
	}
}

func TestChatGPTResponseRequiresTerminalCompletion(t *testing.T) {
	old := httpClientLLMStream
	defer func() { httpClientLLMStream = old }()
	var body []byte
	terminal := true
	httpClientLLMStream = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != chatGPTResource+"/responses" {
			t.Fatal("incorrect endpoint")
		}
		var x bytes.Buffer
		_, _ = x.ReadFrom(r.Body)
		body = x.Bytes()
		events := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n"
		if terminal {
			events += "data: {\"type\":\"response.completed\"}\n\n"
		}
		return &http.Response{StatusCode: 200, Body: ioNop(events), Header: make(http.Header)}, nil
	})}
	cfg := llmConfig{provider: "chatgpt", apiKey: "fake", model: "test-model", baseURL: "https://wrong.example"}
	defaultsFor(&cfg)
	if cfg.baseURL != chatGPTResource {
		t.Fatal("subscription URL is not pinned")
	}
	var output strings.Builder
	err := streamChatGPT(func(c StreamChunk) { output.WriteString(c.Delta) }, []LLMMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "question"}}, cfg)
	if err != nil || output.String() != "hello" {
		t.Fatalf("response failed: %v", err)
	}
	var request map[string]any
	if json.Unmarshal(body, &request) != nil || request["store"] != false || request["stream"] != true || request["instructions"] != "rules" {
		t.Fatalf("invalid request: %s", body)
	}
	terminal = false
	if err := streamChatGPT(func(StreamChunk) {}, []LLMMessage{{Role: "user", Content: "question"}}, cfg); err == nil {
		t.Fatal("interrupted stream accepted")
	}
}

func ioNop(s string) *nopString { return &nopString{strings.NewReader(s)} }

type nopString struct{ *strings.Reader }

func (*nopString) Close() error { return nil }

func TestChatGPTIDRejectsInvalidNonce(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"keys":[{"kid":"test","kty":"RSA","n":%q,"e":"AQAB"}]}`, base64.RawURLEncoding.EncodeToString(key.N.Bytes()))
	}))
	defer server.Close()
	old := chatGPTJWKSURL
	chatGPTJWKSURL = server.URL
	defer func() { chatGPTJWKSURL = old }()
	if _, _, err := chatGPTVerifyID(signedChatGPTID(t, key, "client", "expected"), "client", "different"); err == nil {
		t.Fatal("invalid nonce accepted")
	}
}
