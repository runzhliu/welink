package service

import (
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
	"welink/backend/config"
	"welink/backend/model"
	"welink/backend/pkg/db"
	"welink/backend/repository"

	"github.com/go-ego/gse"
	"github.com/klauspost/compress/zstd"
)

// wechatEmojiRe 匹配微信表情文字化，如 [捂脸]、[偷笑]、[呲牙] 等
var wechatEmojiRe = regexp.MustCompile(`\[[^\[\]]{1,10}\]`)

// zstdDecoderPool 用 sync.Pool 保证并发安全
var zstdDecoderPool = sync.Pool{
	New: func() any {
		d, _ := zstd.NewReader(nil)
		return d
	},
}

type LateNightEntry struct {
	Name           string  `json:"name"`
	LateNightCount int64   `json:"late_night_count"`
	TotalMessages  int64   `json:"total_messages"`
	Ratio          float64 `json:"ratio"`
}

type GlobalStats struct {
	TotalFriends      int               `json:"total_friends"`
	ZeroMsgFriends    int               `json:"zero_msg_friends"`
	TotalMessages     int64             `json:"total_messages"`
	BusiestDay        string            `json:"busiest_day"`
	BusiestDayCount   int               `json:"busiest_day_count"`
	MidnightChamp     string            `json:"midnight_champ"`
	EmojiKing         string            `json:"emoji_king"`
	MonthlyTrend      map[string]int    `json:"monthly_trend"`
	GroupMonthlyTrend map[string]int    `json:"group_monthly_trend"`
	HourlyHeatmap     [24]int           `json:"hourly_heatmap"`
	GroupHourlyHeatmap [24]int          `json:"group_hourly_heatmap"`
	TypeMix           map[string]int    `json:"type_mix"`
	LateNightRanking  []LateNightEntry  `json:"late_night_ranking"`
}

type WordCount struct {
	Word  string `json:"word"`
	Count int    `json:"count"`
}

// ContactDetail 用于单个联系人的深度分析（按需查询，不在启动时计算）
type MoneyEvent struct {
	Time   string `json:"time"`    // "2024-03-15 14:23"
	IsMine bool   `json:"is_mine"` // true=我发的
	Kind   string `json:"kind"`    // "红包" or "转账"
}

type ContactDetail struct {
	HourlyDist        [24]int        `json:"hourly_dist"`
	WeeklyDist        [7]int         `json:"weekly_dist"`
	DailyHeatmap      map[string]int `json:"daily_heatmap"` // "2023-01-15" -> count
	TheirMonthlyTrend map[string]int `json:"their_monthly_trend"` // "2024-01" -> count（对方）
	MyMonthlyTrend    map[string]int `json:"my_monthly_trend"`    // "2024-01" -> count（我）
	LateNightCount    int64          `json:"late_night_count"`
	MoneyCount        int64          `json:"money_count"`         // 红包+转账总数
	RedPacketCount    int64          `json:"red_packet_count"`    // 红包次数
	TransferCount     int64          `json:"transfer_count"`      // 转账次数
	MoneyTimeline     []MoneyEvent   `json:"money_timeline"`      // 红包/转账时间线
	InitiationCnt     int64          `json:"initiation_count"`    // 主动发起对话次数（间隔>6h）
	TotalSessions     int64          `json:"total_sessions"`
}

type ContactStatsExtended struct {
	model.ContactStats
	FirstMsg         string             `json:"first_msg"`
	EmojiCnt         int                `json:"emoji_count"`
	TypePct          map[string]float64 `json:"type_pct"`
	TypeCnt          map[string]int     `json:"type_cnt"`
	SharedGroupsCount int               `json:"shared_groups_count"`
	PeakMonthly   int64   `json:"peak_monthly"`
	PeakPeriod    string  `json:"peak_period"`
	RecentMonthly int64   `json:"recent_monthly"`
	RecallCount   int64   `json:"recall_count"`
	AvgMsgLen     float64 `json:"avg_msg_len"`
	MoneyCount    int64   `json:"money_count"`
}

// classifyMsgType 统一消息类型分类（低 16 位为真实 local_type）
// 返回类型名称；对 type 49 根据内容细分子类型
func classifyMsgType(lt int, content string) string {
	realType := lt & 0xFFFF
	switch realType {
	case 1:
		return "文本"
	case 3:
		return "图片"
	case 34:
		return "语音"
	case 43:
		return "视频"
	case 47:
		return "表情"
	case 42:
		return "名片"
	case 48:
		return "位置"
	case 50:
		return "通话"
	case 49:
		// 应用消息细分
		if strings.Contains(content, "wcpay") {
			if strings.Contains(content, "redenvelope") {
				return "红包"
			}
			return "转账"
		}
		if strings.Contains(content, "refermsg") {
			return "引用"
		}
		if strings.Contains(content, "weappinfo") || strings.Contains(content, "miniprogram") {
			return "小程序"
		}
		if strings.Contains(content, "<type>5</type>") || strings.Contains(content, "<type>4</type>") || strings.Contains(content, "<type>6</type>") {
			return "链接/文件"
		}
		if strings.Contains(content, "<type>51</type>") || strings.Contains(content, "<type>63</type>") {
			return "视频号"
		}
		return "其他"
	case 10000, 11000:
		return "系统"
	default:
		return "其他"
	}
}

type ContactService struct {
	dbMgr            *db.DBManager
	msgRepo          *repository.MessageRepository
	cfg              *config.AnalysisConfig
	tz               *time.Location
	segmenter        gse.Segmenter
	segmenterMu      sync.Mutex // 保护 segmenter 不被并发调用（gse 非线程安全）
	cache            []ContactStatsExtended
	global           GlobalStats
	cacheMu          sync.RWMutex
	isIndexing       bool
	isInitialized    bool // 标记初始化是否完成
	groupDetailCache     map[string]*GroupDetail          // 群聊详情内存缓存（lazy load）
	groupDetailMu        sync.RWMutex
	groupDetailComputing map[string]bool                  // 正在后台计算中的群聊
	groupRelCache        map[string]*RelationshipGraph    // 群聊人物关系缓存
	groupRelComputing    map[string]bool
	filterFrom       int64 // 全局时间范围过滤（Unix 秒，0=不限）
	filterTo         int64
	calendarHeatmap  map[string]int // 全局每日消息量（联系人+群聊），performAnalysis 后可读
}

// 强化的系统话术过滤词库
var SYSTEM_KEYS = []string{
	"通过了你的朋友验证", "现在我们可以开始聊天了", "我是群聊", "以上是打招呼内容",
	"已经通过了你的朋友验证", "你已添加了", "对方已添加你为朋友", "Accepted your friend request",
	"We can now chat", "以上为打招呼内容",
}

var STOP_WORDS = map[string]bool{
	// 人称代词
	"我": true, "你": true, "他": true, "她": true, "它": true, "我们": true, "你们": true, "他们": true, "她们": true,
	"自己": true, "人家": true, "大家": true, "别人": true,
	// 结构助词 / 语气词
	"的": true, "了": true, "着": true, "过": true, "地": true, "得": true,
	"吧": true, "啊": true, "哦": true, "哇": true, "嗯": true, "哈": true, "呢": true,
	"呀": true, "嘛": true, "哟": true, "喔": true, "唉": true, "哎": true, "哎呀": true,
	"嗨": true, "哈哈": true, "哈哈哈": true, "嘻嘻": true, "呵呵": true, "哈哈哈哈": true,
	// 副词 / 连词
	"也": true, "都": true, "还": true, "就": true, "才": true, "又": true, "很": true,
	"太": true, "真": true, "非常": true, "特别": true, "比较": true, "更": true, "最": true,
	"挺": true, "蛮": true, "相当": true, "十分": true, "超": true, "好": true, "好好": true,
	"所以": true, "因为": true, "但是": true, "不过": true, "而且": true, "如果": true,
	"虽然": true, "然后": true, "接着": true, "以后": true, "之后": true, "之前": true,
	"以前": true, "现在": true, "今天": true, "明天": true, "昨天": true,
	"不": true, "没": true, "别": true, "莫": true,
	// 动词（高频但无信息量）
	"是": true, "在": true, "有": true, "要": true, "去": true, "来": true, "说": true,
	"到": true, "看": true, "想": true, "知道": true, "觉得": true, "感觉": true,
	"以为": true, "认为": true, "觉着": true, "发现": true, "感觉到": true,
	"让": true, "把": true, "被": true, "给": true, "跟": true, "和": true, "与": true,
	"用": true, "从": true, "向": true, "对": true, "对于": true, "关于": true,
	"做": true, "干": true, "弄": true, "搞": true,
	// 形容词 / 通用词
	"这": true, "那": true, "哪": true, "什么": true, "怎么": true, "为什么": true, "哪里": true,
	"这里": true, "那里": true, "这边": true, "那边": true, "这样": true, "那样": true,
	"这种": true, "那种": true, "这么": true, "那么": true, "怎样": true, "如何": true,
	"多少": true, "几个": true, "一些": true, "一点": true, "一下": true, "一样": true,
	"一起": true, "一直": true, "一定": true, "一般": true, "一共": true,
	"有点": true, "有些": true, "有时": true, "有时候": true, "有没有": true,
	"可以": true, "可能": true, "应该": true, "需要": true, "能够": true, "能": true,
	"会": true, "行": true, "好的": true, "好吧": true, "好啊": true,
	"没有": true, "没事": true, "没关系": true, "不是": true, "不行": true, "不好": true,
	"不知道": true, "不太": true, "不能": true, "不用": true, "不对": true,
	"还是": true, "还好": true, "还有": true, "就是": true, "就好": true,
	// 口语填充词
	"那个": true, "这个": true, "其实": true, "然而": true, "反正": true, "毕竟": true,
	"况且": true, "何况": true, "而是": true, "只是": true, "不是吗": true,
	"对吧": true, "对啊": true, "是吗": true, "是啊": true, "是吧": true, "是的": true,
	"嗯嗯": true, "嗯啊": true, "哦哦": true, "哦对": true, "哦好": true,
	"hhh": true, "hh": true, "ok": true, "OK": true, "ok的": true, "yeah": true,
	"em": true, "emm": true, "emmm": true, "en": true,
	"呃": true, "额": true, "额额": true,
	// 已经、之前等时间副词
	"已经": true, "刚刚": true, "刚才": true, "突然": true, "忽然": true,
	"马上": true, "立刻": true, "赶紧": true, "终于": true, "终于是": true,
	// 数量词 / 量词
	"个": true, "件": true, "种": true, "次": true, "下": true, "遍": true,
	"些": true, "点": true, "块": true, "条": true,
	// 方位词
	"上": true, "左": true, "右": true, "前": true, "后": true,
	"里": true, "外": true, "中": true, "间": true,
	// 标点转义等
	"…": true, "～": true, "/": true, "、": true,
}

func NewContactService(mgr *db.DBManager, cfg *config.Config) *ContactService {
	loc, err := time.LoadLocation(cfg.Analysis.Timezone)
	if err != nil {
		log.Printf("[CONFIG] Unknown timezone %q, falling back to Asia/Shanghai: %v", cfg.Analysis.Timezone, err)
		loc = time.FixedZone("CST", 8*3600)
	}
	svc := &ContactService{
		dbMgr:            mgr,
		msgRepo:          repository.NewMessageRepository(mgr),
		cfg:              &cfg.Analysis,
		tz:               loc,
		groupDetailCache:     make(map[string]*GroupDetail),
		groupDetailComputing: make(map[string]bool),
		groupRelCache:        make(map[string]*RelationshipGraph),
		groupRelComputing:    make(map[string]bool),
	}
	svc.segmenter.LoadDict()

	// 如果配置了自动初始化时间范围，启动后立即开始索引
	if cfg.Analysis.DefaultInitFrom != 0 || cfg.Analysis.DefaultInitTo != 0 {
		log.Printf("[CONFIG] Auto-init with from=%d to=%d", cfg.Analysis.DefaultInitFrom, cfg.Analysis.DefaultInitTo)
		svc.Reinitialize(cfg.Analysis.DefaultInitFrom, cfg.Analysis.DefaultInitTo)
	}
	return svc
}

