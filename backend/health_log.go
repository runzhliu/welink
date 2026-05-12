package main

// health_log.go — 「健康日记」 Lab
//
// 扫所有私聊里关于"生病"的痕迹：症状词 / 就医行为词。命中后用 7 天滚动窗口
// 把连续提及合并成一次"生病发作"，分别统计「我自己」和「TA 们」。
//
// 零 LLM、纯关键词匹配 + 否定语境过滤，秒出可离线。
//
// 输出（前端用作 Lab 卡片）：
//   - summary：全年级别的"我生病过几次 / TA 们生病过几次"
//   - per_contact：按联系人聚合的 Top 榜 + 双向次数对比
//   - timeline：按时间倒序的"最近一些生病片段"，含原文摘要给气氛
//
// API:
//   GET  /api/labs/health-log[?refresh=1]
//   POST /api/labs/health-log

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

// ─── 词典 ─────────────────────────────────────────────────────────────────────

// 症状词：明确指向"我/TA 正在不舒服"的词。短词在前 + 长词在前一般规则不适用，
// 因为我们的策略是「同一句命中任意一个就算」，不是按最长匹配。
//
// 加词的原则：
//   - 必须有明确"身体不适"语义，不能是"老板太狠了"这种隐喻
//   - 不能是常见歌词 / 影视剧名（如"流感"是电影名，但也是病名 → 留着，靠否定词过滤）
//   - 中英都加：fever / sick / flu 这种常用英文也能命中
var healthSymptomPattern = regexp.MustCompile(
	`感冒|发烧|发热|高烧|低烧` +
		`|咳嗽|嗓子疼|喉咙疼|喉咙痛|嗓子哑|声音哑` +
		`|头疼|头痛|偏头痛|头晕|眩晕` +
		`|肚子疼|肚子痛|胃疼|胃痛|胃胀|反酸|烧心` +
		`|拉肚子|腹泻|便秘` +
		`|恶心|想吐|呕吐|干呕|反胃` +
		`|牙疼|牙痛|智齿|蛀牙发作` +
		`|腰疼|腰痛|背疼|背痛|肩颈疼|脖子疼` +
		`|关节疼|膝盖疼|脚踝疼|手指疼` +
		`|过敏|起疹子|起红点|长湿疹|长痘|长麦粒` +
		`|失眠|睡不着|入睡困难` +
		`|中暑|脱水|低血糖|血压高|低血压` +
		`|鼻塞|流鼻涕|打喷嚏|鼻炎犯了|鼻炎发作` +
		`|口腔溃疡|嘴上起泡|嘴角溃疡` +
		`|月经|大姨妈|痛经|经期` +
		`|流感|新冠|阳了|二阳|甲流|乙流|诺如` +
		`|fever|sick|flu|covid|migraine`,
)

// 行为词：去医院/吃药这类强信号。即使不出现症状词，单独出现也算"生病线索"。
var healthBehaviorPattern = regexp.MustCompile(
	`去医院|看医生|看大夫|去看病|去看了医生|挂号|挂了号|排队挂` +
		`|急诊|住院|住了院|出院|做手术|动手术|开刀` +
		`|打针|输液|挂水|挂吊瓶|输了液|打了针|打吊针` +
		`|拍片|拍 ?ct|做 ?ct|拍 ?x ?光|做核磁|做 ?mri|做 ?b ?超` +
		`|抽血|验血|化验` +
		`|吃药|喝药|嗑药|布洛芬|泰诺|奥司他韦|连花清瘟|阿莫西林|藿香正气|蒙脱石散` +
		`|发烧药|退烧药|止痛药|感冒药|消炎药|抗生素` +
		`|请病假|病假|请假休息|请了假.{0,4}养病` +
		`|儿科|急诊科|内科|外科|皮肤科|妇科|口腔科|眼科` +
		`|阳性|抗原|核酸阳`,
)

// 否定/排除词：句子里命中任何一个，整句作废。
//
// 设计动机：避免误报
//   - "不会感冒"、"别发烧了"、"没有发烧"
//   - "热门"、"流量"、"股热"（"热"字会被未来正则误伤，这里先不收，但保留扩展）
//   - "感冒灵广告"、"医院里那个" 这种话题谈论而非自述
//
// 注意：我们只在「同一句」内查，不跨句。
var healthNegationPattern = regexp.MustCompile(
	`不会(感冒|发烧|头疼|拉肚子|生病)` +
		`|别(感冒|发烧|头疼|生病)了?` +
		`|没(感冒|发烧|拉肚子|事|生病)` +
		`|不是(感冒|发烧)` +
		`|不至于(感冒|发烧)` +
		`|怕(感冒|发烧|生病)` +
		`|担心(感冒|发烧|生病)` +
		`|预防(感冒|发烧)` +
		`|防止(感冒|发烧|拉肚子)`,
)

