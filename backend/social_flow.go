package main

// social_flow.go — 「社交圈年度流动榜」 Lab
//
// 现有的 Lab 大多是「快照」：某个时间点的排行、占比、画像。
// 缺一个「时间流动」的叙事——你的社交圈这一年和上一年比，发生了什么人事变迁？
//
// 把每个私聊「今年 12 个月」(this) 和「去年 12 个月」(last) 两个滑动窗口的消息量拿来对比，
// 给每个人贴一个「流动标签」：
//
//   - 新晋核心 (newcomer)  : 去年几乎没聊(last 很少)，今年突然聊很多(this 高) —— 新进入你生活的人
//   - 逆袭回归 (revived)   : 去年聊过(last 有量)、中途冷下来、今年又热起来(this >> 近期低谷) —— 失而复得
//   - 悄然淡出 (faded)     : 去年是常聊(last 高)，今年骤降(this << last) —— 正在远离的人
//   - 稳步升温 (warming)   : 两年都聊，今年明显更多 —— 越走越近
//   - 稳定常驻 (steady)    : 两年量都不低且变化不大 —— 你的社交压舱石
//
// 算法纯统计、零 LLM：基于已缓存的 monthlyByUsername(username -> "YYYY-MM" -> {total,mine})，
// 复用 service.GetYearlyBuckets() 拿两个 12 月窗口。秒级返回。
//
// 排行四视角（前端分 tab）：
//   - newcomers : 新晋核心（今年增量绝对值最大且去年很少）
//   - faded     : 悄然淡出（今年相对去年跌幅最大）
//   - revived   : 逆袭回归（去年有底子、今年回暖）
//   - all       : 全员流动总览（按今年消息量降序，带流动标签）
//
// API:
//   GET  /api/labs/social-flow[?refresh=1]
//   POST /api/labs/social-flow

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
	sfMinThisOrLast = 30              // 两年合计至少 30 条才有讨论价值（过滤一面之缘）
	sfTopLimit      = 30              // 每个榜最多 30 条
	sfNewcomerLast  = 15             // 去年 ≤ 15 条算"去年几乎没聊"
	sfFadedDropPct  = 60             // 今年比去年跌 ≥ 60% 算"淡出"
	sfWarmRisePct   = 50             // 今年比去年涨 ≥ 50% 算"升温"
	sfCacheTTL      = 30 * time.Minute
)

// 流动标签
const (
	sfFlowNewcomer = "newcomer" // 新晋核心
	sfFlowRevived  = "revived"  // 逆袭回归
	sfFlowFaded    = "faded"    // 悄然淡出
	sfFlowWarming  = "warming"  // 稳步升温
	sfFlowSteady   = "steady"   // 稳定常驻
)

// SFContactRow 单个联系人的年度流动
type SFContactRow struct {
	Username    string  `json:"username"`
	DisplayName string  `json:"display_name"`
	AvatarURL   string  `json:"avatar_url"`
	ThisYear    int     `json:"this_year"`    // 今年 12 月消息总数
	LastYear    int     `json:"last_year"`    // 去年 12 月消息总数
	Delta       int     `json:"delta"`        // this - last（正=变多）
	ChangePct   int     `json:"change_pct"`   // 变化百分比（-100..+999），去年为 0 时记 999
	Flow        string  `json:"flow"`         // 流动标签（见上）
	MyRatioThis float64 `json:"my_ratio_this"` // 今年我方发言占比 0~1（-1=样本不足）
}

// SFResponse 完整响应
type SFResponse struct {
	ScannedContacts int            `json:"scanned_contacts"`
	AnchorMonth     string         `json:"anchor_month"`     // 锚点月份 "2006-01"，前端展示窗口范围用
	Newcomers       []SFContactRow `json:"newcomers"`        // 新晋核心
	Faded           []SFContactRow `json:"faded"`            // 悄然淡出
	Revived         []SFContactRow `json:"revived"`          // 逆袭回归 / 升温
	All             []SFContactRow `json:"all"`              // 全员流动总览（今年量降序）
	GeneratedAt     int64          `json:"generated_at"`
}

var (
	sfCacheMu  sync.Mutex
	sfCacheVal *SFResponse
	sfCacheAt  time.Time
)

func registerSocialFlowRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/social-flow", socialFlowHandler(getSvc))
	prot.POST("/labs/social-flow", socialFlowHandler(getSvc))
}

func socialFlowHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		refresh := c.Query("refresh") == "1"

		sfCacheMu.Lock()
		if !refresh && sfCacheVal != nil && time.Since(sfCacheAt) < sfCacheTTL {
			cached := *sfCacheVal
			sfCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		sfCacheMu.Unlock()

		resp := buildSocialFlow(svc)

		sfCacheMu.Lock()
		sfCacheVal = resp
		sfCacheAt = time.Now()
		sfCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

func buildSocialFlow(svc *service.ContactService) *SFResponse {
	t := startTimer("social_flow_build")

	buckets, anchorMonth := svc.GetYearlyBuckets()

	// 联系人显示信息（名字 / 头像）来自缓存 stats
	type meta struct{ name, avatar string }
	infoByUser := make(map[string]meta, len(buckets))
	for _, st := range svc.GetCachedStats() {
		if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
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
		infoByUser[st.Username] = meta{name, avatar}
	}

	rows := make([]SFContactRow, 0, len(buckets))
	for username, w := range buckets {
		// 群聊 / 公众号已在 infoByUser 阶段过滤；不在表里的跳过
		info, ok := infoByUser[username]
		if !ok {
			continue
		}
		this, last := w.This.Total, w.Last.Total
		if this+last < sfMinThisOrLast {
			continue
		}

		delta := this - last
		var changePct int
		if last > 0 {
			changePct = (delta * 100) / last
			if changePct > 999 {
				changePct = 999
			}
		} else if this > 0 {
			changePct = 999
		}

		myRatio := -1.0
		if this >= 10 {
			myRatio = float64(w.This.Mine) / float64(this)
		}

		row := SFContactRow{
			Username:    username,
			DisplayName: info.name,
			AvatarURL:   info.avatar,
			ThisYear:    this,
			LastYear:    last,
			Delta:       delta,
			ChangePct:   changePct,
			Flow:        classifySocialFlow(this, last, changePct),
			MyRatioThis: myRatio,
		}
		rows = append(rows, row)
	}

	resp := &SFResponse{
		ScannedContacts: len(rows),
		AnchorMonth:     anchorMonth,
		GeneratedAt:     time.Now().Unix(),
	}

	// —— 新晋核心：去年很少、今年起量。按今年消息量降序（今年聊得越多越靠前）。
	newcomers := sfFilter(rows, func(r SFContactRow) bool { return r.Flow == sfFlowNewcomer })
	sort.Slice(newcomers, func(i, j int) bool { return newcomers[i].ThisYear > newcomers[j].ThisYear })
	resp.Newcomers = sfCap(newcomers, sfTopLimit)

	// —— 悄然淡出：跌幅最大（changePct 升序，越负越靠前）。只看去年本来有量的。
	faded := sfFilter(rows, func(r SFContactRow) bool { return r.Flow == sfFlowFaded })
	sort.Slice(faded, func(i, j int) bool {
		// 跌得更狠的在前；同跌幅时去年量更大的在前（损失更可惜）
		if faded[i].ChangePct != faded[j].ChangePct {
			return faded[i].ChangePct < faded[j].ChangePct
		}
		return faded[i].LastYear > faded[j].LastYear
	})
	resp.Faded = sfCap(faded, sfTopLimit)

	// —— 逆袭回归 / 升温：去年有底子、今年回暖。按增量绝对值降序。
	revived := sfFilter(rows, func(r SFContactRow) bool {
		return r.Flow == sfFlowRevived || r.Flow == sfFlowWarming
	})
	sort.Slice(revived, func(i, j int) bool { return revived[i].Delta > revived[j].Delta })
	resp.Revived = sfCap(revived, sfTopLimit)

	// —— 全员总览：今年量降序（缺今年量的沉到底，按去年量兜底）
	all := make([]SFContactRow, len(rows))
	copy(all, rows)
	sort.Slice(all, func(i, j int) bool {
		if all[i].ThisYear != all[j].ThisYear {
			return all[i].ThisYear > all[j].ThisYear
		}
		return all[i].LastYear > all[j].LastYear
	})
	resp.All = sfCap(all, sfTopLimit*2) // 总览放宽一些

	t.Done(nil, "scanned", len(rows))
	return resp
}

// classifySocialFlow 给一段「今年 vs 去年」打流动标签。
func classifySocialFlow(this, last, changePct int) string {
	switch {
	// 去年几乎没聊、今年起量 → 新晋核心
	case last <= sfNewcomerLast && this >= sfMinThisOrLast/2:
		return sfFlowNewcomer
	// 去年是常聊、今年骤降 → 悄然淡出
	case last >= sfMinThisOrLast && changePct <= -sfFadedDropPct:
		return sfFlowFaded
	// 去年有底子、今年明显回暖且体量翻倍以上 → 逆袭回归
	case last >= sfNewcomerLast && this > last && changePct >= 100:
		return sfFlowRevived
	// 两年都聊、今年更多 → 稳步升温
	case changePct >= sfWarmRisePct:
		return sfFlowWarming
	default:
		return sfFlowSteady
	}
}

func sfFilter(rows []SFContactRow, keep func(SFContactRow) bool) []SFContactRow {
	out := make([]SFContactRow, 0, len(rows))
	for _, r := range rows {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

func sfCap(rows []SFContactRow, n int) []SFContactRow {
	if rows == nil {
		return []SFContactRow{}
	}
	if len(rows) > n {
		rows = rows[:n]
	}
	return rows
}