// Reinitialize 用新的时间范围重新索引（前端调用）
func (s *ContactService) Reinitialize(from, to int64) {
	s.cacheMu.Lock()
	s.filterFrom = from
	s.filterTo = to
	s.isInitialized = false
	s.isIndexing = true
	s.cacheMu.Unlock()

	// 清空群聊缓存
	s.groupDetailMu.Lock()
	s.groupDetailCache = make(map[string]*GroupDetail)
	s.groupDetailComputing = make(map[string]bool)
	s.groupRelCache = make(map[string]*RelationshipGraph)
	s.groupRelComputing = make(map[string]bool)
	s.groupDetailMu.Unlock()

	go func() {
		log.Printf("[INIT] Reinitializing with from=%d to=%d", from, to)
		s.performAnalysis()
		s.cacheMu.Lock()
		s.isIndexing = false
		s.isInitialized = true
		s.cacheMu.Unlock()
		log.Println("[INIT] Reinitialization complete.")
	}()
}

func (s *ContactService) fullAnalysisTask() {
	// 首次启动立即执行分析
	log.Println("[INIT] Starting initial data analysis...")
	s.isIndexing = true
	s.performAnalysis()
	s.isIndexing = false

	// 标记初始化完成
	s.cacheMu.Lock()
	s.isInitialized = true
	s.cacheMu.Unlock()
	log.Println("[INIT] Initial analysis completed! Data ready.")

	// 后续定时刷新
	for {
		time.Sleep(30 * time.Minute)
		log.Println("[REFRESH] Background refresh starting...")
		s.isIndexing = true
		s.performAnalysis()
		s.isIndexing = false
	}
}

func (s *ContactService) timeWhere() string {
	from, to := s.filterFrom, s.filterTo
	if from > 0 && to > 0 {
		return fmt.Sprintf(" WHERE create_time >= %d AND create_time <= %d", from, to)
	} else if from > 0 {
		return fmt.Sprintf(" WHERE create_time >= %d", from)
	} else if to > 0 {
		return fmt.Sprintf(" WHERE create_time <= %d", to)
	}
	return ""
}

func (s *ContactService) performAnalysis() {
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, nick_name, remark, COALESCE(alias,''), flag, COALESCE(big_head_url,''), COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0")
	if err != nil { return }
	defer rows.Close()

	var contacts []model.Contact
	for rows.Next() {
		var c model.Contact
		rows.Scan(&c.Username, &c.Nickname, &c.Remark, &c.Alias, &c.Flag, &c.BigHeadURL, &c.SmallHeadURL)
		uname := strings.ToLower(c.Username)
		if strings.HasSuffix(uname, "@chatroom") || strings.HasPrefix(uname, "gh_") || uname == "" { continue }
		if (c.Flag&3 != 0) || (strings.TrimSpace(c.Remark) != "") { contacts = append(contacts, c) }
	}

	type lateEntry struct {
		name           string
		lateNightCount int64
		totalMessages  int64
	}

	timeWhere := s.timeWhere()
	result := make([]ContactStatsExtended, len(contacts))
	lateNightData := make([]lateEntry, len(contacts))
	globalDaily := make(map[string]int)
	globalHourly := [24]int{}
	globalTypeMix := make(map[string]int)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.cfg.WorkerCount)

	for i := range contacts {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done(); sem <- struct{}{}; defer func() { <-sem }()
			c := contacts[idx]
			tableName := db.GetTableName(c.Username)
			ext := ContactStatsExtended{ContactStats: model.ContactStats{Contact: c}}

			var firstMsgTs int64 = 9999999999
			var globalFirstTs int64 = 9999999999
			var globalLastTs int64 = 0
			var lateNightCnt int64
			typeCounts := make(map[string]int)
			monthly := make(map[string]int)
			recentCutoff := time.Now().In(s.tz).AddDate(0, -1, 0)
			var totalTextLen, textCount int64

			for _, mdb := range s.dbMgr.MessageDBs {
				var contactRowID int64 = -1
				mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", c.Username)).Scan(&contactRowID)

				mRows, err := mdb.Query(fmt.Sprintf("SELECT local_type, create_time, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s", tableName, timeWhere))
				if err != nil { continue }
				for mRows.Next() {
					var lt int; var ts int64; var rawContent []byte; var ct int64; var senderID int64
					mRows.Scan(&lt, &ts, &rawContent, &ct, &senderID)
					content := decodeGroupContent(rawContent, ct)
					if lt == 10000 { ext.RecallCount++; continue }
					ext.TotalMessages++
					isMine := contactRowID < 0 || senderID != contactRowID
					if isMine {
						ext.MyMessages++
					} else {
						ext.TheirMessages++
					}

					if ts < globalFirstTs { globalFirstTs = ts }
					if ts > globalLastTs { globalLastTs = ts }

					dt := time.Unix(ts, 0).In(s.tz)
					h := dt.Hour()
					if h >= s.cfg.LateNightStartHour && h < s.cfg.LateNightEndHour { lateNightCnt++ }
					mu.Lock(); globalDaily[dt.Format("2006-01-02")]++; globalHourly[h]++; mu.Unlock()
					monthly[dt.Format("2006-01")]++
					if ts >= recentCutoff.Unix() { ext.RecentMonthly++ }

					typeName := classifyMsgType(lt, content)
					if typeName == "文本" {
						if content != "" && !s.isSys(content) {
							charLen := int64(len([]rune(content)))
							totalTextLen += charLen; textCount++
							if isMine {
								ext.MyChars += charLen
							} else {
								ext.TheirChars += charLen
							}
						}
						if ts < firstMsgTs && content != "" && !s.isSys(content) {
							firstMsgTs = ts
							ext.FirstMsg = content
						}
					} else if typeName == "表情" {
						ext.EmojiCnt++
					} else if typeName == "红包" || typeName == "转账" {
						ext.MoneyCount++
					}
					typeCounts[typeName]++
					mu.Lock(); globalTypeMix[typeName]++; mu.Unlock()
				}
				mRows.Close()
			}
			if ext.TotalMessages > 0 {
				ext.FirstMessage = s.formatTime(globalFirstTs); ext.LastMessage = s.formatTime(globalLastTs)
				for m, cnt := range monthly {
					if int64(cnt) > ext.PeakMonthly { ext.PeakMonthly = int64(cnt); ext.PeakPeriod = m }
				}
				if textCount > 0 { ext.AvgMsgLen = float64(totalTextLen) / float64(textCount) }
				ext.TypePct = make(map[string]float64)
				ext.TypeCnt = make(map[string]int)
				for k, v := range typeCounts {
					ext.TypePct[k] = float64(v) / float64(ext.TotalMessages) * 100
					ext.TypeCnt[k] = v
				}
			}
			name := c.Remark
			if name == "" { name = c.Nickname }
			if name == "" { name = c.Username }
			lateNightData[idx] = lateEntry{name: name, lateNightCount: lateNightCnt, totalMessages: ext.TotalMessages}
			result[idx] = ext
		}(i)
	}
	wg.Wait()

	// 计算每个联系人的共同群聊数
	sharedGroupCounts := s.buildSharedGroupCounts()
	for i := range result {
		result[i].SharedGroupsCount = sharedGroupCounts[result[i].Username]
	}

	sort.Slice(result, func(i, j int) bool { return result[i].TotalMessages > result[j].TotalMessages })

	// 构建深夜密友排行
	sort.Slice(lateNightData, func(i, j int) bool { return lateNightData[i].lateNightCount > lateNightData[j].lateNightCount })
	var lateNightRanking []LateNightEntry
	for _, e := range lateNightData {
		if e.totalMessages < s.cfg.LateNightMinMessages || e.lateNightCount == 0 { continue }
		ratio := float64(e.lateNightCount) / float64(e.totalMessages) * 100
		lateNightRanking = append(lateNightRanking, LateNightEntry{
			Name: e.name, LateNightCount: e.lateNightCount, TotalMessages: e.totalMessages, Ratio: ratio,
		})
		if len(lateNightRanking) >= s.cfg.LateNightTopN { break }
	}

	s.cacheMu.Lock()
	s.cache = result

	// 计算总消息量
	var totalMessages int64 = 0
	for _, r := range result {
		totalMessages += r.TotalMessages
	}

	s.global = GlobalStats{
		TotalFriends:     len(result),
		ZeroMsgFriends:   func() int { c := 0; for _, r := range result { if r.TotalMessages == 0 { c++ } }; return c }(),
		TotalMessages:    totalMessages,
		HourlyHeatmap:    globalHourly,
		TypeMix:          globalTypeMix,
		LateNightRanking: lateNightRanking,
		MonthlyTrend: func() map[string]int {
			m := make(map[string]int)
			for day, cnt := range globalDaily {
				if len(day) >= 7 {
					m[day[:7]] += cnt
				}
			}
			return m
		}(),
		GroupMonthlyTrend:  s.buildGroupMonthlyTrend(),
		GroupHourlyHeatmap: s.buildGroupHourlyHeatmap(),
	}
	maxDayVal := 0
	for d, c := range globalDaily { if c > maxDayVal { s.global.BusiestDay = d; s.global.BusiestDayCount = c; maxDayVal = c } }
	if len(result) > 0 {
		maxEmoji := -1
		for _, r := range result { if r.EmojiCnt > maxEmoji { maxEmoji = r.EmojiCnt; name := r.Nickname; if r.Remark != "" { name = r.Remark }; s.global.EmojiKing = name } }
	}
	// 构建全局日历热力图（联系人 + 群聊）
	calHeatmap := make(map[string]int, len(globalDaily))
	for d, c := range globalDaily { calHeatmap[d] = c }
	for d, c := range s.buildGroupDailyHeatmap() { calHeatmap[d] += c }
	s.calendarHeatmap = calHeatmap
	s.cacheMu.Unlock()
}

// FilteredStats 时间范围过滤后的统计结果
type FilteredStats struct {
	Contacts  []ContactStatsExtended `json:"contacts"`
	GlobalStats GlobalStats          `json:"global_stats"`
}

