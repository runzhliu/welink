package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestPairingDoesNotTrustForgedBrowserHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	p := defaultPreferences()
	p.MobilePairingToken = "synthetic-pairing-token"
	if err := savePreferences(p); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(requirePairingTokenIfEnabled)
	r.GET("/api/example", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	check := func(remote, origin, authorization string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
		req.RemoteAddr = remote
		req.Header.Set("Origin", origin)
		req.Header.Set("Referer", "http://localhost:3418/")
		if authorization != "" {
			req.Header.Set("Authorization", "Bearer "+authorization)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	if got := check("172.18.0.5:1111", "http://localhost:3418", ""); got != 401 {
		t.Fatalf("forged headers: %d", got)
	}
	if got := check("172.18.0.5:1111", "", "synthetic-pairing-token"); got != 204 {
		t.Fatalf("valid token: %d", got)
	}
	if got := check("127.0.0.1:1111", "", ""); got != 204 {
		t.Fatalf("loopback: %d", got)
	}
}
