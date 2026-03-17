package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ─── mock helpers ────────────────────────────────────────────────────

func mockServer(responses map[string]string) *Server {
	return &Server{
		fetch: func(path string, params map[string]string) (string, error) {
			if v, ok := responses[path]; ok {
				return v, nil
			}
			return `{}`, nil
		},
	}
}

func mockServerErr(errMsg string) *Server {
	return &Server{
		fetch: func(path string, params map[string]string) (string, error) {
			return "", fmt.Errorf(errMsg)
		},
	}
}

// ─── formatJSON ───────────────────────────────────────────────────────

func TestFormatJSON_Valid(t *testing.T) {
	out := formatJSON(`{"a":1}`)
	if out == `{"a":1}` {
		t.Error("expected indented output")
	}
	var v map[string]int
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		t.Errorf("output is not valid JSON: %v", err)
	}
}

func TestFormatJSON_Invalid(t *testing.T) {
	in := `not json`
	out := formatJSON(in)
	if out != in {
		t.Errorf("expected passthrough, got %q", out)
	}
}

// ─── callTool ─────────────────────────────────────────────────────────

func args(m map[string]string) json.RawMessage {
	b, _ := json.Marshal(m)
	return b
}

func TestCallTool_GetContactStats(t *testing.T) {
	srv := mockServer(map[string]string{"/api/contacts/stats": `[{"username":"alice"}]`})
	r := srv.callTool("get_contact_stats", nil)
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
	if len(r.Content) == 0 || r.Content[0].Text == "" {
		t.Error("expected non-empty content")
	}
}

func TestCallTool_GetContactStats_BackendError(t *testing.T) {
	srv := mockServerErr("connection refused")
	r := srv.callTool("get_contact_stats", nil)
	if !r.IsError {
		t.Error("expected error result")
	}
}

func TestCallTool_GetContactDetail_MissingUsername(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_contact_detail", args(map[string]string{}))
	if !r.IsError {
		t.Error("expected error for missing username")
	}
}

