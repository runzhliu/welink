package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func createPreflightDB(t *testing.T, path, schema string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
}

func TestDataPreflightChecksSchemaWithoutChangingDatabases(t *testing.T) {
	root := filepath.Join(t.TempDir(), "synthetic #? 数据")
	contact := filepath.Join(root, "contact", "contact.db")
	message := filepath.Join(root, "message", "message_0.db")
	createPreflightDB(t, contact, `CREATE TABLE contact (username TEXT, nick_name TEXT, remark TEXT, alias TEXT, flag INTEGER, verify_flag INTEGER, big_head_url TEXT, small_head_url TEXT)`)
	createPreflightDB(t, message, `CREATE TABLE Name2Id (user_name TEXT); CREATE TABLE Msg_synthetic (message_content TEXT); INSERT INTO Msg_synthetic VALUES ('private synthetic message')`)
	beforeContact, err := os.ReadFile(contact)
	if err != nil {
		t.Fatal(err)
	}
	beforeMessage, err := os.ReadFile(message)
	if err != nil {
		t.Fatal(err)
	}
	result := inspectDataDirectory(root)
	if !result.OK {
		t.Fatalf("valid schema rejected: %+v", result.Checks)
	}
	afterContact, err := os.ReadFile(contact)
	if err != nil {
		t.Fatal(err)
	}
	afterMessage, err := os.ReadFile(message)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeContact, afterContact) || !bytes.Equal(beforeMessage, afterMessage) {
		t.Fatal("preflight modified a database")
	}
	for _, check := range result.Checks {
		if strings.Contains(check.Message, "private synthetic message") {
			t.Fatal("preflight exposed message data")
		}
	}
}

func TestDataPreflightReportsMissingInvalidAndUnsupportedData(t *testing.T) {
	root := t.TempDir()
	if result := inspectDataDirectory(root); result.OK || len(result.Checks) == 0 {
		t.Fatal("missing data accepted")
	}
	contact := filepath.Join(root, "contact", "contact.db")
	message := filepath.Join(root, "message", "message_0.db")
	createPreflightDB(t, contact, `CREATE TABLE contact (username TEXT)`)
	createPreflightDB(t, message, `CREATE TABLE Name2Id (user_name TEXT)`)
	result := inspectDataDirectory(root)
	if result.OK || !strings.Contains(result.Checks[0].Message, "缺少字段") {
		t.Fatalf("unsupported contact schema accepted: %+v", result.Checks)
	}
	if err := os.WriteFile(message, []byte("not a sqlite database"), 0600); err != nil {
		t.Fatal(err)
	}
	result = inspectDataDirectory(root)
	if result.OK || !strings.Contains(result.Checks[1].Message, "未解密") {
		t.Fatalf("invalid message database accepted: %+v", result.Checks)
	}
}

func TestDataPreflightWarnsForLegacyMissingSenderMap(t *testing.T) {
	root := t.TempDir()
	contact := filepath.Join(root, "contact", "contact.db")
	message := filepath.Join(root, "message", "message_0.db")
	createPreflightDB(t, contact, `CREATE TABLE contact (username TEXT, nick_name TEXT, remark TEXT, alias TEXT, flag INTEGER, verify_flag INTEGER, big_head_url TEXT, small_head_url TEXT)`)
	createPreflightDB(t, message, `CREATE TABLE Msg_synthetic (message_content TEXT)`)
	result := inspectDataDirectory(root)
	if !result.OK || len(result.Checks) < 2 || result.Checks[1].Status != "warning" || !strings.Contains(result.Checks[1].Message, "缺少发送者映射") {
		t.Fatalf("legacy database should be allowed with warning: %+v", result)
	}
}

func TestDataPreflightEndpointRejectsRemoteAndDemo(t *testing.T) {
	t.Setenv("DEMO_MODE", "false")
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerDataPreflight(r.Group("/api"), true)
	request := func(remote, origin string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/app/data-preflight", strings.NewReader(`{"data_dir":"/nonexistent"}`))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		req.RemoteAddr = remote
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	if got := request("192.0.2.4:1234", ""); got != http.StatusForbidden {
		t.Fatalf("remote status = %d", got)
	}
	if got := request("127.0.0.1:1234", ""); got != http.StatusOK {
		t.Fatalf("local status = %d", got)
	}
	if got := request("127.0.0.1:1234", "https://example.invalid"); got != http.StatusForbidden {
		t.Fatalf("untrusted origin status = %d", got)
	}
	t.Setenv("DEMO_MODE", "true")
	if got := request("127.0.0.1:1234", ""); got != http.StatusForbidden {
		t.Fatalf("demo status = %d", got)
	}
}
