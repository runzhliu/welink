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
	HourlyHeatmap     [24]int           `json:"hourly_heatmap"`
	TypeMix           map[string]int    `json:"type_mix"`
	LateNightRanking  []LateNightEntry  `json:"late_night_ranking"`
}

type WordCount struct {
	Word  string `json:"word"`
	Count int    `json:"count"`
}

// ContactDetail 用于单个联系人的深度分析（按需查询，不在启动时计算）
type ContactDetail struct {
	HourlyDist     [24]int        `json:"hourly_dist"`
	WeeklyDist     [7]int         `json:"weekly_dist"`
	DailyHeatmap   map[string]int `json:"daily_heatmap"` // "2023-01-15" -> count
	LateNightCount int64          `json:"late_night_count"`
	MoneyCount     int64          `json:"money_count"`
	InitiationCnt  int64          `json:"initiation_count"`  // 主动发起对话次数（间隔>6h）
	TotalSessions  int64          `json:"total_sessions"`
}

type ContactStatsExtended struct {
	model.ContactStats
	FirstMsg         string             `json:"first_msg"`
	EmojiCnt         int                `json:"emoji_count"`
	TypePct          map[string]float64 `json:"type_pct"`
	TypeCnt          map[string]int     `json:"type_cnt"`
	SharedGroupsCount int               `json:"shared_groups_count"`
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
	groupDetailCache map[string]*GroupDetail // 群聊详情内存缓存（lazy load）
	groupDetailMu    sync.RWMutex
	filterFrom       int64 // 全局时间范围过滤（Unix 秒，0=不限）
	filterTo         int64
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
		groupDetailCache: make(map[string]*GroupDetail),
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
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, nick_name, remark, alias, flag, COALESCE(big_head_url,''), COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0")
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

			for _, mdb := range s.dbMgr.MessageDBs {
				mRows, err := mdb.Query(fmt.Sprintf("SELECT local_type, create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s", tableName, timeWhere))
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

					typeName := "其他"
					switch lt {
					case 1:
						typeName = "文本"
						if ts < firstMsgTs && content != "" && !s.isSys(content) {
							firstMsgTs = ts
							ext.FirstMsg = content
						}
					case 3: typeName = "图片"
					case 34: typeName = "语音"
					case 47: typeName = "表情"; ext.EmojiCnt++
					case 43: typeName = "视频"
					}
					typeCounts[typeName]++
					mu.Lock(); globalTypeMix[typeName]++; mu.Unlock()
				}
				mRows.Close()

				// 统计对方发送的消息数（their = sender is the contact）
				theirTw := timeWhere
				if theirTw == "" {
					theirTw = fmt.Sprintf(" WHERE real_sender_id = (SELECT rowid FROM Name2Id WHERE user_name = %q)", c.Username)
				} else {
					theirTw += fmt.Sprintf(" AND real_sender_id = (SELECT rowid FROM Name2Id WHERE user_name = %q)", c.Username)
				}
				var theirCnt int64
				row := mdb.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM [%s]%s", tableName, theirTw))
				row.Scan(&theirCnt)
				ext.TheirMessages += theirCnt
			}
			if ext.TotalMessages > 0 {
				ext.FirstMessage = s.formatTime(globalFirstTs); ext.LastMessage = s.formatTime(globalLastTs)
				ext.MyMessages = ext.TotalMessages - ext.TheirMessages
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
	}
	maxDayVal := 0
	for d, c := range globalDaily { if c > maxDayVal { s.global.BusiestDay = d; s.global.BusiestDayCount = c; maxDayVal = c } }
	if len(result) > 0 {
		maxEmoji := -1
		for _, r := range result { if r.EmojiCnt > maxEmoji { maxEmoji = r.EmojiCnt; name := r.Nickname; if r.Remark != "" { name = r.Remark }; s.global.EmojiKing = name } }
	}
	s.cacheMu.Unlock()
}

// FilteredStats 时间范围过滤后的统计结果
type FilteredStats struct {
	Contacts  []ContactStatsExtended `json:"contacts"`
	GlobalStats GlobalStats          `json:"global_stats"`
}

