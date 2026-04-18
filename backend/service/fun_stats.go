package service

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"welink/backend/pkg/db"
)

// CompanionEntry 一个联系人的陪伴时长统计
type CompanionEntry struct {
	Username      string `json:"username"`
	Name          string `json:"name"`
	SessionCount  int    `json:"session_count"`
	TotalMinutes  int64  `json:"total_minutes"`
	TotalMessages int64  `json:"total_messages"`
}

// CompanionStats 是陪伴时长聚合
type CompanionStats struct {
	TotalMinutes int64            `json:"total_minutes"`  // 全局累计
	Entries      []CompanionEntry `json:"entries"`        // 按 TotalMinutes 降序
	GeneratedAt  int64            `json:"generated_at"`   // Unix 秒
	GapSeconds   int64            `json:"gap_seconds"`    // 用于切 session 的阈值
}

// 简单缓存 10 分钟，避免被多次点击反复扫表
var (
	companionCacheMu sync.Mutex
	companionCache   *CompanionStats
	companionCacheAt time.Time
)

// GetCompanionStats 计算每个联系人的「陪伴时长」
// —— 把相邻消息按 SessionGapSeconds 切成会话，累加每个会话的时长。
// 结果缓存 10 分钟；显式刷新传 refresh=true。
func (s *ContactService) GetCompanionStats(refresh bool) (*CompanionStats, error) {
	companionCacheMu.Lock()
	if !refresh && companionCache != nil && time.Since(companionCacheAt) < 10*time.Minute {
		defer companionCacheMu.Unlock()
		return companionCache, nil
	}
	companionCacheMu.Unlock()

	s.cacheMu.RLock()
	contacts := make([]CompanionEntry, 0, len(s.cache))
	for _, c := range s.cache {
		// 没消息的跳过
		if c.TotalMessages == 0 {
			continue
		}
		contacts = append(contacts, CompanionEntry{
			Username: c.Username, Name: c.Remark, TotalMessages: c.TotalMessages,
		})
		if contacts[len(contacts)-1].Name == "" {
			contacts[len(contacts)-1].Name = c.Nickname
			if contacts[len(contacts)-1].Name == "" {
				contacts[len(contacts)-1].Name = c.Username
			}
		}
	}
	s.cacheMu.RUnlock()

	s.paramsMu.RLock()
	gap := s.params.SessionGapSeconds
	s.paramsMu.RUnlock()
	if gap <= 0 {
		gap = 21600 // 默认 6 小时
	}

	var totalMin int64
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8) // 并发 8 个联系人，别把 SQLite 打死

	for i := range contacts {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sem <- struct{}{}; defer func() { <-sem }()
			table := db.GetTableName(contacts[idx].Username)

			// 把每个 message DB 里该联系人的时间戳全读出来
			var all []int64
			for _, mdb := range s.dbMgr.MessageDBs {
				rows, err := mdb.Query(fmt.Sprintf("SELECT create_time FROM [%s] ORDER BY create_time", table))
				if err != nil {
					continue
				}
				for rows.Next() {
					var ts int64
					if err := rows.Scan(&ts); err == nil && ts > 0 {
						all = append(all, ts)
					}
				}
				rows.Close()
			}
			if len(all) < 2 {
				return
			}
			sort.Slice(all, func(i, j int) bool { return all[i] < all[j] })

			// 按 gap 切 session，累加 (end - start) 秒
			sessionCount := 1
			sessionStart := all[0]
			sessionEnd := all[0]
			var secs int64
			for i := 1; i < len(all); i++ {
				if all[i]-sessionEnd > gap {
					// 结束当前会话
					secs += sessionEnd - sessionStart
					sessionCount++
					sessionStart = all[i]
				}
				sessionEnd = all[i]
			}
			secs += sessionEnd - sessionStart

			contacts[idx].SessionCount = sessionCount
			contacts[idx].TotalMinutes = secs / 60
			mu.Lock()
			totalMin += secs / 60
			mu.Unlock()
		}(i)
	}
	wg.Wait()

	// 过滤零陪伴 + 排序
	nonzero := make([]CompanionEntry, 0, len(contacts))
	for _, c := range contacts {
		if c.TotalMinutes > 0 {
			nonzero = append(nonzero, c)
		}
	}
	sort.Slice(nonzero, func(i, j int) bool { return nonzero[i].TotalMinutes > nonzero[j].TotalMinutes })

	result := &CompanionStats{
		TotalMinutes: totalMin,
		Entries:      nonzero,
		GeneratedAt:  time.Now().Unix(),
		GapSeconds:   gap,
	}
	companionCacheMu.Lock()
	companionCache = result
	companionCacheAt = time.Now()
	companionCacheMu.Unlock()
	return result, nil
}

