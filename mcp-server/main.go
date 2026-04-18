package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// ─── MCP JSON-RPC 协议结构 ───────────────────────────────────────────

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   *Error `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// ─── MCP 协议相关类型 ────────────────────────────────────────────────

type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type Capabilities struct {
	Tools *ToolsCapability `json:"tools,omitempty"`
}

type ToolsCapability struct{}

type InitializeResult struct {
	ProtocolVersion string       `json:"protocolVersion"`
	ServerInfo      ServerInfo   `json:"serverInfo"`
	Capabilities    Capabilities `json:"capabilities"`
}

type Tool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema InputSchema `json:"inputSchema"`
}

type InputSchema struct {
	Type       string              `json:"type"`
	Properties map[string]Property `json:"properties,omitempty"`
	Required   []string            `json:"required,omitempty"`
}

type Property struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

type ListToolsResult struct {
	Tools []Tool `json:"tools"`
}

type CallToolParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type CallToolResult struct {
	Content []TextContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

// ─── Server 结构体 ───────────────────────────────────────────────────

type Server struct {
	fetch func(path string, params map[string]string) (string, error)
}

func NewServer(backendURL string) *Server {
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
		},
	}
	return &Server{
		fetch: func(path string, params map[string]string) (string, error) {
			return apiGetWithClient(client, backendURL, path, params)
		},
	}
}

// ─── WeLink API 调用 ─────────────────────────────────────────────────

func apiGetWithClient(client *http.Client, baseURL string, path string, params map[string]string) (string, error) {
	u, err := url.Parse(baseURL + path)
	if err != nil {
		return "", err
	}
	if len(params) > 0 {
		q := u.Query()
		for k, v := range params {
			q.Set(k, v)
		}
		u.RawQuery = q.Encode()
	}
	resp, err := client.Get(u.String())
	if err != nil {
		return "", fmt.Errorf("WeLink 后端未启动或无法访问: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func formatJSON(raw string) string {
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return raw
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return raw
	}
	return string(b)
}

// ─── Tool 定义 ───────────────────────────────────────────────────────

var tools = []Tool{
	{
		Name:        "get_contact_stats",
		Description: "获取所有微信联系人的消息统计排名，包括总消息数、对方消息数、我的消息数、首次和最后一次聊天时间。用于回答「我和谁联系最多」、「谁是我最常聊的人」等问题。",
		InputSchema: InputSchema{
			Type: "object",
		},
	},
	{
		Name:        "get_contact_detail",
		Description: "获取某个微信联系人的深度分析，包括每小时/每周消息分布、深夜消息数、红包数、主动发起对话比例、聊天热度（热/温/冷）等。用于分析与某人的关系深度。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"username": {Type: "string", Description: "联系人的微信 username，如 wxid_xxxxx 或 12345678@chatroom"},
			},
			Required: []string{"username"},
		},
	},
	{
		Name:        "get_contact_wordcloud",
		Description: "获取与某个联系人聊天的高频词汇，用于了解双方经常聊的话题。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"username":     {Type: "string", Description: "联系人的微信 username"},
				"include_mine": {Type: "string", Description: "是否包含我发送的消息，true 或 false，默认 false"},
			},
			Required: []string{"username"},
		},
	},
	{
		Name:        "get_contact_sentiment",
		Description: "获取与某个联系人聊天的情感趋势分析，按月统计正面/负面/中性消息占比，用于了解关系情感变化。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"username":     {Type: "string", Description: "联系人的微信 username"},
				"include_mine": {Type: "string", Description: "是否包含我发送的消息，true 或 false，默认 false"},
			},
			Required: []string{"username"},
		},
	},
	{
		Name:        "get_contact_messages",
		Description: "获取与某个联系人某一天的聊天记录。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"username": {Type: "string", Description: "联系人的微信 username"},
				"date":     {Type: "string", Description: "日期，格式 YYYY-MM-DD，如 2024-03-15"},
			},
			Required: []string{"username", "date"},
		},
	},
	{
		Name:        "get_global_stats",
		Description: "获取微信数据全局统计，包括总好友数、总消息数、最忙的一天、每月消息趋势、24小时热力图、消息类型分布、深夜聊天排行等。用于回答总体社交数据问题。",
		InputSchema: InputSchema{
			Type: "object",
		},
	},
	{
		Name:        "get_groups",
		Description: "获取所有微信群聊列表及其消息统计。",
		InputSchema: InputSchema{
			Type: "object",
		},
	},
	{
		Name:        "get_group_detail",
		Description: "获取某个群聊的深度分析，包括成员发言排名、活跃时间分布、高频词汇等。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"username": {Type: "string", Description: "群聊的微信 username，格式通常为 xxxxx@chatroom"},
			},
			Required: []string{"username"},
		},
	},
	{
		Name:        "get_stats_by_timerange",
		Description: "按时间范围过滤统计数据，分析特定时期的社交情况。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"from": {Type: "string", Description: "开始时间，Unix 秒时间戳"},
				"to":   {Type: "string", Description: "结束时间，Unix 秒时间戳"},
			},
			Required: []string{"from", "to"},
		},
	},
	{
		Name:        "get_self_portrait",
		Description: "获取本人自画像：总发送量、平均消息长度、活跃时段、最常联系的人等，用于「我自己是怎样的社交者」这类问题。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_money_overview",
		Description: "获取红包和转账的全局概览，包括各联系人收发金额统计。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_urls",
		Description: "获取聊天记录里分享过的所有 URL 链接，包含域名分布和每条链接的上下文。用于「我都被分享过哪些链接」。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_cooling_contacts",
		Description: "获取关系降温榜：曾经高互动但最近消息量大幅下降的联系人。用于「谁和我渐行渐远」。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_companion_time",
		Description: "获取每个联系人的陪伴时长（基于 session 切分估算的累计聊天分钟数），以及 Top 排名。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_common_circle",
		Description: "分析两个联系人的共同社交圈：共同的群聊 + 推测的共同好友。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"user1": {Type: "string", Description: "第一个联系人的 username"},
				"user2": {Type: "string", Description: "第二个联系人的 username"},
			},
			Required: []string{"user1", "user2"},
		},
	},
	{
		Name:        "get_contact_similarity",
		Description: "找出哪些联系人彼此「最像」（基于活跃时段、消息长度等特征）。返回 Top N 对。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"top": {Type: "string", Description: "返回前 N 对，默认 20"},
			},
		},
	},
	{
		Name:        "search_messages",
		Description: "跨所有联系人/群聊全局搜索消息内容。用于「我有没有和谁聊过 xxx」。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"q":    {Type: "string", Description: "搜索关键字"},
				"type": {Type: "string", Description: "搜索范围：all（默认）| contact | group"},
			},
			Required: []string{"q"},
		},
	},
	{
		Name:        "get_ai_usage_stats",
		Description: "获取 WeLink 本地 AI 对话的用量统计（字符数、估算 tokens，按 provider/model 分组）。",
		InputSchema: InputSchema{Type: "object"},
	},
	{
		Name:        "get_relationship_forecast",
		Description: "获取关系动态预测：基于过去 6 个月消息节奏给每个联系人打 4 档（升温/稳定/降温/濒危）。默认返回「建议主动联系」的 Top N。include_all=1 时返回全 4 档完整列表 + 每人最近 12 月消息数折线。",
		InputSchema: InputSchema{
			Type: "object",
			Properties: map[string]Property{
				"top":         {Type: "string", Description: "默认 5；建议主动联系的条数"},
				"include_all": {Type: "string", Description: "填 1 返回全 4 档 + 12 月折线；默认 0 只返回 Top N"},
			},
		},
	},
}

// ─── Tool 调用处理 ───────────────────────────────────────────────────

func (s *Server) callTool(name string, args json.RawMessage) CallToolResult {
	var argMap map[string]string
	if len(args) > 0 {
		if err := json.Unmarshal(args, &argMap); err != nil {
			return errorResult("参数解析失败: " + err.Error())
		}
	}
	if argMap == nil {
		argMap = map[string]string{}
	}

	var (
		raw string
		err error
	)

	switch name {
	case "get_contact_stats":
		raw, err = s.fetch("/api/contacts/stats", nil)

	case "get_contact_detail":
		username := argMap["username"]
		if username == "" {
			return errorResult("缺少参数: username")
		}
		raw, err = s.fetch("/api/contacts/detail", map[string]string{"username": username})

	case "get_contact_wordcloud":
		username := argMap["username"]
		if username == "" {
			return errorResult("缺少参数: username")
		}
		params := map[string]string{"username": username}
		if argMap["include_mine"] != "" {
			params["include_mine"] = argMap["include_mine"]
		}
		raw, err = s.fetch("/api/contacts/wordcloud", params)

	case "get_contact_sentiment":
		username := argMap["username"]
		if username == "" {
			return errorResult("缺少参数: username")
		}
		params := map[string]string{"username": username}
		if argMap["include_mine"] != "" {
			params["include_mine"] = argMap["include_mine"]
		}
		raw, err = s.fetch("/api/contacts/sentiment", params)

	case "get_contact_messages":
		username := argMap["username"]
		date := argMap["date"]
		if username == "" || date == "" {
			return errorResult("缺少参数: username 和 date")
		}
		raw, err = s.fetch("/api/contacts/messages", map[string]string{
			"username": username,
			"date":     date,
		})

	case "get_global_stats":
		raw, err = s.fetch("/api/global", nil)

	case "get_groups":
		raw, err = s.fetch("/api/groups", nil)

	case "get_group_detail":
		username := argMap["username"]
		if username == "" {
			return errorResult("缺少参数: username")
		}
		raw, err = s.fetch("/api/groups/detail", map[string]string{"username": username})

	case "get_stats_by_timerange":
		from := argMap["from"]
		to := argMap["to"]
		if from == "" || to == "" {
			return errorResult("缺少参数: from 和 to")
		}
		// 验证是数字
		if _, e := strconv.ParseInt(from, 10, 64); e != nil {
			return errorResult("from 必须是 Unix 时间戳（整数）")
		}
		if _, e := strconv.ParseInt(to, 10, 64); e != nil {
			return errorResult("to 必须是 Unix 时间戳（整数）")
		}
		raw, err = s.fetch("/api/stats/filter", map[string]string{"from": from, "to": to})

	case "get_self_portrait":
		raw, err = s.fetch("/api/contacts/self-portrait", nil)

	case "get_money_overview":
		raw, err = s.fetch("/api/contacts/money-overview", nil)

	case "get_urls":
		raw, err = s.fetch("/api/contacts/urls", nil)

	case "get_cooling_contacts":
		raw, err = s.fetch("/api/contacts/cooling", nil)

	case "get_companion_time":
		raw, err = s.fetch("/api/fun/companion-time", nil)

	case "get_common_circle":
		u1 := argMap["user1"]
		u2 := argMap["user2"]
		if u1 == "" || u2 == "" {
			return errorResult("缺少参数: user1 和 user2")
		}
		raw, err = s.fetch("/api/contacts/common-circle", map[string]string{"user1": u1, "user2": u2})

	case "get_contact_similarity":
		params := map[string]string{}
		if t := argMap["top"]; t != "" {
			if _, e := strconv.Atoi(t); e != nil {
				return errorResult("top 必须是整数")
			}
			params["top"] = t
		}
		raw, err = s.fetch("/api/contacts/similarity", params)

	case "search_messages":
		q := argMap["q"]
		if q == "" {
			return errorResult("缺少参数: q")
		}
		params := map[string]string{"q": q}
		if t := argMap["type"]; t != "" {
			params["type"] = t
		}
		raw, err = s.fetch("/api/search", params)

	case "get_ai_usage_stats":
		raw, err = s.fetch("/api/ai/usage-stats", nil)

	case "get_relationship_forecast":
		params := map[string]string{}
		if t := argMap["top"]; t != "" {
			if _, e := strconv.Atoi(t); e != nil {
				return errorResult("top 必须是整数")
			}
			params["top"] = t
		}
		if argMap["include_all"] == "1" {
			params["include_all"] = "1"
		}
		raw, err = s.fetch("/api/contacts/relationship-forecast", params)

	default:
		return errorResult("未知工具: " + name)
	}

	if err != nil {
		return errorResult(err.Error())
	}

	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: formatJSON(raw)}},
	}
}

func errorResult(msg string) CallToolResult {
	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: msg}},
		IsError: true,
	}
}

// ─── MCP 消息处理 ────────────────────────────────────────────────────

func (s *Server) handle(req Request) *Response {
	resp := &Response{JSONRPC: "2.0", ID: req.ID}

	switch req.Method {
	case "initialize":
		resp.Result = InitializeResult{
			ProtocolVersion: "2024-11-05",
			ServerInfo:      ServerInfo{Name: "welink-mcp", Version: "1.0.0"},
			Capabilities:    Capabilities{Tools: &ToolsCapability{}},
		}

	case "tools/list":
		resp.Result = ListToolsResult{Tools: tools}

	case "tools/call":
		var params CallToolParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			resp.Error = &Error{Code: -32602, Message: "Invalid params"}
			return resp
		}
		result := s.callTool(params.Name, params.Arguments)
		resp.Result = result

	case "notifications/initialized":
		return nil

	case "ping":
		resp.Result = struct{}{}

	default:
		resp.Error = &Error{Code: -32601, Message: "Method not found: " + req.Method}
	}

	return resp
}

// ─── 主循环（stdio JSON-RPC）────────────────────────────────────────

func main() {
	welinkURL := os.Getenv("WELINK_URL")
	if welinkURL == "" {
		welinkURL = "http://localhost:8080"
	}
	srv := NewServer(welinkURL)

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	encoder := json.NewEncoder(os.Stdout)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var req Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			encoder.Encode(Response{
				JSONRPC: "2.0",
				Error:   &Error{Code: -32700, Message: "Parse error"},
			})
			continue
		}

		// Notification（无 id）不回复
		if req.ID == nil && req.Method == "notifications/initialized" {
			continue
		}

		resp := srv.handle(req)
		if resp != nil && req.ID != nil {
			encoder.Encode(resp)
		}
	}
}
