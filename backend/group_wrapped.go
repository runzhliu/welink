package main

// group_wrapped.go — "群聊 Wrapped"
//
// 把单个群浓缩成一张可分享的卡片：发言榜、最常被 @、媒体大王、
// 早鸟夜猫子、最长一句话、Top emoji、群口头禅。
// 纯统计、不调 LLM —— 与 group_year_review 区分：那个是 AI 叙事年报。
//
// API: GET /api/groups/wrapped?room=<roomid>
//
// 单群最多扫 10000 条消息（取最近 N 条），结果按 room 缓存 10 分钟。

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	gwMaxMessages   = 10000
	gwCacheTTL      = 10 * time.Minute
	gwTopMembers    = 5
	gwTopEmojis     = 5
	gwTopPhrases    = 5
	gwMaxLongestLen = 240 // 最长消息预览截断
)

type GWMember struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Messages    int64  `json:"messages"`
}

type GWMediaChampion struct {
	Speaker     string `json:"speaker"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Count       int    `json:"count"`
	Kind        string `json:"kind"`  // "image" / "voice" / "video" / "file"
	Label       string `json:"label"` // 中文标签
}

type GWLongest struct {
	Speaker     string `json:"speaker"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Length      int    `json:"length"`
	Date        string `json:"date,omitempty"`
	Content     string `json:"content"`
}

type GWMention struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type GWPhrase struct {
	Text  string `json:"text"`
	Count int    `json:"count"`
}

