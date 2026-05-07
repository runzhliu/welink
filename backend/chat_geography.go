package main

// chat_geography.go — 「聊天地图」
//
// 思路：内置一个常见地名词典（中国直辖市 / 主要城市 / 景点 + 海外大城 + 国家），
// 扫"我"和私聊的全部文本消息，子串匹配并统计每个地名被提到的次数 + Top 3 聊起它的人。
// 零 LLM、零外部地理 API、零新增依赖。
//
// 与"创意实验室"里其他卡片一致：本地缓存 2h，?refresh=1 强制重算。
//
// API: GET /api/me/chat-geography[?limit=30][&refresh=1]

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
	cgMaxContacts      = 80
	cgMaxMsgPerContact = 5000
	cgDefaultLimit     = 30
	cgMaxLimit         = 100
	cgCacheTTL         = 2 * time.Hour
	cgTopContactsPer   = 3 // 每个地名展示 Top N 同行者
)

// Tier 表示地名的类别（影响前端图标 / 颜色）
type CGTier string

const (
	tierChinaMetro   CGTier = "china_metro"   // 北上广深 + 直辖市
	tierChinaCity    CGTier = "china_city"    // 其他中国城市
	tierChinaScenic  CGTier = "china_scenic"  // 国内著名景点
	tierAbroadCity   CGTier = "abroad_city"   // 海外城市
	tierAbroadCountry CGTier = "abroad_country" // 国家级
	tierRegion       CGTier = "region"        // 港澳台
)

// CGContactRef 一个 Top 联系人引用
type CGContactRef struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Avatar      string `json:"avatar,omitempty"`
	Count       int    `json:"count"`
}

// CGPlace 一个地名条目
type CGPlace struct {
	Name      string         `json:"name"`
	Tier      CGTier         `json:"tier"`
	Mentions  int            `json:"mentions"`
	Contacts  int            `json:"contacts"`           // 多少个不同联系人聊起过
	TopWith   []CGContactRef `json:"top_with,omitempty"` // Top 3 同行者
}

// CGResponse 完整响应
type CGResponse struct {
	Places          []CGPlace `json:"places"`
	TotalMentions   int       `json:"total_mentions"`
	UniquePlaces    int       `json:"unique_places"`
	ContactsScanned int       `json:"contacts_scanned"`
	MessagesScanned int       `json:"messages_scanned"`
	GeneratedAt     int64     `json:"generated_at"`
}

