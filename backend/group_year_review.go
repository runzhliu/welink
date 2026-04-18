package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// registerGroupYearReviewRoutes 注册群聊年度回顾 API。
func registerGroupYearReviewRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/groups/year-review", groupYearReviewHandler(getSvc))
}

// GroupYearReviewResponse AI 群聊年报响应
type GroupYearReviewResponse struct {
	GroupName        string         `json:"group_name"`
	Year             int            `json:"year"`
	TotalMessages    int64          `json:"total_messages"`
	TotalMembers     int            `json:"total_members"`       // 当年活跃人数
	BusiestDay       string         `json:"busiest_day"`         // "2025-03-14"
	BusiestDayCount  int            `json:"busiest_day_count"`
	TopMembers       []YRMember     `json:"top_members"`         // Top 3 发言者
	TopTopics        []string       `json:"top_topics"`          // 高频词 Top 3
	GoldenQuotes     []string       `json:"golden_quotes"`       // AI 提炼 3 句经典语录
	MonthlyTrend     [12]int        `json:"monthly_trend"`       // 12 月消息量
	Highlight        string         `json:"highlight,omitempty"` // AI 叙事的一段话
}

// YRMember 年报里的成员条目
type YRMember struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Messages    int64  `json:"messages"`
}

// GET /api/groups/year-review?username=xxx&year=2025&profile_id=xxx
func groupYearReviewHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		uname := strings.TrimSpace(c.Query("username"))
		if uname == "" || !strings.HasSuffix(uname, "@chatroom") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填且必须是群聊"})
			return
		}
		year := time.Now().Year()
		if y := c.Query("year"); y != "" {
			if n, err := strconv.Atoi(y); err == nil && n >= 2010 && n <= 2100 {
				year = n
			}
		}
		profileID := c.Query("profile_id")

		data, err := buildGroupYearReview(svc, uname, year, profileID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, data)
	}
}

// buildGroupYearReview 读该群该年所有消息，计算统计 + 调 LLM 提炼语录/叙事
func buildGroupYearReview(svc *service.ContactService, uname string, year int, profileID string) (*GroupYearReviewResponse, error) {
	// 群名
	groups := svc.GetGroups()
	name := uname
	for _, g := range groups {
		if g.Username == uname {
			name = g.Name
			break
		}
	}

	// 年度时间范围
	loc, _ := time.LoadLocation("Asia/Shanghai")
	start := time.Date(year, 1, 1, 0, 0, 0, 0, loc).Unix()
	end := time.Date(year+1, 1, 1, 0, 0, 0, 0, loc).Unix()

	// 取该年所有消息
	msgs := svc.ExportGroupMessages(uname, start, end)
	if len(msgs) == 0 {
		return nil, fmt.Errorf("%d 年该群没有消息", year)
	}

	resp := &GroupYearReviewResponse{
		GroupName:     name,
		Year:          year,
		TotalMessages: int64(len(msgs)),
	}

	// 按成员聚合 + 日聚合 + 月度趋势 + 文本采样
	memberCnt := make(map[string]*YRMember)
	dayCnt := make(map[string]int)
	var textSamples []string
	for _, m := range msgs {
		if m.Speaker != "" {
			entry, ok := memberCnt[m.Speaker]
			if !ok {
				entry = &YRMember{Username: m.Speaker, DisplayName: m.Speaker, AvatarURL: m.AvatarURL}
				memberCnt[m.Speaker] = entry
			}
			entry.Messages++
		}
		if m.Date != "" {
			dayCnt[m.Date]++
			// 从 "YYYY-MM-DD" 提取月份填月度趋势
			if len(m.Date) >= 7 {
				if mm, err := strconv.Atoi(m.Date[5:7]); err == nil && mm >= 1 && mm <= 12 {
					resp.MonthlyTrend[mm-1]++
				}
			}
		}
		if m.Type == 1 && m.Content != "" {
			c := strings.TrimSpace(m.Content)
			if len([]rune(c)) >= 6 && len([]rune(c)) <= 80 {
				textSamples = append(textSamples, c)
			}
		}
	}
	resp.TotalMembers = len(memberCnt)

	// Top 成员 Top 3
	members := make([]*YRMember, 0, len(memberCnt))
	for _, m := range memberCnt {
		members = append(members, m)
	}
	sort.Slice(members, func(i, j int) bool { return members[i].Messages > members[j].Messages })
	if len(members) > 3 {
		members = members[:3]
	}
	resp.TopMembers = make([]YRMember, len(members))
	for i, m := range members {
		resp.TopMembers[i] = *m
	}

	// 最忙的一天
	for d, c := range dayCnt {
		if c > resp.BusiestDayCount {
			resp.BusiestDay = d
			resp.BusiestDayCount = c
		}
	}

	// 高频词 Top 3
	detail := svc.GetGroupDetail(uname)
	if detail != nil && len(detail.TopWords) > 0 {
		for i, w := range detail.TopWords {
			if i >= 3 {
				break
			}
			resp.TopTopics = append(resp.TopTopics, w.Word)
		}
	}

	// AI 经典语录 + 叙事
	if len(textSamples) >= 20 {
		quotes, highlight, err := llmGroupReview(resp, textSamples, profileID)
		if err == nil {
			resp.GoldenQuotes = quotes
			resp.Highlight = highlight
		}
	}

	return resp, nil
}

