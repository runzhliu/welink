package main

// highlights.go — "你和 TA 的高光瞬间"
//
// 选一个联系人，从全部聊天记录里挑出几段"最有故事感"的对话片段。
// 思路：先用规则按天分组挑出候选日（最长聊天日/认识当天/最深夜的一天/最近活跃日 + 随机补位），
// 把这些天前后几条消息送给 LLM，由 LLM 选出 5-8 个高光并配标题摘要，前端渲染成可分享卡片。

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// Highlight 单条高光
type Highlight struct {
	Category string             `json:"category"`        // "认识当天" / "最长聊天日" / "深夜长谈" / "最近"
	Title    string             `json:"title"`           // LLM 起的标题（10-16 字）
	Summary  string             `json:"summary"`         // 一两句话总结，30-60 字
	Date     string             `json:"date"`            // "2024-03-15"
	Excerpt  []HighlightExcerpt `json:"excerpt"`         // 节选 3-5 条对话
}

// HighlightExcerpt 对话节选里的一行
type HighlightExcerpt struct {
	Speaker string `json:"speaker"` // "我" / 对方 displayName
	Time    string `json:"time"`    // "23:14"
	Content string `json:"content"`
}

// HighlightsResponse 接口响应
type HighlightsResponse struct {
	DisplayName   string      `json:"display_name"`
	TotalMessages int64       `json:"total_messages"`
	DaysKnown     int         `json:"days_known"`
	FirstDate     string      `json:"first_date"`
	LastDate      string      `json:"last_date"`
	Highlights    []Highlight `json:"highlights"`
}

// 候选日窗口送给 LLM 的内部结构
type highlightCandidate struct {
	Date     string
	Reason   string // "longest_chat" / "first_day" / "late_night" / "recent" / "random"
	Lines    []string
}

func registerHighlightsRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/highlights", highlightsHandler(getSvc))
}

func highlightsHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var body struct {
			Username  string `json:"username"`
			ProfileID string `json:"profile_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}

		// 联系人基础信息
		var displayName string
		var totalMsgs int64
		for _, stat := range svc.GetCachedStats() {
			if stat.Username == body.Username {
				displayName = stat.Remark
				if displayName == "" {
					displayName = stat.Nickname
				}
				if displayName == "" {
					displayName = stat.Username
				}
				totalMsgs = stat.TotalMessages
				break
			}
		}
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		msgs := svc.ExportContactMessagesAll(body.Username)
		if len(msgs) < 30 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "消息太少（少于 30 条），暂时挑不出高光"})
			return
		}

		// 按日期分组
		byDate := make(map[string][]service.ChatMessage)
		for _, m := range msgs {
			byDate[m.Date] = append(byDate[m.Date], m)
		}
		dates := make([]string, 0, len(byDate))
		for d := range byDate {
			dates = append(dates, d)
		}
		sort.Strings(dates)

		firstDate := dates[0]
		lastDate := dates[len(dates)-1]
		// 相识天数：以日历日数计算
		daysKnown := len(dates)
		if t1, e1 := time.Parse("2006-01-02", firstDate); e1 == nil {
			if t2, e2 := time.Parse("2006-01-02", lastDate); e2 == nil {
				daysKnown = int(t2.Sub(t1).Hours()/24) + 1
			}
		}

		// 挑候选日
		candidates := pickCandidateDates(byDate, dates)
		if len(candidates) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "找不到合适的对话候选"})
			return
		}

		// 拼候选片段（每个候选日最多 25 条）
		const maxLinesPerDay = 25
		const maxRunes = 70
		highlightCands := make([]highlightCandidate, 0, len(candidates))
		for _, cand := range candidates {
			day := byDate[cand.Date]
			lines := make([]string, 0, maxLinesPerDay)
			start := 0
			if len(day) > maxLinesPerDay {
				// 取中间一段（更可能是聊嗨的高潮）
				start = (len(day) - maxLinesPerDay) / 2
			}
			end := start + maxLinesPerDay
			if end > len(day) {
				end = len(day)
			}
			for i := start; i < end; i++ {
				m := day[i]
				speaker := "我"
				if !m.IsMine {
					speaker = displayName
				}
				content := strings.TrimSpace(m.Content)
				if content == "" {
					continue
				}
				if rs := []rune(content); len(rs) > maxRunes {
					content = string(rs[:maxRunes]) + "…"
				}
				lines = append(lines, fmt.Sprintf("[%s] %s: %s", m.Time, speaker, content))
			}
			if len(lines) >= 3 {
				highlightCands = append(highlightCands, highlightCandidate{
					Date:   cand.Date,
					Reason: cand.Reason,
					Lines:  lines,
				})
			}
		}
		if len(highlightCands) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "候选片段过短"})
			return
		}

		// 构造 prompt
		systemPrompt := `你是一位擅长从聊天记录里发现"故事"的写作者。下面给出我和某位联系人在不同日期的几段聊天片段，每段都标注了挑选原因。
请挑出 5-8 段最有"高光感"的（让人想发朋友圈纪念的瞬间），为每一段写一个简短的标题和概括。

判定"高光"的标准：
- 有情绪 / 有故事 / 有专属梗（吵架后和好、深夜真心话、第一次见面、共同回忆某事、互相调侃成习惯）
- 不是寒暄、不是事务性沟通（"在吗""收到""好的")、不是单纯转发链接
- 优先选不同情绪、不同时间段的片段，避免雷同