// AnalyzeWithFilter 对指定时间范围内的消息做统计（不写入缓存）
func (s *ContactService) AnalyzeWithFilter(from, to int64) *FilteredStats {
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, nick_name, remark, COALESCE(alias,''), flag, COALESCE(big_head_url,''), COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0")
	if err != nil { return nil }
	defer rows.Close()

	var contacts []model.Contact
	for rows.Next() {
		var c model.Contact
		rows.Scan(&c.Username, &c.Nickname, &c.Remark, &c.Alias, &c.Flag, &c.BigHeadURL, &c.SmallHeadURL)
		uname := strings.ToLower(c.Username)
		if strings.HasSuffix(uname, "@chatroom") || strings.HasPrefix(uname, "gh_") || uname == "" { continue }
		if (c.Flag&3 != 0) || (strings.TrimSpace(c.Remark) != "") { contacts = append(contacts, c) }
	}

	type lateEntry struct {
		name           string
		lateNightCount int64
		totalMessages  int64
	}

	// 构建 time WHERE 子句
	timeWhere := ""
	if from > 0 && to > 0 {
		timeWhere = fmt.Sprintf(" WHERE create_time >= %d AND create_time <= %d", from, to)
	} else if from > 0 {
		timeWhere = fmt.Sprintf(" WHERE create_time >= %d", from)
	} else if to > 0 {
		timeWhere = fmt.Sprintf(" WHERE create_time <= %d", to)
	}

	result := make([]ContactStatsExtended, len(contacts))
	lateNightData := make([]lateEntry, len(contacts))
	globalDaily := make(map[string]int)
	globalHourly := [24]int{}
	globalTypeMix := make(map[string]int)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.cfg.WorkerCount)

	for i := range contacts {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done(); sem <- struct{}{}; defer func() { <-sem }()
			c := contacts[idx]
			tableName := db.GetTableName(c.Username)
			ext := ContactStatsExtended{ContactStats: model.ContactStats{Contact: c}}

			var firstMsgTs int64 = 9999999999
			var globalFirstTs int64 = 9999999999
			var globalLastTs int64 = 0
			var lateNightCnt int64
			typeCounts := make(map[string]int)

			for _, mdb := range s.dbMgr.MessageDBs {
				query := fmt.Sprintf("SELECT local_type, create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s", tableName, timeWhere)
				mRows, err := mdb.Query(query)
				if err != nil { continue }
				for mRows.Next() {
					var lt int; var ts int64; var rawContent []byte; var ct int64
					mRows.Scan(&lt, &ts, &rawContent, &ct)
					content := decodeGroupContent(rawContent, ct)
					ext.TotalMessages++

					if ts < globalFirstTs { globalFirstTs = ts }
					if ts > globalLastTs { globalLastTs = ts }

					dt := time.Unix(ts, 0).In(s.tz)
					h := dt.Hour()
					if h >= s.cfg.LateNightStartHour && h < s.cfg.LateNightEndHour { lateNightCnt++ }
					mu.Lock(); globalDaily[dt.Format("2006-01-02")]++; globalHourly[h]++; mu.Unlock()

					typeName := classifyMsgType(lt, content)
					if typeName == "文本" {
						if ts < firstMsgTs && content != "" && !s.isSys(content) {
							firstMsgTs = ts
							ext.FirstMsg = content
						}
					} else if typeName == "表情" {
						ext.EmojiCnt++
					}
					typeCounts[typeName]++
					mu.Lock(); globalTypeMix[typeName]++; mu.Unlock()
				}
				mRows.Close()
			}
			if ext.TotalMessages > 0 {
				ext.FirstMessage = s.formatTime(globalFirstTs); ext.LastMessage = s.formatTime(globalLastTs)
				ext.TypePct = make(map[string]float64)
				ext.TypeCnt = make(map[string]int)
				for k, v := range typeCounts {
					ext.TypePct[k] = float64(v) / float64(ext.TotalMessages) * 100
					ext.TypeCnt[k] = v
				}
			}
			name := c.Remark
			if name == "" { name = c.Nickname }
			if name == "" { name = c.Username }
			lateNightData[idx] = lateEntry{name: name, lateNightCount: lateNightCnt, totalMessages: ext.TotalMessages}
			result[idx] = ext
		}(i)
	}
	wg.Wait()
	sort.Slice(result, func(i, j int) bool { return result[i].TotalMessages > result[j].TotalMessages })

	sort.Slice(lateNightData, func(i, j int) bool { return lateNightData[i].lateNightCount > lateNightData[j].lateNightCount })
	var lateNightRanking []LateNightEntry
	for _, e := range lateNightData {
		if e.totalMessages < s.cfg.LateNightMinMessages || e.lateNightCount == 0 { continue }
		ratio := float64(e.lateNightCount) / float64(e.totalMessages) * 100
		lateNightRanking = append(lateNightRanking, LateNightEntry{
			Name: e.name, LateNightCount: e.lateNightCount, TotalMessages: e.totalMessages, Ratio: ratio,
		})
		if len(lateNightRanking) >= s.cfg.LateNightTopN { break }
	}

	var totalMessages int64 = 0
	for _, r := range result { totalMessages += r.TotalMessages }

	gs := GlobalStats{
		TotalFriends:     len(result),
		ZeroMsgFriends:   func() int { c := 0; for _, r := range result { if r.TotalMessages == 0 { c++ } }; return c }(),
		TotalMessages:    totalMessages,
		HourlyHeatmap:    globalHourly,
		TypeMix:          globalTypeMix,
		LateNightRanking: lateNightRanking,
		MonthlyTrend: func() map[string]int {
			m := make(map[string]int)
			for day, cnt := range globalDaily {
				if len(day) >= 7 { m[day[:7]] += cnt }
			}
			return m
		}(),
	}
	for d, c := range globalDaily { if c > gs.BusiestDayCount { gs.BusiestDay = d; gs.BusiestDayCount = c } }

	// filter out zero-message contacts from result
	var nonEmpty []ContactStatsExtended
	for _, r := range result { if r.TotalMessages > 0 { nonEmpty = append(nonEmpty, r) } }

	return &FilteredStats{Contacts: nonEmpty, GlobalStats: gs}
}

// GetContactDetail 按需深度分析单个联系人（小时分布、周分布、日历热力、深夜、红包、主动率）
func (s *ContactService) GetContactDetail(username string) *ContactDetail {
	tableName := db.GetTableName(username)
	detail := &ContactDetail{
		DailyHeatmap:      make(map[string]int),
		TheirMonthlyTrend: make(map[string]int),
		MyMonthlyTrend:    make(map[string]int),
	}

	var prevTs int64

	timeWhere := s.timeWhere()
	orderBy := " ORDER BY create_time ASC"
	for _, mdb := range s.dbMgr.MessageDBs {
		// 每个 DB 单独查联系人 rowid
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s%s", tableName, timeWhere, orderBy))
		if err != nil { continue }
		for rows.Next() {
			var ts int64; var lt int; var rawContent []byte; var ct int64; var senderID int64
			rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)
			content := decodeGroupContent(rawContent, ct)
			dt := time.Unix(ts, 0).In(s.tz)
			h := dt.Hour()
			w := int(dt.Weekday()) // 0=Sunday

			isMineMsg := contactRowID < 0 || senderID != contactRowID
			month := dt.Format("2006-01")

			detail.HourlyDist[h]++
			detail.WeeklyDist[w]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++
			if isMineMsg {
				detail.MyMonthlyTrend[month]++
			} else {
				detail.TheirMonthlyTrend[month]++
			}

			if h >= s.cfg.LateNightStartHour && h < s.cfg.LateNightEndHour { detail.LateNightCount++ }

			// 红包 / 转账检测
			typeName := classifyMsgType(lt, content)
			if typeName == "红包" {
				detail.MoneyCount++
				detail.RedPacketCount++
				detail.MoneyTimeline = append(detail.MoneyTimeline, MoneyEvent{
					Time: dt.Format("2006-01-02 15:04"), IsMine: isMineMsg, Kind: "红包",
				})
			} else if typeName == "转账" {
				detail.MoneyCount++
				detail.TransferCount++
				detail.MoneyTimeline = append(detail.MoneyTimeline, MoneyEvent{
					Time: dt.Format("2006-01-02 15:04"), IsMine: isMineMsg, Kind: "转账",
				})
			}

			// 新对话段：与上条消息间隔 > session_gap_seconds
			if prevTs == 0 || ts-prevTs > s.cfg.SessionGapSeconds {
				detail.TotalSessions++
				if isMineMsg {
					detail.InitiationCnt++
				}
			}
			prevTs = ts
		}
		rows.Close()
	}
	return detail
}

// ChatMessage 单条聊天消息（用于日历点击查看当天记录）
type ChatMessage struct {
	Time    string `json:"time"`              // "14:23"
	Content string `json:"content"`           // 消息内容或类型描述
	IsMine  bool   `json:"is_mine"`           // true=我发的
	Type    int    `json:"type"`              // local_type
	Date    string `json:"date,omitempty"`    // "2024-03-15"，搜索结果中使用
}

// GetDayMessages 返回指定联系人某一天的聊天记录（按时间排序）
func (s *ContactService) GetDayMessages(username, date string) []ChatMessage {
	tableName := db.GetTableName(username)

	// 将 date (YYYY-MM-DD) 转换为当天的 Unix 秒时间戳范围
	t, err := time.ParseInLocation("2006-01-02", date, s.tz)
	if err != nil {
		return nil
	}
	dayStart := t.Unix()
	dayEnd := dayStart + 86400

	var msgs []ChatMessage
	for _, mdb := range s.dbMgr.MessageDBs {
		// 每个 DB 单独查联系人 rowid（不同 DB 里 rowid 不同）
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s] WHERE create_time >= %d AND create_time < %d ORDER BY create_time ASC",
			tableName, dayStart, dayEnd,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var lt int
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)

			content := decodeGroupContent(rawContent, ct)
			content = strings.TrimSpace(content)

			// 非文本类型给个描述
			switch lt {
			case 3:
				content = "[图片]"
			case 34:
				content = "[语音]"
			case 43:
				content = "[视频]"
			case 47:
				content = "[表情]"
			case 49:
				if content == "" {
					content = "[文件/链接]"
				} else if strings.Contains(content, "wcpay") || strings.Contains(content, "redenvelope") {
					content = "[红包/转账]"
				} else {
					content = "[链接/文件]"
				}
			default:
				if lt != 1 {
					content = fmt.Sprintf("[消息类型 %d]", lt)
				}
			}
			if content == "" {
				continue
			}

			isMine := contactRowID < 0 || senderID != contactRowID
			timeStr := time.Unix(ts, 0).In(s.tz).Format("15:04")
			msgs = append(msgs, ChatMessage{
				Time:    timeStr,
				Content: content,
				IsMine:  isMine,
				Type:    lt,
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []ChatMessage{}
	}
	return msgs
}

// GetMonthMessages 返回指定联系人某月的纯文本消息（local_type=1），用于情感分析详情查看
func (s *ContactService) GetMonthMessages(username, month string, includeMine bool) []ChatMessage {
	tableName := db.GetTableName(username)

	// month 格式: "2024-03"，转换为月份首尾时间戳
	t, err := time.ParseInLocation("2006-01", month, s.tz)
	if err != nil {
		return nil
	}
	monthStart := t.Unix()
	// 下个月第一天
	var nextMonth time.Time
	if t.Month() == 12 {
		nextMonth = time.Date(t.Year()+1, 1, 1, 0, 0, 0, 0, s.tz)
	} else {
		nextMonth = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, s.tz)
	}
	monthEnd := nextMonth.Unix()

	var msgs []ChatMessage
	for _, mdb := range s.dbMgr.MessageDBs {
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		senderFilter := ""
		if !includeMine && contactRowID >= 0 {
			senderFilter = fmt.Sprintf(" AND real_sender_id = %d", contactRowID)
		}

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s] WHERE local_type=1 AND create_time >= %d AND create_time < %d%s ORDER BY create_time ASC",
			tableName, monthStart, monthEnd, senderFilter,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &rawContent, &ct, &senderID)

			content := decodeGroupContent(rawContent, ct)
			content = strings.TrimSpace(content)
			if content == "" {
				continue
			}

			isMine := contactRowID < 0 || senderID != contactRowID
			timeStr := time.Unix(ts, 0).In(s.tz).Format("01-02 15:04")
			msgs = append(msgs, ChatMessage{
				Time:    timeStr,
				Content: content,
				IsMine:  isMine,
				Type:    1,
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []ChatMessage{}
	}
	return msgs
}

// SearchMessages 在指定联系人的聊天记录中搜索关键词，返回匹配的文本消息（最多200条）
func (s *ContactService) SearchMessages(username, query string, includeMine bool) []ChatMessage {
	if query == "" {
		return []ChatMessage{}
	}
	tableName := db.GetTableName(username)
	tw := s.timeWhere()

	var msgs []ChatMessage
	for _, mdb := range s.dbMgr.MessageDBs {
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		senderFilter := ""
		if !includeMine && contactRowID >= 0 {
			senderFilter = fmt.Sprintf(" AND real_sender_id = %d", contactRowID)
		}

		whereClause := tw
		if whereClause == "" {
			whereClause = " WHERE local_type=1"
		} else {
			whereClause += " AND local_type=1"
		}
		whereClause += senderFilter

		sqlStr := fmt.Sprintf(
			"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s ORDER BY create_time DESC",
			tableName, whereClause,
		)
		rows, err := mdb.Query(sqlStr)
		if err != nil {
			continue
		}
		lowerQuery := strings.ToLower(query)
		for rows.Next() {
			var ts int64
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &rawContent, &ct, &senderID)

			content := decodeGroupContent(rawContent, ct)
			content = strings.TrimSpace(content)
			if content == "" {
				continue
			}
			if !strings.Contains(strings.ToLower(content), lowerQuery) {
				continue
			}

			isMine := contactRowID < 0 || senderID != contactRowID
			t := time.Unix(ts, 0).In(s.tz)
			msgs = append(msgs, ChatMessage{
				Time:    t.Format("15:04"),
				Date:    t.Format("2006-01-02"),
				Content: content,
				IsMine:  isMine,
				Type:    1,
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []ChatMessage{}
	}
	// 按时间倒序（最新在前）
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].Date+msgs[i].Time > msgs[j].Date+msgs[j].Time })
	if len(msgs) > 200 {
		msgs = msgs[:200]
	}
	return msgs
}

const ExportLimit = 50000

// exportTimeWhere 返回导出专用的 WHERE 子句。
// 若 from/to 均为 0，回退到索引时的时间范围（fallback）。
func exportTimeWhere(from, to int64, fallback string) string {
	if from == 0 && to == 0 {
		return fallback
	}
	if from > 0 && to > 0 {
		return fmt.Sprintf(" WHERE create_time >= %d AND create_time <= %d", from, to)
	}
	if from > 0 {
		return fmt.Sprintf(" WHERE create_time >= %d", from)
	}
	return fmt.Sprintf(" WHERE create_time <= %d", to)
}

// ExportContactMessages 导出联系人全量聊天记录（最多 ExportLimit 条，按时间正序）
// from/to 为 Unix 秒，传 0 则沿用已索引的时间范围
func (s *ContactService) ExportContactMessages(username string, from, to int64) []ChatMessage {
	return s.exportContactMessages(username, from, to, ExportLimit)
}