// 排除话题词（这些词出现在句子里，说明是在聊别的）
var healthTopicNoise = regexp.MustCompile(
	`电视剧|电影|小说|游戏|歌曲|歌词|股票|基金|新闻|公众号|视频|UP主|up主` +
		`|蓝奏云|网盘|链接|http`,
)

// "生病" / "病了" 这种泛泛说法 —— 单独命中信号太弱，要配合更具体的词或者
// 不在否定/话题语境里才算。
var healthGenericPattern = regexp.MustCompile(`病了|不舒服|难受死|难受得|太难受|生病|身体不好|身体不舒服`)

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const (
	hlMaxContacts      = 200             // 最多扫前 N 个最常聊的私聊
	hlMaxMsgPerContact = 50000           // 每人最多 50000 条（生病通常出现在普通对话流，不会刷屏，应付大群足够）
	hlEpisodeGapDays   = 7               // 7 天滑动窗口合并成一次"发作"
	hlTimelineLimit    = 30              // 时间线最多展示 30 条
	hlSnippetMaxRunes  = 80              // 时间线原文片段截断
	hlCacheTTL         = 30 * time.Minute
)

// ─── 数据结构 ─────────────────────────────────────────────────────────────────

// 单次"发作"：一段聊天里连续提到生病的窗口
type healthEpisode struct {
	FirstDate string
	LastDate  string
	Speaker   string // "me" or "them"
	Snippets  []string // 最多 3 条命中原文
}

// HLContactRow 单个联系人的健康数据汇总
type HLContactRow struct {
	Username       string `json:"username"`
	DisplayName    string `json:"display_name"`
	AvatarURL      string `json:"avatar_url"`
	MyEpisodes     int    `json:"my_episodes"`     // 我在 TA 面前提到生病
	TheirEpisodes  int    `json:"their_episodes"`  // TA 跟我说 TA 生病
	LastEpisodeDate string `json:"last_episode_date"`
	LastEpisodeWho  string `json:"last_episode_who"` // me / them
}