// llmGroupReview 调 LLM 提炼 3 条经典语录 + 一段叙事
func llmGroupReview(resp *GroupYearReviewResponse, samples []string, profileID string) ([]string, string, error) {
	// 从 samples 里随机挑 80 条做上下文（避免超 token）
	if len(samples) > 80 {
		// 均匀抽 80 条
		step := len(samples) / 80
		picked := make([]string, 0, 80)
		for i := 0; i < len(samples) && len(picked) < 80; i += step {
			picked = append(picked, samples[i])
		}
		samples = picked
	}

	topMembers := make([]string, 0, len(resp.TopMembers))
	for _, m := range resp.TopMembers {
		topMembers = append(topMembers, fmt.Sprintf("%s(%d 条)", m.DisplayName, m.Messages))
	}

	systemPrompt := `你是一位善于讲故事的年度总结撰稿人。根据一个微信群在某一年的聊天片段，输出严格 JSON：

{
  "quotes": ["XX", "XX", "XX"],    // 3 条最能体现这个群氛围的经典语录（直接引用原话，不加注释）
  "highlight": "XXX"                // 一段 60-100 字的叙事，像 Spotify Wrapped 风格，总结这一年群里发生了什么
}

要求：
- quotes 必须是原文，不允许改写；优先挑金句/梗/有辨识度的表达
- highlight 要具体、不空话；结合成员、话题、活跃度写，少用套话
- 不要 markdown code fence，直接裸 JSON`

	userPrompt := fmt.Sprintf(`群名：%s
年份：%d
总消息：%d 条
活跃成员：%d 人
最忙一天：%s（%d 条）
发言榜 Top 3：%s
高频词 Top 3：%s

聊天片段（按时间采样）：
%s`, resp.GroupName, resp.Year, resp.TotalMessages, resp.TotalMembers,
		resp.BusiestDay, resp.BusiestDayCount,
		strings.Join(topMembers, " / "),
		strings.Join(resp.TopTopics, " / "),
		strings.Join(samples, "\n"))

	prefs := loadPreferences()
	profPrefs := prefs
	if profileID != "" {
		cfg := llmConfigForProfile(profileID, prefs)
		profPrefs.LLMProvider = cfg.provider
		profPrefs.LLMAPIKey = cfg.apiKey
		profPrefs.LLMBaseURL = cfg.baseURL
		profPrefs.LLMModel = cfg.model
	}

	raw, err := CompleteLLM([]LLMMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}, profPrefs)
	if err != nil {
		return nil, "", err
	}
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		if idx := strings.Index(raw, "\n"); idx >= 0 {
			raw = raw[idx+1:]
		}
		if idx := strings.LastIndex(raw, "```"); idx >= 0 {
			raw = raw[:idx]
		}
	}
	raw = strings.TrimSpace(raw)

	var parsed struct {
		Quotes    []string `json:"quotes"`
		Highlight string   `json:"highlight"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, "", fmt.Errorf("LLM 返回格式异常：%w", err)
	}
	return parsed.Quotes, parsed.Highlight, nil
}
