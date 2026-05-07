package service

// golden_quotes.go — 群金句榜（被引用最多的消息）
//
// 扫描群里所有「引用消息」（local_type=49 且 message_content 含 <refermsg>），
// 解析 XML 抽出 <svrid>/<chatusr>/<content>/<displayname>，按原始消息聚合，
// 找出被引用次数最多的「群金句」。零 LLM、零新依赖。
//
// 与"群内我的 CP"不同：那个只看引用是否涉及"我"，这里关心整个群里
// 哪些消息变成了梗 / 名场面。
//
// 缓存：10 分钟一份，按 room|from|to 索引。

import (
	"fmt"
	"html"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"welink/backend/pkg/db"
)

const (
	gqMaxScan        = 60000           // 每个群最多扫的消息数（按时间倒序裁剪）
	gqDefaultLimit   = 10
	gqMaxLimit       = 50
	gqMaxQuoteRunes  = 240             // 显示截断
	gqCacheTTL       = 10 * time.Minute
	gqMaxRefermsgRaw = 128 * 1024      // 单条原始 message_content 大于这个就跳过（防御 XML 爆大）
	gqMaxRepliers    = 3
)

// GoldenQuoteReplier 一个引用者条目
type GoldenQuoteReplier struct {
	Speaker string `json:"speaker"`
	Avatar  string `json:"avatar,omitempty"`
	Count   int    `json:"count"`
}

// GoldenQuoteRaw 一条「群金句」聚合结果
type GoldenQuoteRaw struct {
	Svrid       string               `json:"svrid"`                  // 服务端消息 ID（用于去重；空时是 content+speaker fallback）
	Speaker     string               `json:"speaker"`                // 发言人显示名
	SpeakerWxid string               `json:"speaker_wxid"`
	Avatar      string               `json:"avatar,omitempty"`
	Content     string               `json:"content"`                // 原始消息文本（已去前后空白 + 截断）
	QuoteCount  int                  `json:"quote_count"`            // 被引用次数
	Ts          int64                `json:"ts,omitempty"`           // 原始消息 unix 秒
	Date        string               `json:"date,omitempty"`         // YYYY-MM-DD
	Time        string               `json:"time,omitempty"`         // HH:MM
	Repliers    []GoldenQuoteReplier `json:"repliers,omitempty"`     // Top 引用者
}

// GoldenQuotesData 整个群的金句榜结果
type GoldenQuotesData struct {
	GroupName    string           `json:"group_name"`
	RoomID       string           `json:"room_id"`
	TotalScanned int              `json:"total_scanned"`  // 扫描的消息数（含非引用）
	TotalQuotes  int              `json:"total_quotes"`   // 命中引用的消息数
	UniqueQuoted int              `json:"unique_quoted"`  // 不同的"被引用原文"数
	Quotes       []GoldenQuoteRaw `json:"quotes"`
	GeneratedAt  int64            `json:"generated_at"`
	Truncated    bool             `json:"truncated"`      // 是否触发了 gqMaxScan 上限
}

// 解析 refermsg XML 用的局部 regex —— 都只跑在已经确认含 <refermsg> 的内容上
var (
	gqSvridRe       = regexp.MustCompile(`<svrid>([^<]+)</svrid>`)
	gqChatusrRe     = regexp.MustCompile(`<chatusr>([^<]+)</chatusr>`)
	gqDisplayRe     = regexp.MustCompile(`<displayname>([^<]+)</displayname>`)
	gqRefTypeRe     = regexp.MustCompile(`<refermsg>[\s\S]*?<type>(\d+)</type>`)
	gqCreateTimeRe  = regexp.MustCompile(`<refermsg>[\s\S]*?<createtime>(\d+)</createtime>`)
	// content 可能裹 CDATA，也可能直接是文本。两种都吃。
	gqContentCDATARe = regexp.MustCompile(`<refermsg>[\s\S]*?<content><!\[CDATA\[([\s\S]*?)\]\]></content>`)
	gqContentPlainRe = regexp.MustCompile(`<refermsg>[\s\S]*?<content>([\s\S]*?)</content>`)
)

// 缓存
type gqCacheEntry struct {
	val *GoldenQuotesData
	at  time.Time
}

var (
	gqCacheMu sync.Mutex
	gqCache   = make(map[string]gqCacheEntry)
)