// HLTimelineItem 一条"最近的生病记录"
type HLTimelineItem struct {
	Date        string `json:"date"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Who         string `json:"who"`    // me / them
	Snippet     string `json:"snippet"`
}

// HLMonthBucket 月度发作次数
type HLMonthBucket struct {
	Month         string `json:"month"`           // "2025-03"
	MyEpisodes    int    `json:"my_episodes"`
	TheirEpisodes int    `json:"their_episodes"`
}

// HealthLogResponse 健康日记完整响应
type HealthLogResponse struct {
	TotalMyEpisodes    int              `json:"total_my_episodes"`
	TotalTheirEpisodes int              `json:"total_their_episodes"`
	ContactsWithHits   int              `json:"contacts_with_hits"`
	TopContacts        []HLContactRow   `json:"top_contacts"`
	MyEarliestDate     string           `json:"my_earliest_date,omitempty"`
	Timeline           []HLTimelineItem `json:"timeline"`
	Monthly            []HLMonthBucket  `json:"monthly"`
	ScannedContacts    int              `json:"scanned_contacts"`
	GeneratedAt        int64            `json:"generated_at"`
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

var (
	hlCacheMu   sync.Mutex
	hlCacheVal  *HealthLogResponse
	hlCacheAt   time.Time
	hlCacheFrom int64
	hlCacheTo   int64
)

// ─── 路由 ─────────────────────────────────────────────────────────────────────

func registerHealthLogRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/health-log", healthLogHandler(getSvc))
	prot.POST("/labs/health-log", healthLogHandler(getSvc))
}

func healthLogHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"

		hlCacheMu.Lock()
		if !refresh && hlCacheVal != nil &&
			hlCacheFrom == from && hlCacheTo == to &&
			time.Since(hlCacheAt) < hlCacheTTL {
			cached := *hlCacheVal
			hlCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		hlCacheMu.Unlock()

		resp := buildHealthLog(svc)

		hlCacheMu.Lock()
		hlCacheVal = resp
		hlCacheAt = time.Now()
		hlCacheFrom = from
		hlCacheTo = to
		hlCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

// ─── 核心计算 ─────────────────────────────────────────────────────────────────

func buildHealthLog(svc *service.ContactService) *HealthLogResponse {
	t := startTimer("health_log_build")

	// 选私聊（不含群、不含公众号），按消息量降序取前 N
	stats := svc.GetCachedStats()
	type cand struct {
		username    string
		displayName string
		avatar      string
		total       int64
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
		picks = append(picks, cand{
			username:    st.Username,
			displayName: name,
			avatar:      avatar,
			total:       st.TotalMessages,
		})
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
	if len(picks) > hlMaxContacts {
		picks = picks[:hlMaxContacts]
	}

	resp := &HealthLogResponse{
		ScannedContacts: len(picks),
		GeneratedAt:     time.Now().Unix(),
	}

	monthlyAgg := make(map[string]*HLMonthBucket) // "2025-03" → bucket
	var allTimeline []HLTimelineItem

	for _, p := range picks {
		msgs := svc.ExportContactMessagesAll(p.username)
		if len(msgs) > hlMaxMsgPerContact {
			msgs = msgs[len(msgs)-hlMaxMsgPerContact:]
		}

		// 收集所有命中：一条消息只算一次，分 me / them 两条赛道
		hits := make([]healthHit, 0, 8)
		for _, m := range msgs {
			if m.Type != 1 || len(m.Date) < 10 {
				continue
			}
			content := strings.TrimSpace(m.Content)
			if content == "" {
				continue
			}
			if !looksLikeHealthMention(content) {
				continue
			}
			hits = append(hits, healthHit{
				date:    m.Date[:10],
				isMine:  m.IsMine,
				snippet: truncateRunes(content, hlSnippetMaxRunes),
			})
		}
		if len(hits) == 0 {
			continue
		}

		// 7 天滚动窗口合并成 episode（分 me/them 各自合并）
		mineEpisodes := mergeIntoEpisodes(hits, true)
		theirEpisodes := mergeIntoEpisodes(hits, false)

		row := HLContactRow{
			Username:      p.username,
			DisplayName:   p.displayName,
			AvatarURL:     p.avatar,
			MyEpisodes:    len(mineEpisodes),
			TheirEpisodes: len(theirEpisodes),
		}

		// 最近一次发作
		var lastDate string
		var lastWho string
		for _, ep := range mineEpisodes {
			if ep.LastDate > lastDate {
				lastDate = ep.LastDate
				lastWho = "me"
			}
		}
		for _, ep := range theirEpisodes {
			if ep.LastDate > lastDate {
				lastDate = ep.LastDate
				lastWho = "them"
			}
		}
		row.LastEpisodeDate = lastDate
		row.LastEpisodeWho = lastWho

		resp.TopContacts = append(resp.TopContacts, row)
		resp.TotalMyEpisodes += len(mineEpisodes)
		resp.TotalTheirEpisodes += len(theirEpisodes)

		// 月度桶（按 episode 起始月）
		for _, ep := range mineEpisodes {
			month := ep.FirstDate[:7]
			b := monthlyAgg[month]
			if b == nil {
				b = &HLMonthBucket{Month: month}
				monthlyAgg[month] = b
			}
			b.MyEpisodes++
		}
		for _, ep := range theirEpisodes {
			month := ep.FirstDate[:7]
			b := monthlyAgg[month]
			if b == nil {
				b = &HLMonthBucket{Month: month}
				monthlyAgg[month] = b
			}
			b.TheirEpisodes++
		}

		// 时间线候选：每个 episode 取首条原文
		for _, ep := range mineEpisodes {
			snippet := ""
			if len(ep.Snippets) > 0 {
				snippet = ep.Snippets[0]
			}
			allTimeline = append(allTimeline, HLTimelineItem{
				Date:        ep.FirstDate,
				Username:    p.username,
				DisplayName: p.displayName,
				Who:         "me",
				Snippet:     snippet,
			})
		}
		for _, ep := range theirEpisodes {
			snippet := ""
			if len(ep.Snippets) > 0 {
				snippet = ep.Snippets[0]
			}
			allTimeline = append(allTimeline, HLTimelineItem{
				Date:        ep.FirstDate,
				Username:    p.username,
				DisplayName: p.displayName,
				Who:         "them",
				Snippet:     snippet,
			})
		}
	}

	resp.ContactsWithHits = len(resp.TopContacts)

	// Top 榜按"双方总和"排序，给前端切 Top N 用
	sort.Slice(resp.TopContacts, func(i, j int) bool {
		ti := resp.TopContacts[i].MyEpisodes + resp.TopContacts[i].TheirEpisodes
		tj := resp.TopContacts[j].MyEpisodes + resp.TopContacts[j].TheirEpisodes
		if ti != tj {
			return ti > tj
		}
		// 同分按最近日期降序
		return resp.TopContacts[i].LastEpisodeDate > resp.TopContacts[j].LastEpisodeDate
	})

	// 月度桶按月升序输出
	monthly := make([]HLMonthBucket, 0, len(monthlyAgg))
	for _, b := range monthlyAgg {
		monthly = append(monthly, *b)
	}
	sort.Slice(monthly, func(i, j int) bool { return monthly[i].Month < monthly[j].Month })
	resp.Monthly = monthly

	// 我自己最早一次（用来文案上"从 YYYY 年起，你聊了 N 次生病"）
	for _, ep := range allTimeline {
		if ep.Who != "me" {
			continue
		}
		if resp.MyEarliestDate == "" || ep.Date < resp.MyEarliestDate {
			resp.MyEarliestDate = ep.Date
		}
	}

	// 时间线按日期降序，取最近 N 条
	sort.Slice(allTimeline, func(i, j int) bool { return allTimeline[i].Date > allTimeline[j].Date })
	if len(allTimeline) > hlTimelineLimit {
		allTimeline = allTimeline[:hlTimelineLimit]
	}
	resp.Timeline = allTimeline

	t.Done(nil,
		"scanned_contacts", len(picks),
		"hits_contacts", resp.ContactsWithHits,
		"my_episodes", resp.TotalMyEpisodes,
		"their_episodes", resp.TotalTheirEpisodes,
	)
	return resp
}

// looksLikeHealthMention 判定一条消息是否疑似"生病/就医"。
//
// 规则：
//   1. 命中症状词 或 行为词 → 候选
//   2. 命中泛泛"病了/不舒服" + 没命中话题噪声 → 候选
//   3. 命中否定/预防词 → 一票否决
//   4. 命中话题噪声（电视剧/新闻等）+ 命中症状 → 否决（很可能是在聊别的）
func looksLikeHealthMention(s string) bool {
	if healthNegationPattern.MatchString(s) {
		return false
	}
	hitSymptom := healthSymptomPattern.MatchString(s)
	hitBehavior := healthBehaviorPattern.MatchString(s)
	hitGeneric := healthGenericPattern.MatchString(s)

	if !hitSymptom && !hitBehavior && !hitGeneric {
		return false
	}

	// 话题噪声 + 没有"我/我家/我妈"这种主语强信号时降级
	if healthTopicNoise.MatchString(s) {
		return false
	}

	// 泛泛词单独命中时要求消息够短（说明是自述，不是大段引用）
	if !hitSymptom && !hitBehavior && hitGeneric {
		runes := []rune(s)
		if len(runes) > 40 {
			return false
		}
	}

	return true
}

// healthHit 一条疑似生病的消息命中
type healthHit struct {
	date    string
	isMine  bool
	snippet string
}

// mergeIntoEpisodes 把同一条赛道的命中按 7 天滚动窗口合并成 episodes。
//
// hits 已经按时间从旧到新（svc.ExportContactMessagesAll 的天然顺序）。
func mergeIntoEpisodes(allHits []healthHit, mine bool) []healthEpisode {
	var episodes []healthEpisode
	var cur *healthEpisode

	for _, h := range allHits {
		if h.isMine != mine {
			continue
		}
		if cur == nil {
			cur = &healthEpisode{
				FirstDate: h.date,
				LastDate:  h.date,
				Snippets:  []string{h.snippet},
			}
			continue
		}
		// 距上一次 ≤ 7 天 → 合并到当前 episode
		if hlDayGap(cur.LastDate, h.date) <= hlEpisodeGapDays {
			cur.LastDate = h.date
			if len(cur.Snippets) < 3 {
				cur.Snippets = append(cur.Snippets, h.snippet)
			}
			continue
		}
		// 否则收掉旧的、开新 episode
		episodes = append(episodes, *cur)
		cur = &healthEpisode{
			FirstDate: h.date,
			LastDate:  h.date,
			Snippets:  []string{h.snippet},
		}
	}
	if cur != nil {
		episodes = append(episodes, *cur)
	}
	return episodes
}

// hlDayGap 算两个 YYYY-MM-DD 之间的间隔天数（abs）。
// 与 milestones.go 的 daysBetween 不同：那个返回"包含天数"，这里要的是"距离天数"。
func hlDayGap(a, b string) int {
	ta, errA := time.Parse("2006-01-02", a)
	tb, errB := time.Parse("2006-01-02", b)
	if errA != nil || errB != nil {
		return 9999
	}
	diff := tb.Sub(ta).Hours() / 24
	if diff < 0 {
		diff = -diff
	}
	return int(diff + 0.5)
}