// ExportContactMessagesAll 导出联系人全部聊天记录（不限条数），用于 RAG 索引构建。
func (s *ContactService) ExportContactMessagesAll(username string) []ChatMessage {
	return s.exportContactMessages(username, 0, 0, 0)
}

func (s *ContactService) exportContactMessages(username string, from, to int64, limit int) []ChatMessage {
	tableName := db.GetTableName(username)
	tw := exportTimeWhere(from, to, s.timeWhere())

	var msgs []ChatMessage
	for _, mdb := range s.dbMgr.MessageDBs {
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		whereClause := tw
		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s ORDER BY create_time ASC",
			tableName, whereClause,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var lt int
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)

			content := decodeGroupContent(rawContent, ct)
			content = strings.TrimSpace(content)
			switch lt {
			case 3:
				content = "[图片]"
			case 34:
				content = "[语音]"
			case 43:
				content = "[视频]"
			case 47:
				content = "[表情]"
			case 49:
				if strings.Contains(content, "wcpay") || strings.Contains(content, "redenvelope") {
					content = "[红包/转账]"
				} else {
					content = "[链接/文件]"
				}
			default:
				if lt != 1 && content == "" {
					content = fmt.Sprintf("[消息类型 %d]", lt)
				}
			}
			if content == "" {
				continue
			}
			isMine := contactRowID < 0 || senderID != contactRowID
			t := time.Unix(ts, 0).In(s.tz)
			msgs = append(msgs, ChatMessage{
				Date:    t.Format("2006-01-02"),
				Time:    t.Format("15:04"),
				Content: content,
				IsMine:  isMine,
				Type:    lt,
			})
		}
		rows.Close()
	}

	sort.Slice(msgs, func(i, j int) bool {
		return msgs[i].Date+msgs[i].Time < msgs[j].Date+msgs[j].Time
	})
	if limit > 0 && len(msgs) > limit {
		msgs = msgs[len(msgs)-limit:]
	}
	return msgs
}

// ExportGroupMessages 导出群聊全量聊天记录（最多 ExportLimit 条，按时间正序）
// from/to 为 Unix 秒，传 0 则沿用已索引的时间范围
func (s *ContactService) ExportGroupMessages(username string, from, to int64) []GroupChatMessage {
	return s.exportGroupMessages(username, from, to, ExportLimit)
}

// ExportGroupMessagesAll 导出群聊全部聊天记录（不限条数），用于 RAG 索引构建。
func (s *ContactService) ExportGroupMessagesAll(username string) []GroupChatMessage {
	return s.exportGroupMessages(username, 0, 0, 0)
}

func (s *ContactService) exportGroupMessages(username string, from, to int64, limit int) []GroupChatMessage {
	tableName := db.GetTableName(username)
	tw := exportTimeWhere(from, to, s.timeWhere())

	nameMap := s.loadContactNameMap()
	var msgs []GroupChatMessage

	for _, mdb := range s.dbMgr.MessageDBs {
		id2name := make(map[int64]string)
		n2iRows, err2 := mdb.Query("SELECT rowid, user_name FROM Name2Id")
		if err2 == nil {
			for n2iRows.Next() {
				var rid int64
				var uname string
				n2iRows.Scan(&rid, &uname)
				id2name[rid] = uname
			}
			n2iRows.Close()
		}

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s ORDER BY create_time ASC",
			tableName, tw,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var lt int
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)

			rawText := decodeGroupContent(rawContent, ct)
			rawText = strings.TrimSpace(rawText)

			speakerWxid := ""
			content := rawText
			if lt == 1 {
				if idx := strings.Index(rawText, ":\n"); idx > 0 && idx < 80 {
					speakerWxid = rawText[:idx]
					content = strings.TrimSpace(rawText[idx+2:])
				}
			} else {
				switch lt {
				case 3:
					content = "[图片]"
				case 34:
					content = "[语音]"
				case 43:
					content = "[视频]"
				case 47:
					content = "[表情]"
				case 49:
					if strings.Contains(content, "wcpay") || strings.Contains(content, "redenvelope") {
						content = "[红包/转账]"
					} else {
						content = "[链接/文件]"
					}
				default:
					content = fmt.Sprintf("[消息类型 %d]", lt)
				}
			}
			if speakerWxid == "" {
				if wxid, ok := id2name[senderID]; ok {
					speakerWxid = wxid
				}
			}
			if content == "" {
				continue
			}
			speaker := speakerWxid
			if n, ok := nameMap[speakerWxid]; ok && n != "" {
				speaker = n
			}
			if speaker == "" {
				speaker = "未知"
			}
			t := time.Unix(ts, 0).In(s.tz)
			msgs = append(msgs, GroupChatMessage{
				Date:    t.Format("2006-01-02"),
				Time:    t.Format("15:04"),
				Speaker: speaker,
				Content: content,
				IsMine:  false,
				Type:    lt,
			})
		}
		rows.Close()
	}

	sort.Slice(msgs, func(i, j int) bool {
		return msgs[i].Date+msgs[i].Time < msgs[j].Date+msgs[j].Time
	})
	if limit > 0 && len(msgs) > limit {
		msgs = msgs[len(msgs)-limit:]
	}
	return msgs
}

// ExtractContactGroupMessages 从指定群聊中提取某联系人的文本发言（取最近 limit 条）
// contactUsername 为联系人的 wxid，groupUsernames 为群聊 username 列表
// limit <= 0 表示不限条数
func (s *ContactService) ExtractContactGroupMessages(contactUsername string, groupUsernames []string, limit int) []string {
	type timedText struct {
		ts   int64
		text string
	}
	var items []timedText
	tw := s.timeWhere()

	for _, groupUname := range groupUsernames {
		tableName := db.GetTableName(groupUname)

		// 收集该群中联系人的全部发言
		var groupItems []timedText
		for _, mdb := range s.dbMgr.MessageDBs {
			var contactRowID int64 = -1
			mdb.QueryRow("SELECT rowid FROM Name2Id WHERE user_name = ?", contactUsername).Scan(&contactRowID)
			if contactRowID < 0 {
				continue
			}

			whereClause := tw
			if whereClause == "" {
				whereClause = fmt.Sprintf(" WHERE real_sender_id = %d AND local_type = 1", contactRowID)
			} else {
				whereClause += fmt.Sprintf(" AND real_sender_id = %d AND local_type = 1", contactRowID)
			}

			rows, err := mdb.Query(fmt.Sprintf(
				"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s ORDER BY create_time ASC",
				tableName, whereClause,
			))
			if err != nil {
				continue
			}
			for rows.Next() {
				var ts int64
				var rawContent []byte
				var ct int64
				rows.Scan(&ts, &rawContent, &ct)
				text := decodeGroupContent(rawContent, ct)
				text = strings.TrimSpace(text)
				if idx := strings.Index(text, ":\n"); idx > 0 && idx < 80 {
					text = strings.TrimSpace(text[idx+2:])
				}
				if text != "" {
					groupItems = append(groupItems, timedText{ts, text})
				}
			}
			rows.Close()
		}
		// 每个群按时间排序，取最近 limit 条
		sort.Slice(groupItems, func(i, j int) bool { return groupItems[i].ts < groupItems[j].ts })
		if limit > 0 && len(groupItems) > limit {
			groupItems = groupItems[len(groupItems)-limit:]
		}
		items = append(items, groupItems...)
	}
	// 全局按时间排序
	sort.Slice(items, func(i, j int) bool { return items[i].ts < items[j].ts })
	samples := make([]string, len(items))
	for i, it := range items {
		samples[i] = it.text
	}
	return samples
}

func (s *ContactService) GetWordCloud(username string, includeMine bool) []WordCount {
	tableName := db.GetTableName(username)
	// 先收集文本，关闭 DB 连接后再分词
	twCloud := s.timeWhere()
	if twCloud == "" {
		twCloud = " WHERE local_type=1"
	} else {
		twCloud += " AND local_type=1"
	}
	if !includeMine {
		twCloud += fmt.Sprintf(" AND real_sender_id = (SELECT rowid FROM Name2Id WHERE user_name = %q)", username)
	}
	var texts []string
	for _, mdb := range s.dbMgr.MessageDBs {
		rows, err := mdb.Query(fmt.Sprintf("SELECT message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s", tableName, twCloud))
		if err != nil { continue }
		for rows.Next() {
			var rawContent []byte
			var ct int64
			rows.Scan(&rawContent, &ct)
			content := decodeGroupContent(rawContent, ct)
			if content == "" || s.isSys(content) { continue }
			content = wechatEmojiRe.ReplaceAllString(content, "")
			texts = append(texts, content)
		}
		rows.Close()
	}
	wordCounts := make(map[string]int)
	s.segmenterMu.Lock()
	for _, content := range texts {
		for _, seg := range s.segmenter.Cut(content, true) {
			seg = strings.TrimSpace(seg)
			if !utf8.ValidString(seg) { continue }
			runes := []rune(seg)
			// 长度：至少 2 个字符，不超过 8 个（过滤长句残片）
			if len(runes) < 2 || len(runes) > 8 { continue }
			if isNumeric(seg) || STOP_WORDS[seg] || containsEmoji(seg) || !hasWordChar(seg) { continue }
			wordCounts[seg]++
		}
	}
	s.segmenterMu.Unlock()

	// 计算最小词频阈值：词频 < max(2, totalTexts*0.001) 的词视为噪声
	minCount := 2
	if threshold := len(texts) / 1000; threshold > minCount {
		minCount = threshold
	}

	var list []WordCount
	for k, v := range wordCounts {
		if v >= minCount && utf8.ValidString(k) {
			list = append(list, WordCount{k, v})
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Count > list[j].Count })
	if len(list) > 120 { list = list[:120] }
	return list
}

func (s *ContactService) isSys(c string) bool {
	for _, k := range SYSTEM_KEYS { if strings.Contains(c, k) { return true } }
	return false
}

func (s *ContactService) GetCachedStats() []ContactStatsExtended {
	s.cacheMu.RLock(); defer s.cacheMu.RUnlock()
	if s.cache == nil { return []ContactStatsExtended{} }
	return s.cache
}

func (s *ContactService) GetGlobal() GlobalStats {
	s.cacheMu.RLock(); defer s.cacheMu.RUnlock(); return s.global
}

func (s *ContactService) GetStatus() map[string]interface{} {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	return map[string]interface{}{
		"is_indexing":    s.isIndexing,
		"is_initialized": s.isInitialized,
		"total_cached":   len(s.cache),
	}
}

func (s *ContactService) formatTime(ts int64) string {
	if ts <= 0 || ts > 2000000000 { return "-" }
	return time.Unix(ts, 0).In(s.tz).Format("2006-01-02")
}

func isNumeric(s string) bool {
	for _, r := range s { if (r < '0' || r > '9') && r != '.' { return false } }
	return true
}

// hasWordChar 判断是否包含至少一个汉字或英文字母，过滤纯标点/符号词
func hasWordChar(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) { return true }
	}
	return false
}

// containsEmoji 检测字符串是否包含 emoji 或特殊符号
// ─── 群聊画像 ────────────────────────────────────────────────────────────────

type GroupInfo struct {
	Username      string `json:"username"`
	Name          string `json:"name"`       // 群名（remark 或 nickname）
	SmallHeadURL  string `json:"small_head_url"`
	TotalMessages int64  `json:"total_messages"`
	MemberCount   int    `json:"member_count"`
	FirstMessage  string `json:"first_message_time"`
	LastMessage   string `json:"last_message_time"`
}

type MemberStat struct {
	Speaker string `json:"speaker"`
	Count   int64  `json:"count"`
}

type GroupDetail struct {
	HourlyDist   [24]int           `json:"hourly_dist"`
	WeeklyDist   [7]int            `json:"weekly_dist"`
	DailyHeatmap map[string]int    `json:"daily_heatmap"`
	MemberRank   []MemberStat      `json:"member_rank"`  // top 500 发言者
	TopWords     []WordCount       `json:"top_words"`    // top 30 高频词
	TypeDist     map[string]int    `json:"type_dist"`    // 消息类型分布（条数）
}

