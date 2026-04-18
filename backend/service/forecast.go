package service

import (
	"fmt"
	"sort"
	"time"
)

// medianOr 返回 ints 切片的中位数（秒）；样本数 <minSize 时返回 fallback。
func medianOr(ints []int, minSize, fallback int) int {
	if len(ints) < minSize {
		return fallback
	}
	cp := make([]int, len(ints))
	copy(cp, ints)
	sort.Ints(cp)
	return cp[len(cp)/2]
}

// ForecastEntry 单个联系人的关系趋势预测
type ForecastEntry struct {
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	AvatarURL     string `json:"avatar_url"`
	Status        string `json:"status"`        // rising / stable / cooling / endangered
	Score         int    `json:"score"`         // 排序用，0-100
	TrendPct      int    `json:"trend_pct"`     // 最近 3 月 vs 前 3 月百分比变化（-100..+999）
	Recent3       int    `json:"recent_3m"`     // 最近 3 个月消息数
	Prior3        int    `json:"prior_3m"`      // 前 3 个月（4-6 月前）
	DaysSinceLast int    `json:"days_since_last"`
	Reason        string `json:"reason"`        // 一句话描述
	Suggestion    string `json:"suggestion"`    // 行动建议
	Monthly12     []int  `json:"monthly_12,omitempty"` // 最近 12 月消息数（旧→新），仅 include_all 时返回

	// 主动占比（我发消息占比）
	InitiatorRecent int `json:"initiator_recent"` // 最近 3 月我的占比 0-100，-1 表示样本不足
	InitiatorPrior  int `json:"initiator_prior"`  // 前 3 月我的占比，-1 表示样本不足
	InitiatorTrend  int `json:"initiator_trend"`  // 两者差值（百分点，-100..+100），正=我更主动了

	// 响应时延中位数（秒），-1 = 样本不足
	TheirLatencyRecentSec int `json:"their_latency_recent_sec"`
	TheirLatencyPriorSec  int `json:"their_latency_prior_sec"`
	MineLatencyRecentSec  int `json:"mine_latency_recent_sec"`
	MineLatencyPriorSec   int `json:"mine_latency_prior_sec"`
}

// ForecastResponse 关系预测响应
type ForecastResponse struct {
	SuggestContact []ForecastEntry `json:"suggest_contact"` // 建议主动联系 Top N
	All            []ForecastEntry `json:"all,omitempty"`   // 全 4 档列表，仅 include_all 时返回（按状态优先级 + 分数排序）
	GeneratedAt    int64           `json:"generated_at"`
	TotalScored    int             `json:"total_scored"`
}

const (
	forecastStatusRising     = "rising"
	forecastStatusStable     = "stable"
	forecastStatusCooling    = "cooling"
	forecastStatusEndangered = "endangered"
)

