package service

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"regexp"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
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

// ReplyRhythm 回复节奏统计
type ReplyRhythm struct {
	MyAvgSeconds    float64 `json:"my_avg_seconds"`    // 我的平均回复时间（秒）
	TheirAvgSeconds float64 `json:"their_avg_seconds"` // 对方的平均回复时间（秒）
	MyMedianSeconds float64 `json:"my_median_seconds"`
	TheirMedianSeconds float64 `json:"their_median_seconds"`
	MyQuickReplies  int     `json:"my_quick_replies"`  // 我 60 秒内回复次数
	TheirQuickReplies int   `json:"their_quick_replies"`
	MySlowReplies   int     `json:"my_slow_replies"`   // 我 1 小时以上回复次数
	TheirSlowReplies int    `json:"their_slow_replies"`
	MyTotalReplies  int     `json:"my_total_replies"`
	TheirTotalReplies int   `json:"their_total_replies"`
	// 按时段统计平均回复秒数（0-23h）
	MyHourlyAvg     [24]float64 `json:"my_hourly_avg"`
	TheirHourlyAvg  [24]float64 `json:"their_hourly_avg"`
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
	InitiationCnt     int64              `json:"initiation_count"`    // 主动发起对话次数（间隔>6h）
	TotalSessions     int64              `json:"total_sessions"`
	ReplyRhythm       *ReplyRhythm       `json:"reply_rhythm,omitempty"`
	DensityCurve      map[string]float64 `json:"density_curve,omitempty"` // "2024-01" → 月均消息间隔（秒）
	IntervalBuckets   map[string]int     `json:"interval_buckets,omitempty"` // "10s"/"1min"/"10min"/"1h"/"6h"/"1d" → 次数
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

// AnalysisParams 分析参数，支持运行时热加载。
type AnalysisParams struct {
	Timezone             string
	LateNightStartHour   int
	LateNightEndHour     int
	SessionGapSeconds    int64
	WorkerCount          int
	LateNightMinMessages int64
	LateNightTopN        int
}

type ContactService struct {
	dbMgr            *db.DBManager
	msgRepo          *repository.MessageRepository
	params           AnalysisParams
	paramsMu         sync.RWMutex
	tz               *time.Location
	segmenter        gse.Segmenter
	segmenterMu      sync.Mutex // 保护 segmenter 不被并发调用（gse 非线程安全）
	cache            []ContactStatsExtended
	global           GlobalStats
	cacheMu          sync.RWMutex
	isIndexing       bool
	isInitialized    bool // 标记初始化是否完成
	// 进度快照（由 performAnalysis 更新，/api/status 读取）
	progressTotal    int    // 本轮总联系人数，0 = 未开始
	progressDone     int    // 已完成联系人数
	progressCurrent  string // 正在处理的联系人 username（显示用）
	progressStart    time.Time
	cancelFn         func() // 中止当前 performAnalysis；未在索引时为 nil
	lastInitErr      string
	groupListCache       []GroupInfo                      // 群聊列表缓存
	groupListReady       bool
	groupDetailCache     map[string]*GroupDetail          // 群聊详情内存缓存（lazy load）
	groupDetailMu        sync.RWMutex
	groupDetailComputing map[string]bool                  // 正在后台计算中的群聊
	groupRelCache        map[string]*RelationshipGraph    // 群聊人物关系缓存
	groupRelComputing    map[string]bool
	anniversaryDetected  []DetectedEvent                  // 纪念日缓存
	anniversaryMilestones []FriendMilestone
	anniversaryCacheDay  string                           // 缓存日期（当天有效）
	anniversaryMu        sync.RWMutex
	filterFrom       int64 // 全局时间范围过滤（Unix 秒，0=不限）
	filterTo         int64
	calendarHeatmap  map[string]int // 全局每日消息量（联系人+群聊），performAnalysis 后可读
	similarityCache  *SimilarityResult // 联系人相似度缓存
	similarityMu     sync.RWMutex
	moneyCache       *MoneyOverview    // 红包转账缓存
	moneyMu          sync.RWMutex
	selfPortraitCache *SelfPortrait    // 个人自画像缓存
	selfPortraitMu    sync.RWMutex
	socialBreadthCache []SocialBreadthPoint // 每日社交广度缓存
	socialBreadthMu    sync.RWMutex
	urlCollectionCache *URLCollectionResult // URL 收藏夹缓存
	urlCollectionMu    sync.RWMutex
	monthlyByUsername  map[string]map[string]MonthBucket // 关系预测用：username -> "YYYY-MM" -> {total, mine}
	monthlyByUserMu    sync.RWMutex
	latencyByUsername  map[string]LatencyStats // 关系预测用：username -> 回复时延统计
	latencyByUserMu    sync.RWMutex
}

// MonthBucket 单月消息桶，用于关系预测的主动占比分析
type MonthBucket struct {
	Total int // 总条数（我+对方）
	Mine  int // 我发的条数
}

// LatencyStats 回复时延统计（关系预测用）
// 秒数；-1 表示样本不足（<5 对转换）
type LatencyStats struct {
	TheirRecentMedSec int // TA 回复我（最近 3 月中位时延）
	TheirPriorMedSec  int // TA 回复我（前 3 月，即 4-6 月前）
	MineRecentMedSec  int // 我回复 TA（最近 3 月）
	MinePriorMedSec   int // 我回复 TA（前 3 月）
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

func NewContactService(mgr *db.DBManager, params AnalysisParams, defaultInitFrom, defaultInitTo int64) *ContactService {
	loc, err := time.LoadLocation(params.Timezone)
	if err != nil {
		log.Printf("[CONFIG] Unknown timezone %q, falling back to Asia/Shanghai: %v", params.Timezone, err)
		loc = time.FixedZone("CST", 8*3600)
	}
	svc := &ContactService{
		dbMgr:            mgr,
		msgRepo:          repository.NewMessageRepository(mgr),
		params:           params,
		tz:               loc,
		groupDetailCache:     make(map[string]*GroupDetail),
		groupDetailComputing: make(map[string]bool),
		groupRelCache:        make(map[string]*RelationshipGraph),
		groupRelComputing:    make(map[string]bool),
	}
	if err := svc.segmenter.LoadDictEmbed(); err != nil {
		log.Printf("[WARN] Failed to load embedded gse dict, falling back: %v", err)
		svc.segmenter.LoadDict()
	}

	// 如果配置了自动初始化时间范围，启动后立即开始索引
	if defaultInitFrom != 0 || defaultInitTo != 0 {
		log.Printf("[CONFIG] Auto-init with from=%d to=%d", defaultInitFrom, defaultInitTo)
		svc.Reinitialize(defaultInitFrom, defaultInitTo)
	}
	return svc
}

// UpdateParams 热加载分析参数。
func (s *ContactService) UpdateParams(p AnalysisParams) {
	s.paramsMu.Lock()
	defer s.paramsMu.Unlock()
	if p.Timezone != s.params.Timezone {
		if loc, err := time.LoadLocation(p.Timezone); err == nil {
			s.tz = loc
		}
	}
	s.params = p
}

// Reinitialize 用新的时间范围重新索引（前端调用）
func (s *ContactService) Reinitialize(from, to int64) {
	// 若已有索引任务在跑，先打断，避免两个 performAnalysis 同时刷新缓存互相覆盖
	s.cacheMu.Lock()
	if s.cancelFn != nil {
		s.cancelFn()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelFn = cancel
	s.filterFrom = from
	s.filterTo = to
	s.isInitialized = false
	s.isIndexing = true
	s.progressTotal = 0
	s.progressDone = 0
	s.progressCurrent = ""
	s.progressStart = time.Now()
	s.lastInitErr = ""
	s.cacheMu.Unlock()

	// 清空群聊缓存
	s.groupDetailMu.Lock()
	s.groupListCache = nil
	s.groupListReady = false
	s.groupDetailCache = make(map[string]*GroupDetail)
	s.groupDetailComputing = make(map[string]bool)
	s.groupRelCache = make(map[string]*RelationshipGraph)
	s.groupRelComputing = make(map[string]bool)
	s.groupDetailMu.Unlock()

	s.similarityMu.Lock()
	s.similarityCache = nil
	s.similarityMu.Unlock()
	s.moneyMu.Lock()
	s.moneyCache = nil
	s.moneyMu.Unlock()
	s.selfPortraitMu.Lock()
	s.selfPortraitCache = nil
	s.selfPortraitMu.Unlock()
	s.socialBreadthMu.Lock()
	s.socialBreadthCache = nil
	s.socialBreadthMu.Unlock()
	s.urlCollectionMu.Lock()
	s.urlCollectionCache = nil
	s.urlCollectionMu.Unlock()

	go func() {
		// panic 兜底：避免 performAnalysis 崩溃后 isInitialized 永远卡在 false，前端转圈无尽头
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[INIT] performAnalysis panic: %v\n%s", r, debug.Stack())
				s.cacheMu.Lock()
				s.isIndexing = false
				s.isInitialized = true // 标记完成，让前端能进入主界面（功能会 503，但至少不卡死）
				s.lastInitErr = fmt.Sprintf("panic: %v", r)
				s.cancelFn = nil
				s.cacheMu.Unlock()
			}
		}()
		log.Printf("[INIT] Reinitializing with from=%d to=%d", from, to)
		s.performAnalysisCtx(ctx)
		s.cacheMu.Lock()
		s.isIndexing = false
		if ctx.Err() != nil {
			// 被取消：不标记 isInitialized=true，前端会回到"未索引"状态，
			// 但 lastInitErr 会告诉它原因，避免死循环重触发索引
			s.isInitialized = false
			s.lastInitErr = "indexing cancelled"
			log.Println("[INIT] Reinitialization cancelled by user.")
		} else {
			s.isInitialized = true
			s.lastInitErr = ""
			log.Println("[INIT] Reinitialization complete.")
		}
		s.cancelFn = nil
		s.cacheMu.Unlock()
	}()
}

func (s *ContactService) fullAnalysisTask() {
	// 首次启动立即执行分析
	log.Println("[INIT] Starting initial data analysis...")
	s.isIndexing = true
	s.performAnalysisCtx(context.Background())
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
		s.performAnalysisCtx(context.Background())
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

func (s *ContactService) performAnalysisCtx(ctx context.Context) {
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
	monthlyByUser := make(map[string]map[string]MonthBucket, len(contacts))    // 关系预测用
	latencyByUser := make(map[string]LatencyStats, len(contacts))              // 关系预测响应时延用
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.params.WorkerCount)

	// 进度：同步到 service 字段（/api/status 读）+ 日志
	log.Printf("[INIT] performAnalysis 开始：%d 个联系人，%d 工作协程", len(contacts), s.params.WorkerCount)
	startedAt := time.Now()
	s.cacheMu.Lock()
	s.progressTotal = len(contacts)
	s.progressDone = 0
	s.progressStart = startedAt
	s.cacheMu.Unlock()
	var done int64
	var doneMu sync.Mutex

	for i := range contacts {
		// 取消信号：每个联系人处理前检查一下，取消后 goroutine 立刻退出不领新任务
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(idx int) {
			defer wg.Done(); sem <- struct{}{}; defer func() { <-sem }()
			if ctx.Err() != nil { // 进入 worker 后再检查一次
				return
			}
			c := contacts[idx]
			s.cacheMu.Lock()
			s.progressCurrent = c.Username
			s.cacheMu.Unlock()
			contactStart := time.Now()
			defer func() {
				elapsed := time.Since(contactStart)
				doneMu.Lock()
				done++
				cur := done
				doneMu.Unlock()
				s.cacheMu.Lock()
				s.progressDone = int(cur)
				s.cacheMu.Unlock()
				// 慢联系人单独打 warn，其它每 50 个汇报一次
				if elapsed > 10*time.Second {
					log.Printf("[INIT] 联系人 %d/%d 处理较慢：%s 耗时 %s", cur, len(contacts), c.Username, elapsed.Round(time.Millisecond))
				} else if cur%50 == 0 || cur == int64(len(contacts)) {
					log.Printf("[INIT] 进度 %d/%d（已用 %s）", cur, len(contacts), time.Since(startedAt).Round(time.Second))
				}
			}()
			tableName := db.GetTableName(c.Username)
			ext := ContactStatsExtended{ContactStats: model.ContactStats{Contact: c}}

			var firstMsgTs int64 = 9999999999
			var globalFirstTs int64 = 9999999999
			var globalLastTs int64 = 0
			var lateNightCnt int64
			typeCounts := make(map[string]int)
			monthly := make(map[string]MonthBucket)
			recentCutoff := time.Now().In(s.tz).AddDate(0, -1, 0)
			var totalTextLen, textCount int64
			// 响应时延收集：最近 6 个月内的 (ts, isMine)，稍后排序算中位时延
			latencyCutoff6 := time.Now().In(s.tz).AddDate(0, -6, 0).Unix()
			latencyCutoff3 := time.Now().In(s.tz).AddDate(0, -3, 0).Unix()
			type tsKind struct {
				ts   int64
				mine bool
			}
			var transitions []tsKind

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
					if h >= s.params.LateNightStartHour && h < s.params.LateNightEndHour { lateNightCnt++ }
					mu.Lock(); globalDaily[dt.Format("2006-01-02")]++; globalHourly[h]++; mu.Unlock()
					mk := dt.Format("2006-01")
					b := monthly[mk]
					b.Total++
					if isMine { b.Mine++ }
					monthly[mk] = b
					if ts >= recentCutoff.Unix() { ext.RecentMonthly++ }
					if ts >= latencyCutoff6 {
						transitions = append(transitions, tsKind{ts, isMine})
					}

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
				ext.FirstMessageTs = globalFirstTs; ext.LastMessageTs = globalLastTs
				for m, b := range monthly {
					if int64(b.Total) > ext.PeakMonthly { ext.PeakMonthly = int64(b.Total); ext.PeakPeriod = m }
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
			if len(monthly) > 0 {
				mu.Lock()
				monthlyByUser[c.Username] = monthly
				mu.Unlock()
			}
			// 计算响应时延（对多个 message_N.db 合并后再排序）
			if len(transitions) >= 4 {
				sort.Slice(transitions, func(i, j int) bool { return transitions[i].ts < transitions[j].ts })
				var theirRecent, theirPrior, mineRecent, minePrior []int
				for i := 1; i < len(transitions); i++ {
					a, b := transitions[i-1], transitions[i]
					if a.mine == b.mine {
						continue // 同一方连续发言，不算响应
					}
					delay := int(b.ts - a.ts)
					if delay <= 0 || delay > 86400*3 {
						continue // 超过 3 天视为非直接响应
					}
					// delay 归属于 b（回复者）所在的窗口
					bucket := &theirPrior
					if b.mine {
						// 我回复 TA
						if b.ts >= latencyCutoff3 {
							bucket = &mineRecent
						} else {
							bucket = &minePrior
						}
					} else {
						// TA 回复我
						if b.ts >= latencyCutoff3 {
							bucket = &theirRecent
						} else {
							bucket = &theirPrior
						}
					}
					*bucket = append(*bucket, delay)
				}
				stats := LatencyStats{
					TheirRecentMedSec: medianOr(theirRecent, 5, -1),
					TheirPriorMedSec:  medianOr(theirPrior, 5, -1),
					MineRecentMedSec:  medianOr(mineRecent, 5, -1),
					MinePriorMedSec:   medianOr(minePrior, 5, -1),
				}
				if stats.TheirRecentMedSec != -1 || stats.TheirPriorMedSec != -1 ||
					stats.MineRecentMedSec != -1 || stats.MinePriorMedSec != -1 {
					mu.Lock()
					latencyByUser[c.Username] = stats
					mu.Unlock()
				}
			}
		}(i)
	}
	wg.Wait()

	s.monthlyByUserMu.Lock()
	s.monthlyByUsername = monthlyByUser
	s.monthlyByUserMu.Unlock()

	s.latencyByUserMu.Lock()
	s.latencyByUsername = latencyByUser
	s.latencyByUserMu.Unlock()

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
		if e.totalMessages < s.params.LateNightMinMessages || e.lateNightCount == 0 { continue }
		ratio := float64(e.lateNightCount) / float64(e.totalMessages) * 100
		lateNightRanking = append(lateNightRanking, LateNightEntry{
			Name: e.name, LateNightCount: e.lateNightCount, TotalMessages: e.totalMessages, Ratio: ratio,
		})
		if len(lateNightRanking) >= s.params.LateNightTopN { break }
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
	sem := make(chan struct{}, s.params.WorkerCount)

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
					if h >= s.params.LateNightStartHour && h < s.params.LateNightEndHour { lateNightCnt++ }
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
				ext.FirstMessageTs = globalFirstTs; ext.LastMessageTs = globalLastTs
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
		if e.totalMessages < s.params.LateNightMinMessages || e.lateNightCount == 0 { continue }
		ratio := float64(e.lateNightCount) / float64(e.totalMessages) * 100
		lateNightRanking = append(lateNightRanking, LateNightEntry{
			Name: e.name, LateNightCount: e.lateNightCount, TotalMessages: e.totalMessages, Ratio: ratio,
		})
		if len(lateNightRanking) >= s.params.LateNightTopN { break }
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
	var prevIsMine bool
	var prevMsgTs int64
	// 密度曲线：按月统计消息间隔
	type monthInterval struct {
		totalSec int64
		count    int
	}
	densityMonthly := make(map[string]*monthInterval)
	var densityPrevTs int64
	// 间隔分布桶: 10s / 1min / 10min / 1h / 6h / 1d
	intervalBuckets := map[string]int{"10s": 0, "1min": 0, "10min": 0, "1h": 0, "6h": 0, "1d": 0}
	var myReplyDelays []int64   // 我的回复间隔（秒）
	var theirReplyDelays []int64 // 对方的回复间隔（秒）
	type hourlyDelay struct {
		total int64
		count int
	}
	myHourly := [24]hourlyDelay{}
	theirHourly := [24]hourlyDelay{}

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

			// 密度曲线：记录消息间隔（排除超过 24h 的间隔，避免非活跃时段拉高均值）
			if densityPrevTs > 0 {
				gap := ts - densityPrevTs
				if gap > 0 {
					if gap <= 86400 {
						mi := densityMonthly[month]
						if mi == nil {
							mi = &monthInterval{}
							densityMonthly[month] = mi
						}
						mi.totalSec += gap
						mi.count++
					}
					// 间隔分布桶
					switch {
					case gap <= 10:
						intervalBuckets["10s"]++
					case gap <= 60:
						intervalBuckets["1min"]++
					case gap <= 600:
						intervalBuckets["10min"]++
					case gap <= 3600:
						intervalBuckets["1h"]++
					case gap <= 21600:
						intervalBuckets["6h"]++
					default:
						intervalBuckets["1d"]++
					}
				}
			}
			densityPrevTs = ts

			detail.HourlyDist[h]++
			detail.WeeklyDist[w]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++
			if isMineMsg {
				detail.MyMonthlyTrend[month]++
			} else {
				detail.TheirMonthlyTrend[month]++
			}

			if h >= s.params.LateNightStartHour && h < s.params.LateNightEndHour { detail.LateNightCount++ }

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

			// 回复节奏：发送方切换时记录回复间隔（限 6 小时内，排除新对话）
			if prevMsgTs > 0 && prevIsMine != isMineMsg {
				delay := ts - prevMsgTs
				if delay > 0 && delay <= 21600 { // <= 6h 才算回复
					if isMineMsg {
						myReplyDelays = append(myReplyDelays, delay)
						myHourly[h] = hourlyDelay{myHourly[h].total + delay, myHourly[h].count + 1}
					} else {
						theirReplyDelays = append(theirReplyDelays, delay)
						theirHourly[h] = hourlyDelay{theirHourly[h].total + delay, theirHourly[h].count + 1}
					}
				}
			}
			prevMsgTs = ts
			prevIsMine = isMineMsg

			// 新对话段：与上条消息间隔 > session_gap_seconds
			if prevTs == 0 || ts-prevTs > s.params.SessionGapSeconds {
				detail.TotalSessions++
				if isMineMsg {
					detail.InitiationCnt++
				}
			}
			prevTs = ts
		}
		rows.Close()
	}
	// 计算回复节奏统计
	if len(myReplyDelays) > 0 || len(theirReplyDelays) > 0 {
		rr := &ReplyRhythm{
			MyTotalReplies:    len(myReplyDelays),
			TheirTotalReplies: len(theirReplyDelays),
		}
		calcStats := func(delays []int64) (avg, median float64, quick, slow int) {
			if len(delays) == 0 {
				return
			}
			var sum int64
			for _, d := range delays {
				sum += d
				if d <= 60 {
					quick++
				} else if d >= 3600 {
					slow++
				}
			}
			avg = float64(sum) / float64(len(delays))
			sorted := make([]int64, len(delays))
			copy(sorted, delays)
			sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
			median = float64(sorted[len(sorted)/2])
			return
		}
		rr.MyAvgSeconds, rr.MyMedianSeconds, rr.MyQuickReplies, rr.MySlowReplies = calcStats(myReplyDelays)
		rr.TheirAvgSeconds, rr.TheirMedianSeconds, rr.TheirQuickReplies, rr.TheirSlowReplies = calcStats(theirReplyDelays)
		for h := 0; h < 24; h++ {
			if myHourly[h].count > 0 {
				rr.MyHourlyAvg[h] = float64(myHourly[h].total) / float64(myHourly[h].count)
			}
			if theirHourly[h].count > 0 {
				rr.TheirHourlyAvg[h] = float64(theirHourly[h].total) / float64(theirHourly[h].count)
			}
		}
		detail.ReplyRhythm = rr
	}

	// 密度曲线：月均消息间隔
	if len(densityMonthly) > 0 {
		dc := make(map[string]float64, len(densityMonthly))
		for m, mi := range densityMonthly {
			if mi.count > 0 {
				dc[m] = float64(mi.totalSec) / float64(mi.count)
			}
		}
		detail.DensityCurve = dc
	}

	// 间隔分布直方图
	detail.IntervalBuckets = intervalBuckets

	return detail
}