// GetGroups 返回所有群聊列表（含消息量），只返回有消息的群
func (s *ContactService) GetGroups() []GroupInfo {
	rows, err := s.dbMgr.ContactDB.Query(
		`SELECT username, nick_name, remark, COALESCE(small_head_url,'') FROM contact WHERE username LIKE '%@chatroom'`)
	if err != nil { return nil }
	defer rows.Close()

	type raw struct{ uname, nick, remark, avatar string }
	var groups []raw
	for rows.Next() {
		var r raw
		rows.Scan(&r.uname, &r.nick, &r.remark, &r.avatar)
		groups = append(groups, r)
	}

	result := make([]GroupInfo, 0, len(groups))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.cfg.WorkerCount)

	for _, g := range groups {
		wg.Add(1)
		go func(g raw) {
			defer wg.Done(); sem <- struct{}{}; defer func() { <-sem }()
			tableName := db.GetTableName(g.uname)
			var total int64
			var firstTs int64 = 9999999999
			var lastTs int64
			twGroups := s.timeWhere()
			twGroupsCount := "SELECT COUNT(*), COALESCE(MIN(create_time),0), COALESCE(MAX(create_time),0) FROM [%s]"
			if twGroups != "" {
				twGroupsCount = "SELECT COUNT(*), COALESCE(MIN(create_time),0), COALESCE(MAX(create_time),0) FROM [%s]" + twGroups
			}
			for _, mdb := range s.dbMgr.MessageDBs {
				var cnt, minTs, maxTs int64
				err := mdb.QueryRow(fmt.Sprintf(twGroupsCount, tableName)).Scan(&cnt, &minTs, &maxTs)
				if err == nil {
					total += cnt
					if minTs > 0 && minTs < firstTs { firstTs = minTs }
					if maxTs > lastTs { lastTs = maxTs }
				}
			}
			if total == 0 { return }
			if firstTs == 9999999999 { firstTs = 0 }
			// 统计群内发言人数（通过 Name2Id 映射到 wxid 后去重，避免跨 DB rowid 重复）
			wxidSet := make(map[string]struct{})
			memberQuery := "SELECT DISTINCT real_sender_id FROM [%s] WHERE real_sender_id > 0"
			if twGroups != "" {
				memberQuery = "SELECT DISTINCT real_sender_id FROM [%s]" + twGroups + " AND real_sender_id > 0"
			}
			for _, mdb := range s.dbMgr.MessageDBs {
				// 加载本 DB 的 rowid → wxid 映射
				id2wxid := make(map[int64]string)
				if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
					for nrows.Next() {
						var rid int64; var uname string
						nrows.Scan(&rid, &uname)
						id2wxid[rid] = uname
					}
					nrows.Close()
				}
				mrows, merr := mdb.Query(fmt.Sprintf(memberQuery, tableName))
				if merr != nil { continue }
				for mrows.Next() {
					var sid int64
					mrows.Scan(&sid)
					if wxid, ok := id2wxid[sid]; ok && wxid != "" {
						wxidSet[wxid] = struct{}{}
					}
				}
				mrows.Close()
			}
			name := g.remark; if name == "" { name = g.nick }; if name == "" { name = g.uname }
			mu.Lock()
			result = append(result, GroupInfo{
				Username: g.uname, Name: name, SmallHeadURL: g.avatar,
				TotalMessages: total, MemberCount: len(wxidSet),
				FirstMessage: s.formatTime(firstTs), LastMessage: s.formatTime(lastTs),
			})
			mu.Unlock()
		}(g)
	}
	wg.Wait()
	sort.Slice(result, func(i, j int) bool { return result[i].TotalMessages > result[j].TotalMessages })
	return result
}

// loadContactNameMap 从联系人 DB 加载 wxid → 显示名 映射
func (s *ContactService) loadContactNameMap() map[string]string {
	nameMap := make(map[string]string)
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, COALESCE(remark,''), COALESCE(nick_name,'') FROM contact")
	if err != nil { return nameMap }
	defer rows.Close()
	for rows.Next() {
		var uname, remark, nick string
		rows.Scan(&uname, &remark, &nick)
		name := remark
		if name == "" { name = nick }
		if name == "" { name = uname }
		nameMap[uname] = name
	}
	return nameMap
}

// decodeGroupContent 解码群消息内容（支持 zstd 压缩，goroutine-safe）
func decodeGroupContent(raw []byte, ct int64) string {
	if ct == 4 && len(raw) > 0 {
		dec := zstdDecoderPool.Get().(*zstd.Decoder)
		result, err := dec.DecodeAll(raw, nil)
		zstdDecoderPool.Put(dec)
		if err != nil { return "" }
		return string(result)
	}
	return string(raw)
}

// GetGroupDetail 群聊深度画像（lazy load + 内存缓存，异步计算）
// 首次调用立即返回 nil 并在后台开始计算，前端应轮询直到返回非 nil
func (s *ContactService) GetGroupDetail(username string) *GroupDetail {
	// 先查缓存
	s.groupDetailMu.RLock()
	cached, inCache := s.groupDetailCache[username]
	computing := s.groupDetailComputing[username]
	s.groupDetailMu.RUnlock()

	if inCache {
		return cached
	}
	if computing {
		return nil // 正在计算中，让前端继续轮询
	}

	// 标记为计算中，启动后台 goroutine
	s.groupDetailMu.Lock()
	if s.groupDetailComputing[username] || s.groupDetailCache[username] != nil {
		s.groupDetailMu.Unlock()
		return nil
	}
	s.groupDetailComputing[username] = true
	s.groupDetailMu.Unlock()

	go s.computeGroupDetail(username)
	return nil
}

func (s *ContactService) computeGroupDetail(username string) {
	tableName := db.GetTableName(username)
	detail := &GroupDetail{DailyHeatmap: make(map[string]int), TypeDist: make(map[string]int), MemberRank: []MemberStat{}, TopWords: []WordCount{}}
	memberMap := make(map[string]int64)
	wordCounts := make(map[string]int)

	nameMap := s.loadContactNameMap()

	twDetail := s.timeWhere()
	// Pass 1: 全量扫描时间分布 + 发言人统计
	// 用 real_sender_id（rowid）→ Name2Id → wxid → nameMap 解析所有人（含本人）
	for _, mdb := range s.dbMgr.MessageDBs {
		// 加载本 DB 的 Name2Id：rowid → wxid
		idToWxid := make(map[int64]string)
		if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
			for nrows.Next() {
				var rid int64; var uname string
				nrows.Scan(&rid, &uname)
				idToWxid[rid] = uname
			}
			nrows.Close()
		}

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, real_sender_id, local_type, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s", tableName, twDetail))
		if err != nil { continue }
		for rows.Next() {
			var ts, senderID int64
			var lt int
			var rawContent []byte; var ct int64
			rows.Scan(&ts, &senderID, &lt, &rawContent, &ct)
			content := decodeGroupContent(rawContent, ct)
			dt := time.Unix(ts, 0).In(s.tz)
			detail.HourlyDist[dt.Hour()]++
			detail.WeeklyDist[int(dt.Weekday())]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++
			typeName := classifyMsgType(lt, content)
			if typeName != "系统" { detail.TypeDist[typeName]++ }
			if wxid, ok := idToWxid[senderID]; ok && wxid != "" {
				speaker := wxid
				if name, ok2 := nameMap[wxid]; ok2 { speaker = name }
				memberMap[speaker]++
			}
		}
		rows.Close()
	}

	// Pass 2: 全量纯文本消息（local_type=1）收集后批量分词
	// 先收集所有文本（持 DB 连接期间不分词），关闭连接后再加锁分词
	twText := twDetail
	if twText == "" {
		twText = " WHERE local_type=1"
	} else {
		twText += " AND local_type=1"
	}
	var textSamples []string
	for _, mdb := range s.dbMgr.MessageDBs {
		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s",
			tableName, twText))
		if err != nil { continue }
		for rows.Next() {
			var rawContent []byte
			var ct int64
			rows.Scan(&rawContent, &ct)
			content := decodeGroupContent(rawContent, ct)
			if content == "" { continue }
			if idx := strings.Index(content, ":\n"); idx > 0 && idx < 80 {
				content = content[idx+2:]
			}
			if content == "" || s.isSys(content) { continue }
			content = wechatEmojiRe.ReplaceAllString(content, "")
			textSamples = append(textSamples, content)
		}
		rows.Close()
	}
	// 关闭所有 DB 连接后，加锁做分词（gse 非线程安全）
	s.segmenterMu.Lock()
	for _, text := range textSamples {
		for _, seg := range s.segmenter.Cut(text, true) {
			seg = strings.TrimSpace(seg)
			if !utf8.ValidString(seg) { continue }
			runes := []rune(seg)
			if len(runes) < 2 || len(runes) > 8 { continue }
			if isNumeric(seg) || STOP_WORDS[seg] || containsEmoji(seg) || !hasWordChar(seg) { continue }
			wordCounts[seg]++
		}
	}
	s.segmenterMu.Unlock()

	// 成员排行 top 500
	for speaker, cnt := range memberMap {
		detail.MemberRank = append(detail.MemberRank, MemberStat{Speaker: speaker, Count: cnt})
	}
	sort.Slice(detail.MemberRank, func(i, j int) bool { return detail.MemberRank[i].Count > detail.MemberRank[j].Count })
	if len(detail.MemberRank) > 500 { detail.MemberRank = detail.MemberRank[:500] }

	// 高频词 top 30
	for w, c := range wordCounts {
		if utf8.ValidString(w) { detail.TopWords = append(detail.TopWords, WordCount{w, c}) }
	}
	sort.Slice(detail.TopWords, func(i, j int) bool { return detail.TopWords[i].Count > detail.TopWords[j].Count })
	if len(detail.TopWords) > 30 { detail.TopWords = detail.TopWords[:30] }

	// 写入缓存，清除 computing 标记
	s.groupDetailMu.Lock()
	s.groupDetailCache[username] = detail
	delete(s.groupDetailComputing, username)
	s.groupDetailMu.Unlock()
}

// GroupChatMessage 群聊单条消息（含发言者显示名）
type GroupChatMessage struct {
	Time    string `json:"time"`           // "HH:MM"
	Speaker string `json:"speaker"`        // 发言者显示名
	Content string `json:"content"`        // 消息内容
	IsMine  bool   `json:"is_mine"`        // 是否是我发的
	Type    int    `json:"type"`           // local_type
	Date    string `json:"date,omitempty"` // "2024-03-15"，搜索结果中使用
}

// GetGroupDayMessages 返回群聊某一天的聊天记录
func (s *ContactService) GetGroupDayMessages(username, date string) []GroupChatMessage {
	tableName := db.GetTableName(username)

	t, err := time.ParseInLocation("2006-01-02", date, s.tz)
	if err != nil {
		return nil
	}
	dayStart := t.Unix()
	dayEnd := dayStart + 86400

	nameMap := s.loadContactNameMap()

	var msgs []GroupChatMessage
	for _, mdb := range s.dbMgr.MessageDBs {
		// 加载本 DB 的 Name2Id 映射：rowid → wxid
		id2name := make(map[int64]string)
		n2iRows, err2 := mdb.Query("SELECT rowid, user_name FROM Name2Id")
		if err2 == nil {
			for n2iRows.Next() {
				var rid int64
				var uname string
				n2iRows.Scan(&rid, &uname)
				id2name[rid] = uname
			}
			n2iRows.Close()
		}

		// 找我自己在本 DB 的 rowid（匹配 contact.db 中有 flag&3 的我自己的账号）
		// 通过 nameMap：我自己不在 contact 表里，但可通过排除所有联系人来判断
		// 更简单：群聊消息中 is_mine 通过 wxid 判断，需要知道自己的 wxid
		// 由于自己的 wxid 可能不在联系人表，这里用 isMine=false 作为保守值
		// 实际通过检查：若 wxid 不在 nameMap（非好友/自己），视为自己
		// 注意：群里有很多非好友，不能用此逻辑。改为：
		// 凡是 wxid 能在 nameMap 中找到（是好友），则不是我；否则用群消息格式里的前缀判断
		// 最可靠：和私聊一样，查 Name2Id 找我的 rowid
		// 我的 wxid 是 contact.db 中 flag=2055 左右的那个（只能启动时读一次）
		// 这里简化：每条消息根据 sender wxid 是否等于 "自己"（后续可配置）
		// 当前版本：is_mine = 从群消息前缀"wxid:\n"判断

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s] WHERE create_time >= %d AND create_time < %d ORDER BY create_time ASC",
			tableName, dayStart, dayEnd,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var lt int
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)

			rawText := decodeGroupContent(rawContent, ct)
			rawText = strings.TrimSpace(rawText)

			// 解析发言者（群消息格式："wxid:\n内容"）
			speakerWxid := ""
			content := rawText
			if lt == 1 {
				if idx := strings.Index(rawText, ":\n"); idx > 0 && idx < 80 {
					speakerWxid = rawText[:idx]
					content = rawText[idx+2:]
				}
			}

			// 若消息前缀没有 wxid，从 real_sender_id 查
			if speakerWxid == "" {
				if wxid, ok := id2name[senderID]; ok {
					speakerWxid = wxid
				}
			}

			// 显示名：备注/昵称 > wxid
			speaker := speakerWxid
			if n, ok := nameMap[speakerWxid]; ok && n != "" {
				speaker = n
			}
			if speaker == "" {
				speaker = "未知"
			}

			// 非文本类型描述
			switch lt {
			case 3:
				content = "[图片]"
			case 34:
				content = "[语音]"
			case 43:
				content = "[视频]"
			case 47:
				content = "[表情]"
			case 49:
				if strings.Contains(content, "wcpay") || strings.Contains(content, "redenvelope") {
					content = "[红包/转账]"
				} else {
					content = "[链接/文件]"
				}
			default:
				if lt != 1 {
					content = fmt.Sprintf("[消息类型 %d]", lt)
				}
			}
			content = strings.TrimSpace(content)
			if content == "" {
				continue
			}

			msgs = append(msgs, GroupChatMessage{
				Time:    time.Unix(ts, 0).In(s.tz).Format("15:04"),
				Speaker: speaker,
				Content: content,
				IsMine:  false, // 群聊暂不区分"我"，仅展示发言者
				Type:    lt,
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []GroupChatMessage{}
	}
	return msgs
}