// GetRelationshipForecast 计算所有联系人的关系趋势预测，并返回建议主动联系列表
//
// 算法：
//   recent_3m = 最近 3 个完整月（含当月）消息数
//   prior_3m  = 第 4-6 月前的消息数
//   days_since_last 来自 LastMessageTs
//
// 状态判定（优先级从高到低）：
//   - endangered: prior_3m >= 10 且 (days_since_last >= 60 或 recent_3m == 0)
//   - cooling:    prior_3m >= 5 且 recent_3m * 2 < prior_3m
//   - rising:     recent_3m >= 5 且 recent_3m > prior_3m * 1.5
//   - stable:     其他
//
// "suggest_contact" 只取 endangered + cooling，按 prior_3m 降序（曾经互动多的优先），最多 topN 条。
// includeAll=true 时额外返回 All 字段（含全 4 档 + 12 月折线）。
func (s *ContactService) GetRelationshipForecast(topN int, includeAll bool) ForecastResponse {
	if topN <= 0 {
		topN = 5
	}

	s.cacheMu.RLock()
	cache := s.cache
	s.cacheMu.RUnlock()

	s.monthlyByUserMu.RLock()
	monthlyMap := s.monthlyByUsername
	s.monthlyByUserMu.RUnlock()

	s.latencyByUserMu.RLock()
	latencyMap := s.latencyByUsername
	s.latencyByUserMu.RUnlock()

	now := time.Now().In(s.tz)
	monthKeys := make([]string, 12)
	for i := 0; i < 12; i++ {
		monthKeys[i] = now.AddDate(0, -i, 0).Format("2006-01")
	}

	var all []ForecastEntry
	for _, c := range cache {
		if c.TotalMessages < 20 {
			continue
		}
		bucket := monthlyMap[c.Username]
		if bucket == nil {
			continue
		}

		var recent3, prior3 int
		var recent3Mine, prior3Mine int
		for i := 0; i < 3; i++ {
			b := bucket[monthKeys[i]]
			recent3 += b.Total
			recent3Mine += b.Mine
		}
		for i := 3; i < 6; i++ {
			b := bucket[monthKeys[i]]
			prior3 += b.Total
			prior3Mine += b.Mine
		}
		if recent3 == 0 && prior3 == 0 {
			continue // 12 个月前的旧关系，不在预测范围
		}

		var daysSinceLast int
		if c.LastMessageTs > 0 {
			daysSinceLast = int(now.Sub(time.Unix(c.LastMessageTs, 0)).Hours() / 24)
		}

		status, trendPct := classifyForecast(recent3, prior3, daysSinceLast)

		// 主动占比（样本不足时返回 -1）
		initiatorRecent := -1
		if recent3 >= 5 {
			initiatorRecent = (recent3Mine * 100) / recent3
		}
		initiatorPrior := -1
		if prior3 >= 5 {
			initiatorPrior = (prior3Mine * 100) / prior3
		}
		initiatorTrend := 0
		if initiatorRecent >= 0 && initiatorPrior >= 0 {
			initiatorTrend = initiatorRecent - initiatorPrior
		}

		name := c.Remark
		if name == "" {
			name = c.Nickname
		}
		if name == "" {
			name = c.Username
		}

		latency, hasLatency := latencyMap[c.Username]
		if !hasLatency {
			latency = LatencyStats{-1, -1, -1, -1}
		}
		entry := ForecastEntry{
			Username:              c.Username,
			DisplayName:           name,
			AvatarURL:             c.SmallHeadURL,
			Status:                status,
			Score:                 scoreForSuggest(status, prior3, daysSinceLast),
			TrendPct:              trendPct,
			Recent3:               recent3,
			Prior3:                prior3,
			DaysSinceLast:         daysSinceLast,
			Reason:                reasonText(status, recent3, prior3, daysSinceLast, trendPct, initiatorRecent, initiatorPrior, initiatorTrend, latency),
			Suggestion:            suggestionText(status),
			InitiatorRecent:       initiatorRecent,
			InitiatorPrior:        initiatorPrior,
			InitiatorTrend:        initiatorTrend,
			TheirLatencyRecentSec: latency.TheirRecentMedSec,
			TheirLatencyPriorSec:  latency.TheirPriorMedSec,
			MineLatencyRecentSec:  latency.MineRecentMedSec,
			MineLatencyPriorSec:   latency.MinePriorMedSec,
		}
		if includeAll {
			m12 := make([]int, 12)
			for i := 0; i < 12; i++ {
				// 旧 → 新：monthKeys[11] 是 11 月前，monthKeys[0] 是当月
				m12[i] = bucket[monthKeys[11-i]].Total
			}
			entry.Monthly12 = m12
		}
		all = append(all, entry)
	}

	// 抽出建议主动联系
	var suggest []ForecastEntry
	for _, e := range all {
		if e.Status == forecastStatusCooling || e.Status == forecastStatusEndangered {
			suggest = append(suggest, e)
		}
	}
	sort.Slice(suggest, func(i, j int) bool { return suggest[i].Score > suggest[j].Score })
	if len(suggest) > topN {
		suggest = suggest[:topN]
	}
	if suggest == nil {
		suggest = []ForecastEntry{}
	}

	resp := ForecastResponse{
		SuggestContact: suggest,
		GeneratedAt:    now.Unix(),
		TotalScored:    len(all),
	}

	if includeAll {
		// 全列表按 status 优先级 → score 降序排序
		statusRank := map[string]int{
			forecastStatusEndangered: 0,
			forecastStatusCooling:    1,
			forecastStatusRising:     2,
			forecastStatusStable:     3,
		}
		sort.Slice(all, func(i, j int) bool {
			ri, rj := statusRank[all[i].Status], statusRank[all[j].Status]
			if ri != rj {
				return ri < rj
			}
			return all[i].Score > all[j].Score
		})
		resp.All = all
	}

	return resp
}

