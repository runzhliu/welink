package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAgentAccessEnforcesCredentialScopeAndExpiry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "agent-access.json")
	t.Setenv("WELINK_AGENT_ACCESS_PATH", path)
	sum := sha256.Sum256([]byte("synthetic-secret"))
	policy := agentAccessPolicy{TokenSHA256: hex.EncodeToString(sum[:]), Conversations: []string{"synthetic"}, Actions: []string{"dates"}, ExpiresAt: time.Now().Add(time.Hour)}
	save := func() {
		t.Helper()
		b, err := json.Marshal(policy)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	save()
	svc := &agentMock{}
	r := gin.New()
	r.POST("/api/agent/query", requireAgentAccess, agentQueryHandler(func() agentQueryService { return svc }))
	query := func(token, origin, body string) int {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/agent/query", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	body := `{"action":"dates","username":"synthetic","max_items":2,"max_chars":20}`
	if got := query("", "http://localhost:3418", body); got != 401 {
		t.Fatalf("forged origin: %d", got)
	}
	if got := query("wrong", "", body); got != 401 {
		t.Fatalf("wrong credential: %d", got)
	}
	if got := query("synthetic-secret", "", body); got != 200 {
		t.Fatalf("allowed request: %d", got)
	}
	if got := query("synthetic-secret", "", `{"action":"dates","username":"other","max_items":2,"max_chars":20}`); got != 403 {
		t.Fatalf("other contact: %d", got)
	}
	if got := query("synthetic-secret", "", `{"action":"day","username":"synthetic","date":"2020-01-01","max_items":2,"max_chars":20}`); got != 403 {
		t.Fatalf("other action: %d", got)
	}
	policy.ExpiresAt = time.Now().Add(-time.Second)
	save()
	if got := query("synthetic-secret", "", body); got != 401 {
		t.Fatalf("expired credential: %d", got)
	}
}
