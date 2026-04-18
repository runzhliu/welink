package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"welink/backend/service"
)

// collectAll 把多条 ExportItem 全部采集成 ExportDoc 列表。
// 单条 item 失败时只跳过该条，不影响其他；全部失败才返回 error。
func collectAll(svc *service.ContactService, items []ExportItem) ([]ExportDoc, error) {
	if svc == nil {
		return nil, fmt.Errorf("服务未就绪")
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("请至少选择一项导出内容")
	}
	docs := make([]ExportDoc, 0, len(items))
	var firstErr error
	for _, it := range items {
		var doc ExportDoc
		var err error
		switch it.Type {
		case ExportYearReview:
			doc, err = collectYearReview(svc, it)
		case ExportConversation:
			doc, err = collectConversation(svc, it)
		case ExportAIHistory:
			doc, err = collectAIHistory(it)
		case ExportMemoryGraph:
			doc, err = collectMemoryGraph(svc, it)
		default:
			err = fmt.Errorf("未知导出类型：%s", it.Type)
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if it.Title != "" {
			doc.Title = it.Title
		}
		docs = append(docs, doc)
	}
	if len(docs) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return docs, nil
}

// ─── 1. 年度回顾（全局） ─────────────────────────────────────────────────────

// collectYearReview 基于 GlobalStats + GetCachedStats 生成年度报告。
// it.Year=0 表示导出全部年份的概览；具体年份则按月份过滤。
func collectYearReview(svc *service.ContactService, it ExportItem) (ExportDoc, error) {
	g := svc.GetGlobal()
	stats := svc.GetCachedStats()

	yearLabel := "全部年份"
	yearTag := "all"
	if it.Year > 0 {
		yearLabel = fmt.Sprintf("%d 年", it.Year)
		yearTag = fmt.Sprintf("%d", it.Year)
	}

	var sb strings.Builder
	title := fmt.Sprintf("WeLink 年度回顾 · %s", yearLabel)
	sb.WriteString("# " + title + "\n\n")
	sb.WriteString(fmt.Sprintf("> 由 WeLink 于 %s 生成\n\n", time.Now().Format("2006-01-02 15:04")))

	// — 总览 —
	sb.WriteString("## 📊 总览\n\n")
	sb.WriteString("| 指标 | 数值 |\n|---|---|\n")
	sb.WriteString(fmt.Sprintf("| 联系人总数 | %d 位 |\n", g.TotalFriends))
	sb.WriteString(fmt.Sprintf("| 有过对话的联系人 | %d 位 |\n", g.TotalFriends-g.ZeroMsgFriends))
	sb.WriteString(fmt.Sprintf("| 累计消息 | %d 条 |\n", g.TotalMessages))
	if g.BusiestDay != "" {
		sb.WriteString(fmt.Sprintf("| 最忙的一天 | %s（%d 条） |\n", g.BusiestDay, g.BusiestDayCount))
	}
	if g.MidnightChamp != "" {
		sb.WriteString(fmt.Sprintf("| 凌晨之王 | %s |\n", g.MidnightChamp))
	}
	if g.EmojiKing != "" {
		sb.WriteString(fmt.Sprintf("| 表情包之王 | %s |\n", g.EmojiKing))
	}
	sb.WriteString("\n")

	// — Top 10 联系人 —
	sb.WriteString("## 🏆 Top 10 联系人\n\n")
	sorted := make([]service.ContactStatsExtended, len(stats))
	copy(sorted, stats)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].TotalMessages > sorted[j].TotalMessages
	})
	sb.WriteString("| # | 联系人 | 消息总数 | 我发出 | 对方发出 |\n|---|---|---:|---:|---:|\n")
	limit := 10
	if len(sorted) < limit {
		limit = len(sorted)
	}
	for i := 0; i < limit; i++ {
		c := sorted[i]
		name := pickName(c.Remark, c.Nickname, c.Username)
		sb.WriteString(fmt.Sprintf("| %d | %s | %d | %d | %d |\n",
			i+1, name, c.TotalMessages, c.MyMessages, c.TheirMessages))
	}
	sb.WriteString("\n")

	// — 月度趋势 —
	if len(g.MonthlyTrend) > 0 {
		sb.WriteString("## 📈 月度趋势\n\n")
		months := make([]string, 0, len(g.MonthlyTrend))
		for m := range g.MonthlyTrend {
			if it.Year > 0 && !strings.HasPrefix(m, fmt.Sprintf("%d-", it.Year)) {
				continue
			}
			months = append(months, m)
		}
		sort.Strings(months)
		if len(months) == 0 {
			sb.WriteString(fmt.Sprintf("（%s 没有数据）\n\n", yearLabel))
		} else {
			sb.WriteString("| 月份 | 消息数 |\n|---|---:|\n")
			for _, m := range months {
				sb.WriteString(fmt.Sprintf("| %s | %d |\n", m, g.MonthlyTrend[m]))
			}
			sb.WriteString("\n")
		}
	}

	// — 24 小时活跃曲线 —
	sb.WriteString("## 🕐 24 小时活跃曲线\n\n")
	maxH := 0
	for _, v := range g.HourlyHeatmap {
		if v > maxH {
			maxH = v
		}
	}
	sb.WriteString("```\n")
	for h := 0; h < 24; h++ {
		bar := ""
		if maxH > 0 {
			n := g.HourlyHeatmap[h] * 30 / maxH
			bar = strings.Repeat("█", n)
		}
		sb.WriteString(fmt.Sprintf("%02d:00 %5d %s\n", h, g.HourlyHeatmap[h], bar))
	}
	sb.WriteString("```\n\n")

	// — 消息类型分布 —
	if len(g.TypeMix) > 0 {
		sb.WriteString("## 🧩 消息类型分布\n\n")
		type kv struct {
			K string
			V int
		}
		mix := make([]kv, 0, len(g.TypeMix))
		var total int
		for k, v := range g.TypeMix {
			mix = append(mix, kv{k, v})
			total += v
		}
		sort.Slice(mix, func(i, j int) bool { return mix[i].V > mix[j].V })
		sb.WriteString("| 类型 | 条数 | 占比 |\n|---|---:|---:|\n")
		for _, m := range mix {
			pct := 0.0
			if total > 0 {
				pct = float64(m.V) * 100 / float64(total)
			}
			sb.WriteString(fmt.Sprintf("| %s | %d | %.1f%% |\n", m.K, m.V, pct))
		}
		sb.WriteString("\n")
	}

	// — 深夜守护者 —
	if len(g.LateNightRanking) > 0 {
		sb.WriteString("## 🌙 深夜守护者\n\n")
		sb.WriteString("| # | 联系人 | 深夜消息 | 总消息 | 比例 |\n|---|---|---:|---:|---:|\n")
		lim := 10
		if len(g.LateNightRanking) < lim {
			lim = len(g.LateNightRanking)
		}
		for i := 0; i < lim; i++ {
			e := g.LateNightRanking[i]
			sb.WriteString(fmt.Sprintf("| %d | %s | %d | %d | %.1f%% |\n",
				i+1, e.Name, e.LateNightCount, e.TotalMessages, e.Ratio*100))
		}
		sb.WriteString("\n")
	}

	return ExportDoc{
		Title:    title,
		Filename: fmt.Sprintf("年度回顾-%s", yearTag),
		Markdown: sb.String(),
	}, nil
}

