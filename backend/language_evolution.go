package main

// language_evolution.go — 「我的语言进化史」
//
// 把"我"发的所有文本消息按年聚合，统计 5 个能反映说话风格的指标：
//   - avg_chars  每条消息平均字数（句长）
//   - emoji_per_100   每 100 条消息平均 emoji 数
//   - english_pct      含英文字母的消息占比
//   - top_openers      Top 3 最常用开场白
//   - longest_msg      该年说过最长一句话
//
// 这是 Wrapped 风格的"时间序列版" —— 现有的 /api/me/dna 是单一年快照，
// 这里画出"我自己"在多年里说话风格的变化曲线。零 LLM、本地缓存 2h。
//
// API: GET /api/me/language-evolution[?refresh=1]

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	leMaxContacts        = 80              // 最多扫前 80 个最常聊的私聊
	leMaxMsgPerContact   = 5000            // 每人最多 5000 条
	leMinMsgsPerYear     = 50              // 该年文本消息少于 50 条不出卡（统计不稳）
	leCacheTTL           = 2 * time.Hour
	leLongestMsgRuneCap  = 240             // 最长一句话显示截断
)

// LEYear 一年的语言指标
type LEYear struct {
	Year           int             `json:"year"`
	MyMessages     int64           `json:"my_messages"`
	MyChars        int64           `json:"my_chars"`
	AvgChars       float64         `json:"avg_chars"`
	EmojiCount     int64           `json:"emoji_count"`
	EmojiPer100    float64         `json:"emoji_per_100"`     // 每 100 条消息的 emoji 数
	EnglishMsgs    int64           `json:"english_msgs"`
	EnglishPct     float64         `json:"english_pct"`       // 0-1
	ActiveDays     int             `json:"active_days"`
	MsgsPerDay     float64         `json:"msgs_per_day"`      // 活跃日的日均
	TopOpeners     []DNAOpener     `json:"top_openers"`       // Top 3
	LongestMessage string          `json:"longest_message"`
	LongestLen     int             `json:"longest_len"`
}

// LanguageEvolutionResponse 语言进化史完整响应
type LanguageEvolutionResponse struct {
	Years            []LEYear `json:"years"`              // 升序，仅含消息 ≥ leMinMsgsPerYear 的年份
	TotalMyMessages  int64    `json:"total_my_messages"`
	TotalMyChars     int64    `json:"total_my_chars"`
	FirstYear        int      `json:"first_year"`
	LastYear         int      `json:"last_year"`
	ContactsScanned  int      `json:"contacts_scanned"`
	GeneratedAt      int64    `json:"generated_at"`
}

// 缓存（Reinitialize 后 from/to 变化即失效）
var (
	leCacheMu   sync.Mutex
	leCacheVal  *LanguageEvolutionResponse
	leCacheAt   time.Time
	leCacheFrom int64
	leCacheTo   int64
)

func registerLanguageEvolutionRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/me/language-evolution", languageEvolutionHandler(getSvc))
	prot.POST("/me/language-evolution", languageEvolutionHandler(getSvc))
}

func languageEvolutionHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"

		leCacheMu.Lock()
		if !refresh && leCacheVal != nil &&
			leCacheFrom == from && leCacheTo == to &&
			time.Since(leCacheAt) < leCacheTTL {
			cached := *leCacheVal
			leCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		leCacheMu.Unlock()

		// 选私聊 Top N（沿用 DNA 的口径）
		stats := svc.GetCachedStats()
		type sc struct {
			username string
			total    int64
		}
		picks := make([]sc, 0, 64)
		for _, st := range stats {
			if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
				continue
			}
			if st.TotalMessages <= 0 {
				continue
			}
			picks = append(picks, sc{username: st.Username, total: st.TotalMessages})
		}
		if len(picks) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "没有可分析的聊天数据"})
			return
		}
		sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
		if len(picks) > leMaxContacts {
			picks = picks[:leMaxContacts]
		}

		// 按年聚合
		type yearAgg struct {
			myMsgs       int64
			myChars      int64
			emojiCount   int64
			englishMsgs  int64
			activeDays   map[string]struct{}
			openerCnt    map[string]int
			longestLen   int
			longestText  string
		}
		buckets := make(map[int]*yearAgg)
		getBucket := func(y int) *yearAgg {
			b, ok := buckets[y]
			if !ok {
				b = &yearAgg{
					activeDays: make(map[string]struct{}),
					openerCnt:  make(map[string]int),
				}
				buckets[y] = b
			}
			return b
		}

		var totalMyMsgs, totalMyChars int64

		for _, p := range picks {
			msgs := svc.ExportContactMessagesAll(p.username)
			if len(msgs) > leMaxMsgPerContact {
				msgs = msgs[len(msgs)-leMaxMsgPerContact:]
			}
			for _, m := range msgs {
				if !m.IsMine || m.Type != 1 {
					continue
				}
				if len(m.Date) < 4 {
					continue
				}
				year, ok := parseYear4(m.Date)
				if !ok {
					continue
				}
				content := strings.TrimSpace(m.Content)
				if content == "" {
					continue
				}
				b := getBucket(year)
				b.myMsgs++
				totalMyMsgs++
				rl := utf8.RuneCountInString(content)
				b.myChars += int64(rl)
				totalMyChars += int64(rl)
				b.activeDays[m.Date] = struct{}{}

				// emoji 计数（复用 chat_dna.go 的判定）
				for _, r := range content {
					if emojiRangeRune(r) {
						b.emojiCount++
					}
				}

				// 英文夹杂：消息中含任意 ASCII 字母
				if hasASCIILetter(content) {
					b.englishMsgs++
				}

				// 开场白
				if op := extractOpener(content); op != "" {
					b.openerCnt[op]++
				}

				// 最长一句话（限制 ≤600 排除粘贴块）
				if rl > b.longestLen && rl <= 600 {
					b.longestLen = rl
					b.longestText = content
				}
			}
		}

		// 输出年份排序
		years := make([]int, 0, len(buckets))
		for y := range buckets {
			years = append(years, y)
		}
		sort.Ints(years)

		out := make([]LEYear, 0, len(years))
		var firstYear, lastYear int
		for _, y := range years {
			b := buckets[y]
			if b.myMsgs < leMinMsgsPerYear {
				continue
			}
			avgChars := 0.0
			if b.myMsgs > 0 {
				avgChars = float64(b.myChars) / float64(b.myMsgs)
			}
			emojiPer100 := 0.0
			if b.myMsgs > 0 {
				emojiPer100 = float64(b.emojiCount) * 100 / float64(b.myMsgs)
			}
			engPct := 0.0
			if b.myMsgs > 0 {
				engPct = float64(b.englishMsgs) / float64(b.myMsgs)
			}
			activeDays := len(b.activeDays)
			msgsPerDay := 0.0
			if activeDays > 0 {
				msgsPerDay = float64(b.myMsgs) / float64(activeDays)
			}
			openers := mapTopK(b.openerCnt, 3, func(k string, v int) DNAOpener {
				return DNAOpener{Text: k, Count: v}
			})
			longest := b.longestText
			if rl := []rune(longest); len(rl) > leLongestMsgRuneCap {
				longest = string(rl[:leLongestMsgRuneCap]) + "…"
			}
			out = append(out, LEYear{
				Year:           y,
				MyMessages:     b.myMsgs,
				MyChars:        b.myChars,
				AvgChars:       roundTo2(avgChars),
				EmojiCount:     b.emojiCount,
				EmojiPer100:    roundTo2(emojiPer100),
				EnglishMsgs:    b.englishMsgs,
				EnglishPct:     roundTo4(engPct),
				ActiveDays:     activeDays,
				MsgsPerDay:     roundTo2(msgsPerDay),
				TopOpeners:     openers,
				LongestMessage: longest,
				LongestLen:     b.longestLen,
			})
			if firstYear == 0 || y < firstYear {
				firstYear = y
			}
			if y > lastYear {
				lastYear = y
			}
		}

		resp := LanguageEvolutionResponse{
			Years:           out,
			TotalMyMessages: totalMyMsgs,
			TotalMyChars:    totalMyChars,
			FirstYear:       firstYear,
			LastYear:        lastYear,
			ContactsScanned: len(picks),
			GeneratedAt:     time.Now().Unix(),
		}

		leCacheMu.Lock()
		leCacheVal = &resp
		leCacheAt = time.Now()
		leCacheFrom = from
		leCacheTo = to
		leCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

// parseYear4 从 "YYYY-MM-DD" 取年份。返回 (year, ok)
func parseYear4(date string) (int, bool) {
	if len(date) < 4 {
		return 0, false
	}
	y := 0
	for i := 0; i < 4; i++ {
		c := date[i]
		if c < '0' || c > '9' {
			return 0, false
		}
		y = y*10 + int(c-'0')
	}
	if y < 2000 || y > 2100 {
		return 0, false
	}
	return y, true
}

// hasASCIILetter 是否含至少一个 a-zA-Z（用于"英文夹杂率"）
func hasASCIILetter(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			// 但要确保不是 emoji 描述里的 ASCII（如"[微笑]"）。最快剔除：开头是 [。
			// extractOpener 已经处理过这种，这里只做简单判断。
			_ = unicode.IsLetter // 保留 import 占位
			return true
		}
	}
	return false
}

func roundTo2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

func roundTo4(v float64) float64 {
	return float64(int64(v*10000+0.5)) / 10000
}