// SearchGroupMessages 在群聊消息中搜索关键词，只匹配文本消息，返回最多 200 条（按时间倒序）
func (s *ContactService) SearchGroupMessages(username, query string) []GroupChatMessage {
	if query == "" {
		return []GroupChatMessage{}
	}
	tableName := db.GetTableName(username)
	tw := s.timeWhere()

	whereClause := tw
	if whereClause == "" {
		whereClause = " WHERE local_type=1"
	} else {
		whereClause += " AND local_type=1"
	}

	nameMap := s.loadContactNameMap()
	lowerQuery := strings.ToLower(query)
	var msgs []GroupChatMessage

	for _, mdb := range s.dbMgr.MessageDBs {
		id2name := make(map[int64]string)
		n2iRows, err2 := mdb.Query("SELECT rowid, user_name FROM Name2Id")
		if err2 == nil {
			for n2iRows.Next() {
				var rid int64
				var uname string
				n2iRows.Scan(&rid, &uname)
				id2name[rid] = uname
			}
			n2iRows.Close()
		}

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s ORDER BY create_time DESC",
			tableName, whereClause,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var rawContent []byte
			var ct, senderID int64
			rows.Scan(&ts, &rawContent, &ct, &senderID)

			rawText := decodeGroupContent(rawContent, ct)
			rawText = strings.TrimSpace(rawText)

			speakerWxid := ""
			content := rawText
			if idx := strings.Index(rawText, ":\n"); idx > 0 && idx < 80 {
				speakerWxid = rawText[:idx]
				content = rawText[idx+2:]
			}
			if speakerWxid == "" {
				if wxid, ok := id2name[senderID]; ok {
					speakerWxid = wxid
				}
			}

			content = strings.TrimSpace(content)
			if content == "" {
				continue
			}
			if !strings.Contains(strings.ToLower(content), lowerQuery) {
				continue
			}

			speaker := speakerWxid
			if n, ok := nameMap[speakerWxid]; ok && n != "" {
				speaker = n
			}
			if speaker == "" {
				speaker = "未知"
			}

			t := time.Unix(ts, 0).In(s.tz)
			msgs = append(msgs, GroupChatMessage{
				Time:    t.Format("15:04"),
				Date:    t.Format("2006-01-02"),
				Speaker: speaker,
				Content: content,
				IsMine:  false,
				Type:    1,
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []GroupChatMessage{}
	}
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].Date+msgs[i].Time > msgs[j].Date+msgs[j].Time })
	if len(msgs) > 200 {
		msgs = msgs[:200]
	}
	return msgs
}

// buildGroupHourlyHeatmap 统计所有群聊的 24 小时消息分布
func (s *ContactService) buildGroupHourlyHeatmap() [24]int {
	var result [24]int

	rows, err := s.dbMgr.ContactDB.Query(`SELECT username FROM contact WHERE username LIKE '%@chatroom'`)
	if err != nil {
		return result
	}
	var groupUsernames []string
	for rows.Next() {
		var uname string
		rows.Scan(&uname)
		groupUsernames = append(groupUsernames, uname)
	}
	rows.Close()

	twFilter := s.timeWhere()
	for _, groupUname := range groupUsernames {
		tableName := db.GetTableName(groupUname)
		for _, mdb := range s.dbMgr.MessageDBs {
			var query string
			if twFilter == "" {
				query = fmt.Sprintf("SELECT create_time FROM [%s]", tableName)
			} else {
				query = fmt.Sprintf("SELECT create_time FROM [%s]%s", tableName, twFilter)
			}
			mRows, err := mdb.Query(query)
			if err != nil {
				continue
			}
			for mRows.Next() {
				var ts int64
				mRows.Scan(&ts)
				h := time.Unix(ts, 0).In(s.tz).Hour()
				result[h]++
			}
			mRows.Close()
		}
	}
	return result
}

// buildGroupMonthlyTrend 统计所有群聊的月度消息量（month → count）
func (s *ContactService) buildGroupMonthlyTrend() map[string]int {
	result := make(map[string]int)

	rows, err := s.dbMgr.ContactDB.Query(`SELECT username FROM contact WHERE username LIKE '%@chatroom'`)
	if err != nil {
		return result
	}
	var groupUsernames []string
	for rows.Next() {
		var uname string
		rows.Scan(&uname)
		groupUsernames = append(groupUsernames, uname)
	}
	rows.Close()

	twFilter := s.timeWhere()
	for _, groupUname := range groupUsernames {
		tableName := db.GetTableName(groupUname)
		for _, mdb := range s.dbMgr.MessageDBs {
			var query string
			if twFilter == "" {
				query = fmt.Sprintf("SELECT create_time FROM [%s]", tableName)
			} else {
				query = fmt.Sprintf("SELECT create_time FROM [%s]%s", tableName, twFilter)
			}
			mRows, err := mdb.Query(query)
			if err != nil {
				continue
			}
			for mRows.Next() {
				var ts int64
				mRows.Scan(&ts)
				month := time.Unix(ts, 0).In(s.tz).Format("2006-01")
				result[month]++
			}
			mRows.Close()
		}
	}
	return result
}

// buildSharedGroupCounts 构建所有联系人的共同群聊数量映射（username → 共同群聊数）
// 采用倒排索引：对每个群聊找出有发言的联系人，汇总计数
func (s *ContactService) buildSharedGroupCounts() map[string]int {
	result := make(map[string]int)

	// 1. 获取所有群聊 username
	rows, err := s.dbMgr.ContactDB.Query(`SELECT username FROM contact WHERE username LIKE '%@chatroom'`)
	if err != nil {
		return result
	}
	var groupUsernames []string
	for rows.Next() {
		var uname string
		rows.Scan(&uname)
		groupUsernames = append(groupUsernames, uname)
	}
	rows.Close()

	// 2. 预加载每个消息 DB 的 Name2Id 映射（rowid → wxid）
	idToWxid := make([]map[int64]string, len(s.dbMgr.MessageDBs))
	for dbIdx, mdb := range s.dbMgr.MessageDBs {
		idToWxid[dbIdx] = make(map[int64]string)
		if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
			for nrows.Next() {
				var rid int64
				var uname string
				nrows.Scan(&rid, &uname)
				idToWxid[dbIdx][rid] = uname
			}
			nrows.Close()
		}
	}

	// 3. 对每个群聊，找出所有有发言的联系人并计数
	twFilter := s.timeWhere()
	for _, groupUname := range groupUsernames {
		tableName := db.GetTableName(groupUname)
		seenInGroup := make(map[string]bool)

		for dbIdx, mdb := range s.dbMgr.MessageDBs {
			var query string
			if twFilter == "" {
				query = fmt.Sprintf("SELECT DISTINCT real_sender_id FROM [%s]", tableName)
			} else {
				query = fmt.Sprintf("SELECT DISTINCT real_sender_id FROM [%s]%s", tableName, twFilter)
			}
			senderRows, err := mdb.Query(query)
			if err != nil {
				continue
			}
			for senderRows.Next() {
				var senderID int64
				senderRows.Scan(&senderID)
				if wxid, ok := idToWxid[dbIdx][senderID]; ok && wxid != "" && !seenInGroup[wxid] {
					seenInGroup[wxid] = true
					result[wxid]++
				}
			}
			senderRows.Close()
		}
	}

	return result
}

// GetCommonGroups 返回当前用户与指定联系人共同所在的群聊列表
// 判断依据：在群聊消息表中，通过 Name2Id 查找该联系人的 wxid 是否出现过
func (s *ContactService) GetCommonGroups(contactUsername string) []GroupInfo {
	// 先拿所有群列表（已有消息的）
	allGroups := s.GetGroups()
	if len(allGroups) == 0 {
		return []GroupInfo{}
	}

	// 在每个消息 DB 里查找该联系人的 Name2Id rowid
	// 然后检查各群聊表中是否有该 real_sender_id
	contactRowIDs := make(map[int][]int64) // dbIndex → []rowid

	for dbIdx, mdb := range s.dbMgr.MessageDBs {
		rows, err := mdb.Query("SELECT rowid FROM Name2Id WHERE user_name = ?", contactUsername)
		if err != nil {
			continue
		}
		for rows.Next() {
			var rid int64
			rows.Scan(&rid)
			contactRowIDs[dbIdx] = append(contactRowIDs[dbIdx], rid)
		}
		rows.Close()
	}

	// 对每个群聊检查联系人是否有发言
	var result []GroupInfo
	twFilter := s.timeWhere()
	for _, g := range allGroups {
		tableName := db.GetTableName(g.Username)
		found := false
		for dbIdx, mdb := range s.dbMgr.MessageDBs {
			if found {
				break
			}
			rids := contactRowIDs[dbIdx]
			if len(rids) == 0 {
				continue
			}
			for _, rid := range rids {
				query := fmt.Sprintf("SELECT 1 FROM [%s] WHERE real_sender_id = ?%s LIMIT 1", tableName, twFilter)
				var exists int
				err := mdb.QueryRow(query, rid).Scan(&exists)
				if err == nil && exists == 1 {
					found = true
					break
				}
			}
		}
		if found {
			result = append(result, g)
		}
	}

	if result == nil {
		return []GroupInfo{}
	}
	return result
}

func containsEmoji(s string) bool {
	for _, r := range s {
		// Emoji 通常在以下 Unicode 范围：
		// - 0x1F300-0x1F9FF (Miscellaneous Symbols and Pictographs, Emoticons, etc.)
		// - 0x2600-0x26FF (Miscellaneous Symbols)
		// - 0x2700-0x27BF (Dingbats)
		// - 0xFE00-0xFE0F (Variation Selectors)
		// - 0x1F000-0x1F02F (Mahjong/Domino tiles)
		if r >= 0x1F300 && r <= 0x1F9FF ||
			r >= 0x2600 && r <= 0x26FF ||
			r >= 0x2700 && r <= 0x27BF ||
			r >= 0xFE00 && r <= 0xFE0F ||
			r >= 0x1F000 && r <= 0x1F02F ||
			unicode.Is(unicode.So, r) || // Symbols, Other
			unicode.Is(unicode.Sk, r) {  // Symbols, Modifier
			return true
		}
	}
	return false
}

// ─── 关系降温榜 ───────────────────────────────────────────────────────────────

// CoolingEntry 降温榜条目
type CoolingEntry struct {
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	SmallHeadURL  string  `json:"small_head_url"`
	PeakMonthly   float64 `json:"peak_monthly"`   // 历史峰值3月均值
	RecentMonthly float64 `json:"recent_monthly"` // 近3月均值
	DropRatio     float64 `json:"drop_ratio"`     // (peak-recent)/peak
	PeakPeriod    string  `json:"peak_period"`    // 峰值起始月 "2022-03"
	TotalMessages int64   `json:"total_messages"`
}

