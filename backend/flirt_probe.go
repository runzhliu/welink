package main

// flirt_probe.go — 「暧昧探测」 Lab
//
// 扫所有私聊里的"暧昧"语言痕迹。5 个类别，纯关键词匹配 + 否定语境过滤，
// 零 LLM、秒出可离线。仅用于个人娱乐回顾，不是关系结论。
//
// 设计要点：
//   - 5 类信号：endearment（亲昵称呼）/ longing（想念）/ late_night（深夜亲密）/
//     flirty_action（暧昧动作）/ flirty_emoji（暧昧表情）
//   - 一条消息可同时命中多类（"宝贝想你了" → endearment + longing）
//   - 按联系人聚合，区分 me/them 两条赛道（看双向度）
//   - 误报防御：商品/称谓正式语 / 工作语境 / 否定语境一票否决
//   - 用户已知的"伴侣/家人"可通过 preferences.flirt_excluded 名单排除
//
// API:
//   GET  /api/labs/flirt-probe[?refresh=1]
//   POST /api/labs/flirt-probe

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// ─── 词典：5 类暧昧信号 ──────────────────────────────────────────────────────

// 1. 亲昵称呼 endearment
// "老婆 / 老公" 即使是真实配偶之间也是暧昧表达；如果用户不想看到真配偶
// 出现在榜上，可通过 flirt_excluded 名单排除。
var flirtEndearmentPattern = regexp.MustCompile(
	`老婆|老公|媳妇|宝贝|宝宝|亲爱的|亲爱滴|心肝|小可爱|小宝贝|小可怜` +
		`|baby|honey|darling|sweetie`,
)

// 2. 想念 / 思念 longing
// 必须主语指向对方（"想你 / miss you"），泛泛的"想念"不算
var flirtLongingPattern = regexp.MustCompile(
	`想你|好想你|想死你|想见你|想抱你|想亲你|挂念你|惦记你` +
		`|miss\s*you|miss\s*u|想念你`,
)

// 3. 深夜亲密 late_night_intimate
var flirtLateNightPattern = regexp.MustCompile(
	`晚安宝贝|晚安亲爱的|早安宝贝|早安亲爱的` +
		`|陪我睡|一起睡|想你睡不着|因为你睡不着|睡不着想你`,
)

// 4. 暧昧动作 flirty_action
// 要求是"动词词组"，避免误伤"亲亲牌牙膏 / 抱抱熊"
var flirtActionPattern = regexp.MustCompile(
	`抱抱|抱一下|抱一个|想抱抱|抱抱我` +
		`|亲亲|亲一口|啵一个|想亲亲|亲一下你|亲你一下` +
		`|摸摸头|蹭蹭|揉揉|捏捏脸|戳戳|摸摸` +
		`|牵手|手牵手|十指相扣`,
)

// 5. 暧昧 emoji + 微信内置表情
var flirtEmojiPattern = regexp.MustCompile(
	`😘|😍|🥰|😻|💋|💕|💖|💗|💝|💞|❤️|❤|♥️|💌|🌹|🌷` +
		`|\[亲亲\]|\[亲一口\]|\[啵\]|\[爱心\]|\[心动\]|\[脸红\]|\[抱抱\]|\[玫瑰\]`,
)

// ─── 否定 / 排除 ─────────────────────────────────────────────────────────────

// 否定语境：句子里出现，整句作废
var flirtNegationPattern = regexp.MustCompile(
	`不想你|没想你|哪里想你|谁想你|怎么会想你` +
		`|讨厌你|烦你|滚远点|滚开|去死` +
		`|别(?:亲|抱|摸|蹭)|不要(?:亲|抱|摸)|别叫(?:宝贝|宝宝|老公|老婆|亲爱的)`,
)

// 排除话题噪声：商品名 / 影视剧 / 转账等正式上下文
var flirtTopicNoise = regexp.MustCompile(
	`电视剧|电影|小说|游戏|歌曲|歌词|演唱会|综艺|MV|mv` +
		`|公众号|链接|http|视频号|UP主|up主|蓝奏云|网盘` +
		`|亲爱的客户|亲爱的用户|亲爱的会员|亲爱的家长` +
		`|宝贝(?:牌|系列|促销|秒杀|拍下|领取|店铺|宝贝详情)` +
		`|微信(?:支付|转账|红包|账单)|淘宝|京东|拼多多`,
)

