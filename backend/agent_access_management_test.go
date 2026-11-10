package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type accountAgentMock struct {
	*agentMock
	owner string
}

func (m *accountAgentMock) SFTIdentity() string { return m.owner }

func TestAgentManagementRequiresScopeAndDoesNotReplaceExistingPolicy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	t.Setenv("DEMO_MODE", "false")
	t.Setenv("PREFERENCES_PATH", filepath.Join(dir, "preferences.json"))
	t.Setenv("WELINK_AGENT_ACCESS_PATH", filepath.Join(dir, "agent-access.json"))
	r := gin.New()
	api := r.Group("/api")
	ownerID := "synthetic-owner"
	registerAgentManagementRoutes(api, sftPINGate(api), func() string { return ownerID })
	svc := &accountAgentMock{agentMock: &agentMock{}, owner: ownerID}
	api.POST("/agent/query", requireAgentAccess, agentQueryHandler(func() agentQueryService { return svc }))
	do := func(method, path, body, remote, origin, session string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.RemoteAddr = remote
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if session != "" {
			req.Header.Set("X-SFT-Session", session)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	local := "127.0.0.1:1234"
	grant := `{"conversations":["synthetic"],"actions":["dates"],"hours":24}`
	if got := do("POST", "/api/agent/access", grant, "192.0.2.2:1234", "http://localhost:3418", "").Code; got != 401 {
		t.Fatalf("remote: %d", got)
	}
	if got := do("POST", "/api/agent/access", grant, local, "https://untrusted.example", "").Code; got != 401 {
		t.Fatalf("origin: %d", got)
	}
	if got := do("POST", "/api/agent/access", `{"conversations":[],"actions":["dates"],"hours":24}`, local, "", "").Code; got != 400 {
		t.Fatalf("empty scope: %d", got)
	}
	if got := do("POST", "/api/agent/access", `{"conversations":["synthetic"],"actions":["delete"],"hours":24}`, local, "", "").Code; got != 400 {
		t.Fatalf("invalid action: %d", got)
	}
	created := do("POST", "/api/agent/access", grant, local, "", "")
	if created.Code != 201 || created.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("create: %d", created.Code)
	}
	var output struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &output); err != nil || len(output.Token) != 64 {
		t.Fatal("credential not returned")
	}
	data, err := os.ReadFile(agentAccessPath())
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(output.Token)) {
		t.Fatal("plaintext credential stored")
	}
	info, err := os.Stat(agentAccessPath())
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("policy permissions")
	}
	status := do("GET", "/api/agent/access", "", local, "", "")
	if status.Code != 200 || strings.Contains(status.Body.String(), output.Token) || strings.Contains(status.Body.String(), "token_sha256") {
		t.Fatal("status exposed credential")
	}
	if got := do("POST", "/api/agent/access", grant, local, "", "").Code; got != 409 {
		t.Fatalf("overwrote policy: %d", got)
	}
	query := func() int {
		req := httptest.NewRequest(http.MethodPost, "/api/agent/query", strings.NewReader(`{"action":"dates","username":"synthetic","max_items":2,"max_chars":20}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+output.Token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	if got := query(); got != 200 {
		t.Fatalf("authorized query: %d", got)
	}
	ownerID = "another-account"
	svc.owner = ownerID
	if got := query(); got != 403 {
		t.Fatalf("account switch: %d", got)
	}
	if got := do("GET", "/api/agent/access", "", local, "", "").Body.String(); !strings.Contains(got, "other_account") || strings.Contains(got, "synthetic") {
		t.Fatalf("account status: %s", got)
	}
	var expired agentAccessPolicy
	if err := json.Unmarshal(data, &expired); err != nil {
		t.Fatal(err)
	}
	expired.ExpiresAt = time.Now().Add(-time.Hour)
	expiredData, err := json.Marshal(expired)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(agentAccessPath(), expiredData, 0600); err != nil {
		t.Fatal(err)
	}
	if got := do("GET", "/api/agent/access", "", local, "", "").Body.String(); !strings.Contains(got, "other_account") || strings.Contains(got, "synthetic") {
		t.Fatalf("expired account status: %s", got)
	}
	if got := do("DELETE", "/api/agent/access", "", local, "", "").Code; got != 200 || loadAgentAccessPolicy() != nil {
		t.Fatalf("revoke: %d", got)
	}
	t.Setenv("DEMO_MODE", "true")
	if got := do("POST", "/api/agent/access", grant, local, "", "").Code; got != 403 {
		t.Fatalf("demo: %d", got)
	}
}

func TestAgentManagementHonorsPIN(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	t.Setenv("DEMO_MODE", "false")
	t.Setenv("PREFERENCES_PATH", filepath.Join(dir, "preferences.json"))
	t.Setenv("WELINK_AGENT_ACCESS_PATH", filepath.Join(dir, "agent-access.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("1234"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if err := savePreferences(Preferences{LockPinHash: string(hash)}); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	api := r.Group("/api")
	registerAgentManagementRoutes(api, sftPINGate(api), func() string { return "synthetic-owner" })
	request := func(method, path, body, session string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-SFT-Session", session)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	if got := request("GET", "/api/agent/access", "", "").Code; got != 423 {
		t.Fatalf("without PIN: %d", got)
	}
	if got := request("POST", "/api/sft/unlock", `{"pin":"wrong"}`, "").Code; got != 401 {
		t.Fatalf("wrong PIN: %d", got)
	}
	w := request("POST", "/api/sft/unlock", `{"pin":"1234"}`, "")
	var response struct {
		Session string `json:"session"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Session == "" {
		t.Fatal("unlock failed")
	}
	if got := request("GET", "/api/agent/access", "", response.Session).Code; got != http.StatusOK {
		t.Fatalf("unlocked: %d", got)
	}
}