// GetGroupGoldenQuotes 扫一个群，返回被引用最多的 Top N 条消息
//
// from/to 为 0 时沿用全局索引时间范围（s.timeWhere）。
// limit 默认 10，最大 50。
func (s *ContactService) GetGroupGoldenQuotes(uname string, limit int, from, to int64) (*GoldenQuotesData, error) {
	if uname == "" || !strings.HasSuffix(uname, "@chatroom") {
		return nil, fmt.Errorf("uname 必须是群聊（以 @chatroom 结尾）")
	}
	if limit <= 0 {
		limit = gqDefaultLimit
	}
	if limit > gqMaxLimit {
		limit = gqMaxLimit
	}

	// 缓存：key 含 limit，避免不同 limit 复用上次的截断结果
	cacheKey := fmt.Sprintf("%s|%d|%d|%d", uname, from, to, limit)
	gqCacheMu.Lock()
	if e, ok := gqCache[cacheKey]; ok && time.Since(e.at) < gqCacheTTL {
		v := *e.val
		gqCacheMu.Unlock()
		return &v, nil
	}
	gqCacheMu.Unlock()

	// 群名
	groupName := uname
	for _, g := range s.GetGroups() {
		if g.Username == uname {
			if g.Name != "" {
				groupName = g.Name
			}
			break
		}
	}

	tableName := db.GetTableName(uname)
	tw := exportTimeWhere(from, to, s.timeWhere())

	nameMap := s.loadContactNameMap()
	avatarMap := s.loadContactAvatarMap()

	// 聚合容器
	type quoteAgg struct {
		svrid      string
		speaker    string
		spkWxid    string
		avatar     string
		content    string
		ts         int64
		count      int
		repliers   map[string]int    // replier display -> count
		replierAv  map[string]string // replier display -> avatar
	}
	bucket := make(map[string]*quoteAgg)
	totalScanned := 0
	totalQuotes := 0
	truncated := false

	for _, mdb := range s.dbMgr.MessageDBs {
		// rowid → wxid
		idToWxid := make(map[int64]string)
		if nrows, nerr := mdb.Query("SELECT rowid, user_name FROM Name2Id"); nerr == nil {
			for nrows.Next() {
				var rid int64
				var u string
				nrows.Scan(&rid, &u)
				idToWxid[rid] = u
			}
			nrows.Close()
		}

		// 倒序扫，拿到 gqMaxScan 后截断；这样大群只算最近窗口，避免 OOM
		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, real_sender_id, local_type, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s ORDER BY create_time DESC",
			tableName, tw))
		if err != nil {
			continue
		}

		for rows.Next() {
			if totalScanned >= gqMaxScan {
				truncated = true
				break
			}
			var ts, senderID int64
			var lt int
			var rawContent []byte
			var ct int64
			rows.Scan(&ts, &senderID, &lt, &rawContent, &ct)
			totalScanned++

			// 只看 type=49 + refermsg；超大的跳过（防御 XML 爆炸）
			if (lt & 0xFFFF) != 49 {
				continue
			}
			if len(rawContent) > gqMaxRefermsgRaw {
				continue
			}
			content := decodeGroupContent(rawContent, ct)
			if !strings.Contains(content, "<refermsg>") {
				continue
			}
			// 仅文本类引用（type=1）才算金句
			if m := gqRefTypeRe.FindStringSubmatch(content); len(m) != 2 || strings.TrimSpace(m[1]) != "1" {
				continue
			}

			// 抽 chatusr / svrid / 原文 / displayname / createtime
			origWxid := ""
			if m := gqChatusrRe.FindStringSubmatch(content); len(m) == 2 {
				origWxid = strings.TrimSpace(m[1])
			}
			if origWxid == "" {
				continue
			}

			origText := ""
			if m := gqContentCDATARe.FindStringSubmatch(content); len(m) == 2 {
				origText = m[1]
			} else if m := gqContentPlainRe.FindStringSubmatch(content); len(m) == 2 {
				origText = m[1]
			}
			origText = strings.TrimSpace(html.UnescapeString(origText))
			// 群里 type=1 文本带 "wxid:\n" 前缀，剥掉
			if idx := strings.Index(origText, ":\n"); idx > 0 && idx < 80 {
				origText = strings.TrimSpace(origText[idx+2:])
			}
			if origText == "" {
				continue
			}
			runes := []rune(origText)
			if len(runes) < 2 {
				continue
			}
			if len(runes) > gqMaxQuoteRunes {
				origText = string(runes[:gqMaxQuoteRunes]) + "…"
			}

			// 引用者（type=49 的 sender）
			replierWxid := ""
			if w, ok := idToWxid[senderID]; ok {
				replierWxid = w
			}
			// 引用自己的不算（避免一个人反复 quote 自己刷榜）
			if replierWxid != "" && replierWxid == origWxid {
				continue
			}

			svrid := ""
			if m := gqSvridRe.FindStringSubmatch(content); len(m) == 2 {
				svrid = strings.TrimSpace(m[1])
			}
			origTs := int64(0)
			if m := gqCreateTimeRe.FindStringSubmatch(content); len(m) == 2 {
				if v, err := parseInt64(m[1]); err == nil {
					origTs = v
				}
			}
			origDisplay := ""
			if m := gqDisplayRe.FindStringSubmatch(content); len(m) == 2 {
				origDisplay = strings.TrimSpace(html.UnescapeString(m[1]))
			}

			// 聚合 key：svrid 优先，否则 chatusr+原文 hash
			key := svrid
			if key == "" || key == "0" {
				key = "noid:" + origWxid + ":" + origText
			}

			agg, ok := bucket[key]
			if !ok {
				speakerName := origDisplay
				if n, ok2 := nameMap[origWxid]; ok2 && n != "" {
					speakerName = n
				}
				if speakerName == "" {
					speakerName = origWxid
				}
				agg = &quoteAgg{
					svrid:     svrid,
					speaker:   speakerName,
					spkWxid:   origWxid,
					avatar:    avatarMap[origWxid],
					content:   origText,
					ts:        origTs,
					repliers:  make(map[string]int),
					replierAv: make(map[string]string),
				}
				bucket[key] = agg
			}
			agg.count++
			totalQuotes++

			// 引用者展示
			if replierWxid != "" {
				rname := replierWxid
				if n, ok := nameMap[replierWxid]; ok && n != "" {
					rname = n
				}
				agg.repliers[rname]++
				if _, has := agg.replierAv[rname]; !has {
					agg.replierAv[rname] = avatarMap[replierWxid]
				}
			}
		}
		rows.Close()
		if truncated {
			break
		}
	}

	// 排序 + 截断 Top limit
	all := make([]*quoteAgg, 0, len(bucket))
	for _, v := range bucket {
		if v.count < 2 {
			continue // 只被引用一次的不上榜
		}
		all = append(all, v)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].count != all[j].count {
			return all[i].count > all[j].count
		}
		// 同票数：原文较短的在前（金句通常更短）
		li := utf8.RuneCountInString(all[i].content)
		lj := utf8.RuneCountInString(all[j].content)
		if li != lj {
			return li < lj
		}
		return all[i].ts > all[j].ts
	})
	uniqueQuoted := len(all)
	if len(all) > limit {
		all = all[:limit]
	}

	// repliers Top N + 时间格式化
	out := make([]GoldenQuoteRaw, 0, len(all))
	for _, a := range all {
		entry := GoldenQuoteRaw{
			Svrid:       a.svrid,
			Speaker:     a.speaker,
			SpeakerWxid: a.spkWxid,
			Avatar:      a.avatar,
			Content:     a.content,
			QuoteCount:  a.count,
			Ts:          a.ts,
		}
		if a.ts > 0 {
			t := time.Unix(a.ts, 0).In(s.tz)
			entry.Date = t.Format("2006-01-02")
			entry.Time = t.Format("15:04")
		}
		// repliers 按次数倒排，截 top N
		type kv struct {
			n string
			c int
		}
		rs := make([]kv, 0, len(a.repliers))
		for n, c := range a.repliers {
			rs = append(rs, kv{n, c})
		}
		sort.Slice(rs, func(i, j int) bool { return rs[i].c > rs[j].c })
		max := gqMaxRepliers
		if len(rs) < max {
			max = len(rs)
		}
		entry.Repliers = make([]GoldenQuoteReplier, 0, max)
		for i := 0; i < max; i++ {
			entry.Repliers = append(entry.Repliers, GoldenQuoteReplier{
				Speaker: rs[i].n,
				Avatar:  a.replierAv[rs[i].n],
				Count:   rs[i].c,
			})
		}
		out = append(out, entry)
	}

	res := &GoldenQuotesData{
		GroupName:    groupName,
		RoomID:       uname,
		TotalScanned: totalScanned,
		TotalQuotes:  totalQuotes,
		UniqueQuoted: uniqueQuoted,
		Quotes:       out,
		GeneratedAt:  time.Now().Unix(),
		Truncated:    truncated,
	}

	// 写缓存（按容量主动 GC）
	gqCacheMu.Lock()
	if len(gqCache) >= 32 {
		now := time.Now()
		for k, e := range gqCache {
			if now.Sub(e.at) >= gqCacheTTL {
				delete(gqCache, k)
			}
		}
	}
	gqCache[cacheKey] = gqCacheEntry{val: res, at: time.Now()}
	gqCacheMu.Unlock()

	return res, nil
}

// parseInt64 是 strconv.ParseInt 的小包装，避免 import strconv 给本文件加噪
func parseInt64(s string) (int64, error) {
	var n int64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("not a number: %q", s)
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}