// 称呼的"正式语"误报：抗议被算成暧昧
// "亲爱的张总好" / "宝贝快递员" 之类
var flirtFormalPattern = regexp.MustCompile(
	`亲爱的(?:[各位]|[同事先生女士]{2}|[领导老师同学家长])` +
		`|宝贝快递|宝贝物流|宝贝商品`,
)

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const (
	flMaxContacts      = 200             // 最多扫前 N 个最常聊的私聊
	flMaxMsgPerContact = 30000           // 每人最多 30000 条
	flTimelineLimit    = 50              // 时间线最多展示 50 条
	flTopContactsLimit = 30              // top 联系人列表最多 30 条
	flTopQuoteLimit    = 3               // 每联系人取 Top 3 高光语录
	flSnippetMaxRunes  = 60              // 时间线 / quote 原文片段截断
	flMinHitsToInclude = 2               // 命中数低于此值（且类型 < 2）的联系人不入榜
	flCacheTTL         = 30 * time.Minute
)

// 类别 key（前端按这套展示）
const (
	flCatEndearment = "endearment"
	flCatLonging    = "longing"
	flCatLateNight  = "late_night"
	flCatAction     = "action"
	flCatEmoji      = "emoji"
)

// ─── 数据结构 ─────────────────────────────────────────────────────────────────

// flirtHit 一条命中消息
type flirtHit struct {
	date       string
	isMine     bool
	snippet    string
	categories []string // 同一条可命中多个类别
}

// FLQuote 单条高光语录
type FLQuote struct {
	Date    string `json:"date"`
	Who     string `json:"who"` // me / them
	Snippet string `json:"snippet"`
}

// FLContactRow 单个联系人的暧昧聚合
type FLContactRow struct {
	Username      string         `json:"username"`
	DisplayName   string         `json:"display_name"`
	AvatarURL     string         `json:"avatar_url"`
	TotalHits     int            `json:"total_hits"`
	MyHits        int            `json:"my_hits"`
	TheirHits     int            `json:"their_hits"`
	Categories    map[string]int `json:"categories"`     // 类别 → 命中数
	FirstDate     string         `json:"first_date"`
	LastDate      string         `json:"last_date"`
	TopQuotes     []FLQuote      `json:"top_quotes"`     // 最多 3 条最具代表性
	MutualScore   float64        `json:"mutual_score"`   // 0-1，越接近 1 越双向
}

