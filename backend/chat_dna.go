package main

// chat_dna.go — "我的聊天 DNA"
//
// 类似 Spotify Wrapped：把全微信的聊天数据浓缩成几张可分享的"人设卡"。
// 完全靠规则 + 统计，不调 LLM —— 这样既零成本又不会失败。

import (
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// 全局上限 —— 防止人肉极端用户把后端打爆
const (
	dnaMaxContacts        = 60     // 最多取前 60 个最常聊的私聊
	dnaMaxMsgPerContact   = 2000   // 每个联系人最多扫 2000 条
	dnaTopContactsForCard = 5      // 卡片上展示几个 top 联系人
)

type DNATopContact struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Avatar      string `json:"avatar"`
	Messages    int64  `json:"messages"`
}

type DNAEmoji struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type DNAOpener struct {
	Text  string `json:"text"`
	Count int    `json:"count"`
}

type DNAQuickestReplier struct {
	Username    string  `json:"username"`
	DisplayName string  `json:"display_name"`
	Avatar      string  `json:"avatar"`
	MedianSec   float64 `json:"median_sec"` // 我对 ta 的中位回复秒数
	Samples     int     `json:"samples"`
}

type DNALateNight struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Avatar      string `json:"avatar"`
	Count       int    `json:"count"` // 0-5 点之间和 ta 的消息条数
}