// ─── 2. 对话归档 ──────────────────────────────────────────────────────────────

// collectConversation 导出某个联系人/群聊在指定区间内的所有消息。
// it.From / it.To 为 0 表示全量；超过 50000 条会被服务层截断。
func collectConversation(svc *service.ContactService, it ExportItem) (ExportDoc, error) {
	if it.Username == "" {
		return ExportDoc{}, fmt.Errorf("对话归档需要指定 username")
	}
	display := lookupDisplayName(svc, it.Username, it.IsGroup)

	rangeLabel := "全部时间"
	if it.From > 0 || it.To > 0 {
		rangeLabel = fmt.Sprintf("%s ~ %s",
			tsLabel(it.From, "开始"),
			tsLabel(it.To, "至今"))
	}

	var sb strings.Builder
	title := fmt.Sprintf("聊天归档 · %s", display)
	sb.WriteString("# " + title + "\n\n")
	sb.WriteString(fmt.Sprintf("> 时间范围：%s\n", rangeLabel))
	sb.WriteString(fmt.Sprintf("> 由 WeLink 于 %s 生成\n\n", time.Now().Format("2006-01-02 15:04")))

	if it.IsGroup {
		msgs := svc.ExportGroupMessages(it.Username, it.From, it.To)
		sb.WriteString(fmt.Sprintf("共 %d 条消息。\n\n", len(msgs)))
		var lastDate string
		for _, m := range msgs {
			if m.Date != "" && m.Date != lastDate {
				sb.WriteString(fmt.Sprintf("\n## 📅 %s\n\n", m.Date))
				lastDate = m.Date
			}
			speaker := m.Speaker
			if m.IsMine {
				speaker = "我"
			}
			content := normalizeMsgContent(m.Content, m.Type)
			sb.WriteString(fmt.Sprintf("- **%s** `%s` — %s\n", speaker, m.Time, content))
		}
	} else {
		msgs := svc.ExportContactMessages(it.Username, it.From, it.To)
		sb.WriteString(fmt.Sprintf("共 %d 条消息。\n\n", len(msgs)))
		var lastDate string
		for _, m := range msgs {
			if m.Date != "" && m.Date != lastDate {
				sb.WriteString(fmt.Sprintf("\n## 📅 %s\n\n", m.Date))
				lastDate = m.Date
			}
			who := display
			if m.IsMine {
				who = "我"
			}
			content := normalizeMsgContent(m.Content, m.Type)
			sb.WriteString(fmt.Sprintf("- **%s** `%s` — %s\n", who, m.Time, content))
		}
	}

	return ExportDoc{
		Title:    title,
		Filename: fmt.Sprintf("对话归档-%s", display),
		Markdown: sb.String(),
	}, nil
}