输出严格 JSON，不要 markdown code fence：
{"highlights":[
  {"date":"2024-03-15","category":"深夜长谈","title":"凌晨三点的真心话","summary":"那天他第一次说起小时候搬家的事，我们聊到天亮。",
   "excerpt":[{"speaker":"我","time":"02:14","content":"..."},{"speaker":"对方","time":"02:16","content":"..."}]}
]}

要求：
- title 10-16 字，要有"故事感"，不要抽象空话
- summary 30-60 字，第一人称口吻，像在给朋友讲那天发生了什么
- category 从这几类挑：「认识当天」「最长聊天日」「深夜长谈」「最近时光」「随机翻到」（按我提供的挑选原因映射）
- excerpt 从给定片段里**原样摘抄** 3-5 条最能体现高光感的对话（不要改写），保留 speaker/time/content
- 如果某个候选片段确实没什么"故事感"（纯寒暄/事务），可以丢掉它，最少返回 5 段，最多 8 段
- 不要输出片段以外的内容、不要解释`

		var ub strings.Builder
		ub.WriteString(fmt.Sprintf("联系人：%s\n累计消息：%d 条\n相识：%s 至 %s\n\n",
			displayName, totalMsgs, firstDate, lastDate))
		for i, hc := range highlightCands {
			fmt.Fprintf(&ub, "── 候选 %d ──\n日期：%s\n挑选原因：%s\n",
				i+1, hc.Date, reasonZh(hc.Reason))
			for _, ln := range hc.Lines {
				ub.WriteString(ln)
				ub.WriteString("\n")
			}
			ub.WriteString("\n")
		}

		// 调用 LLM（按 profile）
		prefs := loadPreferences()
		profPrefs := prefs
		if body.ProfileID != "" {
			cfg := llmConfigForProfile(body.ProfileID, prefs)
			profPrefs.LLMProvider = cfg.provider
			profPrefs.LLMAPIKey = cfg.apiKey
			profPrefs.LLMBaseURL = cfg.baseURL
			profPrefs.LLMModel = cfg.model
		}
		raw, err := CompleteLLM([]LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: ub.String()},
		}, profPrefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败：" + err.Error()})
			return
		}

		raw = stripCodeFence(strings.TrimSpace(raw))
		var parsed struct {
			Highlights []Highlight `json:"highlights"`
		}
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "LLM 返回格式异常：" + err.Error(),
				"raw":   raw,
			})
			return
		}
		if len(parsed.Highlights) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 没返回任何高光"})
			return
		}

		c.JSON(http.StatusOK, HighlightsResponse{
			DisplayName:   displayName,
			TotalMessages: totalMsgs,
			DaysKnown:     daysKnown,
			FirstDate:     firstDate,
			LastDate:      lastDate,
			Highlights:    parsed.Highlights,
		})
	}
}

// pickCandidateDates 从所有日期里挑出最多 ~10 个"值得给 LLM 看"的候选日。
func pickCandidateDates(byDate map[string][]service.ChatMessage, dates []string) []highlightCandidate {
	if len(dates) == 0 {
		return nil
	}
	type dayStat struct {
		date          string
		count         int
		lateNightCnt  int // 0-5 点的消息数
	}
	stats := make([]dayStat, 0, len(dates))
	for _, d := range dates {
		ds := byDate[d]
		ln := 0
		for _, m := range ds {
			// m.Time 格式 "HH:MM"
			if len(m.Time) >= 2 {
				h := m.Time[:2]
				if h >= "00" && h < "05" {
					ln++
				}
			}
		}
		stats = append(stats, dayStat{date: d, count: len(ds), lateNightCnt: ln})
	}

	picked := make(map[string]string) // date -> reason
	add := func(date, reason string) {
		if _, ok := picked[date]; ok {
			return
		}
		picked[date] = reason
	}

	// 1. 认识当天
	add(stats[0].date, "first_day")

	// 2. 最近活跃的一天（最后一天若消息数 ≥ 5 即取，否则向前找）
	for i := len(stats) - 1; i >= 0; i-- {
		if stats[i].count >= 5 {
			add(stats[i].date, "recent")
			break
		}
	}

	// 3. 最长聊天日（按 count 降序取前 4 个，但避开已加入的）
	byCount := make([]dayStat, len(stats))
	copy(byCount, stats)
	sort.Slice(byCount, func(i, j int) bool { return byCount[i].count > byCount[j].count })
	added := 0
	for _, s := range byCount {
		if added >= 4 {
			break
		}
		if _, ok := picked[s.date]; ok {
			continue
		}
		if s.count < 8 {
			break
		}
		add(s.date, "longest_chat")
		added++
	}

	// 4. 深夜长谈（按 lateNightCnt 降序取前 2 个，要求 ≥ 5）
	byLN := make([]dayStat, len(stats))
	copy(byLN, stats)
	sort.Slice(byLN, func(i, j int) bool { return byLN[i].lateNightCnt > byLN[j].lateNightCnt })
	added = 0
	for _, s := range byLN {
		if added >= 2 || s.lateNightCnt < 5 {
			break
		}
		if _, ok := picked[s.date]; ok {
			continue
		}
		add(s.date, "late_night")
		added++
	}

	// 5. 随机补 2 个分布在中间的日子
	if len(stats) > 6 {
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		tries := 0
		added = 0
		for added < 2 && tries < 20 {
			tries++
			idx := rng.Intn(len(stats)-2) + 1
			s := stats[idx]
			if s.count < 6 {
				continue
			}
			if _, ok := picked[s.date]; ok {
				continue
			}
			add(s.date, "random")
			added++
		}
	}

	out := make([]highlightCandidate, 0, len(picked))
	for _, d := range dates {
		if r, ok := picked[d]; ok {
			out = append(out, highlightCandidate{Date: d, Reason: r})
		}
	}
	return out
}

func reasonZh(r string) string {
	switch r {
	case "first_day":
		return "认识当天"
	case "longest_chat":
		return "聊天最长的一天"
	case "late_night":
		return "深夜长谈"
	case "recent":
		return "最近时光"
	case "random":
		return "随机翻到的一天"
	}
	return r
}

func stripCodeFence(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	}
	return strings.TrimSpace(s)
}