// ─── Ghost 月 ───────────────────────────────────────────────────────────────

// GhostMonth 某联系人在某个月消息量骤降 / 中断的事件
type GhostMonth struct {
	Username     string `json:"username"`
	Name         string `json:"name"`
	Avatar       string `json:"avatar"`
	Month        string `json:"month"`          // "2024-03"
	BeforeCount  int64  `json:"before_count"`   // 骤降前一月消息数
	DuringCount  int64  `json:"during_count"`   // 该月消息数
	AfterCount   int64  `json:"after_count"`    // 骤降后恢复月消息数（可能为 0，表示没恢复）
	DropRatio    float64 `json:"drop_ratio"`    // 1 - during/before；0.8 即骤降 80%
	TotalHistory int64  `json:"total_history"`  // 总消息数（用于前端做上下文）
}

// GhostMonthsResult Ghost 月汇总
type GhostMonthsResult struct {
	Entries     []GhostMonth `json:"entries"`
	GeneratedAt int64        `json:"generated_at"`
}

var (
	ghostMonthsMu     sync.Mutex
	ghostMonthsCache  *GhostMonthsResult
	ghostMonthsCacheAt time.Time
)

// GetGhostMonths 扫描每个联系人的月度消息分布，找出骤降 >= 80% 的"失联月"。
// 启发式：至少 6 个活跃月、前后月都要有 >=10 条消息才判定为"ghost"（偶尔一个月没说话不算）。
// 单次扫描重用已缓存的联系人列表；结果缓存 30 分钟。
func (s *ContactService) GetGhostMonths(refresh bool) (*GhostMonthsResult, error) {
	ghostMonthsMu.Lock()
	if !refresh && ghostMonthsCache != nil && time.Since(ghostMonthsCacheAt) < 30*time.Minute {
		defer ghostMonthsMu.Unlock()
		return ghostMonthsCache, nil
	}
	ghostMonthsMu.Unlock()

	s.cacheMu.RLock()
	contacts := make([]ContactStatsExtended, 0, len(s.cache))
	for _, c := range s.cache {
		// 太少消息的直接跳过（偶尔联系的，不构成"ghost"）
		if c.TotalMessages >= 50 {
			contacts = append(contacts, c)
		}
	}
	s.cacheMu.RUnlock()

	var entries []GhostMonth
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for i := range contacts {
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}; defer func() { <-sem }()

			table := db.GetTableName(c.Username)
			monthly := make(map[string]int64) // "2024-03" → count
			var firstTs, lastTs int64
			for _, mdb := range s.dbMgr.MessageDBs {
				rows, err := mdb.Query(fmt.Sprintf("SELECT create_time FROM [%s] ORDER BY create_time", table))
				if err != nil { continue }
				for rows.Next() {
					var ts int64
					if err := rows.Scan(&ts); err == nil && ts > 0 {
						m := time.Unix(ts, 0).Format("2006-01")
						monthly[m]++
						if firstTs == 0 || ts < firstTs { firstTs = ts }
						if ts > lastTs { lastTs = ts }
					}
				}
				rows.Close()
			}
			if len(monthly) < 6 { return } // 历史太短不做判定
			if firstTs == 0 || lastTs == 0 { return }

			// 补齐中间"零消息"的月份
			start := time.Unix(firstTs, 0)
			end := time.Unix(lastTs, 0)
			type pt struct {
				key   string
				count int64
			}
			var series []pt
			cur := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, start.Location())
			stop := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, end.Location())
			for !cur.After(stop) {
				k := cur.Format("2006-01")
				series = append(series, pt{k, monthly[k]})
				cur = cur.AddDate(0, 1, 0)
			}
			if len(series) < 3 { return }

			// 找最大单月骤降：before (>=10) → during (<=before*0.2) 满足
			name := c.Remark
			if name == "" { name = c.Nickname }
			if name == "" { name = c.Username }

			// 只保留整个历史里骤降最剧烈的那个月，避免一个人刷几条重复
			var best *GhostMonth
			for idx := 1; idx < len(series); idx++ {
				before := series[idx-1].count
				during := series[idx].count
				if before < 10 { continue }
				if during > int64(float64(before)*0.2) { continue } // 降幅不足 80%
				var after int64
				if idx+1 < len(series) {
					after = series[idx+1].count
				}
				drop := 1.0 - float64(during)/float64(before)
				if best == nil || drop > best.DropRatio {
					best = &GhostMonth{
						Username: c.Username, Name: name, Avatar: c.SmallHeadURL,
						Month: series[idx].key,
						BeforeCount: before, DuringCount: during, AfterCount: after,
						DropRatio: drop, TotalHistory: c.TotalMessages,
					}
				}
			}
			if best != nil {
				mu.Lock()
				entries = append(entries, *best)
				mu.Unlock()
			}
		}(contacts[i])
	}
	wg.Wait()

	// 按 drop_ratio 降序，截断 Top 10
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].DropRatio != entries[j].DropRatio {
			return entries[i].DropRatio > entries[j].DropRatio
		}
		return entries[i].TotalHistory > entries[j].TotalHistory
	})
	if len(entries) > 10 {
		entries = entries[:10]
	}

	result := &GhostMonthsResult{Entries: entries, GeneratedAt: time.Now().Unix()}
	ghostMonthsMu.Lock()
	ghostMonthsCache = result
	ghostMonthsCacheAt = time.Now()
	ghostMonthsMu.Unlock()
	return result, nil
}