// 地名词典：name + tier
// 子串匹配 → 名字是否出现在消息中
// 注意：这里的 name 必须是消息里**真正会出现**的字符串。"山西" 这种容易和"山西阳泉"混匹（OK，
// 仍然算山西被提到）；但"上"/"东"这种太短的不要单独加。
var cgPlaceDict = []struct {
	name string
	tier CGTier
}{
	// ── 中国直辖市 + 一线 ──────────────────────────────────────────────
	{"北京", tierChinaMetro}, {"上海", tierChinaMetro}, {"广州", tierChinaMetro},
	{"深圳", tierChinaMetro}, {"天津", tierChinaMetro}, {"重庆", tierChinaMetro},
	// ── 中国主要城市（省会 + 经济强市）────────────────────────────────
	{"成都", tierChinaCity}, {"杭州", tierChinaCity}, {"武汉", tierChinaCity},
	{"南京", tierChinaCity}, {"苏州", tierChinaCity}, {"西安", tierChinaCity},
	{"青岛", tierChinaCity}, {"大连", tierChinaCity}, {"厦门", tierChinaCity},
	{"福州", tierChinaCity}, {"济南", tierChinaCity}, {"合肥", tierChinaCity},
	{"长沙", tierChinaCity}, {"郑州", tierChinaCity}, {"沈阳", tierChinaCity},
	{"长春", tierChinaCity}, {"哈尔滨", tierChinaCity}, {"昆明", tierChinaCity},
	{"贵阳", tierChinaCity}, {"南宁", tierChinaCity}, {"海口", tierChinaCity},
	{"三亚", tierChinaCity}, {"南昌", tierChinaCity}, {"太原", tierChinaCity},
	{"石家庄", tierChinaCity}, {"兰州", tierChinaCity}, {"银川", tierChinaCity},
	{"西宁", tierChinaCity}, {"乌鲁木齐", tierChinaCity}, {"呼和浩特", tierChinaCity},
	{"拉萨", tierChinaCity}, {"宁波", tierChinaCity}, {"无锡", tierChinaCity},
	{"温州", tierChinaCity}, {"东莞", tierChinaCity}, {"佛山", tierChinaCity},
	{"珠海", tierChinaCity}, {"中山", tierChinaCity}, {"惠州", tierChinaCity},
	{"汕头", tierChinaCity}, {"洛阳", tierChinaCity}, {"唐山", tierChinaCity},
	{"扬州", tierChinaCity}, {"烟台", tierChinaCity}, {"威海", tierChinaCity},
	{"绍兴", tierChinaCity}, {"嘉兴", tierChinaCity}, {"金华", tierChinaCity},
	{"丽江", tierChinaCity}, {"大理", tierChinaCity}, {"敦煌", tierChinaCity},
	{"桂林", tierChinaCity}, {"阳朔", tierChinaCity}, {"张家界", tierChinaCity},
	{"九寨沟", tierChinaScenic}, {"凯里", tierChinaCity},
	// ── 港澳台 ────────────────────────────────────────────────────────
	{"香港", tierRegion}, {"澳门", tierRegion}, {"台北", tierRegion},
	{"高雄", tierRegion}, {"台中", tierRegion}, {"台南", tierRegion},
	{"花莲", tierRegion}, {"垦丁", tierRegion},
	// ── 国内著名景点 ──────────────────────────────────────────────────
	{"西湖", tierChinaScenic}, {"黄山", tierChinaScenic}, {"长城", tierChinaScenic},
	{"故宫", tierChinaScenic}, {"颐和园", tierChinaScenic}, {"天坛", tierChinaScenic},
	{"外滩", tierChinaScenic}, {"陆家嘴", tierChinaScenic}, {"迪士尼", tierChinaScenic},
	{"环球影城", tierChinaScenic}, {"泰山", tierChinaScenic}, {"华山", tierChinaScenic},
	{"峨眉山", tierChinaScenic}, {"青城山", tierChinaScenic}, {"武当山", tierChinaScenic},
	{"布达拉宫", tierChinaScenic}, {"鼓浪屿", tierChinaScenic}, {"洱海", tierChinaScenic},
	{"乌镇", tierChinaScenic}, {"周庄", tierChinaScenic}, {"丽江古城", tierChinaScenic},
	{"凤凰古城", tierChinaScenic}, {"喀纳斯", tierChinaScenic}, {"稻城亚丁", tierChinaScenic},
	// ── 海外 - 亚洲 ───────────────────────────────────────────────────
	{"东京", tierAbroadCity}, {"大阪", tierAbroadCity}, {"京都", tierAbroadCity},
	{"奈良", tierAbroadCity}, {"横滨", tierAbroadCity}, {"札幌", tierAbroadCity},
	{"北海道", tierAbroadCity}, {"冲绳", tierAbroadCity}, {"福冈", tierAbroadCity},
	{"首尔", tierAbroadCity}, {"釜山", tierAbroadCity}, {"济州岛", tierAbroadCity},
	{"新加坡", tierAbroadCity}, {"曼谷", tierAbroadCity}, {"清迈", tierAbroadCity},
	{"普吉", tierAbroadCity}, {"普吉岛", tierAbroadCity}, {"芭提雅", tierAbroadCity},
	{"吉隆坡", tierAbroadCity}, {"槟城", tierAbroadCity},
	{"巴厘岛", tierAbroadCity}, {"雅加达", tierAbroadCity}, {"马尼拉", tierAbroadCity},
	{"长滩岛", tierAbroadCity}, {"宿务", tierAbroadCity},
	{"河内", tierAbroadCity}, {"胡志明", tierAbroadCity}, {"岘港", tierAbroadCity},
	{"暹粒", tierAbroadCity}, {"金边", tierAbroadCity},
	{"孟买", tierAbroadCity}, {"新德里", tierAbroadCity},
	{"迪拜", tierAbroadCity}, {"阿布扎比", tierAbroadCity}, {"多哈", tierAbroadCity},
	// ── 海外 - 欧洲 ───────────────────────────────────────────────────
	{"伦敦", tierAbroadCity}, {"爱丁堡", tierAbroadCity},
	{"巴黎", tierAbroadCity}, {"里昂", tierAbroadCity}, {"尼斯", tierAbroadCity},
	{"罗马", tierAbroadCity}, {"米兰", tierAbroadCity}, {"威尼斯", tierAbroadCity},
	{"佛罗伦萨", tierAbroadCity}, {"那不勒斯", tierAbroadCity},
	{"巴塞罗那", tierAbroadCity}, {"马德里", tierAbroadCity},
	{"柏林", tierAbroadCity}, {"慕尼黑", tierAbroadCity}, {"法兰克福", tierAbroadCity},
	{"汉堡", tierAbroadCity},
	{"阿姆斯特丹", tierAbroadCity}, {"鹿特丹", tierAbroadCity},
	{"维也纳", tierAbroadCity}, {"萨尔茨堡", tierAbroadCity},
	{"布拉格", tierAbroadCity}, {"布达佩斯", tierAbroadCity},
	{"雅典", tierAbroadCity}, {"圣托里尼", tierAbroadCity},
	{"苏黎世", tierAbroadCity}, {"日内瓦", tierAbroadCity}, {"卢塞恩", tierAbroadCity},
	{"伊斯坦布尔", tierAbroadCity}, {"卡帕多奇亚", tierAbroadCity},
	{"哥本哈根", tierAbroadCity}, {"斯德哥尔摩", tierAbroadCity},
	{"奥斯陆", tierAbroadCity}, {"赫尔辛基", tierAbroadCity}, {"雷克雅未克", tierAbroadCity},
	{"圣彼得堡", tierAbroadCity}, {"莫斯科", tierAbroadCity},
	// ── 海外 - 美洲 ───────────────────────────────────────────────────
	{"纽约", tierAbroadCity}, {"洛杉矶", tierAbroadCity}, {"旧金山", tierAbroadCity},
	{"芝加哥", tierAbroadCity}, {"波士顿", tierAbroadCity}, {"华盛顿", tierAbroadCity},
	{"西雅图", tierAbroadCity}, {"波特兰", tierAbroadCity}, {"拉斯维加斯", tierAbroadCity},
	{"夏威夷", tierAbroadCity}, {"檀香山", tierAbroadCity},
	{"温哥华", tierAbroadCity}, {"多伦多", tierAbroadCity}, {"蒙特利尔", tierAbroadCity},
	{"墨西哥城", tierAbroadCity}, {"坎昆", tierAbroadCity},
	{"里约", tierAbroadCity}, {"里约热内卢", tierAbroadCity}, {"圣保罗", tierAbroadCity},
	{"布宜诺斯艾利斯", tierAbroadCity},
	// ── 海外 - 大洋洲 / 非洲 ─────────────────────────────────────────
	{"悉尼", tierAbroadCity}, {"墨尔本", tierAbroadCity}, {"布里斯班", tierAbroadCity},
	{"凯恩斯", tierAbroadCity}, {"黄金海岸", tierAbroadCity},
	{"奥克兰", tierAbroadCity}, {"皇后镇", tierAbroadCity}, {"惠灵顿", tierAbroadCity},
	{"开普敦", tierAbroadCity}, {"约翰内斯堡", tierAbroadCity}, {"开罗", tierAbroadCity},
	{"马拉喀什", tierAbroadCity}, {"卡萨布兰卡", tierAbroadCity},
	// ── 国家 / 大区 ───────────────────────────────────────────────────
	{"日本", tierAbroadCountry}, {"韩国", tierAbroadCountry}, {"朝鲜", tierAbroadCountry},
	{"美国", tierAbroadCountry}, {"加拿大", tierAbroadCountry}, {"墨西哥", tierAbroadCountry},
	{"英国", tierAbroadCountry}, {"法国", tierAbroadCountry}, {"德国", tierAbroadCountry},
	{"意大利", tierAbroadCountry}, {"西班牙", tierAbroadCountry}, {"葡萄牙", tierAbroadCountry},
	{"希腊", tierAbroadCountry}, {"瑞士", tierAbroadCountry}, {"荷兰", tierAbroadCountry},
	{"比利时", tierAbroadCountry}, {"奥地利", tierAbroadCountry}, {"捷克", tierAbroadCountry},
	{"匈牙利", tierAbroadCountry}, {"波兰", tierAbroadCountry}, {"瑞典", tierAbroadCountry},
	{"挪威", tierAbroadCountry}, {"芬兰", tierAbroadCountry}, {"丹麦", tierAbroadCountry},
	{"冰岛", tierAbroadCountry}, {"爱尔兰", tierAbroadCountry},
	{"俄罗斯", tierAbroadCountry}, {"乌克兰", tierAbroadCountry}, {"土耳其", tierAbroadCountry},
	{"以色列", tierAbroadCountry}, {"阿联酋", tierAbroadCountry}, {"沙特", tierAbroadCountry},
	{"伊朗", tierAbroadCountry},
	{"泰国", tierAbroadCountry}, {"越南", tierAbroadCountry}, {"老挝", tierAbroadCountry},
	{"柬埔寨", tierAbroadCountry}, {"缅甸", tierAbroadCountry},
	{"马来西亚", tierAbroadCountry}, {"菲律宾", tierAbroadCountry}, {"印度尼西亚", tierAbroadCountry},
	{"印尼", tierAbroadCountry}, {"印度", tierAbroadCountry}, {"斯里兰卡", tierAbroadCountry},
	{"尼泊尔", tierAbroadCountry}, {"巴基斯坦", tierAbroadCountry}, {"孟加拉", tierAbroadCountry},
	{"蒙古", tierAbroadCountry}, {"哈萨克斯坦", tierAbroadCountry},
	{"澳洲", tierAbroadCountry}, {"澳大利亚", tierAbroadCountry}, {"新西兰", tierAbroadCountry},
	{"巴西", tierAbroadCountry}, {"阿根廷", tierAbroadCountry}, {"智利", tierAbroadCountry},
	{"秘鲁", tierAbroadCountry}, {"古巴", tierAbroadCountry},
	{"南非", tierAbroadCountry}, {"肯尼亚", tierAbroadCountry}, {"埃及", tierAbroadCountry},
	{"摩洛哥", tierAbroadCountry}, {"马尔代夫", tierAbroadCountry}, {"塞舌尔", tierAbroadCountry},
}