type DNALongest struct {
	Date         string `json:"date"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	MessageCount int    `json:"message_count"` // 那天聊了多少条
}

type DNAResponse struct {
	TotalContactsAnalyzed int    `json:"total_contacts_analyzed"`
	TotalMessages         int64  `json:"total_messages"`
	MyMessages            int64  `json:"my_messages"`
	MyChars               int64  `json:"my_chars"` // 我累计敲了多少字
	TheirMessages         int64  `json:"their_messages"`
	FirstDate             string `json:"first_date"`
	DaysActive            int    `json:"days_active"` // 你跟人聊过天的总天数

	BusiestHour   int     `json:"busiest_hour"`           // 0-23
	BusiestHourPct float64 `json:"busiest_hour_pct"`      // 0-1
	LateNightPct  float64 `json:"late_night_pct"`         // 0-5 点的消息占比 0-1

	TopContacts      []DNATopContact     `json:"top_contacts"`
	TopOpeners       []DNAOpener         `json:"top_openers"`        // 我最常用的开场白
	TopEmojis        []DNAEmoji          `json:"top_emojis"`         // 我最常用 emoji
	QuickestReplier  *DNAQuickestReplier `json:"quickest_replier"`   // 我最爱秒回的人（中位回复秒数最小）
	LateNightBuddy   *DNALateNight       `json:"late_night_buddy"`   // 深夜聊得最多的人
	LongestSingleDay *DNALongest         `json:"longest_single_day"` // 单日聊最多的一天
	LongestMessage   string              `json:"longest_message"`    // 我说过最长的一句话
	LongestMessageLen int                `json:"longest_message_len"`
}

func registerChatDNARoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/me/dna", chatDNAHandler(getSvc))
	prot.GET("/me/dna", chatDNAHandler(getSvc))
}

func chatDNAHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		stats := svc.GetCachedStats()
		// 只看私聊、有消息
		type sc struct {
			username, name, avatar string
			total                  int64
		}
		picks := make([]sc, 0, 64)
		for _, st := range stats {
			if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
				continue
			}
			if st.TotalMessages <= 0 {
				continue
			}
			name := st.Remark
			if name == "" {
				name = st.Nickname
			}
			if name == "" {
				name = st.Username
			}
			picks = append(picks, sc{
				username: st.Username,
				name:     name,
				avatar:   st.SmallHeadURL,
				total:    st.TotalMessages,
			})
		}
		if len(picks) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "没有可分析的聊天数据"})
			return
		}
		sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
		if len(picks) > dnaMaxContacts {
			picks = picks[:dnaMaxContacts]
		}

		// 累加器
		hourly := [24]int64{}
		emojiCnt := make(map[string]int)
		openerCnt := make(map[string]int)
		dayCnt := make(map[string]int)              // "2024-03-15|username" -> count
		dayDisplay := make(map[string]string)       // "2024-03-15|username" -> 显示名
		lateNightByContact := make(map[string]int)  // username -> 0-5 点条数
		var (
			totalMsgs      int64
			myMsgs         int64
			theirMsgs      int64
			myChars        int64
			myReplyMedians []replyData
			longestMsgText string
			longestMsgLen  int
			firstTs        int64 // 整个微信里最早一条的 unix
			activeDates    = make(map[string]struct{})
		)

		for _, p := range picks {
			msgs := svc.ExportContactMessagesAll(p.username)
			if len(msgs) > dnaMaxMsgPerContact {
				msgs = msgs[len(msgs)-dnaMaxMsgPerContact:]
			}
			myReplyDelays := collectMyReplyDelays(msgs)
			if len(myReplyDelays) >= 20 {
				myReplyMedians = append(myReplyMedians, replyData{
					username:    p.username,
					displayName: p.name,
					avatar:      p.avatar,
					medianSec:   medianFloat(myReplyDelays),
					samples:     len(myReplyDelays),
				})
			}

			lateNight := 0
			daySession := make(map[string]int) // 这个联系人内的 day -> 条数
			for _, m := range msgs {
				totalMsgs++
				if m.IsMine {
					myMsgs++
				} else {
					theirMsgs++
				}
				activeDates[m.Date] = struct{}{}

				// 时段
				hour := -1
				if len(m.Time) >= 2 {
					if h := parseHour(m.Time); h >= 0 {
						hour = h
						hourly[h]++
						if h < 5 {
							lateNight++
						}
					}
				}

				if t := tsFromDateTime(m.Date, m.Time); t > 0 && (firstTs == 0 || t < firstTs) {
					firstTs = t
				}

				if m.Type != 1 {
					continue
				}
				content := strings.TrimSpace(m.Content)
				if content == "" {
					continue
				}
				if m.IsMine {
					rl := utf8.RuneCountInString(content)
					myChars += int64(rl)
					if rl > longestMsgLen && rl <= 600 { // 排除粘贴的超长块
						longestMsgLen = rl
						longestMsgText = content
					}
					countEmojis(content, emojiCnt)
					if op := extractOpener(content); op != "" {
						openerCnt[op]++
					}
				}
				_ = hour
				daySession[m.Date]++
			}

			// 深夜统计：累到联系人
			if lateNight > 0 {
				lateNightByContact[p.username] = lateNight
			}
			// 单日聊最多
			for d, n := range daySession {
				k := d + "|" + p.username
				dayCnt[k] = n
				dayDisplay[k] = p.name
			}
		}

		// 计算最忙小时
		busiestHour, busiestHourPct := 0, 0.0
		var hourSum int64
		for _, v := range hourly {
			hourSum += v
		}
		if hourSum > 0 {
			for i, v := range hourly {
				if v > hourly[busiestHour] {
					busiestHour = i
				}
			}
			busiestHourPct = float64(hourly[busiestHour]) / float64(hourSum)
		}
		var lateNightSum int64
		for h := 0; h < 5; h++ {
			lateNightSum += hourly[h]
		}
		lateNightPct := 0.0
		if hourSum > 0 {
			lateNightPct = float64(lateNightSum) / float64(hourSum)
		}

		// Top 联系人
		topContacts := make([]DNATopContact, 0, dnaTopContactsForCard)
		for i := 0; i < len(picks) && i < dnaTopContactsForCard; i++ {
			p := picks[i]
			topContacts = append(topContacts, DNATopContact{
				Username:    p.username,
				DisplayName: p.name,
				Avatar:      p.avatar,
				Messages:    p.total,
			})
		}

		// Top emoji
		topEmojis := mapTopK(emojiCnt, 10, func(e string, n int) DNAEmoji {
			return DNAEmoji{Emoji: e, Count: n}
		})

		// Top 开场白
		topOpeners := mapTopK(openerCnt, 5, func(o string, n int) DNAOpener {
			return DNAOpener{Text: o, Count: n}
		})

		// 我最爱秒回的人
		var quickest *DNAQuickestReplier
		if len(myReplyMedians) > 0 {
			sort.Slice(myReplyMedians, func(i, j int) bool {
				return myReplyMedians[i].medianSec < myReplyMedians[j].medianSec
			})
			q := myReplyMedians[0]
			quickest = &DNAQuickestReplier{
				Username:    q.username,
				DisplayName: q.displayName,
				Avatar:      q.avatar,
				MedianSec:   q.medianSec,
				Samples:     q.samples,
			}
		}

		// 深夜搭子
		var lateNightBuddy *DNALateNight
		var lnBest int
		var lnUsername string
		for u, n := range lateNightByContact {
			if n > lnBest {
				lnBest = n
				lnUsername = u
			}
		}
		if lnBest > 0 {
			for _, p := range picks {
				if p.username == lnUsername {
					lateNightBuddy = &DNALateNight{
						Username:    p.username,
						DisplayName: p.name,
						Avatar:      p.avatar,
						Count:       lnBest,
					}
					break
				}
			}
		}

		// 单日最长聊
		var longestDay *DNALongest
		var bestN int
		var bestKey string
		for k, n := range dayCnt {
			if n > bestN {
				bestN = n
				bestKey = k
			}
		}
		if bestN > 0 {
			parts := strings.SplitN(bestKey, "|", 2)
			longestDay = &DNALongest{
				Date:         parts[0],
				Username:     parts[1],
				DisplayName:  dayDisplay[bestKey],
				MessageCount: bestN,
			}
		}

		firstDate := ""
		if firstTs > 0 {
			firstDate = time.Unix(firstTs, 0).Format("2006-01-02")
		}

		c.JSON(http.StatusOK, DNAResponse{
			TotalContactsAnalyzed: len(picks),
			TotalMessages:         totalMsgs,
			MyMessages:            myMsgs,
			TheirMessages:         theirMsgs,
			MyChars:               myChars,
			FirstDate:             firstDate,
			DaysActive:            len(activeDates),
			BusiestHour:           busiestHour,
			BusiestHourPct:        busiestHourPct,
			LateNightPct:          lateNightPct,
			TopContacts:           topContacts,
			TopOpeners:            topOpeners,
			TopEmojis:             topEmojis,
			QuickestReplier:       quickest,
			LateNightBuddy:        lateNightBuddy,
			LongestSingleDay:      longestDay,
			LongestMessage:        longestMsgText,
			LongestMessageLen:     longestMsgLen,
		})
	}
}

type replyData struct {
	username, displayName, avatar string
	medianSec                     float64
	samples                       int
}

// collectMyReplyDelays 找连续序列里"对方最后一条 → 我下一条"的间隔（秒），过滤超过 1 小时的（视为新一段对话）
func collectMyReplyDelays(msgs []service.ChatMessage) []float64 {
	delays := make([]float64, 0, 64)
	var lastTheirTs int64
	for _, m := range msgs {
		if m.Type != 1 {
			continue
		}
		ts := tsFromDateTime(m.Date, m.Time)
		if ts <= 0 {
			continue
		}
		if !m.IsMine {
			lastTheirTs = ts
			continue
		}
		// is mine
		if lastTheirTs > 0 {
			d := ts - lastTheirTs
			if d > 0 && d <= 3600 { // 1 小时内才算"回复"
				delays = append(delays, float64(d))
			}
			lastTheirTs = 0
		}
	}
	return delays
}

func medianFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := make([]float64, len(xs))
	copy(cp, xs)
	sort.Float64s(cp)
	mid := len(cp) / 2
	if len(cp)%2 == 1 {
		return cp[mid]
	}
	return (cp[mid-1] + cp[mid]) / 2
}

// parseHour 从 "HH:MM" 取 HH int 0-23
func parseHour(t string) int {
	if len(t) < 2 {
		return -1
	}
	a := t[0]
	b := t[1]
	if a < '0' || a > '9' || b < '0' || b > '9' {
		return -1
	}
	h := int(a-'0')*10 + int(b-'0')
	if h < 0 || h > 23 {
		return -1
	}
	return h
}

// tsFromDateTime 把 "2024-03-15" + "14:23" 转成本地 unix 秒；不准也无所谓，只用于排序与差值
func tsFromDateTime(date, t string) int64 {
	if date == "" || len(t) < 4 {
		return 0
	}
	loc, _ := time.LoadLocation("Local")
	parsed, err := time.ParseInLocation("2006-01-02 15:04", date+" "+t, loc)
	if err != nil {
		return 0
	}
	return parsed.Unix()
}

// emojiRangeRune 简单判断：是否落在常见 emoji 区段（不完美但够用）
func emojiRangeRune(r rune) bool {
	if r < 0x80 {
		return false
	}
	switch {
	case r >= 0x1F300 && r <= 0x1FAFF: // misc symbols & pictographs / emoticons / transport / supplemental
		return true
	case r >= 0x2600 && r <= 0x27BF: // misc symbols, dingbats
		return true
	case r >= 0x1F100 && r <= 0x1F1FF:
		return true
	case r == 0x2764: // ❤
		return true
	}
	return false
}

func countEmojis(s string, m map[string]int) {
	for _, r := range s {
		if emojiRangeRune(r) {
			m[string(r)]++
		}
	}
}

// extractOpener 抽出消息开头的"开场白" —— 短句、纯文字（不含链接/网址），≤ 8 字
func extractOpener(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "[") {
		return ""
	}
	if strings.Contains(s, "http://") || strings.Contains(s, "https://") {
		return ""
	}
	// 切到第一个标点
	end := -1
	for i, r := range s {
		if unicode.IsSpace(r) || isOpenerSeparator(r) {
			end = i
			break
		}
	}
	first := s
	if end > 0 {
		first = s[:end]
	}
	first = strings.TrimSpace(first)
	rl := utf8.RuneCountInString(first)
	if rl < 1 || rl > 8 {
		return ""
	}
	// 过滤纯数字/纯字母太短的（比如随便发个 "1"）
	if rl == 1 {
		r, _ := utf8.DecodeRuneInString(first)
		if unicode.IsDigit(r) || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return ""
		}
	}
	return first
}

func isOpenerSeparator(r rune) bool {
	switch r {
	case '，', ',', '。', '.', '！', '!', '？', '?', '~', '～', '；', ';', '：', ':':
		return true
	}
	return false
}

// mapTopK 把 map 按 value 降序取前 k，再用 mapper 转出元素
func mapTopK[T any](m map[string]int, k int, mapper func(string, int) T) []T {
	type kv struct {
		k string
		v int
	}
	all := make([]kv, 0, len(m))
	for kk, vv := range m {
		all = append(all, kv{kk, vv})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].v != all[j].v {
			return all[i].v > all[j].v
		}
		return all[i].k < all[j].k
	})
	if k > len(all) {
		k = len(all)
	}
	out := make([]T, 0, k)
	for i := 0; i < k; i++ {
		out = append(out, mapper(all[i].k, all[i].v))
	}
	return out
}

