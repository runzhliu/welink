package main

// drift_alert.go — "断联预警 / Drift Alert"
//
// 找出消息频率从高变低、长期没说话的老朋友。
// 纯统计、不调 LLM；只用 ContactStats 缓存里的 LastMessageTs / TotalMessages。
// 数据轻、出图快，是 ChatDNA 的"反向"卡片：一个庆祝长期连接，一个提醒消失中的连接。

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
	driftMinTotalMessages = 50               // 总消息数下限：<50 条说明本来就不熟，不算"断联"
	driftMinDays          = 30               // 进入榜单的最小静默天数
	driftTopN             = 30               // 卡片榜单展示前 N
	driftCacheTTL         = 10 * time.Minute // 与 ChatDNA 一致
)

type DriftEntry struct {
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	Avatar        string  `json:"avatar,omitempty"`
	TotalMessages int64   `json:"total_messages"`
	LastMessageTs int64   `json:"last_message_ts"`
	LastDate      string  `json:"last_date"` // "2025-12-01"
	DaysSilent    int     `json:"days_silent"`
	HeartbreakIdx float64 `json:"heartbreak_index"` // 用于排序，前端可显示也可不显示
}

// DriftSummary 三档分级人数
type DriftSummary struct {
	Tier30Plus  int `json:"tier_30_plus"`  // 30-89 天
	Tier90Plus  int `json:"tier_90_plus"`  // 90-179 天
	Tier180Plus int `json:"tier_180_plus"` // 180+ 天
}

// DriftSuperlatives "之最" 三张高亮卡
type DriftSuperlatives struct {
	LongestSilent  *DriftEntry `json:"longest_silent,omitempty"`   // 静默最久的高频好友
	BiggestVolume  *DriftEntry `json:"biggest_volume,omitempty"`   // 历史聊得最多但已断联的人
	OldestFriend   *DriftEntry `json:"oldest_friend,omitempty"`    // 认识最久（first 最早）且当前断联
}

type DriftResponse struct {
	Today         string            `json:"today"`          // "2026-04-30"
	TotalAnalyzed int               `json:"total_analyzed"` // ≥ 50 条的私聊总数
	TotalAdrift   int               `json:"total_adrift"`   // 断联 30+ 天的人数
	Summary       DriftSummary      `json:"summary"`
	Top           []DriftEntry      `json:"top"`
	Superlatives  DriftSuperlatives `json:"superlatives"`
}

var (
	driftCacheMu   sync.Mutex
	driftCacheVal  *DriftResponse
	driftCacheAt   time.Time
	driftCacheFrom int64
	driftCacheTo   int64
)

func registerDriftAlertRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/me/drift", driftAlertHandler(getSvc))
}

func driftAlertHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"
		driftCacheMu.Lock()
		if !refresh && driftCacheVal != nil &&
			driftCacheFrom == from && driftCacheTo == to &&
			time.Since(driftCacheAt) < driftCacheTTL {
			cached := *driftCacheVal
			driftCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		driftCacheMu.Unlock()

		loc := svc.Location()
		now := time.Now().In(loc)
		stats := svc.GetCachedStats()

		// 1. 过滤候选：私聊 + ≥50 条消息 + 有 last_ts
		candidates := make([]DriftEntry, 0, 64)
		analyzed := 0
		for _, st := range stats {
			if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
				continue
			}
			if st.TotalMessages < driftMinTotalMessages || st.LastMessageTs <= 0 {
				continue
			}
			analyzed++
			lastTime := time.Unix(st.LastMessageTs, 0).In(loc)
			daysSilent := int(now.Sub(lastTime).Hours() / 24)
			if daysSilent < driftMinDays {
				continue
			}
			name := st.Remark
			if name == "" {
				name = st.Nickname
			}
			if name == "" {
				name = st.Username
			}
			// 心碎指数：静默天数 × log10(总消息数+1)
			// 既考虑"多久没联系"也考虑"曾经多熟"，把"以前聊很多但突然消失"顶到前面
			idx := float64(daysSilent) * math.Log10(float64(st.TotalMessages)+1)
			candidates = append(candidates, DriftEntry{
				Username:      st.Username,
				DisplayName:   name,
				Avatar:        st.SmallHeadURL,
				TotalMessages: st.TotalMessages,
				LastMessageTs: st.LastMessageTs,
				LastDate:      lastTime.Format("2006-01-02"),
				DaysSilent:    daysSilent,
				HeartbreakIdx: idx,
			})
		}

		// 2. 三档分级人数
		summary := DriftSummary{}
		for _, e := range candidates {
			switch {
			case e.DaysSilent >= 180:
				summary.Tier180Plus++
			case e.DaysSilent >= 90:
				summary.Tier90Plus++
			default:
				summary.Tier30Plus++
			}
		}

		// 3. Top N 按心碎指数降序
		sort.Slice(candidates, func(i, j int) bool { return candidates[i].HeartbreakIdx > candidates[j].HeartbreakIdx })
		top := candidates
		if len(top) > driftTopN {
			top = top[:driftTopN]
		}

		// 4. 之最（在全部候选里挑，不只是 top）
		var sup DriftSuperlatives
		if len(candidates) > 0 {
			// 静默最久：days_silent 最大
			longest := candidates[0]
			for _, e := range candidates {
				if e.DaysSilent > longest.DaysSilent {
					longest = e
				}
			}
			lc := longest
			sup.LongestSilent = &lc

			// 历史最熟：total_messages 最大
			biggest := candidates[0]
			for _, e := range candidates {
				if e.TotalMessages > biggest.TotalMessages {
					biggest = e
				}
			}
			bc := biggest
			sup.BiggestVolume = &bc

			// 认识最久：first_ts 最小（>0）—— 需要从原始 stats 里找回 first_ts
			oldestTs := int64(0)
			oldestUser := ""
			firstTsByUser := make(map[string]int64, len(stats))
			for _, st := range stats {
				if st.FirstMessageTs > 0 {
					firstTsByUser[st.Username] = st.FirstMessageTs
				}
			}
			for _, e := range candidates {
				ts := firstTsByUser[e.Username]
				if ts <= 0 {
					continue
				}
				if oldestTs == 0 || ts < oldestTs {
					oldestTs = ts
					oldestUser = e.Username
				}
			}
			if oldestUser != "" {
				for _, e := range candidates {
					if e.Username == oldestUser {
						oc := e
						sup.OldestFriend = &oc
						break
					}
				}
			}
		}

		resp := DriftResponse{
			Today:         now.Format("2006-01-02"),
			TotalAnalyzed: analyzed,
			TotalAdrift:   len(candidates),
			Summary:       summary,
			Top:           top,
			Superlatives:  sup,
		}

		driftCacheMu.Lock()
		driftCacheVal = &resp
		driftCacheAt = time.Now()
		driftCacheFrom = from
		driftCacheTo = to
		driftCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}