// 缓存
var (
	cgCacheMu   sync.Mutex
	cgCacheVal  *CGResponse
	cgCacheAt   time.Time
	cgCacheFrom int64
	cgCacheTo   int64
)

func registerChatGeographyRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/me/chat-geography", chatGeographyHandler(getSvc))
}

func chatGeographyHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		from, to := svc.Filter()
		refresh := c.Query("refresh") == "1"

		cgCacheMu.Lock()
		if !refresh && cgCacheVal != nil &&
			cgCacheFrom == from && cgCacheTo == to &&
			time.Since(cgCacheAt) < cgCacheTTL {
			cached := *cgCacheVal
			cgCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		cgCacheMu.Unlock()

		// 选私聊
		stats := svc.GetCachedStats()
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
			picks = append(picks, sc{username: st.Username, name: name, avatar: st.SmallHeadURL, total: st.TotalMessages})
		}
		if len(picks) == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "没有可分析的聊天数据"})
			return
		}
		sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
		if len(picks) > cgMaxContacts {
			picks = picks[:cgMaxContacts]
		}

		// 聚合：placeName -> { mentions, perContact: contactKey -> count }
		type placeAgg struct {
			tier       CGTier
			mentions   int
			perContact map[string]int    // username -> count
			contactRef map[string]string // username -> displayName
			contactAv  map[string]string // username -> avatar
		}
		bucket := make(map[string]*placeAgg)

		var totalScanned int

		for _, p := range picks {
			msgs := svc.ExportContactMessagesAll(p.username)
			if len(msgs) > cgMaxMsgPerContact {
				msgs = msgs[len(msgs)-cgMaxMsgPerContact:]
			}
			for _, m := range msgs {
				if m.Type != 1 {
					continue
				}
				content := strings.TrimSpace(m.Content)
				if content == "" || len(content) < 3 {
					continue
				}
				if strings.HasPrefix(content, "[") {
					continue // 系统消息 / 占位符
				}
				totalScanned++

				// 一条消息内同名只计 1 次（避免"上海上海上海"刷榜）
				seen := make(map[string]bool)
				for _, dict := range cgPlaceDict {
					if seen[dict.name] {
						continue
					}
					if !strings.Contains(content, dict.name) {
						continue
					}
					seen[dict.name] = true
					agg, ok := bucket[dict.name]
					if !ok {
						agg = &placeAgg{
							tier:       dict.tier,
							perContact: make(map[string]int),
							contactRef: make(map[string]string),
							contactAv:  make(map[string]string),
						}
						bucket[dict.name] = agg
					}
					agg.mentions++
					agg.perContact[p.username]++
					if _, has := agg.contactRef[p.username]; !has {
						agg.contactRef[p.username] = p.name
						agg.contactAv[p.username] = p.avatar
					}
				}
			}
		}

		// 构造输出
		all := make([]CGPlace, 0, len(bucket))
		var totalMentions int
		for name, a := range bucket {
			// 按聊起人数 + 提及数排序 Top 联系人
			type kv struct {
				u string
				c int
			}
			refs := make([]kv, 0, len(a.perContact))
			for u, c := range a.perContact {
				refs = append(refs, kv{u, c})
			}
			sort.Slice(refs, func(i, j int) bool { return refs[i].c > refs[j].c })
			max := cgTopContactsPer
			if len(refs) < max {
				max = len(refs)
			}
			top := make([]CGContactRef, 0, max)
			for i := 0; i < max; i++ {
				top = append(top, CGContactRef{
					Username:    refs[i].u,
					DisplayName: a.contactRef[refs[i].u],
					Avatar:      a.contactAv[refs[i].u],
					Count:       refs[i].c,
				})
			}
			all = append(all, CGPlace{
				Name:     name,
				Tier:     a.tier,
				Mentions: a.mentions,
				Contacts: len(a.perContact),
				TopWith:  top,
			})
			totalMentions += a.mentions
		}
		// 排序：mentions 降序，name 升序兜底
		sort.Slice(all, func(i, j int) bool {
			if all[i].Mentions != all[j].Mentions {
				return all[i].Mentions > all[j].Mentions
			}
			return all[i].Name < all[j].Name
		})
		uniquePlaces := len(all)

		// 限制返回 top N（atoiSafe 见 relation_graph.go：合法返回 ≥0，否则 -1）
		limit := cgDefaultLimit
		if v := c.Query("limit"); v != "" {
			if n := atoiSafe(v); n > 0 {
				limit = n
			}
		}
		if limit > cgMaxLimit {
			limit = cgMaxLimit
		}
		if len(all) > limit {
			all = all[:limit]
		}

		resp := CGResponse{
			Places:          all,
			TotalMentions:   totalMentions,
			UniquePlaces:    uniquePlaces,
			ContactsScanned: len(picks),
			MessagesScanned: totalScanned,
			GeneratedAt:     time.Now().Unix(),
		}

		cgCacheMu.Lock()
		cgCacheVal = &resp
		cgCacheAt = time.Now()
		cgCacheFrom = from
		cgCacheTo = to
		cgCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}