// GetCoolingRanking 返回关系降温最明显的联系人（历史峰值3月均 vs 近3月均）
func (s *ContactService) GetCoolingRanking() []CoolingEntry {
	s.cacheMu.RLock()
	contacts := s.cache
	s.cacheMu.RUnlock()

	// 时区偏移秒数（用于 SQLite strftime）
	_, tzOffset := time.Now().In(s.tz).Zone()

	recentCutoff := time.Now().In(s.tz).AddDate(0, -3, 0).Format("2006-01")
	var entries []CoolingEntry

	for _, c := range contacts {
		if c.TotalMessages < 30 {
			continue
		}
		tableName := db.GetTableName(c.Username)

		// 用 SQL GROUP BY 按月聚合，避免逐行扫描
		monthly := make(map[string]int)
		for _, mdb := range s.dbMgr.MessageDBs {
			rows, err := mdb.Query(fmt.Sprintf(
				`SELECT strftime('%%Y-%%m', create_time + %d, 'unixepoch') AS month, COUNT(*) FROM [%s] GROUP BY month`,
				tzOffset, tableName))
			if err != nil {
				continue
			}
			for rows.Next() {
				var month string
				var cnt int
				rows.Scan(&month, &cnt)
				monthly[month] += cnt
			}
			rows.Close()
		}
		if len(monthly) < 4 {
			continue
		}

		months := make([]string, 0, len(monthly))
		for m := range monthly {
			months = append(months, m)
		}
		sort.Strings(months)

		// 历史峰值：找连续 3 个月的最高均值窗口
		var peakAvg float64
		var peakPeriod string
		for i := 0; i <= len(months)-3; i++ {
			avg := float64(monthly[months[i]]+monthly[months[i+1]]+monthly[months[i+2]]) / 3
			if avg > peakAvg {
				peakAvg = avg
				peakPeriod = months[i]
			}
		}
		if peakAvg < 10 {
			continue
		}

		// 近 3 个月均值
		recentSum, recentN := 0, 0
		for _, m := range months {
			if m >= recentCutoff {
				recentSum += monthly[m]
				recentN++
			}
		}
		if recentN == 0 {
			recentN = 1
		}
		recentAvg := float64(recentSum) / float64(recentN)

		dropRatio := (peakAvg - recentAvg) / peakAvg
		if dropRatio < 0.5 {
			continue
		}

		name := c.Remark
		if name == "" {
			name = c.Nickname
		}
		if name == "" {
			name = c.Username
		}
		entries = append(entries, CoolingEntry{
			Username:      c.Username,
			DisplayName:   name,
			SmallHeadURL:  c.SmallHeadURL,
			PeakMonthly:   peakAvg,
			RecentMonthly: recentAvg,
			DropRatio:     dropRatio,
			PeakPeriod:    peakPeriod,
			TotalMessages: c.TotalMessages,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].PeakMonthly > entries[j].PeakMonthly
	})
	if len(entries) > 20 {
		entries = entries[:20]
	}
	return entries
}

// ─── 全局搜索 ──────────────────────────────────────────────────────────────────

// GlobalSearchGroup 单个联系人的搜索结果组
type GlobalSearchGroup struct {
	Username     string        `json:"username"`
	DisplayName  string        `json:"display_name"`
	SmallHeadURL string        `json:"small_head_url"`
	Messages     []ChatMessage `json:"messages"`
	Count        int           `json:"count"`
	IsGroup      bool          `json:"is_group"`
}

// GlobalSearch 跨所有联系人/群聊的消息搜索，按对象分组返回，每个最多 5 条
// searchType: "contact" | "group" | "all"
func (s *ContactService) GlobalSearch(q, searchType string) []GlobalSearchGroup {
	pattern := "%" + q + "%"
	var results []GlobalSearchGroup

	// ── 私聊搜索 ──────────────────────────────────────────────────
	if searchType == "contact" || searchType == "all" {
		s.cacheMu.RLock()
		contacts := s.cache
		s.cacheMu.RUnlock()

		for _, c := range contacts {
			tableName := db.GetTableName(c.Username)
			var msgs []ChatMessage

			for _, mdb := range s.dbMgr.MessageDBs {
				var contactRowID int64 = -1
				mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", c.Username)).Scan(&contactRowID)

				rows, err := mdb.Query(fmt.Sprintf(
					`SELECT create_time, local_type, message_content, COALESCE(real_sender_id,0)
					 FROM [%s] WHERE local_type = 1 AND message_content LIKE ? ORDER BY create_time DESC LIMIT 5`,
					tableName), pattern)
				if err != nil {
					continue
				}
				for rows.Next() {
					var ts int64
					var lt int
					var content string
					var senderID int64
					rows.Scan(&ts, &lt, &content, &senderID)
					dt := time.Unix(ts, 0).In(s.tz)
					isMine := contactRowID < 0 || senderID != contactRowID
					msgs = append(msgs, ChatMessage{
						Time:    dt.Format("15:04"),
						Date:    dt.Format("2006-01-02"),
						Content: content,
						IsMine:  isMine,
						Type:    lt,
					})
				}
				rows.Close()
			}

			if len(msgs) > 0 {
				name := c.Remark
				if name == "" {
					name = c.Nickname
				}
				if name == "" {
					name = c.Username
				}
				results = append(results, GlobalSearchGroup{
					Username:     c.Username,
					DisplayName:  name,
					SmallHeadURL: c.SmallHeadURL,
					Messages:     msgs,
					Count:        len(msgs),
					IsGroup:      false,
				})
			}
		}
	}

	// ── 群聊搜索 ──────────────────────────────────────────────────
	if searchType == "group" || searchType == "all" {
		groupRows, err := s.dbMgr.ContactDB.Query(
			`SELECT username, COALESCE(remark,''), nick_name, COALESCE(small_head_url,'')
			 FROM contact WHERE username LIKE '%@chatroom'`)
		if err == nil {
			defer groupRows.Close()
			for groupRows.Next() {
				var username, remark, nickname, avatar string
				groupRows.Scan(&username, &remark, &nickname, &avatar)

				name := remark
				if name == "" {
					name = nickname
				}
				if name == "" {
					name = username
				}

				tableName := db.GetTableName(username)
				var msgs []ChatMessage

				for _, mdb := range s.dbMgr.MessageDBs {
					msgRows, err := mdb.Query(fmt.Sprintf(
						`SELECT create_time, local_type, message_content
						 FROM [%s] WHERE local_type = 1 AND message_content LIKE ? ORDER BY create_time DESC LIMIT 5`,
						tableName), pattern)
					if err != nil {
						continue
					}
					for msgRows.Next() {
						var ts int64
						var lt int
						var content string
						msgRows.Scan(&ts, &lt, &content)
						// 群消息格式："speakerWxid:\ncontent"，去掉发言人前缀
						if idx := strings.Index(content, ":\n"); idx > 0 && idx < 80 {
							content = content[idx+2:]
						}
						dt := time.Unix(ts, 0).In(s.tz)
						msgs = append(msgs, ChatMessage{
							Time:    dt.Format("15:04"),
							Date:    dt.Format("2006-01-02"),
							Content: content,
							IsMine:  false,
							Type:    lt,
						})
					}
					msgRows.Close()
				}

				if len(msgs) > 0 {
					results = append(results, GlobalSearchGroup{
						Username:     username,
						DisplayName:  name,
						SmallHeadURL: avatar,
						Messages:     msgs,
						Count:        len(msgs),
						IsGroup:      true,
					})
				}
			}
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Count > results[j].Count
	})
	return results
}

// ─── 时光轴 Calendar ──────────────────────────────────────────────────────────

// buildGroupDailyHeatmap 统计所有群聊的每日消息量（date → count）
func (s *ContactService) buildGroupDailyHeatmap() map[string]int {
	result := make(map[string]int)
	rows, err := s.dbMgr.ContactDB.Query(`SELECT username FROM contact WHERE username LIKE '%@chatroom'`)
	if err != nil {
		return result
	}
	var groupUsernames []string
	for rows.Next() {
		var uname string
		rows.Scan(&uname)
		groupUsernames = append(groupUsernames, uname)
	}
	rows.Close()

	twFilter := s.timeWhere()
	for _, groupUname := range groupUsernames {
		tableName := db.GetTableName(groupUname)
		for _, mdb := range s.dbMgr.MessageDBs {
			var query string
			if twFilter == "" {
				query = fmt.Sprintf("SELECT create_time FROM [%s]", tableName)
			} else {
				query = fmt.Sprintf("SELECT create_time FROM [%s]%s", tableName, twFilter)
			}
			mRows, err := mdb.Query(query)
			if err != nil {
				continue
			}
			for mRows.Next() {
				var ts int64
				mRows.Scan(&ts)
				result[time.Unix(ts, 0).In(s.tz).Format("2006-01-02")]++
			}
			mRows.Close()
		}
	}
	return result
}

// GetCalendarHeatmap 返回全局每日消息量（联系人+群聊合计）。
// 必须在 performAnalysis 完成后调用，否则返回 nil。
func (s *ContactService) GetCalendarHeatmap() map[string]int {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	return s.calendarHeatmap
}

// CalendarDayEntry 表示某天某个联系人或群聊的消息摘要。
type CalendarDayEntry struct {
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	SmallHeadURL string `json:"small_head_url"`
	Count        int    `json:"count"`
	IsGroup      bool   `json:"is_group"`
}

// GetDayActivity 查询指定日期有消息的联系人和群聊，按消息数降序返回。
// date 格式为 "2006-01-02"。
func (s *ContactService) GetDayActivity(date string) (contacts []CalendarDayEntry, groups []CalendarDayEntry) {
	t, err := time.ParseInLocation("2006-01-02", date, s.tz)
	if err != nil {
		return nil, nil
	}
	dayStart := t.Unix()
	dayEnd := dayStart + 86400

	// ── 联系人 ──────────────────────────────────────────────────────────────
	cRows, err := s.dbMgr.ContactDB.Query(
		"SELECT username, nick_name, remark, COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0")
	if err == nil {
		defer cRows.Close()
		for cRows.Next() {
			var uname, nick, remark, avatar string
			cRows.Scan(&uname, &nick, &remark, &avatar)
			lower := strings.ToLower(uname)
			if strings.HasSuffix(lower, "@chatroom") || strings.HasPrefix(lower, "gh_") || uname == "" {
				continue
			}

			tableName := db.GetTableName(uname)
			var total int
			for _, mdb := range s.dbMgr.MessageDBs {
				var cnt int
				mdb.QueryRow(fmt.Sprintf(
					"SELECT COUNT(*) FROM [%s] WHERE create_time >= %d AND create_time < %d",
					tableName, dayStart, dayEnd,
				)).Scan(&cnt)
				total += cnt
			}
			if total == 0 {
				continue
			}
			name := remark
			if name == "" {
				name = nick
			}
			if name == "" {
				name = uname
			}
			contacts = append(contacts, CalendarDayEntry{
				Username: uname, DisplayName: name, SmallHeadURL: avatar,
				Count: total, IsGroup: false,
			})
		}
	}

	// ── 群聊 ────────────────────────────────────────────────────────────────
	gRows, err := s.dbMgr.ContactDB.Query(
		"SELECT username, nick_name, remark, COALESCE(small_head_url,'') FROM contact WHERE username LIKE '%@chatroom'")
	if err == nil {
		defer gRows.Close()
		for gRows.Next() {
			var uname, nick, remark, avatar string
			gRows.Scan(&uname, &nick, &remark, &avatar)
			tableName := db.GetTableName(uname)
			var total int
			for _, mdb := range s.dbMgr.MessageDBs {
				var cnt int
				mdb.QueryRow(fmt.Sprintf(
					"SELECT COUNT(*) FROM [%s] WHERE create_time >= %d AND create_time < %d",
					tableName, dayStart, dayEnd,
				)).Scan(&cnt)
				total += cnt
			}
			if total == 0 {
				continue
			}
			name := remark
			if name == "" {
				name = nick
			}
			if name == "" {
				name = uname
			}
			groups = append(groups, CalendarDayEntry{
				Username: uname, DisplayName: name, SmallHeadURL: avatar,
				Count: total, IsGroup: true,
			})
		}
	}

	sort.Slice(contacts, func(i, j int) bool { return contacts[i].Count > contacts[j].Count })
	sort.Slice(groups, func(i, j int) bool { return groups[i].Count > groups[j].Count })
	return contacts, groups
}

// ─── 纪念日检测 ──────────────────────────────────────────────────────────────

// DetectedEvent 自动检测到的日期事件（生日等）
type DetectedEvent struct {
	Type        string `json:"type"`         // "birthday"
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Date        string `json:"date"`         // "MM-DD"
	Years       []int  `json:"years"`        // 在哪些年份检测到
	Evidence    string `json:"evidence"`     // 触发检测的消息片段
}

// FriendMilestone 友谊里程碑
type FriendMilestone struct {
	Username          string `json:"username"`
	DisplayName       string `json:"display_name"`
	AvatarURL         string `json:"avatar_url"`
	FirstMsgDate      string `json:"first_msg_date"`
	DaysKnown         int    `json:"days_known"`
	NextMilestone     int    `json:"next_milestone"`
	NextMilestoneDate string `json:"next_milestone_date"`
	DaysUntil         int    `json:"days_until"`
}