// ─── URL 收藏夹 ─────────────────────────────────────────────────────────────

// URLEntry 一条 URL 记录
type URLEntry struct {
	URL      string `json:"url"`
	Domain   string `json:"domain"`
	Time     string `json:"time"`     // "2024-03-15 14:23"
	Contact  string `json:"contact"`  // 来源联系人显示名
	Username string `json:"username"` // 来源联系人 wxid
	IsMine   bool   `json:"is_mine"`
	Context  string `json:"context"`  // 消息原文前 120 字符
}

// URLCollectionResult URL 收藏夹结果
type URLCollectionResult struct {
	Total   int                `json:"total"`
	Domains map[string]int     `json:"domains"` // 域名 → 次数
	URLs    []URLEntry         `json:"urls"`
}

var urlRe = regexp.MustCompile(`https?://[^\s<>"'\x{3000}-\x{303F}\x{FF00}-\x{FFEF}]+`)

// GetURLCollection 扫描所有联系人的文本消息，提取所有 URL
func (s *ContactService) GetURLCollection() *URLCollectionResult {
	s.urlCollectionMu.RLock()
	if s.urlCollectionCache != nil {
		result := s.urlCollectionCache
		s.urlCollectionMu.RUnlock()
		return result
	}
	s.urlCollectionMu.RUnlock()

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	result := &URLCollectionResult{
		Domains: make(map[string]int),
		URLs:    []URLEntry{},
	}
	tw := s.timeWhere()
	whereClause := tw
	if whereClause == "" {
		whereClause = " WHERE local_type=1"
	} else {
		whereClause += " AND local_type=1"
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, c := range stats {
		if c.TotalMessages == 0 {
			continue
		}
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			tableName := db.GetTableName(c.Username)
			name := c.Remark
			if name == "" {
				name = c.Nickname
			}
			if name == "" {
				name = c.Username
			}

			var urls []URLEntry
			domainCount := make(map[string]int)

			for _, mdb := range s.dbMgr.MessageDBs {
				var contactRowID int64 = -1
				mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", c.Username)).Scan(&contactRowID)

				rows, err := mdb.Query(fmt.Sprintf(
					"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s",
					tableName, whereClause))
				if err != nil {
					continue
				}
				for rows.Next() {
					var ts int64
					var rawContent []byte
					var ct, senderID int64
					rows.Scan(&ts, &rawContent, &ct, &senderID)
					content := decodeGroupContent(rawContent, ct)
					if content == "" {
						continue
					}
					matches := urlRe.FindAllString(content, -1)
					if len(matches) == 0 {
						continue
					}
					isMine := contactRowID < 0 || senderID != contactRowID
					timeStr := time.Unix(ts, 0).In(s.tz).Format("2006-01-02 15:04")
					ctxRunes := []rune(content)
					if len(ctxRunes) > 120 {
						content = string(ctxRunes[:120]) + "…"
					}
					for _, u := range matches {
						// 去掉尾部标点
						u = strings.TrimRight(u, ".,;!?)")
						domain := extractDomain(u)
						domainCount[domain]++
						urls = append(urls, URLEntry{
							URL:      u,
							Domain:   domain,
							Time:     timeStr,
							Contact:  name,
							Username: c.Username,
							IsMine:   isMine,
							Context:  content,
						})
					}
				}
				rows.Close()
			}

			if len(urls) == 0 {
				return
			}
			mu.Lock()
			result.URLs = append(result.URLs, urls...)
			for d, n := range domainCount {
				result.Domains[d] += n
			}
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	sort.Slice(result.URLs, func(i, j int) bool { return result.URLs[i].Time > result.URLs[j].Time })
	result.Total = len(result.URLs)

	s.urlCollectionMu.Lock()
	s.urlCollectionCache = result
	s.urlCollectionMu.Unlock()
	return result
}

func extractDomain(url string) string {
	u := strings.TrimPrefix(url, "https://")
	u = strings.TrimPrefix(u, "http://")
	if idx := strings.IndexAny(u, "/?#"); idx >= 0 {
		u = u[:idx]
	}
	return u
}

// ─── 每日社交广度 ───────────────────────────────────────────────────────────

// SocialBreadthPoint 单日社交广度
type SocialBreadthPoint struct {
	Date          string `json:"date"`
	UniqueContacts int    `json:"unique_contacts"`
	TotalMessages  int    `json:"total_messages"`
}

// GetSocialBreadth 返回每日"联系了多少不同的人"时间序列
func (s *ContactService) GetSocialBreadth() []SocialBreadthPoint {
	s.socialBreadthMu.RLock()
	if s.socialBreadthCache != nil {
		result := s.socialBreadthCache
		s.socialBreadthMu.RUnlock()
		return result
	}
	s.socialBreadthMu.RUnlock()

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	// 按天统计: date → set of usernames, and total messages
	dateContacts := make(map[string]map[string]int) // date → username → count

	tw := s.timeWhere()

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, c := range stats {
		if c.TotalMessages == 0 {
			continue
		}
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			tableName := db.GetTableName(c.Username)
			local := make(map[string]int) // date → count

			for _, mdb := range s.dbMgr.MessageDBs {
				rows, err := mdb.Query(fmt.Sprintf(
					"SELECT create_time FROM [%s]%s",
					tableName, tw))
				if err != nil {
					continue
				}
				for rows.Next() {
					var ts int64
					rows.Scan(&ts)
					day := time.Unix(ts, 0).In(s.tz).Format("2006-01-02")
					local[day]++
				}
				rows.Close()
			}

			mu.Lock()
			for day, cnt := range local {
				if dateContacts[day] == nil {
					dateContacts[day] = make(map[string]int)
				}
				dateContacts[day][c.Username] = cnt
			}
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	// 构造结果
	result := make([]SocialBreadthPoint, 0, len(dateContacts))
	for date, contacts := range dateContacts {
		total := 0
		for _, n := range contacts {
			total += n
		}
		result = append(result, SocialBreadthPoint{
			Date:           date,
			UniqueContacts: len(contacts),
			TotalMessages:  total,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Date < result[j].Date })

	s.socialBreadthMu.Lock()
	s.socialBreadthCache = result
	s.socialBreadthMu.Unlock()
	return result
}

// ─── 个人自画像 ─────────────────────────────────────────────────────────────

// SelfPortrait 个人自画像统计
type SelfPortrait struct {
	TotalSent         int64              `json:"total_sent"`            // 我发出的消息总数
	TotalChars        int64              `json:"total_chars"`           // 我发出的总字数
	AvgMsgLen         float64            `json:"avg_msg_len"`           // 平均消息长度
	HourlyDist        [24]int            `json:"hourly_dist"`           // 我的小时分布
	WeeklyDist        [7]int             `json:"weekly_dist"`           // 我的周分布
	InitiationCount   int64              `json:"initiation_count"`      // 主动发起次数
	TotalContacts     int                `json:"total_contacts"`        // 我主动发过消息的人数
	TopActiveHour     int                `json:"top_active_hour"`       // 最活跃的小时
	TopActiveWeekday  int                `json:"top_active_weekday"`    // 最活跃的星期
	MostContactedName string             `json:"most_contacted_name"`   // 最常联系的人
	MostContactedCount int64             `json:"most_contacted_count"`
}

// GetSelfPortrait 聚合"我"方向的消息数据，生成个人自画像
func (s *ContactService) GetSelfPortrait() *SelfPortrait {
	s.selfPortraitMu.RLock()
	if s.selfPortraitCache != nil {
		result := s.selfPortraitCache
		s.selfPortraitMu.RUnlock()
		return result
	}
	s.selfPortraitMu.RUnlock()

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	portrait := &SelfPortrait{}

	tw := s.timeWhere()
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	type contactSent struct {
		name  string
		count int64
	}
	var perContact []contactSent

	for _, c := range stats {
		if c.TotalMessages == 0 {
			continue
		}
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			tableName := db.GetTableName(c.Username)
			var sent int64
			var chars int64
			hourly := [24]int{}
			weekly := [7]int{}

			for _, mdb := range s.dbMgr.MessageDBs {
				var contactRowID int64 = -1
				mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", c.Username)).Scan(&contactRowID)

				rows, err := mdb.Query(fmt.Sprintf(
					"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s",
					tableName, tw))
				if err != nil {
					continue
				}
				for rows.Next() {
					var ts int64
					var lt int
					var rawContent []byte
					var ct, senderID int64
					rows.Scan(&ts, &lt, &rawContent, &ct, &senderID)
					isMine := contactRowID < 0 || senderID != contactRowID
					if !isMine {
						continue
					}
					sent++
					if lt == 1 {
						content := decodeGroupContent(rawContent, ct)
						chars += int64(len([]rune(content)))
					}
					dt := time.Unix(ts, 0).In(s.tz)
					hourly[dt.Hour()]++
					weekly[int(dt.Weekday())]++
				}
				rows.Close()
			}

			if sent == 0 {
				return
			}
			name := c.Remark
			if name == "" {
				name = c.Nickname
			}
			if name == "" {
				name = c.Username
			}

			mu.Lock()
			portrait.TotalSent += sent
			portrait.TotalChars += chars
			for h := 0; h < 24; h++ {
				portrait.HourlyDist[h] += hourly[h]
			}
			for w := 0; w < 7; w++ {
				portrait.WeeklyDist[w] += weekly[w]
			}
			perContact = append(perContact, contactSent{name: name, count: sent})
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	portrait.TotalContacts = len(perContact)
	if portrait.TotalSent > 0 {
		portrait.AvgMsgLen = float64(portrait.TotalChars) / float64(portrait.TotalSent)
	}

	// 最活跃小时
	maxHour := 0
	for h := 1; h < 24; h++ {
		if portrait.HourlyDist[h] > portrait.HourlyDist[maxHour] {
			maxHour = h
		}
	}
	portrait.TopActiveHour = maxHour

	// 最活跃星期
	maxWeek := 0
	for w := 1; w < 7; w++ {
		if portrait.WeeklyDist[w] > portrait.WeeklyDist[maxWeek] {
			maxWeek = w
		}
	}
	portrait.TopActiveWeekday = maxWeek

	// 最常联系的人
	sort.Slice(perContact, func(i, j int) bool { return perContact[i].count > perContact[j].count })
	if len(perContact) > 0 {
		portrait.MostContactedName = perContact[0].name
		portrait.MostContactedCount = perContact[0].count
	}

	s.selfPortraitMu.Lock()
	s.selfPortraitCache = portrait
	s.selfPortraitMu.Unlock()
	return portrait
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

// ExportGroupMessagesRecent 只导出群聊最近 limit 条消息（高效：只从尾部取，不加载全量）
func (s *ContactService) ExportGroupMessagesRecent(username string, limit int) []GroupChatMessage {
	if limit <= 0 {
		limit = 1000
	}
	return s.exportGroupMessages(username, 0, 0, limit)
}

func (s *ContactService) exportGroupMessages(username string, from, to int64, limit int) []GroupChatMessage {
	tableName := db.GetTableName(username)
	tw := exportTimeWhere(from, to, s.timeWhere())

	nameMap := s.loadContactNameMap()
	avatarMap := s.loadContactAvatarMap()
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
				Date:      t.Format("2006-01-02"),
				Time:      t.Format("15:04"),
				Speaker:   speaker,
				Content:   content,
				IsMine:    false,
				Type:      lt,
				AvatarURL: avatarMap[speakerWxid],
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

// ─── 秘语雷达（per-contact TF-IDF）────────────────────────────────────────
// 目标：找出"你和 TA 聊得比跟任何人都多的词" —— 私密梗 / 昵称 / 共同人物 / 内部术语。
// 口径：
//   tf(w, c)   = 该词在当前联系人词云里的 count
//   df(w)      = 词出现在多少个"活跃联系人"的 Top 词云里（只看消息量 Top 50 的联系人，
//                避免 O(全量联系人 × 分词)，同时保证 df 的基数稳定）
//   score      = tf · log((N + 1) / (1 + df))
// 结果按 score 降序取 Top 5；用户视觉上就是"只有我和 TA 特别爱说的词"。

// SecretWord 一个"秘语"词条
type SecretWord struct {
	Word    string  `json:"word"`
	Count   int     `json:"count"`   // tf
	DF      int     `json:"df"`      // 多少个活跃联系人的词云里也有
	Score   float64 `json:"score"`   // TF-IDF 分
}

// secretWordsDocFreq 全局文档频率缓存；1 小时刷一次。
// 第一次调用会同步扫描 Top 50 活跃联系人的词云（可能需要几秒到几十秒），后续命中走缓存。
type secretWordsDF struct {
	df     map[string]int
	docN   int // 参与统计的联系人数 N
	builtAt time.Time
}

var (
	secretDFMu    sync.RWMutex
	secretDFCache *secretWordsDF
)

// buildSecretWordsDF 扫描 Top 50 活跃联系人的词云，构建全局 DF 表。
// 同步执行（调用方决定是否放到 goroutine 里）。
func (s *ContactService) buildSecretWordsDF() *secretWordsDF {
	s.cacheMu.RLock()
	type cc struct {
		username string
		msgs     int64
	}
	cs := make([]cc, 0, len(s.cache))
	for _, c := range s.cache {
		if c.TotalMessages >= 50 {
			cs = append(cs, cc{c.Username, c.TotalMessages})
		}
	}
	s.cacheMu.RUnlock()
	sort.Slice(cs, func(i, j int) bool { return cs[i].msgs > cs[j].msgs })
	if len(cs) > 50 {
		cs = cs[:50]
	}
	df := make(map[string]int)
	for _, c := range cs {
		wc := s.GetWordCloud(c.username, false) // 只看对方发的词
		for _, w := range wc {
			df[w.Word]++
		}
	}
	return &secretWordsDF{df: df, docN: len(cs), builtAt: time.Now()}
}

// GetSecretWords 返回某联系人的"秘语"Top N（默认 5）。
func (s *ContactService) GetSecretWords(username string, topN int) []SecretWord {
	if topN <= 0 {
		topN = 5
	}

	// 取/建 全局 DF 缓存
	secretDFMu.RLock()
	cache := secretDFCache
	fresh := cache != nil && time.Since(cache.builtAt) < time.Hour
	secretDFMu.RUnlock()
	if !fresh {
		built := s.buildSecretWordsDF()
		secretDFMu.Lock()
		secretDFCache = built
		cache = built
		secretDFMu.Unlock()
	}

	// 该联系人的词云
	my := s.GetWordCloud(username, false)
	if len(my) == 0 || cache.docN == 0 {
		return []SecretWord{}
	}

	logN := math.Log(float64(cache.docN + 1))
	result := make([]SecretWord, 0, len(my))
	for _, w := range my {
		df := cache.df[w.Word]
		// 在所有 50 个里都出现的词（df ≈ N）就不是秘语了；log 对数自然处理
		idf := logN - math.Log(float64(1+df))
		if idf <= 0 {
			continue
		}
		result = append(result, SecretWord{
			Word:  w.Word,
			Count: w.Count,
			DF:    df,
			Score: float64(w.Count) * idf,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Score > result[j].Score })
	if len(result) > topN {
		result = result[:topN]
	}
	return result
}

// ─── 联系人相似度分析（谁最像谁）─────────────────────────────────────────────

// SimilarityPair 两个联系人之间的相似度
type SimilarityPair struct {
	User1       string  `json:"user1"`
	Name1       string  `json:"name1"`
	Avatar1     string  `json:"avatar1"`
	User2       string  `json:"user2"`
	Name2       string  `json:"name2"`
	Avatar2     string  `json:"avatar2"`
	Score       float64 `json:"score"`       // 0~1
	TopShared   []string `json:"top_shared"` // 共同高频词 Top5
}

// SimilarityResult 完整结果
type SimilarityResult struct {
	Pairs []SimilarityPair `json:"pairs"`
	Total int              `json:"total"` // 参与对比的联系人数
}

// GetContactSimilarity 基于聊天风格特征计算联系人间相似度，返回最相似的 Top N 对。
// 特征向量：消息类型分布(归一化) + 平均消息长度(归一化) + 24h 活跃分布(归一化)
func (s *ContactService) GetContactSimilarity(topN int) *SimilarityResult {
	s.similarityMu.RLock()
	if s.similarityCache != nil {
		result := s.similarityCache
		s.similarityMu.RUnlock()
		return result
	}
	s.similarityMu.RUnlock()

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	if len(stats) < 2 {
		return &SimilarityResult{Pairs: []SimilarityPair{}, Total: 0}
	}

	// 只对消息量 >= 50 的联系人做对比，否则统计不可靠
	var candidates []ContactStatsExtended
	for _, st := range stats {
		if st.TotalMessages >= 50 {
			candidates = append(candidates, st)
		}
	}
	if len(candidates) < 2 {
		return &SimilarityResult{Pairs: []SimilarityPair{}, Total: 0}
	}
	// 最多取 Top 100 个联系人（避免 O(n^2) 爆炸）
	if len(candidates) > 100 {
		candidates = candidates[:100]
	}

	// 构建特征向量
	type featureVec struct {
		vec  []float64
		words map[string]int // 高频词（用于计算共同词）
	}
	features := make([]featureVec, len(candidates))

	// 消息类型列表（固定顺序）
	typeKeys := []string{"文本", "图片", "语音", "视频", "表情", "红包", "转账", "链接/文件", "小程序", "引用", "名片", "位置", "通话", "视频号", "其他"}

	// 预计算 24h 活跃分布（需要查 detail，但太慢了，这里用 type + avgLen 就够）
	// 实际使用消息类型分布（15维）+ avgMsgLen（1维）+ emoji比例（1维）+ 主被动比（用 my/their 比例, 1维）= 18维
	maxAvgLen := 1.0
	for _, c := range candidates {
		if c.AvgMsgLen > maxAvgLen {
			maxAvgLen = c.AvgMsgLen
		}
	}

	for i, c := range candidates {
		vec := make([]float64, 0, 18)

		// 消息类型分布（归一化百分比 → 0~1）
		for _, tk := range typeKeys {
			vec = append(vec, c.TypePct[tk]/100.0)
		}

		// 平均消息长度（归一化）
		vec = append(vec, c.AvgMsgLen/maxAvgLen)

		// Emoji 比例
		if c.TotalMessages > 0 {
			vec = append(vec, float64(c.EmojiCnt)/float64(c.TotalMessages))
		} else {
			vec = append(vec, 0)
		}

		// 主被动比（对方消息占比）
		if c.TotalMessages > 0 {
			vec = append(vec, float64(c.TheirMessages)/float64(c.TotalMessages))
		} else {
			vec = append(vec, 0.5)
		}

		features[i] = featureVec{vec: vec}
	}

	// 并行获取 Top 词（用于共同词展示）
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, c := range candidates {
		wg.Add(1)
		go func(idx int, username string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			wc := s.GetWordCloud(username, false)
			wm := make(map[string]int, len(wc))
			for _, w := range wc {
				wm[w.Word] = w.Count
			}
			features[idx].words = wm
		}(i, c.Username)
	}
	wg.Wait()

	// 计算所有对的余弦相似度
	type scoredPair struct {
		i, j  int
		score float64
	}
	var pairs []scoredPair
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			score := cosineSimFloat64(features[i].vec, features[j].vec)
			pairs = append(pairs, scoredPair{i, j, score})
		}
	}
	sort.Slice(pairs, func(a, b int) bool { return pairs[a].score > pairs[b].score })

	if topN <= 0 {
		topN = 20
	}
	if len(pairs) > topN {
		pairs = pairs[:topN]
	}

	result := make([]SimilarityPair, 0, len(pairs))
	for _, p := range pairs {
		c1, c2 := candidates[p.i], candidates[p.j]
		name1 := c1.Remark
		if name1 == "" { name1 = c1.Nickname }
		name2 := c2.Remark
		if name2 == "" { name2 = c2.Nickname }

		// 共同高频词 Top5
		var shared []string
		if features[p.i].words != nil && features[p.j].words != nil {
			type sharedWord struct {
				word  string
				score int
			}
			var sw []sharedWord
			for w, cnt1 := range features[p.i].words {
				if cnt2, ok := features[p.j].words[w]; ok {
					sw = append(sw, sharedWord{w, cnt1 + cnt2})
				}
			}
			sort.Slice(sw, func(a, b int) bool { return sw[a].score > sw[b].score })
			for k := 0; k < len(sw) && k < 5; k++ {
				shared = append(shared, sw[k].word)
			}
		}

		result = append(result, SimilarityPair{
			User1: c1.Username, Name1: name1, Avatar1: c1.SmallHeadURL,
			User2: c2.Username, Name2: name2, Avatar2: c2.SmallHeadURL,
			Score: math.Round(p.score*1000) / 1000,
			TopShared: shared,
		})
	}

	sr := &SimilarityResult{Pairs: result, Total: len(candidates)}
	s.similarityMu.Lock()
	s.similarityCache = sr
	s.similarityMu.Unlock()
	return sr
}

func cosineSimFloat64(a, b []float64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// ─── 红包/转账全局总览 ───────────────────────────────────────────────────────

// MoneyContactStat 单个联系人的红包转账统计
type MoneyContactStat struct {
	Username     string `json:"username"`
	Name         string `json:"name"`
	Avatar       string `json:"avatar"`
	SentRedPacket   int `json:"sent_red_packet"`   // 我发出红包
	RecvRedPacket   int `json:"recv_red_packet"`   // 我收到红包
	SentTransfer    int `json:"sent_transfer"`     // 我发出转账
	RecvTransfer    int `json:"recv_transfer"`     // 我收到转账
	Total           int `json:"total"`
}

// MoneyOverview 全局红包转账总览
type MoneyOverview struct {
	TotalRedPacket    int                `json:"total_red_packet"`
	TotalTransfer     int                `json:"total_transfer"`
	TotalSent         int                `json:"total_sent"`         // 我发出的总数
	TotalRecv         int                `json:"total_recv"`         // 我收到的总数
	MonthlyTrend      map[string][2]int  `json:"monthly_trend"`     // "2024-01" → [sent, recv]
	Contacts          []MoneyContactStat `json:"contacts"`          // 按 total 排序
}

// GetMoneyOverview 遍历有红包/转账记录的联系人，聚合全局统计
func (s *ContactService) GetMoneyOverview() *MoneyOverview {
	s.moneyMu.RLock()
	if s.moneyCache != nil {
		result := s.moneyCache
		s.moneyMu.RUnlock()
		return result
	}
	s.moneyMu.RUnlock()

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	// 找出有红包转账的联系人
	var candidates []ContactStatsExtended
	for _, st := range stats {
		if st.MoneyCount > 0 {
			candidates = append(candidates, st)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].MoneyCount > candidates[j].MoneyCount })

	overview := &MoneyOverview{
		MonthlyTrend: make(map[string][2]int),
		Contacts:     []MoneyContactStat{},
	}

	tw := s.timeWhere()
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, c := range candidates {
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			tableName := db.GetTableName(c.Username)
			whereClause := tw

			var sentRP, recvRP, sentTF, recvTF int
			monthly := make(map[string][2]int)

			for _, mdb := range s.dbMgr.MessageDBs {
				var contactRowID int64 = -1
				mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", c.Username)).Scan(&contactRowID)

				rows, err := mdb.Query(fmt.Sprintf(
					"SELECT create_time, local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) FROM [%s]%s",
					tableName, whereClause))
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
					typeName := classifyMsgType(lt, content)
					if typeName != "红包" && typeName != "转账" {
						continue
					}
					isMine := contactRowID < 0 || senderID != contactRowID
					month := time.Unix(ts, 0).In(s.tz).Format("2006-01")

					if typeName == "红包" {
						if isMine {
							sentRP++
						} else {
							recvRP++
						}
					} else {
						if isMine {
							sentTF++
						} else {
							recvTF++
						}
					}
					m := monthly[month]
					if isMine {
						m[0]++
					} else {
						m[1]++
					}
					monthly[month] = m
				}
				rows.Close()
			}

			total := sentRP + recvRP + sentTF + recvTF
			if total == 0 {
				return
			}
			name := c.Remark
			if name == "" {
				name = c.Nickname
			}

			mu.Lock()
			overview.TotalRedPacket += sentRP + recvRP
			overview.TotalTransfer += sentTF + recvTF
			overview.TotalSent += sentRP + sentTF
			overview.TotalRecv += recvRP + recvTF
			for m, v := range monthly {
				cur := overview.MonthlyTrend[m]
				cur[0] += v[0]
				cur[1] += v[1]
				overview.MonthlyTrend[m] = cur
			}
			overview.Contacts = append(overview.Contacts, MoneyContactStat{
				Username: c.Username, Name: name, Avatar: c.SmallHeadURL,
				SentRedPacket: sentRP, RecvRedPacket: recvRP,
				SentTransfer: sentTF, RecvTransfer: recvTF,
				Total: total,
			})
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	sort.Slice(overview.Contacts, func(i, j int) bool {
		return overview.Contacts[i].Total > overview.Contacts[j].Total
	})

	s.moneyMu.Lock()
	s.moneyCache = overview
	s.moneyMu.Unlock()
	return overview
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
	status := map[string]interface{}{
		"is_indexing":    s.isIndexing,
		"is_initialized": s.isInitialized,
		"total_cached":   len(s.cache),
	}
	if s.isIndexing && s.progressTotal > 0 {
		elapsedMs := time.Since(s.progressStart).Milliseconds()
		status["progress"] = map[string]interface{}{
			"done":            s.progressDone,
			"total":           s.progressTotal,
			"current_contact": s.progressCurrent,
			"elapsed_ms":      elapsedMs,
		}
	}
	if s.lastInitErr != "" {
		status["last_error"] = s.lastInitErr
	}
	return status
}

// CancelIndexing 请求中止当前正在进行的 performAnalysis；等待 goroutine 退出后返回。
// 非索引状态下调用是 no-op。
func (s *ContactService) CancelIndexing() bool {
	s.cacheMu.Lock()
	fn := s.cancelFn
	s.cacheMu.Unlock()
	if fn == nil {
		return false
	}
	fn()
	return true
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
	FirstMessage   string `json:"first_message_time"`
	LastMessage    string `json:"last_message_time"`
	FirstMessageTs int64  `json:"first_message_ts,omitempty"`
	LastMessageTs  int64  `json:"last_message_ts,omitempty"`

	// 我在这个群的维度
	MyMessages      int64 `json:"my_messages"`                  // 我的发言数（全类型）
	MyRank          int   `json:"my_rank"`                      // 排名（1-based，0=未发言）
	MyLastMessageTs int64 `json:"my_last_message_ts,omitempty"` // 我上次发言 Unix 秒

	// 近期活跃度
	Recent30Days   int64 `json:"recent_30d_messages"` // 近 30 天消息数
	RecentTrendPct int   `json:"recent_trend_pct"`    // 最近 3 月 vs 前 3 月 %（-100..+999，999=新群）
}

type MemberStat struct {
	Speaker          string `json:"speaker"`
	Username         string `json:"username,omitempty"`           // wxid，用于区分同名不同人
	Count            int64  `json:"count"`                        // 所有类型消息数（图片/表情/红包等也算）
	TextCount        int64  `json:"text_count"`                   // 文本消息数（Type==1），Skill 炼化实际可用
	LastMessageTime  string `json:"last_message_time,omitempty"`  // "2024-03-15 14:23"
	FirstMessageTime string `json:"first_message_time,omitempty"` // 首次发言时间（近似加群时间）
	LastMessageTs    int64  `json:"last_message_ts,omitempty"`    // Unix 秒
	FirstMessageTs   int64  `json:"first_message_ts,omitempty"`
}

type GroupDetail struct {
	HourlyDist   [24]int           `json:"hourly_dist"`
	WeeklyDist   [7]int            `json:"weekly_dist"`
	DailyHeatmap map[string]int    `json:"daily_heatmap"`
	MemberRank   []MemberStat      `json:"member_rank"`  // top 500 发言者
	TopWords     []WordCount       `json:"top_words"`    // top 30 高频词
	TypeDist     map[string]int    `json:"type_dist"`    // 消息类型分布（条数）
	MyCPs        []MyCPEntry       `json:"my_cps"`       // 群内跟我引用互动最多的成员 Top 3

	// 7×24 二维热图（星期×小时），用于时钟指纹；比独立 hourly+weekly 更精准
	// weeklyHourlyDist[weekday][hour]，weekday 0=周日
	WeeklyHourlyDist [7][24]int `json:"weekly_hourly_dist"`

	// 群影响力指数：我发言后 30 分钟内有人回应的次数 / 我发言次数
	// GroupReplyRate 是群的基线（任意成员发言后 30 分钟内有人接的比例）
	MyInfluenceScore  int     `json:"my_influence_score"`   // 0-100，-1=样本不足
	MyReplyRate       float64 `json:"my_reply_rate"`        // 我发言后 30 分钟内有回应的比例 0-1
	GroupBaseReplyRate float64 `json:"group_base_reply_rate"` // 群整体基线 0-1
}

// MyCPEntry 群内「我的 CP」—— 跟我引用互动最多的成员
type MyCPEntry struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Replies     int    `json:"replies"` // TA 引用回复我 + 我引用回复 TA 合计
}

// GetGroups 返回所有群聊列表（含消息量），只返回有消息的群
func (s *ContactService) GetGroups() []GroupInfo {
	s.groupDetailMu.Lock()
	if !s.groupListReady {
		s.groupDetailMu.Unlock()
		list := s.loadGroups()
		s.groupDetailMu.Lock()
		s.groupListCache = list
		s.groupListReady = true
	}
	result := s.groupListCache
	s.groupDetailMu.Unlock()
	return result
}

func (s *ContactService) loadGroups() []GroupInfo {
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

	// 先拿 selfWxid，稍后用于计算「我的发言」相关字段
	selfWxid := ""
	if si := s.GetSelfInfo(); si != nil {
		selfWxid = si.Wxid
	}

	// 近期活跃度 cutoff（相对 wall clock，不受用户时间过滤影响）
	nowSec := time.Now().Unix()
	cutoff30 := nowSec - 30*86400
	cutoff3m := nowSec - 90*86400
	cutoff6m := nowSec - 180*86400

	result := make([]GroupInfo, 0, len(groups))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.params.WorkerCount)

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
			// 统计每成员发言数（GROUP BY real_sender_id），替代原 DISTINCT 查询
			// 顺手得到：发言人数、我的发言数/最后发言时间、全员排名分布
			memberCounts := make(map[string]int64)
			var myTotal, myLastTs int64
			groupMemberQuery := "SELECT real_sender_id, COUNT(*), MAX(create_time) FROM [%s] WHERE real_sender_id > 0 GROUP BY real_sender_id"
			if twGroups != "" {
				groupMemberQuery = "SELECT real_sender_id, COUNT(*), MAX(create_time) FROM [%s]" + twGroups + " AND real_sender_id > 0 GROUP BY real_sender_id"
			}
			for _, mdb := range s.dbMgr.MessageDBs {
				id2wxid := make(map[int64]string)
				if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
					for nrows.Next() {
						var rid int64; var uname string
						nrows.Scan(&rid, &uname)
						id2wxid[rid] = uname
					}
					nrows.Close()
				}
				mrows, merr := mdb.Query(fmt.Sprintf(groupMemberQuery, tableName))
				if merr != nil { continue }
				for mrows.Next() {
					var sid, cnt, last int64
					mrows.Scan(&sid, &cnt, &last)
					if wxid, ok := id2wxid[sid]; ok && wxid != "" {
						memberCounts[wxid] += cnt
						if selfWxid != "" && wxid == selfWxid {
							myTotal += cnt
							if last > myLastTs { myLastTs = last }
						}
					}
				}
				mrows.Close()
			}
			// 尝试从 chatroom_member 表获取真实群成员总数
			realMemberCount := 0
			s.dbMgr.ContactDB.QueryRow(
				`SELECT COUNT(*) FROM chatroom_member cm JOIN chat_room cr ON cr.id = cm.room_id WHERE cr.username = ?`,
				g.uname).Scan(&realMemberCount)
			if realMemberCount == 0 {
				realMemberCount = len(memberCounts) // fallback: 用发言人数
			}

			// 我的排名（在 memberCounts 里按 count 降序找 selfWxid 位置）
			myRank := 0
			if myTotal > 0 {
				for _, cnt := range memberCounts {
					if cnt > myTotal {
						myRank++
					}
				}
				myRank++ // 1-based
			}

			// 近期活跃度：30 天 / 最近 3 月 / 前 3 月（不带用户时间过滤，始终相对 wall clock）
			var r30, r3m, p3m int64
			for _, mdb := range s.dbMgr.MessageDBs {
				var v30, v3m, vp3m int64
				err := mdb.QueryRow(fmt.Sprintf(
					"SELECT "+
						"COALESCE(SUM(CASE WHEN create_time >= %d THEN 1 ELSE 0 END), 0), "+
						"COALESCE(SUM(CASE WHEN create_time >= %d THEN 1 ELSE 0 END), 0), "+
						"COALESCE(SUM(CASE WHEN create_time >= %d AND create_time < %d THEN 1 ELSE 0 END), 0) "+
						"FROM [%s]",
					cutoff30, cutoff3m, cutoff6m, cutoff3m, tableName)).Scan(&v30, &v3m, &vp3m)
				if err == nil {
					r30 += v30
					r3m += v3m
					p3m += vp3m
				}
			}
			trendPct := 0
			if p3m > 0 {
				trendPct = int((r3m - p3m) * 100 / p3m)
			} else if r3m > 0 {
				trendPct = 999
			}

			name := g.remark; if name == "" { name = g.nick }; if name == "" { name = g.uname }
			mu.Lock()
			result = append(result, GroupInfo{
				Username: g.uname, Name: name, SmallHeadURL: g.avatar,
				TotalMessages: total, MemberCount: realMemberCount,
				FirstMessage: s.formatTime(firstTs), LastMessage: s.formatTime(lastTs),
				FirstMessageTs: firstTs, LastMessageTs: lastTs,
				MyMessages:      myTotal,
				MyRank:          myRank,
				MyLastMessageTs: myLastTs,
				Recent30Days:    r30,
				RecentTrendPct:  trendPct,
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

// SelfInfo 当前登录微信账号的基本信息（wxid + 头像）
type SelfInfo struct {
	Wxid      string `json:"wxid"`
	AvatarURL string `json:"avatar_url"`
	Nickname  string `json:"nickname"`
}

// GetSelfInfo 从私聊消息的发送者里推断"我"的 wxid，再从联系人表查头像。
// 原理：任何一段私聊都只有 2 个 sender——对方（已知 wxid）和我。取不是对方的那个就是我。
// 结果会被缓存，整个生命周期只算一次。
func (s *ContactService) GetSelfInfo() *SelfInfo {
	s.cacheMu.RLock()
	var sampleUsername string
	for _, c := range s.cache {
		if c.TotalMessages >= 10 && !strings.Contains(c.Username, "@chatroom") {
			sampleUsername = c.Username
			break
		}
	}
	s.cacheMu.RUnlock()
	if sampleUsername == "" {
		return &SelfInfo{}
	}

	tableName := db.GetTableName(sampleUsername)
	for _, mdb := range s.dbMgr.MessageDBs {
		id2wxid := make(map[int64]string)
		rows, err := mdb.Query("SELECT rowid, user_name FROM Name2Id")
		if err != nil {
			continue
		}
		for rows.Next() {
			var rid int64
			var uname string
			rows.Scan(&rid, &uname)
			id2wxid[rid] = uname
		}
		rows.Close()

		senderRows, err := mdb.Query(fmt.Sprintf(
			"SELECT DISTINCT real_sender_id FROM [%s] WHERE real_sender_id > 0 LIMIT 10", tableName))
		if err != nil {
			continue
		}
		var senders []int64
		for senderRows.Next() {
			var sid int64
			senderRows.Scan(&sid)
			senders = append(senders, sid)
		}
		senderRows.Close()
		if len(senders) == 0 {
			continue
		}

		var contactRowID int64 = -1
		for rid, wxid := range id2wxid {
			if wxid == sampleUsername {
				contactRowID = rid
				break
			}
		}

		for _, sid := range senders {
			if sid != contactRowID {
				if myWxid, ok := id2wxid[sid]; ok {
					info := &SelfInfo{Wxid: myWxid}
					s.dbMgr.ContactDB.QueryRow(
						"SELECT COALESCE(small_head_url,''), COALESCE(nick_name,'') FROM contact WHERE username = ?", myWxid,
					).Scan(&info.AvatarURL, &info.Nickname)
					return info
				}
			}
		}
	}
	return &SelfInfo{}
}

// loadContactAvatarMap 从联系人 DB 加载 wxid → small_head_url 映射
func (s *ContactService) loadContactAvatarMap() map[string]string {
	m := make(map[string]string)
	rows, err := s.dbMgr.ContactDB.Query("SELECT username, COALESCE(small_head_url,'') FROM contact WHERE small_head_url != ''")
	if err != nil {
		return m
	}
	defer rows.Close()
	for rows.Next() {
		var uname, url string
		rows.Scan(&uname, &url)
		if url != "" {
			m[uname] = url
		}
	}
	return m
}

// GetAllRoomMemberships 一次扫表拿到全部群成员关系：group_username → 该群所有成员 wxid。
// 给"关系星图"等需要全量两两关系的场景用，避免 N×M 反复扫消息库。
// 注意：返回的是 chatroom_member 表里登记的成员，包含从未发言的人；
// 自己（"我"）不会出现在 contact 表里，因此天然被过滤掉。
func (s *ContactService) GetAllRoomMemberships() map[string][]string {
	out := make(map[string][]string)
	rows, err := s.dbMgr.ContactDB.Query(
		`SELECT cr.username, c.username
		 FROM chatroom_member cm
		 JOIN chat_room cr ON cr.id = cm.room_id
		 JOIN contact c ON c.id = cm.member_id
		 WHERE cr.username LIKE '%@chatroom'`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var groupU, memberU string
		rows.Scan(&groupU, &memberU)
		if groupU == "" || memberU == "" {
			continue
		}
		out[groupU] = append(out[groupU], memberU)
	}
	return out
}

// loadGroupAllMembers 从 chatroom_member 表获取群聊的完整成员列表（wxid → 显示名）
func (s *ContactService) loadGroupAllMembers(groupUsername string, nameMap map[string]string) map[string]string {
	members := make(map[string]string)
	rows, err := s.dbMgr.ContactDB.Query(
		`SELECT c.username, COALESCE(c.remark,''), COALESCE(c.nick_name,'')
		 FROM chatroom_member cm
		 JOIN chat_room cr ON cr.id = cm.room_id
		 JOIN contact c ON c.id = cm.member_id
		 WHERE cr.username = ?`, groupUsername)
	if err != nil {
		return members
	}
	defer rows.Close()
	for rows.Next() {
		var uname, remark, nick string
		rows.Scan(&uname, &remark, &nick)
		name := remark
		if name == "" { name = nick }
		if name == "" {
			if n, ok := nameMap[uname]; ok && n != "" {
				name = n
			} else {
				name = uname
			}
		}
		members[uname] = name
	}
	return members
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
	// 用 wxid 作为 key，避免显示名重复导致的合并
	memberMap := make(map[string]int64)      // wxid → 发言数（全类型）
	memberTextMap := make(map[string]int64)  // wxid → 文本消息数（Type==1），Skill 炼化真正能用的量
	memberLastTs := make(map[string]int64)   // wxid → 最后发言 Unix 时间戳
	memberFirstTs := make(map[string]int64)  // wxid → 首次发言 Unix 时间戳
	memberNames := make(map[string]string)   // wxid → 显示名
	wordCounts := make(map[string]int)

	nameMap := s.loadContactNameMap()

	// 群内「我的 CP」—— 引用消息里直接点名我 / 我点名他的，强信号
	selfWxid := ""
	if si := s.GetSelfInfo(); si != nil {
		selfWxid = si.Wxid
	}
	myCPReplies := make(map[string]int) // otherWxid → 双向引用合计
	myCPReferRe := regexp.MustCompile(`<chatusr>([^<]+)</chatusr>`)
	const myCPMaxRaw = 128 * 1024

	// 影响力指数：扫描阶段先收集 (ts, wxid)，扫完后排序算
	type msgTsKind struct {
		ts   int64
		wxid string
	}
	var influenceSeq []msgTsKind

	twDetail := s.timeWhere()
	var textSamples []string
	// Pass 1: 全量扫描时间分布 + 发言人统计 + 词云文本收集（合并为一次扫描）
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
			detail.WeeklyHourlyDist[int(dt.Weekday())][dt.Hour()]++
			detail.DailyHeatmap[dt.Format("2006-01-02")]++
			typeName := classifyMsgType(lt, content)
			if typeName != "系统" { detail.TypeDist[typeName]++ }
			if wxid, ok := idToWxid[senderID]; ok && wxid != "" {
				memberMap[wxid]++
				if (lt & 0xFFFF) == 1 {
					memberTextMap[wxid]++
				}
				if ts > memberLastTs[wxid] { memberLastTs[wxid] = ts }
				if cur, ok2 := memberFirstTs[wxid]; !ok2 || ts < cur { memberFirstTs[wxid] = ts }
				if _, ok2 := memberNames[wxid]; !ok2 {
					name := wxid
					if n, ok3 := nameMap[wxid]; ok3 && n != "" { name = n }
					memberNames[wxid] = name
				}
				// 影响力：收集时间 + 发言者，扫完后算
				if typeName != "系统" {
					influenceSeq = append(influenceSeq, msgTsKind{ts, wxid})
				}
			}
			// 同时收集纯文本消息用于词云（合并到 Pass 1，避免第二次全表扫描）
			if (lt&0xFFFF) == 1 && content != "" {
				txtForCloud := content
				if idx := strings.Index(txtForCloud, ":\n"); idx > 0 && idx < 80 {
					txtForCloud = txtForCloud[idx+2:]
				}
				if txtForCloud != "" && !s.isSys(txtForCloud) {
					textSamples = append(textSamples, wechatEmojiRe.ReplaceAllString(txtForCloud, ""))
				}
			}
			// 「我的 CP」引用信号：lt=49 且 refermsg 里 chatusr 涉及我
			// 严格限制 rawContent ≤128KB，避免对几 MB 的分享卡片跑 regex（40k 群 hang 教训）
			if selfWxid != "" && (lt&0xFFFF) == 49 && len(rawContent) <= myCPMaxRaw && content != "" && strings.Contains(content, "<refermsg>") {
				if wxid, ok := idToWxid[senderID]; ok && wxid != "" {
					if m := myCPReferRe.FindStringSubmatch(content); len(m) == 2 {
						refWxid := strings.TrimSpace(m[1])
						if refWxid != "" && refWxid != wxid {
							other := ""
							if wxid == selfWxid {
								other = refWxid
							} else if refWxid == selfWxid {
								other = wxid
							}
							if other != "" {
								myCPReplies[other]++
							}
						}
					}
				}
			}
		}
		rows.Close()
	}

	// 词云文本已在 Pass 1 中一次性收集完毕
	// 分批分词（gse 非线程安全，每批 500 条加锁处理后释放，减少阻塞其他 goroutine）
	const segBatch = 500
	for i := 0; i < len(textSamples); i += segBatch {
		end := i + segBatch
		if end > len(textSamples) { end = len(textSamples) }
		s.segmenterMu.Lock()
		for _, text := range textSamples[i:end] {
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
	}

	// 成员排行 top 500（含最后发言时间、首次发言时间）
	for wxid, cnt := range memberMap {
		lastTime := ""
		if ts, ok := memberLastTs[wxid]; ok && ts > 0 {
			lastTime = time.Unix(ts, 0).In(s.tz).Format("2006-01-02 15:04")
		}
		firstTime := ""
		if ts, ok := memberFirstTs[wxid]; ok && ts > 0 {
			firstTime = time.Unix(ts, 0).In(s.tz).Format("2006-01-02 15:04")
		}
		detail.MemberRank = append(detail.MemberRank, MemberStat{
			Speaker:          memberNames[wxid],
			Username:         wxid,
			Count:            cnt,
			TextCount:        memberTextMap[wxid],
			LastMessageTime:  lastTime,
			FirstMessageTime: firstTime,
			LastMessageTs:    memberLastTs[wxid],
			FirstMessageTs:   memberFirstTs[wxid],
		})
	}
	sort.Slice(detail.MemberRank, func(i, j int) bool { return detail.MemberRank[i].Count > detail.MemberRank[j].Count })

	// 从 chatroom_member 表补全零发言成员（wxid → 显示名）
	allMembers := s.loadGroupAllMembers(username, nameMap)
	spokenWxids := make(map[string]bool, len(memberMap))
	for wxid := range memberMap {
		spokenWxids[wxid] = true
	}
	for wxid, displayName := range allMembers {
		if !spokenWxids[wxid] {
			detail.MemberRank = append(detail.MemberRank, MemberStat{
				Speaker:  displayName,
				Username: wxid,
				Count:    0,
			})
			spokenWxids[wxid] = true
		}
	}

	// 高频词 top 30
	for w, c := range wordCounts {
		if utf8.ValidString(w) { detail.TopWords = append(detail.TopWords, WordCount{w, c}) }
	}
	sort.Slice(detail.TopWords, func(i, j int) bool { return detail.TopWords[i].Count > detail.TopWords[j].Count })
	if len(detail.TopWords) > 30 { detail.TopWords = detail.TopWords[:30] }

	// 影响力指数：发言后 30 分钟内有别人回应的比例
	detail.MyInfluenceScore = -1
	if len(influenceSeq) >= 20 {
		sort.Slice(influenceSeq, func(i, j int) bool { return influenceSeq[i].ts < influenceSeq[j].ts })
		const replyWindow int64 = 1800 // 30 分钟
		var myTotal, myReplied int
		var grpTotal, grpReplied int
		for i, m := range influenceSeq {
			// 向后找第一条异于当前发言者且在 30min 内的消息
			hasReply := false
			for j := i + 1; j < len(influenceSeq); j++ {
				if influenceSeq[j].ts-m.ts > replyWindow {
					break
				}
				if influenceSeq[j].wxid != m.wxid {
					hasReply = true
					break
				}
			}
			grpTotal++
			if hasReply {
				grpReplied++
			}
			if selfWxid != "" && m.wxid == selfWxid {
				myTotal++
				if hasReply {
					myReplied++
				}
			}
		}
		if grpTotal > 0 {
			detail.GroupBaseReplyRate = float64(grpReplied) / float64(grpTotal)
		}
		if myTotal >= 5 { // 我的发言 ≥5 条才算影响力
			detail.MyReplyRate = float64(myReplied) / float64(myTotal)
			// Score：我的回应率 / 群基线，封顶 2 倍后映射到 0-100
			ratio := 1.0
			if detail.GroupBaseReplyRate > 0 {
				ratio = detail.MyReplyRate / detail.GroupBaseReplyRate
			}
			if ratio > 2 {
				ratio = 2
			}
			detail.MyInfluenceScore = int(ratio * 50) // 1x = 50，2x = 100
		}
	}

	// 我的群 CP Top 3（按引用双向合计降序；最少 2 次才入选）
	if len(myCPReplies) > 0 {
		type cpTmp struct {
			wxid    string
			replies int
		}
		all := make([]cpTmp, 0, len(myCPReplies))
		for wxid, n := range myCPReplies {
			if n >= 2 {
				all = append(all, cpTmp{wxid, n})
			}
		}
		sort.Slice(all, func(i, j int) bool { return all[i].replies > all[j].replies })
		if len(all) > 3 {
			all = all[:3]
		}
		if len(all) > 0 {
			avatarMap := s.loadContactAvatarMap()
			for _, c := range all {
				name := memberNames[c.wxid]
				if name == "" {
					if n, ok := nameMap[c.wxid]; ok && n != "" {
						name = n
					} else {
						name = c.wxid
					}
				}
				detail.MyCPs = append(detail.MyCPs, MyCPEntry{
					Username:    c.wxid,
					DisplayName: name,
					AvatarURL:   avatarMap[c.wxid],
					Replies:     c.replies,
				})
			}
		}
	}

	// 写入缓存，清除 computing 标记
	s.groupDetailMu.Lock()
	s.groupDetailCache[username] = detail
	delete(s.groupDetailComputing, username)
	s.groupDetailMu.Unlock()
}

// GroupChatMessage 群聊单条消息（含发言者显示名）
type GroupChatMessage struct {
	Time      string `json:"time"`                  // "HH:MM"
	Speaker   string `json:"speaker"`               // 发言者显示名
	Content   string `json:"content"`               // 消息内容
	IsMine    bool   `json:"is_mine"`               // 是否是我发的
	Type      int    `json:"type"`                  // local_type
	Date      string `json:"date,omitempty"`        // "2024-03-15"，搜索结果中使用
	AvatarURL string `json:"avatar_url,omitempty"`  // 发言者头像 URL（有联系人记录时返回）
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
	avatarMap := s.loadContactAvatarMap()

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
				Time:      time.Unix(ts, 0).In(s.tz).Format("15:04"),
				Speaker:   speaker,
				Content:   content,
				IsMine:    false,
				Type:      lt,
				AvatarURL: avatarMap[speakerWxid],
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []GroupChatMessage{}
	}
	return msgs
}

// SearchGroupMessages 在群聊消息中搜索关键词，只匹配文本消息（按时间倒序）。
// speaker 非空时只返回该发言人的消息。
func (s *ContactService) SearchGroupMessages(username, query, speaker string) []GroupChatMessage {
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
	avatarMap := s.loadContactAvatarMap()
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

			speakerName := speakerWxid
			if n, ok := nameMap[speakerWxid]; ok && n != "" {
				speakerName = n
			}
			if speakerName == "" {
				speakerName = "未知"
			}

			// 按发言人过滤
			if speaker != "" && speakerName != speaker && speakerWxid != speaker {
				continue
			}

			t := time.Unix(ts, 0).In(s.tz)
			msgs = append(msgs, GroupChatMessage{
				Time:      t.Format("15:04"),
				Date:      t.Format("2006-01-02"),
				Speaker:   speakerName,
				Content:   content,
				IsMine:    false,
				Type:      1,
				AvatarURL: avatarMap[speakerWxid],
			})
		}
		rows.Close()
	}

	if msgs == nil {
		return []GroupChatMessage{}
	}
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].Date+msgs[i].Time > msgs[j].Date+msgs[j].Time })
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
// ─── 共同社交圈（两个联系人） ─────────────────────────────────────────────────