// ─── 最像我的朋友 ───────────────────────────────────────────────────────────

// LikeMeEntry 某个联系人对"我的平均对话风格"的相似度
type LikeMeEntry struct {
	Username  string   `json:"username"`
	Name      string   `json:"name"`
	Avatar    string   `json:"avatar"`
	Score     float64  `json:"score"`     // 余弦相似度 0~1
	TopShared []string `json:"top_shared"` // 共同高频词
}

// LikeMeResult 完整结果
type LikeMeResult struct {
	Entries     []LikeMeEntry `json:"entries"`
	GeneratedAt int64         `json:"generated_at"`
}

var (
	likeMeMu      sync.Mutex
	likeMeCache   *LikeMeResult
	likeMeCacheAt time.Time
)

// GetLikeMeFriends 找出聊天风格最接近"我的平均对话基线"的联系人 Top 5。
// "我的基线" = 以 my_messages 为权重的全局 18 维特征向量加权平均。
// 注意：这测的是"关系风格接近我的平均"，不是严格的"他写得像我"——后者需要区分
// 每条消息是谁发的、再做 per-side 统计，代价太大，这里走一个近似。
func (s *ContactService) GetLikeMeFriends(refresh bool) (*LikeMeResult, error) {
	likeMeMu.Lock()
	if !refresh && likeMeCache != nil && time.Since(likeMeCacheAt) < 30*time.Minute {
		defer likeMeMu.Unlock()
		return likeMeCache, nil
	}
	likeMeMu.Unlock()

	s.cacheMu.RLock()
	contacts := make([]ContactStatsExtended, 0, len(s.cache))
	for _, c := range s.cache {
		if c.TotalMessages >= 50 && c.MyMessages > 0 {
			contacts = append(contacts, c)
		}
	}
	s.cacheMu.RUnlock()

	if len(contacts) < 3 {
		return &LikeMeResult{Entries: []LikeMeEntry{}, GeneratedAt: time.Now().Unix()}, nil
	}

	// 构建 18 维向量（和 GetContactSimilarity 里的形式保持一致）
	typeKeys := []string{"文本", "图片", "语音", "视频", "表情", "红包", "转账", "链接/文件", "小程序", "引用", "名片", "位置", "通话", "视频号", "其他"}
	maxAvgLen := 1.0
	for _, c := range contacts {
		if c.AvgMsgLen > maxAvgLen {
			maxAvgLen = c.AvgMsgLen
		}
	}
	vectors := make([][]float64, len(contacts))
	weights := make([]float64, len(contacts))
	for i, c := range contacts {
		vec := make([]float64, 0, 18)
		for _, tk := range typeKeys {
			vec = append(vec, c.TypePct[tk]/100.0)
		}
		vec = append(vec, c.AvgMsgLen/maxAvgLen)
		if c.TotalMessages > 0 {
			vec = append(vec, float64(c.EmojiCnt)/float64(c.TotalMessages))
		} else {
			vec = append(vec, 0)
		}
		if c.TotalMessages > 0 {
			vec = append(vec, float64(c.TheirMessages)/float64(c.TotalMessages))
		} else {
			vec = append(vec, 0.5)
		}
		vectors[i] = vec
		weights[i] = float64(c.MyMessages) // "我"说得越多的关系权重越高
	}

	// 加权平均作为"我的基线"
	meVec := make([]float64, 18)
	var totalW float64
	for i, vec := range vectors {
		for j := range vec {
			meVec[j] += vec[j] * weights[i]
		}
		totalW += weights[i]
	}
	if totalW == 0 {
		return &LikeMeResult{Entries: []LikeMeEntry{}, GeneratedAt: time.Now().Unix()}, nil
	}
	for j := range meVec {
		meVec[j] /= totalW
	}

	// 每个联系人 vs meVec 的 cosine
	type scored struct {
		idx   int
		score float64
	}
	var scores []scored
	for i, vec := range vectors {
		scores = append(scores, scored{i, cosineSimFloat64(vec, meVec)})
	}
	sort.Slice(scores, func(i, j int) bool { return scores[i].score > scores[j].score })

	// 取 Top 5
	topN := 5
	if len(scores) < topN { topN = len(scores) }

	// 并行拿 Top 5 联系人的高频词，供前端展示（可空）
	entries := make([]LikeMeEntry, 0, topN)
	for i := 0; i < topN; i++ {
		c := contacts[scores[i].idx]
		name := c.Remark
		if name == "" { name = c.Nickname }
		if name == "" { name = c.Username }
		var shared []string
		wc := s.GetWordCloud(c.Username, false)
		for _, w := range wc {
			shared = append(shared, w.Word)
			if len(shared) >= 5 { break }
		}
		entries = append(entries, LikeMeEntry{
			Username: c.Username, Name: name, Avatar: c.SmallHeadURL,
			Score: math.Round(scores[i].score*1000) / 1000,
			TopShared: shared,
		})
	}

	result := &LikeMeResult{Entries: entries, GeneratedAt: time.Now().Unix()}
	likeMeMu.Lock()
	likeMeCache = result
	likeMeCacheAt = time.Now()
	likeMeMu.Unlock()
	return result, nil
}

