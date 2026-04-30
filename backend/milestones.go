package main

// milestones.go — "关系考古 / Milestones"
//
// 给一位联系人，扫一遍全部消息，挑出几个关系里程碑事件：
//   首次互动 / 首条长文 / 首次深夜聊天 / 最高频一周 / 最长断联 / 重联 / 单日纪录 / 周年
// 完全靠规则统计，不调 LLM。前端用竖向时间轴渲染。
//
// API: POST /api/contacts/milestones {username}
//
// 上限 20000 条消息（取最近的）；按 username + filter 缓存 10 分钟。

import (
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	msMaxMessages       = 20000
	msCacheTTL          = 10 * time.Minute
	msLongMsgThreshold  = 60          // 首条"长文"门槛（rune 数）
	msContentPreviewMax = 80          // 事件里嵌的 content 预览最大字数
	msMinGapSeconds     = 30 * 86400  // 长断联：≥ 30 天才算
	msReconnectGap      = 60 * 86400  // 重联标记：跨过 60 天的间隔
	msLateNightStart    = 0           // 深夜起点（含）
	msLateNightEnd      = 5           // 深夜终点（不含），即 0-4 点
)

type MSEvent struct {
	Date    string `json:"date"`
	Time    string `json:"time,omitempty"`
	Speaker string `json:"speaker"`           // "我" 或 联系人显示名
	Content string `json:"content,omitempty"` // 已截断
	Length  int    `json:"length,omitempty"`  // 原始字数（首条长文用）
}

type MSPeakWeek struct {
	WeekStart    string `json:"week_start"` // 周一 "2024-03-11"
	WeekEnd      string `json:"week_end"`   // 周日 "2024-03-17"
	MessageCount int    `json:"message_count"`
}

type MSGap struct {
	FromDate string `json:"from_date"` // 静默前最后一条消息日期
	ToDate   string `json:"to_date"`   // 重联那条消息日期
	GapDays  int    `json:"gap_days"`
}

type MSBusiestDay struct {
	Date         string `json:"date"`
	MessageCount int    `json:"message_count"`
}

type MSAnniversary struct {
	FirstDate     string `json:"first_date"`       // 第一条消息日期
	YearsCount    int    `json:"years_count"`      // 已完整跨过的整年数
	NextDate      string `json:"next_date"`        // 下次周年日期
	DaysUntilNext int    `json:"days_until_next"`  // 距离下次周年的天数（0=今天就是）
}

type MSResponse struct {
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	Avatar        string `json:"avatar,omitempty"`
	TotalMessages int64  `json:"total_messages"`
	FirstDate     string `json:"first_date,omitempty"`
	LastDate      string `json:"last_date,omitempty"`
	DaysKnown     int    `json:"days_known"`

	FirstMessage     *MSEvent       `json:"first_message,omitempty"`
	FirstLongMessage *MSEvent       `json:"first_long_message,omitempty"`
	FirstLateNight   *MSEvent       `json:"first_late_night,omitempty"`
	PeakWeek         *MSPeakWeek    `json:"peak_week,omitempty"`
	LongestGap       *MSGap         `json:"longest_gap,omitempty"`
	Reunion          *MSEvent       `json:"reunion,omitempty"`
	BusiestDay       *MSBusiestDay  `json:"busiest_day,omitempty"`
	Anniversary      *MSAnniversary `json:"anniversary,omitempty"`
}

type msCacheEntry struct {
	val *MSResponse
	at  time.Time
}

var (
	msCacheMu sync.Mutex
	msCache   = make(map[string]msCacheEntry) // key: username|from|to
)

func registerMilestonesRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/milestones", milestonesHandler(getSvc))
}

func milestonesHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var body struct {
			Username string `json:"username"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}
		uname := body.Username
		if strings.HasSuffix(uname, "@chatroom") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "milestones 仅支持私聊联系人"})
			return
		}

		from, to := svc.Filter()
		key := uname + "|" + atoi64(from) + "|" + atoi64(to)
		msCacheMu.Lock()
		if e, ok := msCache[key]; ok && time.Since(e.at) < msCacheTTL {
			v := *e.val
			msCacheMu.Unlock()
			c.JSON(http.StatusOK, v)
			return
		}
		msCacheMu.Unlock()

		// 联系人基础信息
		var displayName, avatar string
		var totalMsgs int64
		for _, st := range svc.GetCachedStats() {
			if st.Username == uname {
				displayName = st.Remark
				if displayName == "" {
					displayName = st.Nickname
				}
				if displayName == "" {
					displayName = st.Username
				}
				avatar = st.SmallHeadURL
				totalMsgs = st.TotalMessages
				break
			}
		}
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		msgs := svc.ExportContactMessagesAll(uname)
		// 太少没意思
		if len(msgs) < 20 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "消息太少（少于 20 条），暂时挑不出里程碑"})
			return
		}
		// cap 取最近 N 条；为了"首次互动"还有意义，这里取 head + tail：
		// 头 10000 条用于挑"第一次"类事件，尾 10000 条用于挑"最近活跃"类事件。
		// 简化版：直接全用，但若 > 20000 只截最近 20000，"首次"类用头部 5000 条找。
		// （绝大多数对话都到不了这个量级，这里只是兜底。）
		var firstSlice, allSlice []service.ChatMessage
		if len(msgs) > msMaxMessages {
			firstSlice = msgs[:5000]
			allSlice = msgs[len(msgs)-msMaxMessages:]
		} else {
			firstSlice = msgs
			allSlice = msgs
		}

		loc := svc.Location()
		resp := &MSResponse{
			Username:      uname,
			DisplayName:   displayName,
			Avatar:        avatar,
			TotalMessages: totalMsgs,
		}

		// First / Last date 与 days known
		datesSet := make(map[string]struct{}, 256)
		for _, m := range allSlice {
			if m.Date != "" {
				datesSet[m.Date] = struct{}{}
			}
		}
		// 首日要从 firstSlice 看（如果切片了）
		for _, m := range firstSlice {
			if m.Date == "" {
				continue
			}
			if resp.FirstDate == "" || m.Date < resp.FirstDate {
				resp.FirstDate = m.Date
			}
		}
		for _, m := range allSlice {
			if m.Date == "" {
				continue
			}
			if m.Date > resp.LastDate {
				resp.LastDate = m.Date
			}
		}
		resp.DaysKnown = daysBetween(resp.FirstDate, resp.LastDate)

		// 首次互动：firstSlice 里最早一条非系统消息（Type==1 优先，否则任何文本）
		resp.FirstMessage = findFirstMessage(firstSlice, displayName)

		// 首条长文：firstSlice 里第一条 ≥ 60 字的文本
		resp.FirstLongMessage = findFirstLongMessage(firstSlice, displayName)

		// 首次深夜：firstSlice 里第一条 0-5 点的文本
		resp.FirstLateNight = findFirstLateNight(firstSlice, displayName)

		// 最高频一周：allSlice 全部消息按 ISO 周聚合
		resp.PeakWeek = findPeakWeek(allSlice, loc)

		// 最忙的一天：allSlice 全部消息按日期聚合
		resp.BusiestDay = findBusiestDay(allSlice)

		// 最长断联 + 重联：allSlice 邻接消息时间差最大的那次
		gap, reunion := findLongestGap(allSlice, loc, displayName)
		resp.LongestGap = gap
		resp.Reunion = reunion

		// 周年
		resp.Anniversary = computeAnniversary(resp.FirstDate, loc)

		msCacheMu.Lock()
		msCache[key] = msCacheEntry{val: resp, at: time.Now()}
		msCacheMu.Unlock()

		c.JSON(http.StatusOK, *resp)
	}
}

// daysBetween 返回 [d1, d2] 包含的日历天数；解析失败回退到 datesSet 大小由调用方处理
func daysBetween(d1, d2 string) int {
	t1, e1 := time.Parse("2006-01-02", d1)
	t2, e2 := time.Parse("2006-01-02", d2)
	if e1 != nil || e2 != nil {
		return 0
	}
	return int(t2.Sub(t1).Hours()/24) + 1
}

// truncContent 把消息内容限制在 msContentPreviewMax 字符内
func truncContent(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= msContentPreviewMax {
		return s
	}
	runes := []rune(s)
	return string(runes[:msContentPreviewMax]) + "…"
}

func speakerOf(m service.ChatMessage, displayName string) string {
	if m.IsMine {
		return "我"
	}
	return displayName
}

func findFirstMessage(msgs []service.ChatMessage, displayName string) *MSEvent {
	for _, m := range msgs {
		if m.Type == 10000 || m.Type == 11000 {
			continue
		}
		if m.Date == "" {
			continue
		}
		c := strings.TrimSpace(m.Content)
		if c == "" {
			continue
		}
		// 系统消息内容过滤（"已通过你的好友请求"等）
		if isSystemNotice(c) {
			continue
		}
		return &MSEvent{
			Date:    m.Date,
			Time:    m.Time,
			Speaker: speakerOf(m, displayName),
			Content: truncContent(c),
		}
	}
	return nil
}

func findFirstLongMessage(msgs []service.ChatMessage, displayName string) *MSEvent {
	for _, m := range msgs {
		if m.Type != 1 || m.Date == "" {
			continue
		}
		c := strings.TrimSpace(m.Content)
		if utf8.RuneCountInString(c) < msLongMsgThreshold {
			continue
		}
		return &MSEvent{
			Date:    m.Date,
			Time:    m.Time,
			Speaker: speakerOf(m, displayName),
			Content: truncContent(c),
			Length:  utf8.RuneCountInString(c),
		}
	}
	return nil
}

func findFirstLateNight(msgs []service.ChatMessage, displayName string) *MSEvent {
	for _, m := range msgs {
		if m.Type != 1 || m.Date == "" {
			continue
		}
		h := parseHour(m.Time)
		if h < msLateNightStart || h >= msLateNightEnd {
			continue
		}
		c := strings.TrimSpace(m.Content)
		if c == "" {
			continue
		}
		return &MSEvent{
			Date:    m.Date,
			Time:    m.Time,
			Speaker: speakerOf(m, displayName),
			Content: truncContent(c),
		}
	}
	return nil
}

func findPeakWeek(msgs []service.ChatMessage, loc *time.Location) *MSPeakWeek {
	weekCnt := make(map[string]int) // weekStart "YYYY-MM-DD" -> count
	for _, m := range msgs {
		if m.Date == "" {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02", m.Date, loc)
		if err != nil {
			continue
		}
		// ISO 周一作为 key
		wd := int(t.Weekday())
		if wd == 0 {
			wd = 7
		}
		monday := t.AddDate(0, 0, -(wd - 1))
		weekCnt[monday.Format("2006-01-02")]++
	}
	if len(weekCnt) == 0 {
		return nil
	}
	var bestWeek string
	var bestCnt int
	for w, c := range weekCnt {
		if c > bestCnt {
			bestCnt = c
			bestWeek = w
		}
	}
	if bestCnt == 0 {
		return nil
	}
	monday, err := time.ParseInLocation("2006-01-02", bestWeek, loc)
	if err != nil {
		return &MSPeakWeek{WeekStart: bestWeek, WeekEnd: bestWeek, MessageCount: bestCnt}
	}
	return &MSPeakWeek{
		WeekStart:    bestWeek,
		WeekEnd:      monday.AddDate(0, 0, 6).Format("2006-01-02"),
		MessageCount: bestCnt,
	}
}

func findBusiestDay(msgs []service.ChatMessage) *MSBusiestDay {
	dayCnt := make(map[string]int)
	for _, m := range msgs {
		if m.Date == "" {
			continue
		}
		dayCnt[m.Date]++
	}
	if len(dayCnt) == 0 {
		return nil
	}
	var bestDay string
	var bestCnt int
	for d, c := range dayCnt {
		if c > bestCnt {
			bestCnt = c
			bestDay = d
		}
	}
	if bestCnt < 10 {
		// 一天没聊几句的日子不值得标记
		return nil
	}
	return &MSBusiestDay{Date: bestDay, MessageCount: bestCnt}
}

func findLongestGap(msgs []service.ChatMessage, loc *time.Location, displayName string) (*MSGap, *MSEvent) {
	if len(msgs) < 2 {
		return nil, nil
	}
	var maxGap int64
	maxIdx := -1
	prevTs := int64(0)
	for i, m := range msgs {
		ts := tsFromDateTime(m.Date, m.Time, loc)
		if ts <= 0 {
			continue
		}
		if prevTs > 0 {
			gap := ts - prevTs
			if gap > maxGap {
				maxGap = gap
				maxIdx = i
			}
		}
		prevTs = ts
	}
	if maxIdx < 1 || maxGap < msMinGapSeconds {
		return nil, nil
	}
	gapDays := int(maxGap / 86400)
	gap := &MSGap{
		FromDate: msgs[maxIdx-1].Date,
		ToDate:   msgs[maxIdx].Date,
		GapDays:  gapDays,
	}
	var reunion *MSEvent
	if maxGap >= msReconnectGap {
		// 重联只有跨越 60 天的才标
		rm := msgs[maxIdx]
		c := strings.TrimSpace(rm.Content)
		reunion = &MSEvent{
			Date:    rm.Date,
			Time:    rm.Time,
			Speaker: speakerOf(rm, displayName),
			Content: truncContent(c),
		}
	}
	return gap, reunion
}

func computeAnniversary(firstDate string, loc *time.Location) *MSAnniversary {
	if firstDate == "" {
		return nil
	}
	first, err := time.ParseInLocation("2006-01-02", firstDate, loc)
	if err != nil {
		return nil
	}
	now := time.Now().In(loc)
	years := now.Year() - first.Year()
	// 这年的纪念日
	nextDate := time.Date(now.Year(), first.Month(), first.Day(), 0, 0, 0, 0, loc)
	if !nextDate.After(now) && nextDate.YearDay() != now.YearDay() {
		// 今年的已过，看明年
		nextDate = nextDate.AddDate(1, 0, 0)
	} else if nextDate.YearDay() == now.YearDay() {
		// 今天就是周年
	} else if !nextDate.After(now) {
		nextDate = nextDate.AddDate(1, 0, 0)
	}
	// 已完整跨过的年数：最近一次纪念日 ≤ 今天 时算 1 年
	pastAnniv := time.Date(now.Year(), first.Month(), first.Day(), 0, 0, 0, 0, loc)
	if pastAnniv.After(now) {
		years--
	}
	if years < 0 {
		years = 0
	}
	daysUntil := int(nextDate.Sub(now).Hours()/24) + 1
	if daysUntil < 0 {
		daysUntil = 0
	}
	return &MSAnniversary{
		FirstDate:     firstDate,
		YearsCount:    years,
		NextDate:      nextDate.Format("2006-01-02"),
		DaysUntilNext: daysUntil,
	}
}

// isSystemNotice 简单识别系统提示文案（作为兜底，避免"首次互动"被当成系统通知）
func isSystemNotice(s string) bool {
	for _, k := range []string{
		"通过了你的朋友验证",
		"现在我们可以开始聊天了",
		"已添加了你为朋友",
		"对方已添加你为朋友",
		"以上是打招呼内容",
		"以上为打招呼内容",
		"Accepted your friend request",
		"We can now chat",
	} {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}