var birthdayPatterns = []*regexp.Regexp{
	regexp.MustCompile(`生日快乐`),
	regexp.MustCompile(`(?i)happy\s*birthday`),
	regexp.MustCompile(`祝你?生日`),
	regexp.MustCompile(`生快`),
}

// DetectAnniversaries 检测生日事件和友谊里程碑
func (s *ContactService) DetectAnniversaries() ([]DetectedEvent, []FriendMilestone) {
	s.cacheMu.RLock()
	contacts := s.cache
	s.cacheMu.RUnlock()

	now := time.Now().In(s.tz)
	today := now.Format("2006-01-02")

	// ── 1. 生日检测：扫描含"生日快乐"的消息 ──
	// key = username + "|" + MM-DD
	type bdKey struct {
		username string
		mmdd     string
	}
	type bdInfo struct {
		years    map[int]bool
		evidence string
	}
	bdMap := make(map[bdKey]*bdInfo)

	for _, c := range contacts {
		if c.TotalMessages == 0 {
			continue
		}
		tableName := db.GetTableName(c.Username)
		for _, mdb := range s.dbMgr.MessageDBs {
			// 用 SQL LIKE 在数据库层过滤，避免全表扫描
			rows, err := mdb.Query(fmt.Sprintf(
				`SELECT create_time, message_content FROM [%s]
				 WHERE local_type = 1
				   AND (message_content LIKE '%%生日快乐%%'
				     OR message_content LIKE '%%happy birthday%%'
				     OR message_content LIKE '%%Happy Birthday%%'
				     OR message_content LIKE '%%祝你生日%%'
				     OR message_content LIKE '%%祝生日%%'
				     OR message_content LIKE '%%生快%%')`,
				tableName))
			if err != nil {
				continue
			}
			for rows.Next() {
				var ts int64
				var content string
				rows.Scan(&ts, &content)
				// 二次验证正则
				matched := false
				for _, p := range birthdayPatterns {
					if p.MatchString(content) {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
				dt := time.Unix(ts, 0).In(s.tz)
				mmdd := dt.Format("01-02")
				year := dt.Year()
				key := bdKey{username: c.Username, mmdd: mmdd}
				if bdMap[key] == nil {
					snippet := content
					if len([]rune(snippet)) > 40 {
						snippet = string([]rune(snippet)[:40]) + "…"
					}
					bdMap[key] = &bdInfo{years: map[int]bool{year: true}, evidence: snippet}
				} else {
					bdMap[key].years[year] = true
				}
			}
			rows.Close()
		}
	}

	// 按 username 聚合：同一联系人取出现次数最多的 MM-DD 作为生日
	type bdCandidate struct {
		mmdd     string
		count    int
		evidence string
		years    []int
	}
	bestBD := make(map[string]*bdCandidate)
	for key, info := range bdMap {
		years := make([]int, 0, len(info.years))
		for y := range info.years {
			years = append(years, y)
		}
		sort.Ints(years)
		count := len(years)
		if prev, ok := bestBD[key.username]; !ok || count > prev.count {
			bestBD[key.username] = &bdCandidate{mmdd: key.mmdd, count: count, evidence: info.evidence, years: years}
		}
	}

	// 构建联系人名称映射
	nameMap := make(map[string]string)
	avatarMap := make(map[string]string)
	for _, c := range contacts {
		name := c.Remark
		if name == "" {
			name = c.Nickname
		}
		if name == "" {
			name = c.Username
		}
		nameMap[c.Username] = name
		avatarMap[c.Username] = c.SmallHeadURL
	}

	var detected []DetectedEvent
	for username, bd := range bestBD {
		detected = append(detected, DetectedEvent{
			Type:        "birthday",
			Username:    username,
			DisplayName: nameMap[username],
			AvatarURL:   avatarMap[username],
			Date:        bd.mmdd,
			Years:       bd.years,
			Evidence:    bd.evidence,
		})
	}
	// 按距今天最近排序
	sort.Slice(detected, func(i, j int) bool {
		return daysUntilMMDD(detected[i].Date, today) < daysUntilMMDD(detected[j].Date, today)
	})

	// ── 2. 友谊里程碑 ──
	milestoneValues := []int{100, 200, 365, 500, 730, 1000, 1095, 1500, 1825, 2000, 2555, 3650}
	var milestones []FriendMilestone
	for _, c := range contacts {
		if c.FirstMessage == "" || c.FirstMessage == "-" || c.TotalMessages < 10 {
			continue
		}
		firstDate, err := time.ParseInLocation("2006-01-02", c.FirstMessage, s.tz)
		if err != nil {
			continue
		}
		daysKnown := int(now.Sub(firstDate).Hours() / 24)
		// 找下一个里程碑
		nextMs := 0
		for _, m := range milestoneValues {
			if daysKnown < m {
				nextMs = m
				break
			}
		}
		if nextMs == 0 {
			continue // 已超过所有里程碑
		}
		daysUntil := nextMs - daysKnown
		if daysUntil > 60 {
			continue // 只显示 60 天内到达的里程碑
		}
		nextDate := firstDate.AddDate(0, 0, nextMs).Format("2006-01-02")
		name := c.Remark
		if name == "" {
			name = c.Nickname
		}
		if name == "" {
			name = c.Username
		}
		milestones = append(milestones, FriendMilestone{
			Username:          c.Username,
			DisplayName:       name,
			AvatarURL:         c.SmallHeadURL,
			FirstMsgDate:      c.FirstMessage,
			DaysKnown:         daysKnown,
			NextMilestone:     nextMs,
			NextMilestoneDate: nextDate,
			DaysUntil:         daysUntil,
		})
	}
	sort.Slice(milestones, func(i, j int) bool { return milestones[i].DaysUntil < milestones[j].DaysUntil })
	// 最多返回 20 条
	if len(milestones) > 20 {
		milestones = milestones[:20]
	}

	if detected == nil {
		detected = []DetectedEvent{}
	}
	if milestones == nil {
		milestones = []FriendMilestone{}
	}
	return detected, milestones
}

// daysUntilMMDD 计算从 today (YYYY-MM-DD) 到下一个 MM-DD 的天数
func daysUntilMMDD(mmdd, today string) int {
	year := today[:4]
	target := year + "-" + mmdd
	if target < today {
		// 今年已过，算明年
		y := 0
		fmt.Sscanf(year, "%d", &y)
		target = fmt.Sprintf("%04d-%s", y+1, mmdd)
	}
	t1, _ := time.Parse("2006-01-02", today)
	t2, _ := time.Parse("2006-01-02", target)
	return int(t2.Sub(t1).Hours() / 24)
}

// ─── 群聊人物关系挖掘 ────────────────────────────────────────────────────────

// RelationshipNode 群内成员节点
type RelationshipNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Messages int64  `json:"messages"`
}

// RelationshipEdge 成员间互动边
type RelationshipEdge struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	Weight   int    `json:"weight"`
	Replies  int    `json:"replies"`
	Mentions int    `json:"mentions"`
}

// RelationshipGraph 完整关系图
type RelationshipGraph struct {
	Nodes []RelationshipNode `json:"nodes"`
	Edges []RelationshipEdge `json:"edges"`
}

// GetGroupRelationships 群聊人物关系（lazy load + 缓存，异步计算）
func (s *ContactService) GetGroupRelationships(username string) *RelationshipGraph {
	s.groupDetailMu.RLock()
	cached, inCache := s.groupRelCache[username]
	computing := s.groupRelComputing[username]
	s.groupDetailMu.RUnlock()

	if inCache {
		return cached
	}
	if computing {
		return nil
	}

	s.groupDetailMu.Lock()
	if s.groupRelComputing[username] || s.groupRelCache[username] != nil {
		s.groupDetailMu.Unlock()
		return nil
	}
	s.groupRelComputing[username] = true
	s.groupDetailMu.Unlock()

	go s.computeGroupRelationships(username)
	return nil
}

func (s *ContactService) computeGroupRelationships(username string) {
	tableName := db.GetTableName(username)
	nameMap := s.loadContactNameMap()
	tw := s.timeWhere()

	// 收集所有消息的 (timestamp, senderName, content) 按时间排序
	type msgEntry struct {
		ts     int64
		sender string
		content string
	}
	var allMsgs []msgEntry
	memberMsgs := make(map[string]int64)

	for _, mdb := range s.dbMgr.MessageDBs {
		idToWxid := make(map[int64]string)
		if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
			for nrows.Next() {
				var rid int64
				var uname string
				nrows.Scan(&rid, &uname)
				idToWxid[rid] = uname
			}
			nrows.Close()
		}

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, real_sender_id, local_type, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s ORDER BY create_time ASC",
			tableName, tw))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts, senderID int64
			var lt int
			var rawContent []byte
			var ct int64
			rows.Scan(&ts, &senderID, &lt, &rawContent, &ct)
			if senderID <= 0 {
				continue
			}
			wxid, ok := idToWxid[senderID]
			if !ok || wxid == "" {
				continue
			}
			speaker := wxid
			if name, ok2 := nameMap[wxid]; ok2 {
				speaker = name
			}
			memberMsgs[speaker]++

			content := ""
			if lt == 1 {
				content = decodeGroupContent(rawContent, ct)
				// 去掉群聊消息的 "wxid:\n" 前缀
				if idx := strings.Index(content, ":\n"); idx > 0 && idx < 80 {
					content = content[idx+2:]
				}
			}
			allMsgs = append(allMsgs, msgEntry{ts: ts, sender: speaker, content: content})
		}
		rows.Close()
	}

	// 按时间排序（跨 DB 合并后可能乱序）
	sort.Slice(allMsgs, func(i, j int) bool { return allMsgs[i].ts < allMsgs[j].ts })

	// 建立所有已知成员名集合（用于 @mention 匹配）
	memberNames := make(map[string]bool)
	for name := range memberMsgs {
		memberNames[name] = true
	}

	// 互动检测
	type edgeKey struct{ a, b string }
	makeKey := func(a, b string) edgeKey {
		if a > b {
			a, b = b, a
		}
		return edgeKey{a, b}
	}
	type edgeData struct {
		replies  int
		mentions int
	}
	edgeMap := make(map[edgeKey]*edgeData)
	getEdge := func(a, b string) *edgeData {
		k := makeKey(a, b)
		if edgeMap[k] == nil {
			edgeMap[k] = &edgeData{}
		}
		return edgeMap[k]
	}

	// 连续消息互动检测（2 分钟内的不同发言人视为互动）
	for i := 1; i < len(allMsgs); i++ {
		prev := allMsgs[i-1]
		curr := allMsgs[i]
		if curr.sender != prev.sender && curr.ts-prev.ts <= 120 {
			getEdge(prev.sender, curr.sender).replies++
		}
	}

	// @mention 检测
	atRe := regexp.MustCompile(`@([^\s@]{1,20})`)
	for _, m := range allMsgs {
		if m.content == "" {
			continue
		}
		matches := atRe.FindAllStringSubmatch(m.content, -1)
		for _, match := range matches {
			mentioned := match[1]
			if memberNames[mentioned] && mentioned != m.sender {
				getEdge(m.sender, mentioned).mentions++
			}
		}
	}

	// 构建结果（过滤弱关系）
	var edges []RelationshipEdge
	nodeInEdge := make(map[string]bool)
	for k, e := range edgeMap {
		weight := e.replies + e.mentions*2
		if weight < 3 {
			continue
		}
		edges = append(edges, RelationshipEdge{
			Source: k.a, Target: k.b,
			Weight: weight, Replies: e.replies, Mentions: e.mentions,
		})
		nodeInEdge[k.a] = true
		nodeInEdge[k.b] = true
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].Weight > edges[j].Weight })
	if len(edges) > 200 {
		edges = edges[:200]
	}

	// 只保留出现在边中的节点
	var nodes []RelationshipNode
	for name, cnt := range memberMsgs {
		if nodeInEdge[name] {
			nodes = append(nodes, RelationshipNode{ID: name, Name: name, Messages: cnt})
		}
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Messages > nodes[j].Messages })

	if nodes == nil {
		nodes = []RelationshipNode{}
	}
	if edges == nil {
		edges = []RelationshipEdge{}
	}

	graph := &RelationshipGraph{Nodes: nodes, Edges: edges}
	s.groupDetailMu.Lock()
	s.groupRelCache[username] = graph
	delete(s.groupRelComputing, username)
	s.groupDetailMu.Unlock()
}
