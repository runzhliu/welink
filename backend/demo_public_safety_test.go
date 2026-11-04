package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDemoPublicSafetyBlocksSensitiveOperations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(demoPublicSafety)
	r.NoRoute(func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for _, path := range []string{
		"/api/sft/projects", "/api/sft-local/jobs", "/api/sft-worker/pair", "/api/sft-inference/model/v1/chat/completions",
		"/api/preferences/export?include_secrets=1", "/api/preferences/import", "/api/preferences/reset",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Referer", "http://localhost:3418/")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: got %d, want 403", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/contacts/stats", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("ordinary demo route unexpectedly blocked: %d", w.Code)
	}
}