func classifyForecast(recent3, prior3, daysSinceLast int) (string, int) {
	var trendPct int
	if prior3 > 0 {
		trendPct = ((recent3 - prior3) * 100) / prior3
	} else if recent3 > 0 {
		trendPct = 999
	}

	switch {
	case prior3 >= 10 && (daysSinceLast >= 60 || recent3 == 0):
		return forecastStatusEndangered, trendPct
	case prior3 >= 5 && recent3*2 < prior3:
		return forecastStatusCooling, trendPct
	case recent3 >= 5 && recent3 > (prior3*3)/2:
		return forecastStatusRising, trendPct
	default:
		return forecastStatusStable, trendPct
	}
}

// scoreForSuggest 排序权重：曾经互动越多 + 最近沉默越久 → 越值得主动联系
func scoreForSuggest(status string, prior3, daysSinceLast int) int {
	if status != forecastStatusCooling && status != forecastStatusEndangered {
		return 0
	}
	score := prior3
	if daysSinceLast > 0 {
		score += daysSinceLast / 3
	}
	if status == forecastStatusEndangered {
		score += 30
	}
	if score > 100 {
		score = 100
	}
	return score
}

// formatDelay 把秒数格式化为 "X 分钟" / "Y 小时" / "Z 天" 的中文
func formatDelay(sec int) string {
	if sec < 120 {
		return fmt.Sprintf("%d 秒", sec)
	}
	if sec < 3600 {
		return fmt.Sprintf("%d 分钟", sec/60)
	}
	if sec < 86400 {
		return fmt.Sprintf("%d 小时", sec/3600)
	}
	return fmt.Sprintf("%.1f 天", float64(sec)/86400)
}

func reasonText(status string, recent3, prior3, daysSinceLast, trendPct, initiatorRecent, initiatorPrior, initiatorTrend int, latency LatencyStats) string {
	base := ""
	switch status {
	case forecastStatusEndangered:
		if daysSinceLast >= 60 {
			base = fmt.Sprintf("已 %d 天没说过话，去年同期还在频繁联系", daysSinceLast)
		} else {
			base = fmt.Sprintf("最近 3 个月几乎没消息（%d 条），前 3 个月有 %d 条", recent3, prior3)
		}
	case forecastStatusCooling:
		drop := -trendPct
		if drop < 0 {
			drop = 0
		}
		base = fmt.Sprintf("最近 3 个月消息减少 %d%%（%d → %d）", drop, prior3, recent3)
	case forecastStatusRising:
		if trendPct >= 999 {
			base = fmt.Sprintf("最近 3 个月新增 %d 条消息，互动正在升温", recent3)
		} else {
			base = fmt.Sprintf("最近 3 个月消息增加 %d%%（%d → %d）", trendPct, prior3, recent3)
		}
	default:
		avg := (recent3 + prior3) / 6
		base = fmt.Sprintf("互动稳定，约 %d 条/月", avg)
	}

	// 主动占比显著变化时追加一句（差 ≥15 个百分点才提）
	if initiatorPrior >= 0 && initiatorRecent >= 0 {
		absDelta := initiatorTrend
		if absDelta < 0 {
			absDelta = -absDelta
		}
		if absDelta >= 15 {
			if initiatorTrend > 0 {
				base += fmt.Sprintf("；你更主动了（%d%% → %d%%）", initiatorPrior, initiatorRecent)
			} else {
				// 下降时如果你原来本就很主动，语气更直接
				if initiatorPrior >= 55 && initiatorRecent < 45 {
					base += fmt.Sprintf("；原本你更主动（%d%%），现在对方说得更多（%d%%）", initiatorPrior, 100-initiatorRecent)
				} else {
					base += fmt.Sprintf("；你的主动占比 %d%% → %d%%", initiatorPrior, initiatorRecent)
				}
			}
		}
	}

	// TA 回复时延显著变慢时追加一句（变慢 ≥3 倍，且原本在 1 小时内）
	if latency.TheirRecentMedSec > 0 && latency.TheirPriorMedSec > 0 {
		if latency.TheirRecentMedSec >= latency.TheirPriorMedSec*3 && latency.TheirPriorMedSec <= 3600 {
			base += fmt.Sprintf("；TA 回复从 %s 变成 %s",
				formatDelay(latency.TheirPriorMedSec), formatDelay(latency.TheirRecentMedSec))
		}
	}
	return base
}

func suggestionText(status string) string {
	switch status {
	case forecastStatusEndangered:
		return "好久没联系了，发个表情打个招呼？"
	case forecastStatusCooling:
		return "互动渐少，可以聊聊近况"
	case forecastStatusRising:
		return "关系正在升温，保持节奏"
	default:
		return ""
	}
}