// AnalyzeWithFilter 对指定时间范围内的消息做统计（不写入缓存）
func (s *ContactService) AnalyzeWithFilter(from, to int64) *FilteredStats {
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, nick_name, remark, alias, flag, COALESCE(big_head_url,''), COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0")
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

					typeName := "其他"
					switch lt {
					case 1:
						typeName = "文本"
						if ts < firstMsgTs && content != "" && !s.isSys(content) {
							firstMsgTs = ts
							ext.FirstMsg = content
						}
					case 3: typeName = "图片"
					case 34: typeName = "语音"
					case 47: typeName = "表情"; ext.EmojiCnt++
					case 43: typeName = "视频"
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
		DailyHeatmap: make(map[string]int),
	}

	var prevTs int64

	timeWhere := s.timeWhere()
	orderBy := " ORDER BY create_time ASC"
	for _, mdb := range s.dbMgr.MessageDBs {
		// 每个 DB 单独查联系人 rowid
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, local_type, message_content, COALESCE(real_sender_id,0) FROM [%s]%s%s", tableName, timeWhere, orderBy))
		if err != nil { continue }
		for rows.Next() {
			var ts int64; var lt int; var content string; var senderID int64
			rows.Scan(&ts, &lt, &content, &senderID)
			dt := time.Unix(ts, 0).In(s.tz)
			h := dt.Hour()
			w := int(dt.Weekday()) // 0=Sunday

			detail.HourlyDist[h]++
			detail.WeeklyDist[w]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++

			if h >= s.cfg.LateNightStartHour && h < s.cfg.LateNightEndHour { detail.LateNightCount++ }

			// 红包 / 转账检测 (type 49，含 wcpay 或 redenvelope)
			if lt == 49 && (strings.Contains(content, "wcpay") || strings.Contains(content, "redenvelope")) {
				detail.MoneyCount++
			}

			// 新对话段：与上条消息间隔 > session_gap_seconds
			if prevTs == 0 || ts-prevTs > s.cfg.SessionGapSeconds {
				detail.TotalSessions++
				// 主动发起：该段第一条消息是我发的（senderID != 对方 rowid）
				isMine := contactRowID < 0 || senderID != contactRowID
				if isMine {
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
	FirstMessage  string `json:"first_message_time"`
	LastMessage   string `json:"last_message_time"`
}

type MemberStat struct {
	Speaker string `json:"speaker"`
	Count   int64  `json:"count"`
}

type GroupDetail struct {
	HourlyDist   [24]int        `json:"hourly_dist"`
	WeeklyDist   [7]int         `json:"weekly_dist"`
	DailyHeatmap map[string]int `json:"daily_heatmap"`
	MemberRank   []MemberStat   `json:"member_rank"`  // top 20 发言者
	TopWords     []WordCount    `json:"top_words"`    // top 30 高频词
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
			name := g.remark; if name == "" { name = g.nick }; if name == "" { name = g.uname }
			mu.Lock()
			result = append(result, GroupInfo{
				Username: g.uname, Name: name, SmallHeadURL: g.avatar,
				TotalMessages: total, FirstMessage: s.formatTime(firstTs), LastMessage: s.formatTime(lastTs),
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

// GetGroupDetail 群聊深度画像（lazy load + 内存缓存）
func (s *ContactService) GetGroupDetail(username string) *GroupDetail {
	// 先查缓存
	s.groupDetailMu.RLock()
	if cached, ok := s.groupDetailCache[username]; ok {
		s.groupDetailMu.RUnlock()
		return cached
	}
	s.groupDetailMu.RUnlock()

	tableName := db.GetTableName(username)
	detail := &GroupDetail{DailyHeatmap: make(map[string]int)}
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
			"SELECT create_time, real_sender_id FROM [%s]%s", tableName, twDetail))
		if err != nil { continue }
		for rows.Next() {
			var ts, senderID int64
			rows.Scan(&ts, &senderID)
			dt := time.Unix(ts, 0).In(s.tz)
			detail.HourlyDist[dt.Hour()]++
			detail.WeeklyDist[int(dt.Weekday())]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++
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

	// 成员排行 top 20
	for speaker, cnt := range memberMap {
		detail.MemberRank = append(detail.MemberRank, MemberStat{Speaker: speaker, Count: cnt})
	}
	sort.Slice(detail.MemberRank, func(i, j int) bool { return detail.MemberRank[i].Count > detail.MemberRank[j].Count })
	if len(detail.MemberRank) > 20 { detail.MemberRank = detail.MemberRank[:20] }

	// 高频词 top 30
	for w, c := range wordCounts {
		if utf8.ValidString(w) { detail.TopWords = append(detail.TopWords, WordCount{w, c}) }
	}
	sort.Slice(detail.TopWords, func(i, j int) bool { return detail.TopWords[i].Count > detail.TopWords[j].Count })
	if len(detail.TopWords) > 30 { detail.TopWords = detail.TopWords[:30] }

	// 写入缓存
	s.groupDetailMu.Lock()
	s.groupDetailCache[username] = detail
	s.groupDetailMu.Unlock()

	return detail
}

// GroupChatMessage 群聊单条消息（含发言者显示名）
type GroupChatMessage struct {
	Time    string `json:"time"`    // "HH:MM"
	Speaker string `json:"speaker"` // 发言者显示名
	Content string `json:"content"` // 消息内容
	IsMine  bool   `json:"is_mine"` // 是否是我发的
	Type    int    `json:"type"`    // local_type
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