func TestCallTool_GetContactDetail_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/contacts/detail": `{"hourly_dist":[]}`})
	r := srv.callTool("get_contact_detail", args(map[string]string{"username": "alice_wx"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetContactWordcloud_MissingUsername(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_contact_wordcloud", args(map[string]string{}))
	if !r.IsError {
		t.Error("expected error for missing username")
	}
}

func TestCallTool_GetContactWordcloud_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/contacts/wordcloud": `[{"word":"你好","count":5}]`})
	r := srv.callTool("get_contact_wordcloud", args(map[string]string{"username": "alice_wx", "include_mine": "true"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetContactSentiment_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/contacts/sentiment": `{}`})
	r := srv.callTool("get_contact_sentiment", args(map[string]string{"username": "alice_wx"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetContactMessages_MissingParams(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_contact_messages", args(map[string]string{"username": "alice_wx"}))
	if !r.IsError {
		t.Error("expected error for missing date")
	}
}

func TestCallTool_GetContactMessages_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/contacts/messages": `[]`})
	r := srv.callTool("get_contact_messages", args(map[string]string{"username": "alice_wx", "date": "2024-01-01"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetGlobalStats(t *testing.T) {
	srv := mockServer(map[string]string{"/api/global": `{"total_friends":10}`})
	r := srv.callTool("get_global_stats", nil)
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetGroups(t *testing.T) {
	srv := mockServer(map[string]string{"/api/groups": `[]`})
	r := srv.callTool("get_groups", nil)
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetGroupDetail_MissingUsername(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_group_detail", args(map[string]string{}))
	if !r.IsError {
		t.Error("expected error for missing username")
	}
}

func TestCallTool_GetGroupDetail_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/groups/detail": `{"member_rank":[]}`})
	r := srv.callTool("get_group_detail", args(map[string]string{"username": "xxx@chatroom"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_GetStatsByTimerange_MissingParams(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_stats_by_timerange", args(map[string]string{"from": "0"}))
	if !r.IsError {
		t.Error("expected error for missing to")
	}
}

func TestCallTool_GetStatsByTimerange_InvalidFrom(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_stats_by_timerange", args(map[string]string{"from": "abc", "to": "0"}))
	if !r.IsError {
		t.Error("expected error for non-numeric from")
	}
}

func TestCallTool_GetStatsByTimerange_OK(t *testing.T) {
	srv := mockServer(map[string]string{"/api/stats/filter": `{}`})
	r := srv.callTool("get_stats_by_timerange", args(map[string]string{"from": "1700000000", "to": "1710000000"}))
	if r.IsError {
		t.Fatalf("unexpected error: %v", r.Content[0].Text)
	}
}

func TestCallTool_Unknown(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("nonexistent_tool", nil)
	if !r.IsError {
		t.Error("expected error for unknown tool")
	}
}

func TestCallTool_BadArgs(t *testing.T) {
	srv := mockServer(nil)
	r := srv.callTool("get_contact_detail", json.RawMessage(`{invalid json`))
	if !r.IsError {
		t.Error("expected error for bad args JSON")
	}
}

// ─── handle ──────────────────────────────────────────────────────────

func toRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func TestHandle_Initialize(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 1, Method: "initialize", Params: toRaw(map[string]any{})})
	if resp == nil || resp.Error != nil {
		t.Fatalf("expected valid initialize response, got: %v", resp)
	}
	b, _ := json.Marshal(resp.Result)
	var r InitializeResult
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatalf("failed to parse result: %v", err)
	}
	if r.ServerInfo.Name != "welink-mcp" {
		t.Errorf("unexpected server name: %s", r.ServerInfo.Name)
	}
}

func TestHandle_ToolsList(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 2, Method: "tools/list"})
	if resp == nil || resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp)
	}
	b, _ := json.Marshal(resp.Result)
	var r ListToolsResult
	json.Unmarshal(b, &r)
	if len(r.Tools) == 0 {
		t.Error("expected non-empty tools list")
	}
}

func TestHandle_ToolsCall(t *testing.T) {
	srv := mockServer(map[string]string{"/api/global": `{"total_friends":5}`})
	params := toRaw(CallToolParams{Name: "get_global_stats"})
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 3, Method: "tools/call", Params: params})
	if resp == nil || resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp)
	}
}

func TestHandle_Ping(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 4, Method: "ping"})
	if resp == nil || resp.Error != nil {
		t.Fatalf("ping should return empty result, got: %v", resp)
	}
}

func TestHandle_NotificationsInitialized(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", Method: "notifications/initialized"})
	if resp != nil {
		t.Error("notifications/initialized should return nil")
	}
}

func TestHandle_UnknownMethod(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 5, Method: "unknown/method"})
	if resp == nil || resp.Error == nil {
		t.Error("expected error for unknown method")
	}
	if resp.Error.Code != -32601 {
		t.Errorf("expected code -32601, got %d", resp.Error.Code)
	}
}

func TestHandle_ToolsCall_BadParams(t *testing.T) {
	srv := mockServer(nil)
	resp := srv.handle(Request{JSONRPC: "2.0", ID: 6, Method: "tools/call", Params: json.RawMessage(`{bad`)})
	if resp == nil || resp.Error == nil {
		t.Error("expected parse error")
	}
}

// ─── apiGetWithClient ────────────────────────────────────────────────

func TestApiGetWithClient_OK(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"ok":true}`)
	}))
	defer ts.Close()

	client := &http.Client{}
	result, err := apiGetWithClient(client, ts.URL, "/api/test", map[string]string{"foo": "bar"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == "" {
		t.Error("expected non-empty result")
	}
}

func TestApiGetWithClient_ServerError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		fmt.Fprint(w, `{"error":"internal"}`)
	}))
	defer ts.Close()

	client := &http.Client{}
	// 500 is still returned as body (backend errors are in JSON)
	result, err := apiGetWithClient(client, ts.URL, "/api/test", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == "" {
		t.Error("expected non-empty result even on 500")
	}
}

func TestApiGetWithClient_ConnectionRefused(t *testing.T) {
	client := &http.Client{}
	_, err := apiGetWithClient(client, "http://127.0.0.1:1", "/api/test", nil)
	if err == nil {
		t.Error("expected connection error")
	}
}
