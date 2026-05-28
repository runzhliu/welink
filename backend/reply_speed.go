package main

// reply_speed.go — 「回复速度榜」 Lab
//
// 对每个私聊算双向回复延迟的中位数：
//   - 我回 TA 多快（你→TA）：TA 发完，我隔多久回
//   - TA 回我多快（TA→你）：我发完，TA 隔多久回
//
// 算法：把消息按时间升序走一遍，发现"说话人翻转"时记一次回复延迟。
// 只在 gap ≤ 阈值（默认 6 小时）时计入 —— 隔夜/隔天的不是"回复"，是新开话题。
// 用中位数（抗长尾），不用均值。样本太少（< minPairs）的联系人不入榜。
//
// 排行三视角：
//   - 谁秒回你：TA→你 中位延迟升序（TA 把你当回事）
//   - 你秒回谁：你→TA 中位延迟升序（你把 TA 当回事）
//   - 最不对等：|你→TA − TA→你| 最大（一方热情一方冷淡）
//
// 零 LLM、秒级时间戳、纯计算。
//
// API:
//   GET  /api/labs/reply-speed[?refresh=1]
//   POST /api/labs/reply-speed

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	rsMaxContacts   = 200             // 最多扫前 N 个最常聊的私聊
	rsMaxGapSeconds = 6 * 3600        // 回复延迟上限：超过 6 小时视为新话题，不计入
	rsMinPairs      = 8               // 单方向至少 8 次回复才算可信
	rsTopLimit      = 30             // 榜单最多 30 条
	rsCacheTTL      = 30 * time.Minute
)

// RSContactRow 单个联系人的回复速度
type RSContactRow struct {
	Username        string `json:"username"`
	DisplayName     string `json:"display_name"`
	AvatarURL       string `json:"avatar_url"`
	MyMedianSec     int64  `json:"my_median_sec"`     // 我回 TA 的中位延迟（秒），-1 = 样本不足
	TheirMedianSec  int64  `json:"their_median_sec"`  // TA 回我的中位延迟（秒），-1 = 样本不足
	MyReplies       int    `json:"my_replies"`        // 我回 TA 的次数
	TheirReplies    int    `json:"their_replies"`     // TA 回我的次数
	// 不对等度：>0 表示你回得更快（你更主动）；<0 表示 TA 回得更快（TA 更主动）
	// 仅当双向都有足够样本时有意义
	GapSec          int64  `json:"gap_sec"`           // my_median - their_median
}

// RSResponse 完整响应
type RSResponse struct {
	ScannedContacts int            `json:"scanned_contacts"`
	// 三个榜各自取 Top N（前端分 tab 展示）
	TheyReplyFast   []RSContactRow `json:"they_reply_fast"`   // 谁秒回你（TA→你 升序）
	YouReplyFast    []RSContactRow `json:"you_reply_fast"`    // 你秒回谁（你→TA 升序）
	MostUneven      []RSContactRow `json:"most_uneven"`       // 最不对等（|gap| 降序）
	GeneratedAt     int64          `json:"generated_at"`
}

var (
	rsCacheMu  sync.Mutex
	rsCacheVal *RSResponse
	rsCacheAt  time.Time
)

func registerReplySpeedRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/reply-speed", replySpeedHandler(getSvc))
	prot.POST("/labs/reply-speed", replySpeedHandler(getSvc))
}

func replySpeedHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		refresh := c.Query("refresh") == "1"

		rsCacheMu.Lock()
		if !refresh && rsCacheVal != nil && time.Since(rsCacheAt) < rsCacheTTL {
			cached := *rsCacheVal
			rsCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		rsCacheMu.Unlock()

		resp := buildReplySpeed(svc)

		rsCacheMu.Lock()
		rsCacheVal = resp
		rsCacheAt = time.Now()
		rsCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

func buildReplySpeed(svc *service.ContactService) *RSResponse {
	t := startTimer("reply_speed_build")

	stats := svc.GetCachedStats()
	type cand struct {
		username, displayName, avatar string
		total                         int64
	}
	picks := make([]cand, 0, 64)
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
		avatar := st.SmallHeadURL
		if avatar == "" {
			avatar = st.BigHeadURL
		}
		picks = append(picks, cand{st.Username, name, avatar, st.TotalMessages})
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
	if len(picks) > rsMaxContacts {
		picks = picks[:rsMaxContacts]
	}

	resp := &RSResponse{
		ScannedContacts: len(picks),
		GeneratedAt:     time.Now().Unix(),
	}

	var rows []RSContactRow
	for _, p := range picks {
		points := svc.ContactMessageTimeline(p.username)
		if len(points) < 2 {
			continue
		}

		var myLatencies, theirLatencies []int64
		for i := 1; i < len(points); i++ {
			prev, cur := points[i-1], points[i]
			// 说话人没翻转 → 同一个人连发，不算回复
			if prev.IsMine == cur.IsMine {
				continue
			}
			gap := cur.Ts - prev.Ts
			if gap <= 0 || gap > rsMaxGapSeconds {
				continue
			}
			if cur.IsMine {
				// 上一条 TA 发、这条我发 → 我回 TA
				myLatencies = append(myLatencies, gap)
			} else {
				// 上一条我发、这条 TA 发 → TA 回我
				theirLatencies = append(theirLatencies, gap)
			}
		}

		row := RSContactRow{
			Username:       p.username,
			DisplayName:    p.displayName,
			AvatarURL:      p.avatar,
			MyMedianSec:    -1,
			TheirMedianSec: -1,
			MyReplies:      len(myLatencies),
			TheirReplies:   len(theirLatencies),
		}
		if len(myLatencies) >= rsMinPairs {
			row.MyMedianSec = medianInt64(myLatencies)
		}
		if len(theirLatencies) >= rsMinPairs {
			row.TheirMedianSec = medianInt64(theirLatencies)
		}
		// 完全没有任何一个方向够样本 → 跳过
		if row.MyMedianSec < 0 && row.TheirMedianSec < 0 {
			continue
		}
		if row.MyMedianSec >= 0 && row.TheirMedianSec >= 0 {
			row.GapSec = row.MyMedianSec - row.TheirMedianSec
		}
		rows = append(rows, row)
	}

	// 谁秒回你：TA→你 升序（只取 their 有样本的）
	theyFast := filterRows(rows, func(r RSContactRow) bool { return r.TheirMedianSec >= 0 })
	sort.Slice(theyFast, func(i, j int) bool { return theyFast[i].TheirMedianSec < theyFast[j].TheirMedianSec })
	resp.TheyReplyFast = capRows(theyFast, rsTopLimit)

	// 你秒回谁：你→TA 升序
	youFast := filterRows(rows, func(r RSContactRow) bool { return r.MyMedianSec >= 0 })
	sort.Slice(youFast, func(i, j int) bool { return youFast[i].MyMedianSec < youFast[j].MyMedianSec })
	resp.YouReplyFast = capRows(youFast, rsTopLimit)

	// 最不对等：双向都有样本，按 |gap| 降序
	uneven := filterRows(rows, func(r RSContactRow) bool { return r.MyMedianSec >= 0 && r.TheirMedianSec >= 0 })
	sort.Slice(uneven, func(i, j int) bool { return abs64(uneven[i].GapSec) > abs64(uneven[j].GapSec) })
	resp.MostUneven = capRows(uneven, rsTopLimit)

	t.Done(nil,
		"scanned_contacts", len(picks),
		"rows", len(rows),
	)
	return resp
}

func medianInt64(xs []int64) int64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]int64(nil), xs...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func filterRows(rows []RSContactRow, keep func(RSContactRow) bool) []RSContactRow {
	out := make([]RSContactRow, 0, len(rows))
	for _, r := range rows {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

func capRows(rows []RSContactRow, n int) []RSContactRow {
	if rows == nil {
		return []RSContactRow{}
	}
	if len(rows) > n {
		return rows[:n]
	}
	return rows
}