type GWEmoji struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type GWNocturnal struct {
	Speaker     string `json:"speaker"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Count       int    `json:"count"` // 该时段消息数
}

type GroupWrappedResp struct {
	GroupName       string             `json:"group_name"`
	Avatar          string             `json:"avatar,omitempty"`
	RoomID          string             `json:"room_id"`
	TotalMessages   int64              `json:"total_messages"` // 实际扫了几条
	HistoricalTotal int64              `json:"historical_total"` // 群历史总消息（来自 GroupInfo）
	Truncated       bool               `json:"truncated"`        // 是否被 cap 限制
	ActiveDays      int                `json:"active_days"`
	MemberCount     int                `json:"member_count"`
	FirstDate       string             `json:"first_date,omitempty"`
	LastDate        string             `json:"last_date,omitempty"`
	PeakHour        int                `json:"peak_hour"`     // 0-23
	PeakHourPct     float64            `json:"peak_hour_pct"`
	BusiestDay      string             `json:"busiest_day,omitempty"`
	BusiestDayCount int                `json:"busiest_day_count"`
	TopMembers      []GWMember         `json:"top_members"`
	MostMentioned   *GWMention         `json:"most_mentioned,omitempty"`
	MediaChampions  []GWMediaChampion  `json:"media_champions"`
	EarlyBird       *GWNocturnal       `json:"early_bird,omitempty"` // 5-9 点发言最多的人
	NightOwl        *GWNocturnal       `json:"night_owl,omitempty"`  // 23-3 点发言最多的人
	LongestMessage  *GWLongest         `json:"longest_message,omitempty"`
	TopEmojis       []GWEmoji          `json:"top_emojis"`
	TopPhrases      []GWPhrase         `json:"top_phrases"`
}

type gwCacheEntry struct {
	val *GroupWrappedResp
	at  time.Time
}

var (
	gwCacheMu sync.Mutex
	gwCache   = make(map[string]gwCacheEntry) // key: room|from|to
)

func gwCacheKey(room string, from, to int64) string {
	return room + "|" + atoi64(from) + "|" + atoi64(to)
}

func atoi64(n int64) string {
	if n == 0 {
		return "0"
	}
	// 简单实现，避免依赖 strconv 形成循环
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	digits := make([]byte, 0, 12)
	for n > 0 {
		digits = append(digits, byte('0'+n%10))
		n /= 10
	}
	for i, j := 0, len(digits)-1; i < j; i, j = i+1, j-1 {
		digits[i], digits[j] = digits[j], digits[i]
	}
	if neg {
		return "-" + string(digits)
	}
	return string(digits)
}

func registerGroupWrappedRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/groups/wrapped", groupWrappedHandler(getSvc))
}

func groupWrappedHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		room := strings.TrimSpace(c.Query("room"))
		if room == "" || !strings.HasSuffix(room, "@chatroom") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "room 必填且必须是群聊（以 @chatroom 结尾）"})
			return
		}

		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"
		key := gwCacheKey(room, from, to)
		if !refresh {
			gwCacheMu.Lock()
			if e, ok := gwCache[key]; ok && time.Since(e.at) < gwCacheTTL {
				v := *e.val
				gwCacheMu.Unlock()
				c.JSON(http.StatusOK, v)
				return
			}
			gwCacheMu.Unlock()
		}

		// 群基础信息
		var groupName, avatar string
		var historicalTotal int64
		for _, g := range svc.GetGroups() {
			if g.Username == room {
				groupName = g.Name
				avatar = g.SmallHeadURL
				historicalTotal = g.TotalMessages
				break
			}
		}
		if groupName == "" {
			groupName = room
		}

		// 取最近 gwMaxMessages 条
		msgs := svc.ExportGroupMessagesRecent(room, gwMaxMessages)
		if len(msgs) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "该群没有可分析的消息"})
			return
		}

		resp := computeGroupWrapped(msgs, room, groupName, avatar, historicalTotal)

		// 群口头禅：复用 GroupDetail.TopWords（service 层已分词去停用词）
		if detail := svc.GetGroupDetail(room); detail != nil && len(detail.TopWords) > 0 {
			limit := gwTopPhrases
			if len(detail.TopWords) < limit {
				limit = len(detail.TopWords)
			}
			resp.TopPhrases = make([]GWPhrase, 0, limit)
			for i := 0; i < limit; i++ {
				resp.TopPhrases = append(resp.TopPhrases, GWPhrase{
					Text:  detail.TopWords[i].Word,
					Count: detail.TopWords[i].Count,
				})
			}
		}

		gwCacheMu.Lock()
		// 顺手清掉过期项，避免长期累积。cache key 含 room|from|to，
		// 大量切换群或调整时间范围会持续增长，必须主动 GC。
		if len(gwCache) >= 10 {
			now := time.Now()
			for k, e := range gwCache {
				if now.Sub(e.at) >= gwCacheTTL {
					delete(gwCache, k)
				}
			}
		}
		gwCache[key] = gwCacheEntry{val: resp, at: time.Now()}
		gwCacheMu.Unlock()

		c.JSON(http.StatusOK, *resp)
	}
}

// computeGroupWrapped 用一组消息生成 Wrapped 卡所需字段（除 TopPhrases 外）
func computeGroupWrapped(msgs []service.GroupChatMessage, room, groupName, avatar string, historicalTotal int64) *GroupWrappedResp {
	resp := &GroupWrappedResp{
		GroupName:       groupName,
		Avatar:          avatar,
		RoomID:          room,
		TotalMessages:   int64(len(msgs)),
		HistoricalTotal: historicalTotal,
		Truncated:       historicalTotal > 0 && historicalTotal > int64(len(msgs)),
		MediaChampions:  []GWMediaChampion{},
		TopMembers:      []GWMember{},
		TopEmojis:       []GWEmoji{},
		TopPhrases:      []GWPhrase{},
	}

	// 累加器
	memberCnt := make(map[string]*GWMember)            // speaker -> count
	memberAvatar := make(map[string]string)            // speaker -> avatar
	dayCnt := make(map[string]int)                     // date -> count
	hourCnt := [24]int{}
	emojiCnt := make(map[string]int)
	mentionCnt := make(map[string]int)
	earlyByMember := make(map[string]int) // 5-8 点
	nightByMember := make(map[string]int) // 23-2 点
	mediaCnt := map[string]map[string]int{
		"image": {},
		"voice": {},
		"video": {},
		"file":  {},
	}

	var (
		longestSpeaker string
		longestAvatar  string
		longestLen     int
		longestContent string
		longestDate    string
	)
	dates := make(map[string]struct{})

	for _, m := range msgs {
		spk := m.Speaker
		if spk == "" {
			spk = "(系统)"
		}
		// 成员
		entry, ok := memberCnt[spk]
		if !ok {
			entry = &GWMember{Username: spk, DisplayName: spk, AvatarURL: m.AvatarURL}
			memberCnt[spk] = entry
		}
		entry.Messages++
		if m.AvatarURL != "" && memberAvatar[spk] == "" {
			memberAvatar[spk] = m.AvatarURL
			entry.AvatarURL = m.AvatarURL
		}

		// 日期
		if m.Date != "" {
			dayCnt[m.Date]++
			dates[m.Date] = struct{}{}
			if resp.FirstDate == "" || m.Date < resp.FirstDate {
				resp.FirstDate = m.Date
			}
			if m.Date > resp.LastDate {
				resp.LastDate = m.Date
			}
		}
		// 小时
		hour := -1
		if len(m.Time) >= 2 {
			if h := parseHour(m.Time); h >= 0 {
				hour = h
				hourCnt[h]++
			}
		}
		if hour >= 5 && hour < 9 {
			earlyByMember[spk]++
		}
		if hour >= 23 || (hour >= 0 && hour < 3) {
			nightByMember[spk]++
		}

		// 媒体类型
		switch m.Type {
		case 3:
			mediaCnt["image"][spk]++
		case 34:
			mediaCnt["voice"][spk]++
		case 43:
			mediaCnt["video"][spk]++
		case 49:
			// 49 包含链接/文件/小程序等；只有显式像文件的算
			if strings.Contains(m.Content, "<type>6</type>") || strings.Contains(m.Content, "<type>4</type>") {
				mediaCnt["file"][spk]++
			}
		}

		// 文本相关
		if m.Type == 1 && m.Content != "" {
			s := m.Content
			countEmojis(s, emojiCnt)
			collectMentions(s, mentionCnt)
			n := utf8.RuneCountInString(s)
			if n > longestLen {
				longestLen = n
				longestSpeaker = spk
				longestAvatar = memberAvatar[spk]
				longestContent = s
				longestDate = m.Date
			}
		}
	}

	resp.MemberCount = len(memberCnt)
	resp.ActiveDays = len(dates)

	// Top 成员
	allMembers := make([]*GWMember, 0, len(memberCnt))
	for _, m := range memberCnt {
		allMembers = append(allMembers, m)
	}
	sort.Slice(allMembers, func(i, j int) bool { return allMembers[i].Messages > allMembers[j].Messages })
	limit := gwTopMembers
	if len(allMembers) < limit {
		limit = len(allMembers)
	}
	resp.TopMembers = make([]GWMember, limit)
	for i := 0; i < limit; i++ {
		resp.TopMembers[i] = *allMembers[i]
	}

	// 峰值小时
	maxH, sumH := 0, 0
	for h, c := range hourCnt {
		sumH += c
		if c > hourCnt[maxH] {
			maxH = h
		}
	}
	resp.PeakHour = maxH
	if sumH > 0 {
		resp.PeakHourPct = float64(hourCnt[maxH]) / float64(sumH)
	}

	// 最忙的一天
	for d, c := range dayCnt {
		if c > resp.BusiestDayCount {
			resp.BusiestDay = d
			resp.BusiestDayCount = c
		}
	}

	// 媒体大王（image / voice / video / file）—— 各取 Top 1
	mediaLabels := []struct {
		kind, label string
	}{
		{"image", "图片大王"},
		{"voice", "语音大王"},
		{"video", "视频大王"},
		{"file", "文件大王"},
	}
	for _, ml := range mediaLabels {
		bucket := mediaCnt[ml.kind]
		if len(bucket) == 0 {
			continue
		}
		var champSpk string
		var champCnt int
		for s, c := range bucket {
			if c > champCnt {
				champCnt = c
				champSpk = s
			}
		}
		if champSpk == "" || champCnt < 3 {
			continue // 小于 3 张不值得标记
		}
		resp.MediaChampions = append(resp.MediaChampions, GWMediaChampion{
			Speaker:     champSpk,
			DisplayName: champSpk,
			AvatarURL:   memberAvatar[champSpk],
			Count:       champCnt,
			Kind:        ml.kind,
			Label:       ml.label,
		})
	}

	// 最常被 @
	if len(mentionCnt) > 0 {
		var topName string
		var topCount int
		for n, c := range mentionCnt {
			if c > topCount {
				topCount = c
				topName = n
			}
		}
		if topCount >= 3 { // 太少没意义
			resp.MostMentioned = &GWMention{Name: topName, Count: topCount}
		}
	}

	// 早鸟（5-8 点发言最多的人，至少 5 条）
	if best, n := topByCount(earlyByMember, 5); best != "" {
		resp.EarlyBird = &GWNocturnal{
			Speaker: best, DisplayName: best, AvatarURL: memberAvatar[best], Count: n,
		}
	}
	// 夜猫子（23-2 点）
	if best, n := topByCount(nightByMember, 5); best != "" {
		resp.NightOwl = &GWNocturnal{
			Speaker: best, DisplayName: best, AvatarURL: memberAvatar[best], Count: n,
		}
	}

	// 最长一条
	if longestLen > 0 {
		preview := longestContent
		if utf8.RuneCountInString(preview) > gwMaxLongestLen {
			runes := []rune(preview)
			preview = string(runes[:gwMaxLongestLen]) + "…"
		}
		resp.LongestMessage = &GWLongest{
			Speaker:     longestSpeaker,
			DisplayName: longestSpeaker,
			AvatarURL:   longestAvatar,
			Length:      longestLen,
			Date:        longestDate,
			Content:     preview,
		}
	}

	// Top emoji
	if len(emojiCnt) > 0 {
		resp.TopEmojis = mapTopK(emojiCnt, gwTopEmojis, func(k string, v int) GWEmoji {
			return GWEmoji{Emoji: k, Count: v}
		})
	}

	return resp
}

// collectMentions 从消息内容里抽 @xxx，按显示名累加
// WeChat @ 后通常跟 U+2005 或普通空格，这里把所有空白都当结束
func collectMentions(s string, m map[string]int) {
	for {
		i := strings.Index(s, "@")
		if i < 0 {
			return
		}
		s = s[i+1:]
		// 取到第一个空白或终止符为止
		end := -1
		runes := []rune(s)
		for j, r := range runes {
			if isMentionEnd(r) {
				end = j
				break
			}
			if j >= 30 { // 名字最多 30 字
				end = j
				break
			}
		}
		var name string
		if end < 0 {
			name = string(runes)
		} else {
			name = string(runes[:end])
		}
		name = strings.TrimSpace(name)
		// 至少 2 字，避免 @1 / @a 这种噪音
		if utf8.RuneCountInString(name) >= 2 {
			m[name]++
		}
		if end < 0 {
			return
		}
		s = string(runes[end:])
	}
}

func isMentionEnd(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\r', ' ', ' ', '@':
		return true
	}
	// 中文标点也算结束（含中英文引号）
	switch r {
	case '，', '。', '！', '？', '：', '；', '（', '）', '"', '\'':
		return true
	case '“', '”', '‘', '’':
		return true
	}
	return false
}

// topByCount 返回 map 中 value 最大且 ≥ minCount 的 key 和 value；都不够则返回 ""
func topByCount(m map[string]int, minCount int) (string, int) {
	var bestK string
	var bestV int
	for k, v := range m {
		if v > bestV {
			bestV = v
			bestK = k
		}
	}
	if bestV < minCount {
		return "", 0
	}
	return bestK, bestV
}