// ─── 词语年鉴（每年一个代表词）──────────────────────────────────────────────
// 取每年"我发送的文本消息"里 Top 词云，挑 #1 作为年度代表词。
// 口径：直接扫 message DBs 按 year 分桶 + 简易分词（复用 segmenter）。
// 结果缓存 2 小时（年鉴不太变化）。

type AlmanacEntry struct {
	Year      int    `json:"year"`
	Word      string `json:"word"`       // 年度代表词
	Count     int    `json:"count"`      // 出现次数
	Messages  int    `json:"messages"`   // 当年我发出的文本消息数
	Runners   []string `json:"runners"`  // 第 2~5 名高频词（展示用）
}

type WordAlmanacResult struct {
	Entries     []AlmanacEntry `json:"entries"`
	GeneratedAt int64          `json:"generated_at"`
}

var (
	almanacMu      sync.Mutex
	almanacCache   *WordAlmanacResult
	almanacCacheAt time.Time
)

// GetWordAlmanac 按年聚合"我发送的消息"的 Top 词，每年挑 #1。
// 通过 contact cache 只取消息量 >=500 的活跃联系人（避免全量扫描；代表词来自"我方"主要对话的采样）。
func (s *ContactService) GetWordAlmanac(refresh bool) (*WordAlmanacResult, error) {
	almanacMu.Lock()
	if !refresh && almanacCache != nil && time.Since(almanacCacheAt) < 2*time.Hour {
		defer almanacMu.Unlock()
		return almanacCache, nil
	}
	almanacMu.Unlock()

	// 选活跃联系人做采样源（全量 N 倍联系人会导致词云扫描爆炸）
	s.cacheMu.RLock()
	type cc struct{ username string; msgs int64 }
	list := make([]cc, 0)
	for _, c := range s.cache {
		if c.MyMessages >= 100 {
			list = append(list, cc{c.Username, c.MyMessages})
		}
	}
	s.cacheMu.RUnlock()
	sort.Slice(list, func(i, j int) bool { return list[i].msgs > list[j].msgs })
	if len(list) > 30 {
		list = list[:30]
	}

	// year -> word -> count ; year -> msg count
	yearWords := make(map[int]map[string]int)
	yearMsgs := make(map[int]int)

	for _, cc := range list {
		tableName := db.GetTableName(cc.username)
		for _, mdb := range s.dbMgr.MessageDBs {
			// 只要 "我发的" 文本消息：local_type=1 且 real_sender_id ≠ 对方 rowid
			// 简化：取出所有 type=1 消息后按"剥前缀是否命中"判断是否对方，不是的就当作自己
			rows, err := mdb.Query(fmt.Sprintf(
				"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s] WHERE local_type=1", tableName))
			if err != nil {
				continue
			}
			for rows.Next() {
				var ts int64
				var rawContent []byte
				var ct int64
				rows.Scan(&ts, &rawContent, &ct)
				content := decodeGroupContent(rawContent, ct)
				if content == "" || s.isSys(content) {
					continue
				}
				// 如果开头是 wxid:\n 前缀就是对方发的，跳过
				if idx := strings.Index(content, ":\n"); idx > 0 && idx < 80 {
					continue
				}
				year := time.Unix(ts, 0).In(s.tz).Year()
				if _, ok := yearWords[year]; !ok {
					yearWords[year] = make(map[string]int)
				}
				yearMsgs[year]++
				// 分词并累加
				s.segmenterMu.Lock()
				for _, seg := range s.segmenter.Cut(wechatEmojiRe.ReplaceAllString(content, ""), true) {
					seg = strings.TrimSpace(seg)
					if !utf8.ValidString(seg) {
						continue
					}
					runes := []rune(seg)
					if len(runes) < 2 || len(runes) > 8 {
						continue
					}
					if isNumeric(seg) || STOP_WORDS[seg] || containsEmoji(seg) || !hasWordChar(seg) {
						continue
					}
					yearWords[year][seg]++
				}
				s.segmenterMu.Unlock()
			}
			rows.Close()
		}
	}

	// 组装：按年份升序，每年挑 Top
	years := make([]int, 0, len(yearWords))
	for y := range yearWords {
		years = append(years, y)
	}
	sort.Ints(years)

	entries := make([]AlmanacEntry, 0, len(years))
	for _, y := range years {
		wm := yearWords[y]
		if yearMsgs[y] < 50 {
			continue // 年消息量太少，代表词不稳定
		}
		type kv struct{ k string; v int }
		arr := make([]kv, 0, len(wm))
		for k, v := range wm {
			arr = append(arr, kv{k, v})
		}
		sort.Slice(arr, func(i, j int) bool { return arr[i].v > arr[j].v })
		if len(arr) == 0 {
			continue
		}
		runners := make([]string, 0, 4)
		for i := 1; i < len(arr) && i < 5; i++ {
			runners = append(runners, arr[i].k)
		}
		entries = append(entries, AlmanacEntry{
			Year: y, Word: arr[0].k, Count: arr[0].v,
			Messages: yearMsgs[y], Runners: runners,
		})
	}

	result := &WordAlmanacResult{Entries: entries, GeneratedAt: time.Now().Unix()}
	almanacMu.Lock()
	almanacCache = result
	almanacCacheAt = time.Now()
	almanacMu.Unlock()
	return result, nil
}

