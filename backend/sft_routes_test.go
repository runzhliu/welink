package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"welink/backend/sft"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func TestSFTWorkbenchesRegisterWithoutRouteConflicts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controller, err := sft.New(sft.Config{Root: t.TempDir(), Owner: func() string { return "test" }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = controller.Close() })
	r := gin.New()
	api := r.Group("/api")
	controller.Routes(api.Group("/sft"))
	registerSFTTrainingRoutes(api)
	routes := make(map[string]bool)
	for _, route := range r.Routes() {
		routes[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{
		"POST /api/sft/jobs/:id/cancel",
		"POST /api/sft-local/jobs/:id/cancel",
		"POST /api/sft/deployments/:id/stop",
		"POST /api/sft-local/deployments/:id/stop",
	} {
		if !routes[route] {
			t.Errorf("missing route %s", route)
		}
	}
}

func TestSFTProfilesPreserveDefaultAndRollback(t *testing.T) {
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	original := LLMProfile{ID: "original", Name: "原模型", Provider: "custom", APIKey: "old-key", BaseURL: "http://example.invalid/v1", Model: "base"}
	if _, e := updatePreferences(func(p *Preferences) { p.LLMProfiles = []LLMProfile{original}; syncSFTDefault(p) }); e != nil {
		t.Fatal(e)
	}
	port := "8083"
	cfg := sft.Config{}
	configureSFTProfiles(&cfg, func() string { return port })
	id, e := cfg.Connect("deployment", "风格模型", "sft-secret")
	if e != nil {
		t.Fatal(e)
	}
	prefs := loadPreferences()
	if prefs.LLMProfiles[0].ID != original.ID || prefs.LLMAPIKey != "old-key" {
		t.Fatal("connecting changed the existing default")
	}
	if len(prefs.LLMProfiles) != 2 {
		t.Fatal("missing independent profile")
	}
	if _, e = cfg.Connect("deployment", "duplicate", "sft-secret"); e != nil {
		t.Fatal(e)
	}
	if len(loadPreferences().LLMProfiles) != 2 {
		t.Fatal("connection retry created duplicate profile")
	}
	previous, e := cfg.Default(id)
	if e != nil || previous != original.ID {
		t.Fatal(previous, e)
	}
	if loadPreferences().LLMProfiles[0].ID != id {
		t.Fatal("explicit default did not persist")
	}
	port = "8084"
	actual := llmConfigForProfile(id, loadPreferences())
	if !strings.Contains(actual.baseURL, ":8084/") {
		t.Fatal("profile retained an obsolete fallback port", actual.baseURL)
	}
	actual = llmConfigForProfile("", loadPreferences())
	if !strings.Contains(actual.baseURL, ":8084/") {
		t.Fatal("default retained an obsolete fallback port")
	}
	if e = cfg.Rollback(id, previous); e != nil {
		t.Fatal(e)
	}
	if loadPreferences().LLMAPIKey != "old-key" {
		t.Fatal("rollback lost existing credentials")
	}
	if e = cfg.Rollback(id, previous); e == nil {
		t.Fatal("rollback overwrote a newer default")
	}
}
func TestSFTPINIsServerEnforcedAndChangedPINInvalidatesSession(t *testing.T) {
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	hash, _ := bcrypt.GenerateFromPassword([]byte("123456"), bcrypt.MinCost)
	updatePreferences(func(p *Preferences) { p.LockPinHash = string(hash) })
	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api")
	gate := sftPINGate(api)
	api.GET("/sft/protected", gate, func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	call := func(path, body, session, origin string) *httptest.ResponseRecorder {
		method := "GET"
		if body != "" {
			method = "POST"
		}
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-SFT-Session", session)
		request.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, request)
		return rec
	}
	if w := call("/api/sft/protected", "", "", ""); w.Code != 423 {
		t.Fatal("PIN only protected frontend")
	}
	if w := call("/api/sft/unlock", `{"pin":"wrong"}`, "", ""); w.Code != 401 {
		t.Fatal("invalid PIN accepted")
	}
	response := call("/api/sft/unlock", `{"pin":"123456"}`, "", "")
	var token struct {
		Session string `json:"session"`
	}
	json.Unmarshal(response.Body.Bytes(), &token)
	if token.Session == "" {
		t.Fatal(response.Body.String())
	}
	if w := call("/api/sft/protected", "", token.Session, ""); w.Code != 200 {
		t.Fatal("valid session denied")
	}
	if w := call("/api/sft/protected", "", token.Session, "https://malicious.invalid"); w.Code != 401 {
		t.Fatal("cross-site mutation gate not enforced")
	}
	newHash, _ := bcrypt.GenerateFromPassword([]byte("654321"), bcrypt.MinCost)
	updatePreferences(func(p *Preferences) { p.LockPinHash = string(newHash) })
	if w := call("/api/sft/protected", "", token.Session, ""); w.Code != 423 {
		t.Fatal("old session survived PIN rotation")
	}
}