// ─── 3. AI 对话历史 ──────────────────────────────────────────────────────────

// collectAIHistory 把指定 key 的 AI 对话历史导出为 Markdown。
// AIKey 例如 "contact:wxid_xxx" / "ai-home:cross_qa" / "group:xxx@chatroom"。
func collectAIHistory(it ExportItem) (ExportDoc, error) {
	if it.AIKey == "" {
		return ExportDoc{}, fmt.Errorf("AI 历史导出需要 ai_key")
	}
	msgs, err := GetAIConversation(it.AIKey)
	if err != nil {
		return ExportDoc{}, err
	}

	label := it.AIKey
	if strings.HasPrefix(it.AIKey, "contact:") {
		label = "联系人 · " + strings.TrimPrefix(it.AIKey, "contact:")
	} else if strings.HasPrefix(it.AIKey, "group:") {
		label = "群聊 · " + strings.TrimPrefix(it.AIKey, "group:")
	} else if strings.HasPrefix(it.AIKey, "ai-home:") {
		label = "AI 首页 · " + strings.TrimPrefix(it.AIKey, "ai-home:")
	}

	var sb strings.Builder
	title := fmt.Sprintf("AI 对话历史 · %s", label)
	sb.WriteString("# " + title + "\n\n")
	sb.WriteString(fmt.Sprintf("> 共 %d 条消息，由 WeLink 于 %s 导出\n\n",
		len(msgs), time.Now().Format("2006-01-02 15:04")))

	for i, m := range msgs {
		role := "🧑 我"
		if m.Role == "assistant" {
			role = "🤖 AI"
			if m.Provider != "" || m.Model != "" {
				role = fmt.Sprintf("🤖 %s/%s", strOrDash(m.Provider), strOrDash(m.Model))
			}
		} else if m.Role == "system" {
			role = "⚙️ 系统"
		}
		sb.WriteString(fmt.Sprintf("\n### %d. %s\n\n", i+1, role))
		sb.WriteString(m.Content + "\n")
	}
	return ExportDoc{
		Title:    title,
		Filename: fmt.Sprintf("AI对话-%s", safeFilename(label)),
		Markdown: sb.String(),
	}, nil
}