// ─── 失眠陪聊榜 ────────────────────────────────────────────────────────────
// 凌晨 2-4 点我发消息后，谁最快/最稳定回我。
// 口径：扫描每个活跃联系人的 2-4 点消息；以"我→对方"的相邻消息对为一次"呼叫"；
// 对方在 30 分钟内回复就算成功，记录响应时间；最后按 "响应率 + 中位响应时间" 综合排序。

type InsomniaEntry struct {
	Username       string  `json:"username"`
	Name           string  `json:"name"`
	Avatar         string  `json:"avatar"`
	MyCalls        int     `json:"my_calls"`         // 凌晨我向 TA 发消息的次数
	Responded      int     `json:"responded"`        // 对方 30min 内回复的次数
	ResponseRate   float64 `json:"response_rate"`    // responded / my_calls
	MedianResponseSec int64 `json:"median_response_sec"` // 中位响应时间（秒）
}

type InsomniaResult struct {
	Entries     []InsomniaEntry `json:"entries"`
	GeneratedAt int64           `json:"generated_at"`
}

var (
	insomniaMu      sync.Mutex
	insomniaCache   *InsomniaResult
	insomniaCacheAt time.Time
)

// GetInsomniaTop 凌晨 2-4 点我最常呼叫 & 对方最常回应的 Top 5。
func (s *ContactService) GetInsomniaTop(refresh bool) (*InsomniaResult, error) {
	insomniaMu.Lock()
	if !refresh && insomniaCache != nil && time.Since(insomniaCacheAt) < 30*time.Minute {
		defer insomniaMu.Unlock()
		return insomniaCache, nil
	}
	insomniaMu.Unlock()

	s.cacheMu.RLock()
	type cc struct{ ext ContactStatsExtended }
	list := make([]cc, 0)
	for _, c := range s.cache {
		if c.TotalMessages >= 50 && c.MyMessages > 0 {
			list = append(list, cc{c})
		}
	}
	s.cacheMu.RUnlock()

	entries := make([]InsomniaEntry, 0)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, cc := range list {
		wg.Add(1)
		go func(c ContactStatsExtended) {
			defer wg.Done()
			sem <- struct{}{}; defer func() { <-sem }()

			tableName := db.GetTableName(c.Username)
			// 按时间排序取所有消息，需要判定方向：real_sender_id == Name2Id[username] 即对方；否则我
			type msg struct{ ts int64; mine bool }
			var msgs []msg
			for _, mdb := range s.dbMgr.MessageDBs {
				// 对方的 rowid
				var otherRowID int64
				if row := mdb.QueryRow("SELECT rowid FROM Name2Id WHERE user_name = ?", c.Username); row != nil {
					row.Scan(&otherRowID)
				}
				rows, err := mdb.Query(fmt.Sprintf("SELECT create_time, COALESCE(real_sender_id,0) FROM [%s] ORDER BY create_time ASC", tableName))
				if err != nil { continue }
				for rows.Next() {
					var ts, sid int64
					if err := rows.Scan(&ts, &sid); err != nil { continue }
					// 只关心凌晨 2-4 点的消息以及紧接它们的回复
					msgs = append(msgs, msg{ts, sid != otherRowID && sid != 0})
				}
				rows.Close()
			}
			if len(msgs) < 4 { return }
			sort.Slice(msgs, func(i, j int) bool { return msgs[i].ts < msgs[j].ts })

			var calls, resp int
			respSecs := make([]int64, 0)
			for i, m := range msgs {
				if !m.mine { continue }
				h := time.Unix(m.ts, 0).In(s.tz).Hour()
				if h < 2 || h >= 4 { continue }
				calls++
				// 找下一条对方的消息
				for j := i + 1; j < len(msgs); j++ {
					dt := msgs[j].ts - m.ts
					if dt > 30*60 { break }
					if !msgs[j].mine {
						resp++
						respSecs = append(respSecs, dt)
						break
					}
				}
			}
			if calls < 3 { return } // 少于 3 次呼叫样本太小

			sort.Slice(respSecs, func(i, j int) bool { return respSecs[i] < respSecs[j] })
			var median int64
			if len(respSecs) > 0 {
				median = respSecs[len(respSecs)/2]
			}
			name := c.Remark
			if name == "" { name = c.Nickname }
			if name == "" { name = c.Username }

			mu.Lock()
			entries = append(entries, InsomniaEntry{
				Username: c.Username, Name: name, Avatar: c.SmallHeadURL,
				MyCalls: calls, Responded: resp,
				ResponseRate: float64(resp) / float64(calls),
				MedianResponseSec: median,
			})
			mu.Unlock()
		}(cc.ext)
	}
	wg.Wait()

	// 综合排序：先按响应率降，再按中位响应时间升
	sort.Slice(entries, func(i, j int) bool {
		if math.Abs(entries[i].ResponseRate-entries[j].ResponseRate) > 0.01 {
			return entries[i].ResponseRate > entries[j].ResponseRate
		}
		return entries[i].MedianResponseSec < entries[j].MedianResponseSec
	})
	if len(entries) > 5 {
		entries = entries[:5]
	}

	result := &InsomniaResult{Entries: entries, GeneratedAt: time.Now().Unix()}
	insomniaMu.Lock()
	insomniaCache = result
	insomniaCacheAt = time.Now()
	insomniaMu.Unlock()
	return result, nil
}