// FLTimelineItem 最近一条命中
type FLTimelineItem struct {
	Date        string `json:"date"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Who         string `json:"who"`
	Snippet     string `json:"snippet"`
	Categories  []string `json:"categories"`
}

// FlirtProbeResponse 完整响应
type FlirtProbeResponse struct {
	TotalContactsWithHits int              `json:"total_contacts_with_hits"`
	TotalHits             int              `json:"total_hits"`
	MutualPairs           int              `json:"mutual_pairs"` // 双向命中的联系人数（双方都贡献过）
	TopContacts           []FLContactRow   `json:"top_contacts"`
	Timeline              []FLTimelineItem `json:"timeline"`
	ScannedContacts       int              `json:"scanned_contacts"`
	ExcludedUsernames     []string         `json:"excluded_usernames"` // 当前生效的排除名单（前端展示用）
	GeneratedAt           int64            `json:"generated_at"`
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

var (
	flCacheMu   sync.Mutex
	flCacheVal  *FlirtProbeResponse
	flCacheAt   time.Time
	flCacheFrom int64
	flCacheTo   int64
	// 排除名单变更会让缓存失效；用名单 hash 做版本号
	flCacheExcludeKey string
)

// ─── 路由 ─────────────────────────────────────────────────────────────────────

func registerFlirtProbeRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/flirt-probe", flirtProbeHandler(getSvc))
	prot.POST("/labs/flirt-probe", flirtProbeHandler(getSvc))
}

func flirtProbeHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"

		// 排除名单从 preferences 读
		excluded := loadFlirtExcluded()
		excludeKey := strings.Join(excluded, "|")

		flCacheMu.Lock()
		if !refresh && flCacheVal != nil &&
			flCacheFrom == from && flCacheTo == to &&
			flCacheExcludeKey == excludeKey &&
			time.Since(flCacheAt) < flCacheTTL {
			cached := *flCacheVal
			flCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		flCacheMu.Unlock()

		resp := buildFlirtProbe(svc, excluded)

		flCacheMu.Lock()
		flCacheVal = resp
		flCacheAt = time.Now()
		flCacheFrom = from
		flCacheTo = to
		flCacheExcludeKey = excludeKey
		flCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

// loadFlirtExcluded 读 preferences.flirt_excluded（用户标记的"伴侣/家人不参与统计"名单）
func loadFlirtExcluded() []string {
	p := loadPreferences()
	return append([]string(nil), p.FlirtExcluded...)
}

// ─── 核心计算 ─────────────────────────────────────────────────────────────────

func buildFlirtProbe(svc *service.ContactService, excluded []string) *FlirtProbeResponse {
	t := startTimer("flirt_probe_build")

	excludeSet := make(map[string]bool, len(excluded))
	for _, u := range excluded {
		excludeSet[u] = true
	}

	stats := svc.GetCachedStats()
	type cand struct {
		username    string
		displayName string
		avatar      string
		total       int64
	}
	picks := make([]cand, 0, 64)
	for _, st := range stats {
		// 仅扫私聊（排除群、公众号）
		if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
			continue
		}
		if st.TotalMessages <= 0 || excludeSet[st.Username] {
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
		picks = append(picks, cand{
			username:    st.Username,
			displayName: name,
			avatar:      avatar,
			total:       st.TotalMessages,
		})
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
	if len(picks) > flMaxContacts {
		picks = picks[:flMaxContacts]
	}

	resp := &FlirtProbeResponse{
		ScannedContacts:   len(picks),
		ExcludedUsernames: append([]string(nil), excluded...),
		GeneratedAt:       time.Now().Unix(),
	}

	var allTimeline []FLTimelineItem

	for _, p := range picks {
		msgs := svc.ExportContactMessagesAll(p.username)
		if len(msgs) > flMaxMsgPerContact {
			msgs = msgs[len(msgs)-flMaxMsgPerContact:]
		}

		var hits []flirtHit
		for _, m := range msgs {
			if m.Type != 1 || len(m.Date) < 10 {
				continue
			}
			content := strings.TrimSpace(m.Content)
			if content == "" {
				continue
			}
			cats := detectFlirtCategories(content)
			if len(cats) == 0 {
				continue
			}
			hits = append(hits, flirtHit{
				date:       m.Date[:10],
				isMine:     m.IsMine,
				snippet:    truncateRunes(content, flSnippetMaxRunes),
				categories: cats,
			})
		}
		if len(hits) == 0 {
			continue
		}

		// 至少满足以下之一才入榜，避免单点偶然提及
		//   1. 命中 >= flMinHitsToInclude（默认 2）
		//   2. 涉及 >= 2 个类别（多类齐发说明信号强）
		catSet := make(map[string]bool)
		for _, h := range hits {
			for _, c := range h.categories {
				catSet[c] = true
			}
		}
		if len(hits) < flMinHitsToInclude && len(catSet) < 2 {
			continue
		}

		row := FLContactRow{
			Username:    p.username,
			DisplayName: p.displayName,
			AvatarURL:   p.avatar,
			TotalHits:   len(hits),
			Categories:  make(map[string]int, len(catSet)),
			FirstDate:   hits[0].date,
			LastDate:    hits[len(hits)-1].date,
		}
		for _, h := range hits {
			if h.isMine {
				row.MyHits++
			} else {
				row.TheirHits++
			}
			for _, c := range h.categories {
				row.Categories[c]++
			}
			if h.date < row.FirstDate {
				row.FirstDate = h.date
			}
			if h.date > row.LastDate {
				row.LastDate = h.date
			}
		}

		// 双向度：min/max。完全双向 = 1.0，完全单向 = 0.0
		if row.MyHits > 0 && row.TheirHits > 0 {
			mn, mx := row.MyHits, row.TheirHits
			if mn > mx {
				mn, mx = mx, mn
			}
			row.MutualScore = float64(mn) / float64(mx)
		}

		// Top 高光语录：优先多类别 hit + 优先 emoji/longing 类（更有"暧昧浓度"）
		row.TopQuotes = pickTopQuotes(hits, flTopQuoteLimit)

		resp.TopContacts = append(resp.TopContacts, row)
		resp.TotalHits += len(hits)
		if row.MyHits > 0 && row.TheirHits > 0 {
			resp.MutualPairs++
		}

		// 时间线候选（每联系人最多取 2 条最近命中，避免单人霸榜）
		taken := 0
		for i := len(hits) - 1; i >= 0 && taken < 2; i-- {
			who := "them"
			if hits[i].isMine {
				who = "me"
			}
			allTimeline = append(allTimeline, FLTimelineItem{
				Date:        hits[i].date,
				Username:    p.username,
				DisplayName: p.displayName,
				Who:         who,
				Snippet:     hits[i].snippet,
				Categories:  append([]string(nil), hits[i].categories...),
			})
			taken++
		}
	}

	resp.TotalContactsWithHits = len(resp.TopContacts)

	// Top 排序：总命中数 desc，同分按双向度 desc，再按最近日期 desc
	sort.Slice(resp.TopContacts, func(i, j int) bool {
		a, b := resp.TopContacts[i], resp.TopContacts[j]
		if a.TotalHits != b.TotalHits {
			return a.TotalHits > b.TotalHits
		}
		if a.MutualScore != b.MutualScore {
			return a.MutualScore > b.MutualScore
		}
		return a.LastDate > b.LastDate
	})
	if len(resp.TopContacts) > flTopContactsLimit {
		resp.TopContacts = resp.TopContacts[:flTopContactsLimit]
	}

	// 时间线按日期降序，取 N
	sort.Slice(allTimeline, func(i, j int) bool { return allTimeline[i].Date > allTimeline[j].Date })
	if len(allTimeline) > flTimelineLimit {
		allTimeline = allTimeline[:flTimelineLimit]
	}
	resp.Timeline = allTimeline

	t.Done(nil,
		"scanned_contacts", len(picks),
		"hits_contacts", resp.TotalContactsWithHits,
		"total_hits", resp.TotalHits,
		"mutual_pairs", resp.MutualPairs,
		"excluded", len(excluded),
	)
	return resp
}

// detectFlirtCategories 判断一条消息命中哪些类别，没有命中返回空 slice。
//
// 规则：
//   1. 否定语境 / 话题噪声 / 称呼正式语命中任一 → 一票否决
//   2. 5 个类别分别 match
//   3. 单独 endearment 命中要求消息够短（< 50 字），避免大段引用里偶然出现
func detectFlirtCategories(s string) []string {
	if flirtNegationPattern.MatchString(s) {
		return nil
	}
	if flirtTopicNoise.MatchString(s) {
		return nil
	}
	if flirtFormalPattern.MatchString(s) {
		return nil
	}

	var cats []string
	if flirtEndearmentPattern.MatchString(s) {
		// endearment 单独命中要求短文本，避免长引用 / 论文 / 段子里掺到的"宝贝/老公"
		if len([]rune(s)) <= 50 {
			cats = append(cats, flCatEndearment)
		}
	}
	if flirtLongingPattern.MatchString(s) {
		cats = append(cats, flCatLonging)
	}
	if flirtLateNightPattern.MatchString(s) {
		cats = append(cats, flCatLateNight)
	}
	if flirtActionPattern.MatchString(s) {
		// action 同样要求短文本
		if len([]rune(s)) <= 50 {
			cats = append(cats, flCatAction)
		}
	}
	if flirtEmojiPattern.MatchString(s) {
		cats = append(cats, flCatEmoji)
	}
	return cats
}

// pickTopQuotes 从所有 hits 里挑 top n 高光语录。
// 评分：类别数（更"浓"的优先）+ 长度倾向（短句更直白）
func pickTopQuotes(hits []flirtHit, n int) []FLQuote {
	type scored struct {
		h     flirtHit
		score float64
	}
	all := make([]scored, 0, len(hits))
	for _, h := range hits {
		// 多类别 +2 / 类别；emoji 或 longing 类额外 +1（信号最强）
		s := float64(len(h.categories)) * 2.0
		for _, c := range h.categories {
			if c == flCatEmoji || c == flCatLonging {
				s += 1.0
			}
		}
		// 极短消息 +0.5（"想你" 比段子里的"宝贝今天考试了"更直白）
		if r := []rune(h.snippet); len(r) <= 8 {
			s += 0.5
		}
		all = append(all, scored{h, s})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		// 同分按日期较新
		return all[i].h.date > all[j].h.date
	})
	if len(all) > n {
		all = all[:n]
	}
	out := make([]FLQuote, 0, len(all))
	for _, x := range all {
		who := "them"
		if x.h.isMine {
			who = "me"
		}
		out = append(out, FLQuote{
			Date:    x.h.date,
			Who:     who,
			Snippet: x.h.snippet,
		})
	}
	return out
}