// CommonCircleGroup 一个共同群 + 其他成员
type CommonCircleGroup struct {
	Username     string   `json:"username"`
	Name         string   `json:"name"`
	SmallHeadURL string   `json:"small_head_url"`
	MemberCount  int      `json:"member_count"`  // 该群总成员数
	OtherMembers []string `json:"other_members"` // 除两人之外的其他成员名
}

// CommonFriend 推测的共同好友（出现在多个共同群中）
type CommonFriend struct {
	Name          string `json:"name"`
	Username      string `json:"username"` // wxid，可能为空
	Avatar        string `json:"avatar,omitempty"`
	IsMyContact   bool   `json:"is_my_contact"` // 是否是我的好友
	GroupCount    int    `json:"group_count"`   // 出现在多少个共同群里
}

// CommonCircleResult 共同社交圈结果
type CommonCircleResult struct {
	User1Name    string               `json:"user1_name"`
	User2Name    string               `json:"user2_name"`
	SharedGroups []CommonCircleGroup  `json:"shared_groups"`
	CommonFriends []CommonFriend      `json:"common_friends"` // 按 group_count 降序
}

// GetCommonCircle 找出两个联系人的共同群和共同好友
func (s *ContactService) GetCommonCircle(user1, user2 string) *CommonCircleResult {
	// 查两个联系人在 contact 表中的 id
	var id1, id2 int64
	s.dbMgr.ContactDB.QueryRow("SELECT id FROM contact WHERE username = ?", user1).Scan(&id1)
	s.dbMgr.ContactDB.QueryRow("SELECT id FROM contact WHERE username = ?", user2).Scan(&id2)
	if id1 == 0 || id2 == 0 {
		return &CommonCircleResult{SharedGroups: []CommonCircleGroup{}, CommonFriends: []CommonFriend{}}
	}

	// 查两人的显示名
	nameMap := s.loadContactNameMap()
	name1 := nameMap[user1]
	name2 := nameMap[user2]

	// 查找两人同时在的所有群（从 chatroom_member 表）
	rows, err := s.dbMgr.ContactDB.Query(`
		SELECT cr.id, cr.username
		FROM chat_room cr
		WHERE EXISTS (SELECT 1 FROM chatroom_member cm WHERE cm.room_id = cr.id AND cm.member_id = ?)
		  AND EXISTS (SELECT 1 FROM chatroom_member cm WHERE cm.room_id = cr.id AND cm.member_id = ?)
	`, id1, id2)
	if err != nil {
		return &CommonCircleResult{
			User1Name: name1, User2Name: name2,
			SharedGroups: []CommonCircleGroup{}, CommonFriends: []CommonFriend{},
		}
	}
	defer rows.Close()

	type roomEntry struct {
		id       int64
		username string
	}
	var rooms []roomEntry
	for rows.Next() {
		var r roomEntry
		rows.Scan(&r.id, &r.username)
		rooms = append(rooms, r)
	}

	// 查所有现有群的元信息（name, avatar）
	groupMeta := make(map[string]struct{ name, avatar string })
	gRows, _ := s.dbMgr.ContactDB.Query(
		`SELECT username, COALESCE(remark,''), COALESCE(nick_name,''), COALESCE(small_head_url,'') FROM contact WHERE username LIKE '%@chatroom'`)
	if gRows != nil {
		for gRows.Next() {
			var uname, remark, nick, avatar string
			gRows.Scan(&uname, &remark, &nick, &avatar)
			name := remark
			if name == "" {
				name = nick
			}
			if name == "" {
				name = uname
			}
			groupMeta[uname] = struct{ name, avatar string }{name, avatar}
		}
		gRows.Close()
	}

	// 查我的所有好友 wxid 集合（判断 is_my_contact）
	myContacts := make(map[string]string) // wxid → avatar
	cRows, _ := s.dbMgr.ContactDB.Query(
		"SELECT username, COALESCE(small_head_url,'') FROM contact WHERE verify_flag=0 AND (flag&3 != 0 OR remark != '')")
	if cRows != nil {
		for cRows.Next() {
			var uname, avatar string
			cRows.Scan(&uname, &avatar)
			myContacts[uname] = avatar
		}
		cRows.Close()
	}

	// 统计每个共同群的成员 + 汇总出现在多个共同群的"共同好友"
	type friendStat struct {
		username string
		avatar   string
		isMine   bool
		count    int
	}
	friendMap := make(map[string]*friendStat) // name → stat

	sharedGroups := make([]CommonCircleGroup, 0, len(rooms))
	for _, r := range rooms {
		// 查该群所有成员
		mRows, err := s.dbMgr.ContactDB.Query(`
			SELECT c.username, COALESCE(c.remark,''), COALESCE(c.nick_name,''), COALESCE(c.small_head_url,'')
			FROM chatroom_member cm
			JOIN contact c ON c.id = cm.member_id
			WHERE cm.room_id = ?
		`, r.id)
		if err != nil {
			continue
		}
		var members []string
		memberCount := 0
		for mRows.Next() {
			var uname, remark, nick, avatar string
			mRows.Scan(&uname, &remark, &nick, &avatar)
			memberCount++
			if uname == user1 || uname == user2 {
				continue
			}
			displayName := remark
			if displayName == "" {
				displayName = nick
			}
			if displayName == "" {
				displayName = uname
			}
			members = append(members, displayName)

			// 累计共同好友出现次数
			stat := friendMap[displayName]
			if stat == nil {
				_, isMine := myContacts[uname]
				stat = &friendStat{username: uname, avatar: avatar, isMine: isMine}
				friendMap[displayName] = stat
			}
			stat.count++
		}
		mRows.Close()

		meta := groupMeta[r.username]
		sharedGroups = append(sharedGroups, CommonCircleGroup{
			Username:     r.username,
			Name:         meta.name,
			SmallHeadURL: meta.avatar,
			MemberCount:  memberCount,
			OtherMembers: members,
		})
	}

	// 排序共同群：按成员数升序（小群更可能是紧密圈子）
	sort.Slice(sharedGroups, func(i, j int) bool {
		return sharedGroups[i].MemberCount < sharedGroups[j].MemberCount
	})

	// 共同好友：按出现次数降序，同次数时好友优先
	commonFriends := make([]CommonFriend, 0, len(friendMap))
	for name, stat := range friendMap {
		commonFriends = append(commonFriends, CommonFriend{
			Name:        name,
			Username:    stat.username,
			Avatar:      stat.avatar,
			IsMyContact: stat.isMine,
			GroupCount:  stat.count,
		})
	}
	sort.Slice(commonFriends, func(i, j int) bool {
		if commonFriends[i].GroupCount != commonFriends[j].GroupCount {
			return commonFriends[i].GroupCount > commonFriends[j].GroupCount
		}
		if commonFriends[i].IsMyContact != commonFriends[j].IsMyContact {
			return commonFriends[i].IsMyContact
		}
		return commonFriends[i].Name < commonFriends[j].Name
	})

	return &CommonCircleResult{
		User1Name:     name1,
		User2Name:     name2,
		SharedGroups:  sharedGroups,
		CommonFriends: commonFriends,
	}
}

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
	now := time.Now().In(s.tz)
	today := now.Format("2006-01-02")

	// 当天缓存命中直接返回
	s.anniversaryMu.RLock()
	if s.anniversaryCacheDay == today && s.anniversaryDetected != nil {
		d, m := s.anniversaryDetected, s.anniversaryMilestones
		s.anniversaryMu.RUnlock()
		return d, m
	}
	s.anniversaryMu.RUnlock()

	s.cacheMu.RLock()
	contacts := s.cache
	s.cacheMu.RUnlock()

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
	// 缓存结果（当天有效）
	s.anniversaryMu.Lock()
	s.anniversaryDetected = detected
	s.anniversaryMilestones = milestones
	s.anniversaryCacheDay = today
	s.anniversaryMu.Unlock()

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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Messages  int64  `json:"messages"`
	Community int    `json:"community"` // 社区编号（Label Propagation 检测）
}

