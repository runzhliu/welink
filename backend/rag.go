package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"welink/backend/service"
)

// ftsJobs 记录正在构建中的 FTS 索引 key，防止并发重复构建。
var (
	ftsJobs   = make(map[string]bool)
	ftsJobsMu sync.Mutex
)

// ─── 表初始化 ──────────────────────────────────────────────────────────────────

// initFTSTables 在 aiDB 中创建 FTS5 索引表和状态表。
// 必须在 aiDBMu 持有期间调用（由 InitAIDB 调用）。
func initFTSTables() error {
	_, err := aiDB.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(
		content,
		sender      UNINDEXED,
		datetime    UNINDEXED,
		contact_key UNINDEXED,
		seq         UNINDEXED,
		tokenize = 'trigram'
	)`)
	if err != nil {
		return fmt.Errorf("rag: msg_fts: %w", err)
	}
	_, err = aiDB.Exec(`CREATE TABLE IF NOT EXISTS fts_index_status (
		contact_key TEXT PRIMARY KEY,
		msg_count   INTEGER NOT NULL DEFAULT 0,
		built_at    INTEGER NOT NULL DEFAULT 0
	)`)
	if err != nil {
		return fmt.Errorf("rag: fts_index_status: %w", err)
	}
	return nil
}

// ─── 索引状态 ─────────────────────────────────────────────────────────────────

// IndexStatus 是 GetFTSIndexStatus 的返回值。
type IndexStatus struct {
	Built    bool  `json:"built"`
	MsgCount int   `json:"msg_count"`
	BuiltAt  int64 `json:"built_at"`
}

// GetFTSIndexStatus 返回指定 key 的 FTS 索引构建状态。
func GetFTSIndexStatus(key string) (IndexStatus, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return IndexStatus{}, nil
	}
	var mc int
	var ba int64
	err := db.QueryRow(
		"SELECT msg_count, built_at FROM fts_index_status WHERE contact_key = ?", key,
	).Scan(&mc, &ba)
	if err == sql.ErrNoRows {
		return IndexStatus{}, nil
	}
	if err != nil {
		return IndexStatus{}, err
	}
	return IndexStatus{Built: ba > 0, MsgCount: mc, BuiltAt: ba}, nil
}

// ─── 构建索引 ─────────────────────────────────────────────────────────────────

type ragIndexProgress struct {
	Step    string `json:"step"`
	Current int    `json:"current,omitempty"`
	Total   int    `json:"total,omitempty"`
	Done    bool   `json:"done,omitempty"`
	Error   string `json:"error,omitempty"`
}

// BuildFTSIndex 重建指定联系人的 FTS5 索引，通过 SSE 推送构建进度。
func BuildFTSIndex(w http.ResponseWriter, key, username string, isGroup bool, svc *service.ContactService) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	sendP := func(p ragIndexProgress) {
		b, _ := json.Marshal(p)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	// 防止同一 key 并发重复构建
	ftsJobsMu.Lock()
	if ftsJobs[key] {
		ftsJobsMu.Unlock()
		sendP(ragIndexProgress{Step: "error", Error: "索引正在构建中，请稍后再试"})
		return
	}
	ftsJobs[key] = true
	ftsJobsMu.Unlock()
	defer func() {
		ftsJobsMu.Lock()
		delete(ftsJobs, key)
		ftsJobsMu.Unlock()
	}()

	if svc == nil {
		sendP(ragIndexProgress{Step: "error", Error: "服务不可用，请先配置数据目录"})
		return
	}

	sendP(ragIndexProgress{Step: "loading"})

	// 加载全量消息（不过滤时间）
	type rawMsg struct {
		DateTime string
		Sender   string
		Content  string
	}
	var msgs []rawMsg

	if isGroup {
		for _, m := range svc.ExportGroupMessagesAll(username) {
			if strings.HasPrefix(m.Content, "[") {
				continue // 跳过图片/语音等非文本
			}
			msgs = append(msgs, rawMsg{
				DateTime: m.Date + " " + m.Time,
				Sender:   m.Speaker,
				Content:  m.Content,
			})
		}
	} else {
		for _, m := range svc.ExportContactMessagesAll(username) {
			if strings.HasPrefix(m.Content, "[") {
				continue
			}
			sender := "对方"
			if m.IsMine {
				sender = "我"
			}
			msgs = append(msgs, rawMsg{
				DateTime: m.Date + " " + m.Time,
				Sender:   sender,
				Content:  m.Content,
			})
		}
	}

	total := len(msgs)
	if total == 0 {
		sendP(ragIndexProgress{Step: "error", Error: "该联系人暂无可索引的文本消息"})
		return
	}
	sendP(ragIndexProgress{Step: "indexing", Current: 0, Total: total})

	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()

	if db == nil {
		sendP(ragIndexProgress{Step: "error", Error: "数据库未初始化"})
		return
	}

	// 清理旧索引
	if _, err := db.Exec("DELETE FROM msg_fts WHERE contact_key = ?", key); err != nil {
		sendP(ragIndexProgress{Step: "error", Error: "清理旧索引失败：" + err.Error()})
		return
	}

	// 批量插入（每批 500 条，单事务）
	const batchSize = 500
	for i := 0; i < total; i += batchSize {
		end := i + batchSize
		if end > total {
			end = total
		}
		tx, err := db.Begin()
		if err != nil {
			sendP(ragIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		stmt, err := tx.Prepare(
			"INSERT INTO msg_fts(content, sender, datetime, contact_key, seq) VALUES(?,?,?,?,?)")
		if err != nil {
			tx.Rollback()
			sendP(ragIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		for j := i; j < end; j++ {
			m := msgs[j]
			if _, err := stmt.Exec(m.Content, m.Sender, m.DateTime, key, j); err != nil {
				stmt.Close()
				tx.Rollback()
				sendP(ragIndexProgress{Step: "error", Error: err.Error()})
				return
			}
		}
		stmt.Close()
		if err := tx.Commit(); err != nil {
			sendP(ragIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		sendP(ragIndexProgress{Step: "indexing", Current: end, Total: total})
	}

	// 更新索引状态
	if _, err := db.Exec(`
		INSERT INTO fts_index_status(contact_key, msg_count, built_at) VALUES(?,?,?)
		ON CONFLICT(contact_key) DO UPDATE SET msg_count=excluded.msg_count, built_at=excluded.built_at`,
		key, total, time.Now().Unix(),
	); err != nil {
		sendP(ragIndexProgress{Step: "error", Error: err.Error()})
		return
	}

	sendP(ragIndexProgress{Step: "done", Done: true, Total: total})
}

// ─── 检索 ──────────────────────────────────────────────────────────────────────

// RAGResult 是 FTS5 检索结果的单条消息。
type RAGResult struct {
	Datetime string `json:"datetime"`
	Sender   string `json:"sender"`
	Content  string `json:"content"`
	Seq      int    `json:"seq"`
}

// chineseFuncRunes 汉语中常见虚词/代词，用于从自然语言问句中分离实义词段。
var chineseFuncRunes = map[rune]bool{
	'的': true, '了': true, '是': true, '吗': true, '呢': true,
	'啊': true, '哦': true, '嗯': true, '在': true, '有': true,
	'和': true, '与': true, '或': true, '但': true, '这': true,
	'那': true, '哪': true, '什': true, '么': true, '怎': true,
	'能': true, '要': true, '会': true, '她': true, '他': true,
	'你': true, '我': true, '它': true, '里': true, '过': true,
	'们': true, '着': true, '地': true, '也': true, '都': true,
	'就': true, '从': true, '向': true, '对': true, '被': true,
	'把': true, '让': true, '到': true, '来': true, '去': true,
	'给': true, '于': true, '以': true, '可': true, '不': true,
	'没': true, '很': true, '太': true, '比': true, '更': true,
	'最': true, '非': true, '无': true, '每': true, '各': true,
	'某': true, '该': true, '此': true, '其': true, '为': true,
}

// splitCJKSentence 将一段连续汉字按虚词切分成实义词段。
func splitCJKSentence(s string) []string {
	var segments []string
	var cur strings.Builder
	for _, r := range s {
		if chineseFuncRunes[r] {
			if cur.Len() > 0 {
				segments = append(segments, cur.String())
				cur.Reset()
			}
		} else {
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		segments = append(segments, cur.String())
	}
	return segments
}

// prepareFTSQuery 将查询字符串提取为 FTS5 词组（≥3字符）和 LIKE 词组（2字符）。
// 对超过4字的连续汉字串，先按虚词切分再归类，避免把整句话当成一个检索词。
func prepareFTSQuery(q string) (ftsQuery string, likeTerms []string) {
	// 将标点/特殊符号替换为空格，保留中文和 ASCII 字母数字
	var sb strings.Builder
	for _, r := range q {
		isCJK := r >= 0x4E00 && r <= 0x9FFF
		isASCII := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if isCJK || isASCII {
			sb.WriteRune(r)
		} else {
			sb.WriteRune(' ')
		}
	}

	// 拆出词段：短词直接保留，长句先切虚词
	var segments []string
	for _, word := range strings.Fields(sb.String()) {
		if len([]rune(word)) <= 4 {
			segments = append(segments, word)
		} else {
			segments = append(segments, splitCJKSentence(word)...)
		}
	}

	// 按长度归类：≥3 字 → FTS MATCH，==2 字 → LIKE，1 字忽略
	var ftsTerms []string
	for _, seg := range segments {
		rc := len([]rune(seg))
		switch {
		case rc >= 3:
			ftsTerms = append(ftsTerms, seg)
		case rc == 2:
			likeTerms = append(likeTerms, seg)
		}
	}

	if len(ftsTerms) > 0 {
		ftsQuery = strings.Join(ftsTerms, " OR ")
	}
	return
}

// SearchFTS 在 FTS5 索引中搜索，返回 top-K 命中 + 上下文窗口扩展（±5 条）。
// 短查询（<3字符）自动退化为 LIKE 全文扫描。
// 返回 (结果列表, 直接命中seqSet, error)。
func SearchFTS(key, query string, topK int) (results []RAGResult, hits map[int]bool, err error) {
	t := startTimer("rag_fts")
	defer func() {
		t.Done(err,
			"key", key,
			"query_chars", len(query),
			"top_k", topK,
			"hits", len(hits),
			"results", len(results),
		)
	}()

	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return nil, nil, fmt.Errorf("数据库未初始化")
	}

	ftsQuery, likeTerms := prepareFTSQuery(query)
	if ftsQuery == "" && len(likeTerms) == 0 {
		return nil, nil, nil
	}

	// 收集命中 seq（去重）
	seqSet := make(map[int]bool)

	// FTS5 倒排索引检索（快速，适用于 ≥3 字符词段）
	if ftsQuery != "" {
		rows, err := db.Query(`
			SELECT seq FROM msg_fts
			WHERE msg_fts MATCH ? AND contact_key = ?
			ORDER BY rank
			LIMIT ?`,
			ftsQuery, key, topK,
		)
		if err == nil {
			for rows.Next() {
				var seq int
				rows.Scan(&seq)
				seqSet[seq] = true
			}
			rows.Close()
		}
	}

	// LIKE 全文扫描（兜底，适用于 2 字符短词）
	for _, term := range likeTerms {
		if len(seqSet) >= topK {
			break
		}
		rows, err := db.Query(`
			SELECT seq FROM msg_fts
			WHERE contact_key = ? AND content LIKE ?
			ORDER BY seq DESC
			LIMIT ?`,
			key, "%"+term+"%", topK-len(seqSet),
		)
		if err != nil {
			continue
		}
		for rows.Next() {
			var seq int
			rows.Scan(&seq)
			seqSet[seq] = true
		}
		rows.Close()
	}

	if len(seqSet) == 0 {
		return nil, nil, nil
	}

	// 转换为有序切片，供窗口扩展使用
	hitSeqs := make([]int, 0, len(seqSet))
	for seq := range seqSet {
		hitSeqs = append(hitSeqs, seq)
	}
	sort.Ints(hitSeqs)

	// 构建 ±5 窗口范围并合并重叠区间
	type seqRange struct{ start, end int }
	ranges := make([]seqRange, 0, len(hitSeqs))
	for _, seq := range hitSeqs {
		lo := seq - 5
		if lo < 0 {
			lo = 0
		}
		ranges = append(ranges, seqRange{lo, seq + 5})
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].start < ranges[j].start })

	merged := []seqRange{ranges[0]}
	for _, r := range ranges[1:] {
		last := &merged[len(merged)-1]
		if r.start <= last.end+1 {
			if r.end > last.end {
				last.end = r.end
			}
		} else {
			merged = append(merged, r)
		}
	}

	// 查询每个合并范围内的消息
	seen := make(map[int]bool)
	for _, r := range merged {
		winRows, err := db.Query(`
			SELECT seq, datetime, sender, content FROM msg_fts
			WHERE contact_key = ? AND seq >= ? AND seq <= ?`,
			key, r.start, r.end,
		)
		if err != nil {
			continue
		}
		for winRows.Next() {
			var seq int
			var res RAGResult
			winRows.Scan(&seq, &res.Datetime, &res.Sender, &res.Content)
			if !seen[seq] {
				seen[seq] = true
				res.Seq = seq
				results = append(results, res)
			}
		}
		winRows.Close()
	}

	sort.Slice(results, func(i, j int) bool { return results[i].Seq < results[j].Seq })
	hits = seqSet
	return results, hits, nil
}

// ─── 查询改写 ─────────────────────────────────────────────────────────────────

// rewriteSearchQuery 用 LLM 将自然语言问题改写为聊天记录中可能出现的检索关键词。
// 失败时返回原始查询，保证降级可用。
func rewriteSearchQuery(query string, prefs Preferences) string {
	prompt := fmt.Sprintf(
		"将下面的问题转化为聊天记录检索关键词，输出5-10个空格分隔的词，只输出关键词，不要任何解释或标点：\n%s",
		query,
	)
	result, err := CompleteLLM([]LLMMessage{
		{Role: "system", Content: "你是一个检索关键词提取助手，输出结果只包含空格分隔的关键词，不含任何其他内容。"},
		{Role: "user", Content: prompt},
	}, prefs)
	if err != nil || strings.TrimSpace(result) == "" {
		return query
	}
	// 清洗：去掉换行、多余标点，只保留空格分隔的词段
	cleaned := strings.Map(func(r rune) rune {
		if r == '\n' || r == '，' || r == '、' || r == ',' {
			return ' '
		}
		return r
	}, result)
	return strings.TrimSpace(cleaned)
}

// ─── 混合检索合并 ──────────────────────────────────────────────────────────────

// mergeRAGResults 将向量检索和 FTS 检索结果按 seq 合并去重。
// 命中集合取两者的并集（任一来源命中即标记 is_hit）。
func mergeRAGResults(vecRes []RAGResult, vecHits map[int]bool, ftsRes []RAGResult, ftsHits map[int]bool) ([]RAGResult, map[int]bool) {
	seen := make(map[int]bool)
	combined := make(map[int]bool)
	var results []RAGResult

	addResult := func(r RAGResult) {
		if !seen[r.Seq] {
			seen[r.Seq] = true
			results = append(results, r)
		}
		if (vecHits != nil && vecHits[r.Seq]) || (ftsHits != nil && ftsHits[r.Seq]) {
			combined[r.Seq] = true
		}
	}
	for _, r := range vecRes {
		addResult(r)
	}
	for _, r := range ftsRes {
		addResult(r)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Seq < results[j].Seq })
	return results, combined
}

// ─── 跨联系人日期检索 ──────────────────────────────────────────────────────────

// RAGDateResult 是跨联系人日期检索的单条结果，包含来源 contact_key。
type RAGDateResult struct {
	Datetime   string
	Sender     string
	Content    string
	ContactKey string
	Seq        int
}

// SearchFTSAcrossDate 在 FTS5 索引中跨所有联系人检索指定日期的相关消息。
// 不按 contact_key 过滤，按 datetime 前缀（"date%"）过滤。
// 不做上下文窗口扩展（seq 在各联系人间不连续）。
func SearchFTSAcrossDate(date, query string, topK int) ([]RAGDateResult, int, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return nil, 0, fmt.Errorf("数据库未初始化")
	}

	ftsQuery, likeTerms := prepareFTSQuery(query)
	if ftsQuery == "" && len(likeTerms) == 0 {
		return nil, 0, nil
	}

	datePfx := date + "%"
	seen := make(map[string]bool)
	var results []RAGDateResult

	if ftsQuery != "" {
		rows, err := db.Query(`
			SELECT seq, datetime, sender, content, contact_key FROM msg_fts
			WHERE msg_fts MATCH ? AND datetime LIKE ?
			ORDER BY rank
			LIMIT ?`,
			ftsQuery, datePfx, topK,
		)
		if err == nil {
			for rows.Next() {
				var r RAGDateResult
				rows.Scan(&r.Seq, &r.Datetime, &r.Sender, &r.Content, &r.ContactKey)
				k := r.ContactKey + ":" + strconv.Itoa(r.Seq)
				if !seen[k] {
					seen[k] = true
					results = append(results, r)
				}
			}
			rows.Close()
		}
	}

	for _, term := range likeTerms {
		if len(results) >= topK {
			break
		}
		rows, err := db.Query(`
			SELECT seq, datetime, sender, content, contact_key FROM msg_fts
			WHERE datetime LIKE ? AND content LIKE ?
			LIMIT ?`,
			datePfx, "%"+term+"%", topK-len(results),
		)
		if err != nil {
			continue
		}
		for rows.Next() {
			var r RAGDateResult
			rows.Scan(&r.Seq, &r.Datetime, &r.Sender, &r.Content, &r.ContactKey)
			k := r.ContactKey + ":" + strconv.Itoa(r.Seq)
			if !seen[k] {
				seen[k] = true
				results = append(results, r)
			}
		}
		rows.Close()
	}

	hitCount := len(results)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Datetime < results[j].Datetime
	})

	return results, hitCount, nil
}