// ─── 4. 记忆图谱 ──────────────────────────────────────────────────────────────

// collectMemoryGraph 导出指定 contact_key 的事实库。
// key 形如 "contact:wxid_xxx"。
func collectMemoryGraph(svc *service.ContactService, it ExportItem) (ExportDoc, error) {
	key := it.AIKey
	if key == "" && it.Username != "" {
		prefix := "contact:"
		if it.IsGroup {
			prefix = "group:"
		}
		key = prefix + it.Username
	}
	if key == "" {
		return ExportDoc{}, fmt.Errorf("记忆图谱导出需要 username 或 ai_key")
	}
	facts, err := GetMemFacts(key)
	if err != nil {
		return ExportDoc{}, err
	}
	display := key
	if strings.HasPrefix(key, "contact:") {
		uname := strings.TrimPrefix(key, "contact:")
		display = lookupDisplayName(svc, uname, false)
	} else if strings.HasPrefix(key, "group:") {
		uname := strings.TrimPrefix(key, "group:")
		display = lookupDisplayName(svc, uname, true)
	}

	var sb strings.Builder
	title := fmt.Sprintf("记忆图谱 · %s", display)
	sb.WriteString("# " + title + "\n\n")
	sb.WriteString(fmt.Sprintf("> 共 %d 条事实，由 WeLink 于 %s 生成\n\n",
		len(facts), time.Now().Format("2006-01-02 15:04")))

	if len(facts) == 0 {
		sb.WriteString("（暂无提炼的记忆事实）\n")
	} else {
		for i, f := range facts {
			sb.WriteString(fmt.Sprintf("- %d. %s\n", i+1, f.Fact))
		}
	}
	return ExportDoc{
		Title:    title,
		Filename: fmt.Sprintf("记忆图谱-%s", display),
		Markdown: sb.String(),
	}, nil
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

// pickName 按优先级返回联系人显示名：备注 > 昵称 > username。
func pickName(remark, nickname, username string) string {
	if r := strings.TrimSpace(remark); r != "" {
		return r
	}
	if n := strings.TrimSpace(nickname); n != "" {
		return n
	}
	return username
}

// lookupDisplayName 在缓存里找联系人/群聊显示名；找不到时回落到 username。
func lookupDisplayName(svc *service.ContactService, username string, isGroup bool) string {
	if svc == nil {
		return username
	}
	if isGroup {
		for _, g := range svc.GetGroups() {
			if g.Username == username {
				if g.Name != "" {
					return g.Name
				}
				return username
			}
		}
		return username
	}
	for _, c := range svc.GetCachedStats() {
		if c.Username == username {
			return pickName(c.Remark, c.Nickname, c.Username)
		}
	}
	return username
}

func tsLabel(ts int64, fallback string) string {
	if ts <= 0 {
		return fallback
	}
	return time.Unix(ts, 0).Format("2006-01-02")
}

func strOrDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// normalizeMsgContent 把空的非文本消息渲染成可读说明，避免导出后一行空。
func normalizeMsgContent(content string, msgType int) string {
	c := strings.TrimSpace(content)
	if c == "" {
		switch msgType {
		case 3:
			return "_[图片]_"
		case 34:
			return "_[语音]_"
		case 43:
			return "_[视频]_"
		case 47:
			return "_[表情]_"
		case 49:
			return "_[链接 / 文件]_"
		case 10000:
			return "_[系统消息]_"
		default:
			return fmt.Sprintf("_[消息类型 %d]_", msgType)
		}
	}
	// 转义 Markdown 里有特殊含义的前缀
	if strings.HasPrefix(c, "#") || strings.HasPrefix(c, ">") || strings.HasPrefix(c, "-") {
		c = "\\" + c
	}
	return c
}
