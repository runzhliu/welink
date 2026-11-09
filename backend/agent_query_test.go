package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

type agentMock struct{ called string }

func (m *agentMock) ContactActiveDates(string) []string {
	m.called = "dates"
	return []string{"2024-01-01", "2024-02-01", "2024-03-01"}
}
func (m *agentMock) GetDayMessages(string, string) []service.ChatMessage {
	m.called = "contact-day"
	return []service.ChatMessage{{Time: "10:01", Content: strings.Repeat("你", 30), Type: 1}, {Time: "10:02", Content: "第二条", Type: 1}}
}
func (m *agentMock) GetGroupDayMessages(string, string) []service.GroupChatMessage {
	m.called = "group-day"
	return []service.GroupChatMessage{{Time: "10:01", Speaker: "虚构成员", Content: "群消息", Type: 1}}
}
func (m *agentMock) SearchMessagesWithLimit(string, string, bool, int) []service.ChatMessage {
	m.called = "contact-search"
	return []service.ChatMessage{{Date: "2024-01-01", Content: "虚构消息", Type: 1}}
}
func (m *agentMock) SearchGroupMessages(string, string, string) []service.GroupChatMessage {
	m.called = "group-search"
	return []service.GroupChatMessage{{Date: "2024-01-01", Speaker: "虚构成员", Content: "虚构群消息", Type: 1}}
}

func runAgentQuery(t *testing.T, svc agentQueryService, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/agent/query", agentQueryHandler(func() agentQueryService { return svc }))
	req := httptest.NewRequest(http.MethodPost, "/api/agent/query", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAgentQueryBoundsMessagesAndPreservesSource(t *testing.T) {
	svc := &agentMock{}
	w := runAgentQuery(t, svc, `{"action":"day","username":"synthetic","date":"2024-01-01","max_items":1,"max_chars":20}`)
	if w.Code != 200 || svc.called != "contact-day" {
		t.Fatalf("status=%d called=%s", w.Code, svc.called)
	}
	var result struct {
		Items    []agentMessage `json:"items"`
		HasMore  bool           `json:"has_more"`
		Returned int            `json:"returned"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.HasMore || result.Returned != 1 || len(result.Items) != 1 || !result.Items[0].ContentTruncated || len([]rune(result.Items[0].Content)) != 20 || result.Items[0].Date != "2024-01-01" {
		t.Fatalf("unexpected bounded result: %+v", result)
	}
}

func TestAgentQueryRoutesScopedOperations(t *testing.T) {
	for _, tc := range []struct{ body, want string }{
		{`{"action":"dates","username":"synthetic","max_items":2,"max_chars":20}`, "dates"},
		{`{"action":"day","username":"synthetic@chatroom","date":"2024-01-01","max_items":2,"max_chars":20}`, "group-day"},
		{`{"action":"search","username":"synthetic","query":"测试","max_items":2,"max_chars":20}`, "contact-search"},
		{`{"action":"search","username":"synthetic@chatroom","query":"测试","max_items":2,"max_chars":20}`, "group-search"},
	} {
		svc := &agentMock{}
		w := runAgentQuery(t, svc, tc.body)
		if w.Code != 200 || svc.called != tc.want {
			t.Fatalf("want %s status=%d called=%s", tc.want, w.Code, svc.called)
		}
		if tc.want == "dates" && !strings.Contains(w.Body.String(), `"has_more":true`) {
			t.Fatalf("expected date truncation: %s", w.Body.String())
		}
	}
}

func TestAgentQueryPaginatesWithoutRepeating(t *testing.T) {
	svc := &agentMock{}
	w := runAgentQuery(t, svc, `{"action":"day","username":"synthetic","date":"2024-01-01","max_items":1,"max_chars":20,"offset":1}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "第二条") || !strings.Contains(w.Body.String(), `"has_more":false`) {
		t.Fatalf("unexpected second page: %s", w.Body.String())
	}
	w = runAgentQuery(t, svc, `{"action":"dates","username":"synthetic","max_items":1,"max_chars":20,"offset":1}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "2024-02-01") || !strings.Contains(w.Body.String(), `"next_offset":2`) {
		t.Fatalf("unexpected date page: %s", w.Body.String())
	}
}

func TestAgentQueryRejectsInvalidInputBeforeAccess(t *testing.T) {
	for _, body := range []string{
		`{"action":"day","username":"synthetic","date":"2024-02-30","max_items":1,"max_chars":20}`,
		`{"action":"search","username":"synthetic","query":"a","max_items":1,"max_chars":20}`,
		`{"action":"day","username":"synthetic","date":"2024-01-01","max_items":101,"max_chars":20}`,
		`{"action":"export","username":"synthetic","max_items":1,"max_chars":20}`,
	} {
		svc := &agentMock{}
		w := runAgentQuery(t, svc, body)
		if w.Code != 400 || svc.called != "" {
			t.Fatalf("expected rejection before access: status=%d called=%s", w.Code, svc.called)
		}
	}
}
