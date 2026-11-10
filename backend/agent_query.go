package main

// agent_query.go 提供 Agent 的有界只读查询。请求参数放在 JSON body 中，
// 避免账号、日期和搜索词进入默认 HTTP 访问日志。授权由现有 API 中间件负责。
import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

type agentQueryService interface {
	ContactActiveDates(string) []string
	GetDayMessages(string, string) []service.ChatMessage
	GetGroupDayMessages(string, string) []service.GroupChatMessage
	SearchMessagesWithLimit(string, string, bool, int) []service.ChatMessage
	SearchGroupMessages(string, string, string) []service.GroupChatMessage
}

type agentQuery struct {
	Action   string `json:"action"`
	Username string `json:"username"`
	Date     string `json:"date"`
	Query    string `json:"query"`
	MaxItems int    `json:"max_items"`
	MaxChars int    `json:"max_chars"`
	Offset   int    `json:"offset"`
}

type agentMessage struct {
	Date             string `json:"date"`
	Time             string `json:"time"`
	Speaker          string `json:"speaker"`
	IsMine           bool   `json:"is_mine"`
	Type             int    `json:"type"`
	Content          string `json:"content"`
	ContentTruncated bool   `json:"content_truncated"`
}

func agentQueryHandler(getService func() agentQueryService) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
		var q agentQuery
		if err := c.ShouldBindJSON(&q); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的查询请求"})
			return
		}
		if strings.TrimSpace(q.Username) == "" || len(q.Username) > 128 || strings.TrimSpace(q.Username) != q.Username || q.MaxItems < 1 || q.MaxItems > 100 || q.MaxChars < 20 || q.MaxChars > 2000 || q.Offset < 0 || q.Offset > 100000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "查询参数无效"})
			return
		}
		if q.Action == "day" {
			if t, err := time.Parse("2006-01-02", q.Date); err != nil || t.Format("2006-01-02") != q.Date {
				c.JSON(http.StatusBadRequest, gin.H{"error": "日期无效"})
				return
			}
		} else if q.Action == "search" {
			q.Query = strings.TrimSpace(q.Query)
			if length := utf8.RuneCountInString(q.Query); length < 2 || length > 100 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "搜索词长度无效"})
				return
			}
		} else if q.Action != "dates" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的查询类型"})
			return
		}
		if v, ok := c.Get(agentScopeKey); ok {
			policy, valid := v.(*agentAccessPolicy)
			if !valid || !policy.allows(q.Username, q.Action) {
				c.JSON(http.StatusForbidden, gin.H{"error": "会话或操作未获授权"})
				return
			}
		}
		svc := getService()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "聊天数据尚未就绪"})
			return
		}
		if v, ok := c.Get(agentScopeKey); ok {
			policy, valid := v.(*agentAccessPolicy)
			if valid && policy.OwnerID != "" {
				identity, supportsIdentity := svc.(interface{ SFTIdentity() string })
				if !supportsIdentity || identity.SFTIdentity() != policy.OwnerID {
					c.JSON(http.StatusForbidden, gin.H{"error": "授权不属于当前数据账号"})
					return
				}
			}
		}
		if q.Action == "dates" {
			dates := svc.ContactActiveDates(q.Username)
			end := max(0, len(dates)-q.Offset)
			start := max(0, end-q.MaxItems)
			hasMore := start > 0
			dates = dates[start:end]
			if dates == nil {
				dates = []string{}
			}
			result := gin.H{"dates": dates, "has_more": hasMore}
			if hasMore {
				result["next_offset"] = q.Offset + len(dates)
			}
			c.JSON(http.StatusOK, result)
			return
		}
		var items []agentMessage
		seen := 0
		appendMessage := func(date, at, speaker, content string, mine bool, kind int) {
			seen++
			if seen <= q.Offset {
				return
			}
			if len(items) >= q.MaxItems+1 {
				return
			}
			runes := []rune(content)
			truncated := len(runes) > q.MaxChars
			if truncated {
				runes = runes[:q.MaxChars]
			}
			if date == "" {
				date = q.Date
			}
			items = append(items, agentMessage{Date: date, Time: at, Speaker: speaker, IsMine: mine, Type: kind, Content: string(runes), ContentTruncated: truncated})
		}
		if strings.HasSuffix(q.Username, "@chatroom") {
			var rows []service.GroupChatMessage
			if q.Action == "day" {
				rows = svc.GetGroupDayMessages(q.Username, q.Date)
			} else {
				rows = svc.SearchGroupMessages(q.Username, q.Query, "")
			}
			for _, row := range rows {
				appendMessage(row.Date, row.Time, row.Speaker, row.Content, row.IsMine, row.Type)
				if len(items) > q.MaxItems {
					break
				}
			}
		} else {
			var rows []service.ChatMessage
			if q.Action == "day" {
				rows = svc.GetDayMessages(q.Username, q.Date)
			} else {
				rows = svc.SearchMessagesWithLimit(q.Username, q.Query, true, q.Offset+q.MaxItems+1)
			}
			for _, row := range rows {
				appendMessage(row.Date, row.Time, row.Speaker, row.Content, row.IsMine, row.Type)
				if len(items) > q.MaxItems {
					break
				}
			}
		}
		hasMore := len(items) > q.MaxItems
		if hasMore {
			items = items[:q.MaxItems]
		}
		if items == nil {
			items = []agentMessage{}
		}
		result := gin.H{"items": items, "returned": len(items), "has_more": hasMore}
		if hasMore {
			result["next_offset"] = q.Offset + len(items)
		}
		c.JSON(http.StatusOK, result)
	}
}

func registerAgentQueryRoutes(r *gin.RouterGroup, getService func() *service.ContactService) {
	r.POST("/agent/query", agentQueryHandler(func() agentQueryService {
		svc := getService()
		if svc == nil {
			return nil
		}
		return svc
	}))
}
