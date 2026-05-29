package main

// initiative.go — 「主动指数榜」 Lab
//
// 看每段对话是谁先开口的。和「回复速度榜」是绝配：
//   - 回复速度 = 收到消息后多久回（秒回 = 把你当回事）
//   - 主动指数 = 谁先打破沉默主动找对方（主动 = 想念 / 在意）
//
// 算法：把消息按时间升序走一遍，距上一条 > sessionGap（默认 4 小时）
// 就算"开启一段新对话"。这段对话的第一条是谁发的，谁就记一次"主动开场"。
// 统计每个私聊里：我开场几次 / TA 开场几次 / 共几段对话。
// 对话段数太少（< minSessions）的不可信，不入榜。
//
// 排行三视角：
//   - 你主动找的人：你开场占比最高（你总忍不住先开口）
//   - 主动找你的人：TA 开场占比最高（TA 总惦记你）
//   - 最不对等：开场占比离 50% 最远（一方一直主动 / 一方从不主动）
//
// 零 LLM、秒级时间戳、纯计算。复用 ContactMessageTimeline。
//
// API:
//   GET  /api/labs/initiative[?refresh=1]
//   POST /api/labs/initiative

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	inMaxContacts      = 200            // 最多扫前 N 个最常聊的私聊
	inSessionGapSecond = 4 * 3600       // 静默超过 4 小时 → 下一条算"开启新对话"
	inMinSessions      = 6              // 至少 6 段对话才入榜
	inTopLimit         = 30             // 榜单最多 30 条
	inCacheTTL         = 30 * time.Minute
)

// INContactRow 单个联系人的主动情况
type INContactRow struct {
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	AvatarURL     string  `json:"avatar_url"`
	MyOpens       int     `json:"my_opens"`       // 我主动开场次数
	TheirOpens    int     `json:"their_opens"`    // TA 主动开场次数
	TotalSessions int     `json:"total_sessions"` // 对话段总数
	MyRatio       float64 `json:"my_ratio"`       // 我开场占比 0~1
}

// INResponse 完整响应
type INResponse struct {
	ScannedContacts int            `json:"scanned_contacts"`
	YouInitiate     []INContactRow `json:"you_initiate"`   // 你主动找的人（my_ratio 降序）
	TheyInitiate    []INContactRow `json:"they_initiate"`  // 主动找你的人（my_ratio 升序）
	MostUneven      []INContactRow `json:"most_uneven"`    // 最不对等（|my_ratio-0.5| 降序）
	GeneratedAt     int64          `json:"generated_at"`
}

var (
	inCacheMu  sync.Mutex
	inCacheVal *INResponse
	inCacheAt  time.Time
)

func registerInitiativeRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/initiative", initiativeHandler(getSvc))
	prot.POST("/labs/initiative", initiativeHandler(getSvc))
}

func initiativeHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		refresh := c.Query("refresh") == "1"

		inCacheMu.Lock()
		if !refresh && inCacheVal != nil && time.Since(inCacheAt) < inCacheTTL {
			cached := *inCacheVal
			inCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		inCacheMu.Unlock()

		resp := buildInitiative(svc)

		inCacheMu.Lock()
		inCacheVal = resp
		inCacheAt = time.Now()
		inCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

func buildInitiative(svc *service.ContactService) *INResponse {
	t := startTimer("initiative_build")

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
	if len(picks) > inMaxContacts {
		picks = picks[:inMaxContacts]
	}

	resp := &INResponse{
		ScannedContacts: len(picks),
		GeneratedAt:     time.Now().Unix(),
	}

	var rows []INContactRow
	for _, p := range picks {
		points := svc.ContactMessageTimeline(p.username)
		if len(points) == 0 {
			continue
		}

		myOpens, theirOpens := 0, 0
		var prevTs int64 = -1
		for _, pt := range points {
			// 第一条，或距上一条静默超过阈值 → 这是一段新对话的开场
			if prevTs < 0 || pt.Ts-prevTs > inSessionGapSecond {
				if pt.IsMine {
					myOpens++
				} else {
					theirOpens++
				}
			}
			prevTs = pt.Ts
		}

		total := myOpens + theirOpens
		if total < inMinSessions {
			continue
		}
		rows = append(rows, INContactRow{
			Username:      p.username,
			DisplayName:   p.displayName,
			AvatarURL:     p.avatar,
			MyOpens:       myOpens,
			TheirOpens:    theirOpens,
			TotalSessions: total,
			MyRatio:       float64(myOpens) / float64(total),
		})
	}

	// 你主动找的人：我开场占比降序
	youInit := append([]INContactRow(nil), rows...)
	sort.Slice(youInit, func(i, j int) bool {
		if youInit[i].MyRatio != youInit[j].MyRatio {
			return youInit[i].MyRatio > youInit[j].MyRatio
		}
		return youInit[i].MyOpens > youInit[j].MyOpens
	})
	resp.YouInitiate = capINRows(youInit, inTopLimit)

	// 主动找你的人：我开场占比升序（= TA 开场占比降序）
	theyInit := append([]INContactRow(nil), rows...)
	sort.Slice(theyInit, func(i, j int) bool {
		if theyInit[i].MyRatio != theyInit[j].MyRatio {
			return theyInit[i].MyRatio < theyInit[j].MyRatio
		}
		return theyInit[i].TheirOpens > theyInit[j].TheirOpens
	})
	resp.TheyInitiate = capINRows(theyInit, inTopLimit)

	// 最不对等：开场占比离 0.5 最远
	uneven := append([]INContactRow(nil), rows...)
	sort.Slice(uneven, func(i, j int) bool {
		return math.Abs(uneven[i].MyRatio-0.5) > math.Abs(uneven[j].MyRatio-0.5)
	})
	resp.MostUneven = capINRows(uneven, inTopLimit)

	t.Done(nil,
		"scanned_contacts", len(picks),
		"rows", len(rows),
	)
	return resp
}

func capINRows(rows []INContactRow, n int) []INContactRow {
	if rows == nil {
		return []INContactRow{}
	}
	if len(rows) > n {
		return rows[:n]
	}
	return rows
}