// RelationshipEdge 成员间互动边
type RelationshipEdge struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	Weight   int    `json:"weight"`
	Replies  int    `json:"replies"`
	Mentions int    `json:"mentions"`
}

// CommunityInfo 社区摘要
type CommunityInfo struct {
	ID      int      `json:"id"`
	Members []string `json:"members"`
	Size    int      `json:"size"`
}

// RelationshipGraph 完整关系图
type RelationshipGraph struct {
	Nodes       []RelationshipNode `json:"nodes"`
	Edges       []RelationshipEdge `json:"edges"`
	Communities []CommunityInfo    `json:"communities,omitempty"` // 社区检测结果
	// Modularity 是 Louvain 划分的模块度 Q；< 0.3 视为「没有明显的小圈子」
	// 前端用它决定是否渲染社区列表 / 改用"群内互动较散"的提示
	Modularity float64 `json:"modularity"`
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
	started := time.Now()
	// 兜底：任何 panic 或 early return 都要清掉 computing 标志，否则前端会永远
	// 看到"正在分析"转圈。之前 40k 条消息的群查了半小时没出结果，就是因为
	// 中间某步 panic 没被捕获，standing committing 永远为 true。
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[GROUPREL] %s panic: %v\n%s", username, r, debug.Stack())
		}
		s.groupDetailMu.Lock()
		if _, ok := s.groupRelCache[username]; !ok {
			// panic 或其他原因没写成功 → 放一个空图，让前端拿到"分析失败但已结束"
			s.groupRelCache[username] = &RelationshipGraph{
				Nodes: []RelationshipNode{}, Edges: []RelationshipEdge{},
				Communities: []CommunityInfo{},
			}
		}
		delete(s.groupRelComputing, username)
		s.groupDetailMu.Unlock()
		log.Printf("[GROUPREL] %s 耗时 %.1fs", username, time.Since(started).Seconds())
	}()

	tableName := db.GetTableName(username)
	nameMap := s.loadContactNameMap()
	tw := s.timeWhere()
	log.Printf("[GROUPREL] %s 开始分析，扫描 %d 个 message DB", username, len(s.dbMgr.MessageDBs))

	// 收集所有消息的 (timestamp, senderName, content) 按时间排序。
	// 同时解析 refermsg（局部类型 49 + XML 里 <refermsg>...<chatusr>WXID</chatusr>），
	// 把被引用者的 display name 存进 referTarget —— 这是小圈子里唯一可靠的
	// 「A 在回复 B」信号。老版本那个 120s 滑窗在活跃群里误判极多（午饭高峰
	// 任意两人都会被判成互动），是之前"所有人挤在一个大圈"的主因。
	type msgEntry struct {
		ts          int64
		sender      string // display name
		senderWxid  string // 原始 wxid，用于排除"引用了自己"之类
		content     string
		referTarget string // 被引用者的 display name；为空 = 非引用消息
	}
	var allMsgs []msgEntry
	memberMsgs := make(map[string]int64)

	// 匹配 <chatusr>WXID</chatusr>。WCDB 的 refermsg XML 就这一个字段可靠地标识被引用者。
	referRe := regexp.MustCompile(`<chatusr>([^<]+)</chatusr>`)

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
			if name, ok2 := nameMap[wxid]; ok2 && name != "" {
				speaker = name
			}
			memberMsgs[speaker]++

			content := ""
			var referTarget string
			// 只解文本和 refermsg 需要看的消息类型。大附件类的 lt==49（链接分享、
			// 小程序卡片带大图 base64）动辄几 MB，对每条都跑 strings.Contains + regex
			// 是爆炸性的（40k 条 × 几 MB 文本扫描 = 几十 GB 工作量，之前那个群卡
			// 半小时大概率就是这个原因）。refermsg XML 实际就几百字节，卡到 128KB 原始
			// 的消息肯定不是引用。
			const maxRawBytes = 128 * 1024
			if (lt == 1 || lt == 49) && len(rawContent) <= maxRawBytes {
				content = decodeGroupContent(rawContent, ct)
				if len(content) > 256*1024 {
					// 压缩后膨胀超大也放弃，避免后续扫描爆炸
					content = ""
				} else if lt == 1 {
					// 群聊文本前缀 "wxid:\n"，剥掉后才是真内容
					if idx := strings.Index(content, ":\n"); idx > 0 && idx < 80 {
						content = content[idx+2:]
					}
				} else if lt == 49 && strings.Contains(content, "<refermsg>") {
					if m := referRe.FindStringSubmatch(content); len(m) == 2 {
						refWxid := strings.TrimSpace(m[1])
						if refWxid != "" && refWxid != wxid {
							if name, ok := nameMap[refWxid]; ok && name != "" {
								referTarget = name
							} else {
								referTarget = refWxid
							}
						}
					}
				}
			}
			allMsgs = append(allMsgs, msgEntry{
				ts: ts, sender: speaker, senderWxid: wxid,
				content: content, referTarget: referTarget,
			})
		}
		rows.Close()
	}

	// 按时间排序（跨 DB 合并后可能乱序）
	sort.Slice(allMsgs, func(i, j int) bool { return allMsgs[i].ts < allMsgs[j].ts })
	log.Printf("[GROUPREL] %s 扫描完成：%d 条消息，%d 个成员", username, len(allMsgs), len(memberMsgs))

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

	// 真实引用关系：消息类型 49 且 refermsg.chatusr 是群成员 → 计入 A→B 的回复。
	// 这比原来的"2 分钟窗口"靠谱得多，但在不爱用引用的群里密度会低，正好让
	// 后面的模块度兜底发挥作用（Q<0.3 时告诉用户"该群没有明显小圈子"）。
	for _, m := range allMsgs {
		if m.referTarget != "" && m.referTarget != m.sender && memberNames[m.referTarget] {
			getEdge(m.sender, m.referTarget).replies++
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

	// 自适应阈值：基准 3，并把中位数的 10% 作为下限。
	// 对稀疏群不影响（阈值仍 3），对"人人都有一大堆弱连接"的稠密群能
	// 把底噪刷掉，避免 Louvain 合并时把噪声当成真实聚类。
	allWeights := make([]int, 0, len(edgeMap))
	for _, e := range edgeMap {
		allWeights = append(allWeights, e.replies+e.mentions*2)
	}
	sort.Ints(allWeights)
	threshold := 3
	if n := len(allWeights); n > 0 {
		if adapt := allWeights[n/2] / 10; adapt > threshold {
			threshold = adapt
		}
	}

	// 构建结果（过滤弱关系）
	var edges []RelationshipEdge
	nodeInEdge := make(map[string]bool)
	for k, e := range edgeMap {
		weight := e.replies + e.mentions*2
		if weight < threshold {
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

	log.Printf("[GROUPREL] %s 边过滤完成：阈值 %d，保留 %d 条关系，%d 个节点", username, threshold, len(edges), len(nodes))

	// ── 社区检测（Louvain 单层 + 模块度）──
	// 换掉原来的 Label Propagation：LPA 在稠密图上会塌缩成一个大标签，
	// 这是用户最常抱怨的"所有人都在一个圈里"的根源。Louvain 按模块度收益
	// 决定合并，稀疏/无显著结构的群会直接停在 Q≈0，前端能据此提示"无明显小圈子"。
	modularity := louvainCommunities(nodes, edges)
	log.Printf("[GROUPREL] %s Louvain 完成：模块度 Q=%.3f", username, modularity)

	// 汇总社区信息
	communityMembers := make(map[int][]string)
	for _, n := range nodes {
		communityMembers[n.Community] = append(communityMembers[n.Community], n.Name)
	}
	var communities []CommunityInfo
	for id, members := range communityMembers {
		communities = append(communities, CommunityInfo{ID: id, Members: members, Size: len(members)})
	}
	sort.Slice(communities, func(i, j int) bool { return communities[i].Size > communities[j].Size })

	graph := &RelationshipGraph{Nodes: nodes, Edges: edges, Communities: communities, Modularity: modularity}
	s.groupDetailMu.Lock()
	s.groupRelCache[username] = graph
	delete(s.groupRelComputing, username)
	s.groupDetailMu.Unlock()
}

// louvainCommunities 对节点做单层 Louvain 社区检测，把结果写回 nodes[i].Community，
// 并返回最终划分的模块度 Q。Q ∈ [-0.5, 1]，一般 Q<0.3 即视为"没有清晰的社区结构"。
//
// 实现说明：
//   - 单层（不做图粗化）。规模 ≤200 边、~50 节点的群聊够用；多层版本对噪声图反而更容易
//     合并出假社区，简单版配上模块度下限刚好。
//   - ΔQ 移动准则采用 Blondel 等人的增量公式：先把 i 从当前社区移除，再对每个邻居社区
//     算 ΔQ = k_{i,C}/m - k_i·Σ_C/(2m²)，取最大且 > 0 的那个。
func louvainCommunities(nodes []RelationshipNode, edges []RelationshipEdge) float64 {
	n := len(nodes)
	if n == 0 {
		return 0
	}

	idIdx := make(map[string]int, n)
	for i, nd := range nodes {
		idIdx[nd.ID] = i
		nodes[i].Community = i
	}

	type neighbor struct {
		idx int
		w   int
	}
	adj := make([][]neighbor, n)
	degree := make([]int, n) // 加权度
	var m2 int               // 2m
	for _, e := range edges {
		si, ok1 := idIdx[e.Source]
		ti, ok2 := idIdx[e.Target]
		if !ok1 || !ok2 || si == ti {
			continue
		}
		adj[si] = append(adj[si], neighbor{ti, e.Weight})
		adj[ti] = append(adj[ti], neighbor{si, e.Weight})
		degree[si] += e.Weight
		degree[ti] += e.Weight
		m2 += 2 * e.Weight
	}
	if m2 == 0 {
		return 0
	}
	m := float64(m2) / 2.0

	// commDeg[c] = Σ_{i ∈ c} degree[i]
	commDeg := make(map[int]int, n)
	for i := 0; i < n; i++ {
		commDeg[i] = degree[i]
	}

	order := make([]int, n)
	for i := range order {
		order[i] = i
	}

	// 固定随机种子避免每次结果都跳；用户多次打开同一个群应该看到相同的划分
	rng := rand.New(rand.NewSource(1))

	for iter := 0; iter < 20; iter++ {
		rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		changed := false
		for _, i := range order {
			if len(adj[i]) == 0 {
				continue
			}
			curComm := nodes[i].Community
			ki := degree[i]

			// k_{i,C} : i 到每个邻居社区的边权总和（不含自环）
			kiIn := make(map[int]int, len(adj[i]))
			for _, e := range adj[i] {
				kiIn[nodes[e.idx].Community] += e.w
			}

			// 先把 i 从当前社区拿出
			commDeg[curComm] -= ki

			bestComm := curComm
			bestDelta := 0.0
			for c, kin := range kiIn {
				// ΔQ = k_{i,C}/m - k_i · Σ_C / (2m²)
				delta := float64(kin)/m - float64(ki)*float64(commDeg[c])/(2.0*m*m)
				// 打破并列时倾向编号小的社区，保证收敛稳定
				if delta > bestDelta || (delta == bestDelta && c < bestComm && delta > 0) {
					bestDelta = delta
					bestComm = c
				}
			}

			commDeg[bestComm] += ki
			if bestComm != curComm {
				nodes[i].Community = bestComm
				changed = true
			}
		}
		if !changed {
			break
		}
	}

	// 重新编号社区为连续 0, 1, 2, ...
	labelMap := make(map[int]int)
	nextID := 0
	for i := range nodes {
		if _, ok := labelMap[nodes[i].Community]; !ok {
			labelMap[nodes[i].Community] = nextID
			nextID++
		}
		nodes[i].Community = labelMap[nodes[i].Community]
	}

	// 计算模块度 Q = Σ_c [ L_c/m - (D_c/2m)² ]
	// L_c = 社区内部边权和；D_c = 社区内所有节点度之和。
	// 由于 adj 是无向双向存，遍历 (i, 邻居) 时每条内部边会被计两次，所以最后除以 2。
	commInEdge2 := make(map[int]int) // = 2 * L_c
	commTotDeg := make(map[int]int)
	for i := 0; i < n; i++ {
		c := nodes[i].Community
		commTotDeg[c] += degree[i]
		for _, e := range adj[i] {
			if nodes[e.idx].Community == c {
				commInEdge2[c] += e.w
			}
		}
	}
	Q := 0.0
	for c, dc := range commTotDeg {
		ein2 := commInEdge2[c]
		Q += float64(ein2)/(2.0*m) - float64(dc)*float64(dc)/(4.0*m*m)
	}
	return Q
}
