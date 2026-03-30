package main

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"welink/backend/service"
)

// ─── 表初始化 ──────────────────────────────────────────────────────────────────

// initVecTables 在 aiDB 中创建向量存储表和状态表。
// 必须在 aiDBMu 持有期间调用（由 InitAIDB 调用）。
func initVecTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS vec_messages (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		contact_key TEXT    NOT NULL,
		seq         INTEGER NOT NULL,
		datetime    TEXT    NOT NULL,
		sender      TEXT    NOT NULL,
		content     TEXT    NOT NULL,
		embedding   BLOB    NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("vec: vec_messages: %w", err)
	}
	_, err = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_vec_contact ON vec_messages(contact_key)`)
	if err != nil {
		return fmt.Errorf("vec: idx_vec_contact: %w", err)
	}
	_, err = aiDB.Exec(`CREATE TABLE IF NOT EXISTS vec_index_status (
		contact_key    TEXT    PRIMARY KEY,
		msg_count      INTEGER NOT NULL DEFAULT 0,
		built_at       INTEGER NOT NULL DEFAULT 0,
		model          TEXT    NOT NULL DEFAULT '',
		dims           INTEGER NOT NULL DEFAULT 0,
		extract_offset INTEGER NOT NULL DEFAULT -1
	)`)
	if err != nil {
		return fmt.Errorf("vec: vec_index_status: %w", err)
	}
	// 迁移旧库：若列不存在则添加（重复执行安全，失败静默忽略）
	_, _ = aiDB.Exec(`ALTER TABLE vec_index_status ADD COLUMN extract_offset INTEGER NOT NULL DEFAULT -1`)
	return nil
}

// ─── 索引状态 ─────────────────────────────────────────────────────────────────

// VecIndexStatus 是 GetVecIndexStatus 的返回值。
type VecIndexStatus struct {
	Built    bool   `json:"built"`
	MsgCount int    `json:"msg_count"`
	BuiltAt  int64  `json:"built_at"`
	Model    string `json:"model"`
	Dims     int    `json:"dims"`
}

// GetVecIndexStatus 返回指定 key 的向量索引状态。
func GetVecIndexStatus(key string) (VecIndexStatus, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return VecIndexStatus{}, nil
	}
	var st VecIndexStatus
	err := db.QueryRow(
		"SELECT msg_count, built_at, model, dims FROM vec_index_status WHERE contact_key = ?", key,
	).Scan(&st.MsgCount, &st.BuiltAt, &st.Model, &st.Dims)
	if err == sql.ErrNoRows {
		return VecIndexStatus{}, nil
	}
	if err != nil {
		return VecIndexStatus{}, err
	}
	st.Built = st.BuiltAt > 0
	return st, nil
}

// ─── 后台构建状态 ─────────────────────────────────────────────────────────────

// rawMsg 是构建索引时用于统一表示一条消息的中间结构。
type rawMsg struct {
	DateTime string
	Sender   string
	Content  string
}

type vecIndexProgress struct {
	Step      string `json:"step"`
	Current   int    `json:"current,omitempty"`
	Total     int    `json:"total,omitempty"`
	Done      bool   `json:"done,omitempty"`
	Error     string `json:"error,omitempty"`
	FactCount int    `json:"fact_count,omitempty"`
}

// vecBuildJob 记录单个联系人向量索引的后台构建进度（进程内内存，重启后清空）。
type vecBuildJob struct {
	mu        sync.Mutex
	Step      string `json:"step"`
	Current   int    `json:"current"`
	Total     int    `json:"total"`
	Done      bool   `json:"done"`
	Error     string `json:"error,omitempty"`
	FactCount int    `json:"fact_count"`
}

var (
	vecJobs   = make(map[string]*vecBuildJob)
	vecJobsMu sync.Mutex
)

// getOrCreateJob 返回 key 对应的 job（不存在则新建）。
func getOrCreateJob(key string) *vecBuildJob {
	vecJobsMu.Lock()
	defer vecJobsMu.Unlock()
	if j, ok := vecJobs[key]; ok {
		return j
	}
	j := &vecBuildJob{}
	vecJobs[key] = j
	return j
}

// GetVecBuildProgress 返回 key 的当前构建进度快照，不存在时返回 nil。
func GetVecBuildProgress(key string) *vecIndexProgress {
	vecJobsMu.Lock()
	j, ok := vecJobs[key]
	vecJobsMu.Unlock()
	if !ok {
		return nil
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	p := &vecIndexProgress{
		Step:      j.Step,
		Current:   j.Current,
		Total:     j.Total,
		Done:      j.Done,
		Error:     j.Error,
		FactCount: j.FactCount,
	}
	return p
}

// ─── 构建向量索引 ─────────────────────────────────────────────────────────────

// StartVecIndexBackground 在后台 goroutine 中构建向量索引，立即返回。
// 进度通过 GetVecBuildProgress 轮询获取。
func StartVecIndexBackground(key, username string, isGroup bool, svc *service.ContactService, prefs Preferences) {
	job := getOrCreateJob(key)
	job.mu.Lock()
	// 如果已在构建中，忽略重复请求
	if job.Step != "" && !job.Done && job.Error == "" {
		job.mu.Unlock()
		return
	}
	job.Step = "loading"
	job.Current = 0
	job.Total = 0
	job.Done = false
	job.Error = ""
	job.mu.Unlock()

	go buildVecIndexCore(key, username, isGroup, svc, prefs, func(p vecIndexProgress) {
		job.mu.Lock()
		job.Step = p.Step
		job.Current = p.Current
		job.Total = p.Total
		job.Done = p.Done
		job.Error = p.Error
		job.FactCount = p.FactCount
		job.mu.Unlock()
	})
}

// buildVecIndexCore 是实际构建逻辑，通过 progressFn 回调上报进度。
func buildVecIndexCore(key, username string, isGroup bool, svc *service.ContactService, prefs Preferences, progressFn func(vecIndexProgress)) {
	sendP := progressFn

	cfg := defaultEmbeddingConfig(prefs)

	if svc == nil {
		sendP(vecIndexProgress{Step: "error", Error: "服务不可用，请先配置数据目录"})
		return
	}

	sendP(vecIndexProgress{Step: "loading"})

	var msgs []rawMsg

	if isGroup {
		for _, m := range svc.ExportGroupMessagesAll(username) {
			if strings.HasPrefix(m.Content, "[") {
				continue
			}
			msgs = append(msgs, rawMsg{m.Date + " " + m.Time, m.Speaker, m.Content})
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
			msgs = append(msgs, rawMsg{m.Date + " " + m.Time, sender, m.Content})
		}
	}

	total := len(msgs)
	if total == 0 {
		sendP(vecIndexProgress{Step: "error", Error: "该联系人暂无可索引的文本消息"})
		return
	}

	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		sendP(vecIndexProgress{Step: "error", Error: "数据库未初始化"})
		return
	}

	if _, err := db.Exec("DELETE FROM vec_messages WHERE contact_key = ?", key); err != nil {
		sendP(vecIndexProgress{Step: "error", Error: "清理旧索引失败：" + err.Error()})
		return
	}
	if _, err := db.Exec("DELETE FROM vec_index_status WHERE contact_key = ?", key); err != nil {
		sendP(vecIndexProgress{Step: "error", Error: "清理旧状态失败：" + err.Error()})
		return
	}

	sendP(vecIndexProgress{Step: "embedding", Current: 0, Total: total})

	// Ollama 较慢，用小批次；云端 API 支持更大批次
	batchSize := 20
	if cfg.Provider != "ollama" {
		batchSize = 200
	}

	for i := 0; i < total; i += batchSize {
		end := i + batchSize
		if end > total {
			end = total
		}
		batch := msgs[i:end]

		texts := make([]string, len(batch))
		for j, m := range batch {
			// 拼入发送者，让语义更完整（"我: 好的" vs "对方: 好的"）
			text := m.Sender + ": " + m.Content
			// 截断超长文本：nomic-embed-text 默认上下文 2048 token，中文约 500 字/批
			texts[j] = truncateRunes(text, 400)
		}

		embeddings, err := GetEmbeddingsBatch(texts, cfg)
		if err != nil {
			sendP(vecIndexProgress{Step: "error", Error: "Embedding 失败：" + err.Error()})
			return
		}

		tx, err := db.Begin()
		if err != nil {
			sendP(vecIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		stmt, err := tx.Prepare(
			"INSERT INTO vec_messages(contact_key, seq, datetime, sender, content, embedding) VALUES(?,?,?,?,?,?)")
		if err != nil {
			tx.Rollback()
			sendP(vecIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		for j, emb := range embeddings {
			if emb == nil {
				continue
			}
			m := batch[j]
			if _, err := stmt.Exec(key, i+j, m.DateTime, m.Sender, m.Content, encodeVec(emb)); err != nil {
				stmt.Close()
				tx.Rollback()
				sendP(vecIndexProgress{Step: "error", Error: err.Error()})
				return
			}
		}
		stmt.Close()
		if err := tx.Commit(); err != nil {
			sendP(vecIndexProgress{Step: "error", Error: err.Error()})
			return
		}
		sendP(vecIndexProgress{Step: "embedding", Current: end, Total: total})
	}

	if _, err := db.Exec(`
		INSERT INTO vec_index_status(contact_key, msg_count, built_at, model, dims) VALUES(?,?,?,?,?)
		ON CONFLICT(contact_key) DO UPDATE SET
			msg_count=excluded.msg_count, built_at=excluded.built_at,
			model=excluded.model, dims=excluded.dims`,
		key, total, time.Now().Unix(), cfg.Model, cfg.Dims,
	); err != nil {
		sendP(vecIndexProgress{Step: "error", Error: err.Error()})
		return
	}

	sendP(vecIndexProgress{Step: "done", Done: true, Total: total})
}

// ─── 向量检索 ─────────────────────────────────────────────────────────────────

const (
	// vecChunkRows：每次从 DB 加载的行数，控制内存上限。
	// 峰值内存 = vecChunkRows × dims × 4 bytes
	// 5000 × 1536 × 4 = 30 MB（OpenAI），5000 × 768 × 4 = 15 MB（Ollama）
	vecChunkRows = 5000
	// vecWindowSize：命中条目前后各扩展的消息数（比 FTS 小，因为语义命中更精准）
	vecWindowSize = 3
)

type vecCandidate struct {
	seq        int
	similarity float32
}

// SearchVec 对指定联系人执行向量相似度检索，返回 top-K 命中 + 上下文窗口扩展。
// 采用分块加载：每次只读 vecChunkRows 条 embedding，内存安全，适用于大群聊（10 万条以上）。
func SearchVec(key, query string, topK int, prefs Preferences) ([]RAGResult, map[int]bool, error) {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return nil, nil, fmt.Errorf("数据库未初始化")
	}

	cfg := defaultEmbeddingConfig(prefs)

	// Embed query（单次 API 调用）
	queryEmbs, err := GetEmbeddingsBatch([]string{query}, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("query embedding 失败：%w", err)
	}
	if len(queryEmbs) == 0 || queryEmbs[0] == nil {
		return nil, nil, fmt.Errorf("embedding 返回为空")
	}
	queryVec := queryEmbs[0]

	// 分块扫描：逐块加载 embedding，计算相似度，只保留 (seq, similarity)
	var candidates []vecCandidate
	offset := 0
	for {
		rows, err := db.Query(
			`SELECT seq, embedding FROM vec_messages WHERE contact_key = ? ORDER BY seq LIMIT ? OFFSET ?`,
			key, vecChunkRows, offset,
		)
		if err != nil {
			return nil, nil, err
		}
		count := 0
		for rows.Next() {
			var seq int
			var blob []byte
			rows.Scan(&seq, &blob)
			vec := decodeVec(blob)
			if len(vec) != len(queryVec) {
				continue // 维度不匹配（索引用了不同模型），跳过
			}
			sim := cosineSimilarity(queryVec, vec)
			candidates = append(candidates, vecCandidate{seq, sim})
			count++
		}
		rows.Close()
		if count < vecChunkRows {
			break
		}
		offset += vecChunkRows
	}

	if len(candidates) == 0 {
		return nil, nil, nil
	}

	// 按相似度降序，取 top-K
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].similarity > candidates[j].similarity
	})
	if len(candidates) > topK {
		candidates = candidates[:topK]
	}

	seqSet := make(map[int]bool)
	for _, c := range candidates {
		seqSet[c.seq] = true
	}

	// 构建 ±vecWindowSize 窗口并合并重叠区间
	hitSeqs := make([]int, 0, len(seqSet))
	for seq := range seqSet {
		hitSeqs = append(hitSeqs, seq)
	}
	sort.Ints(hitSeqs)

	type seqRange struct{ start, end int }
	ranges := make([]seqRange, 0, len(hitSeqs))
	for _, seq := range hitSeqs {
		lo := seq - vecWindowSize
		if lo < 0 {
			lo = 0
		}
		ranges = append(ranges, seqRange{lo, seq + vecWindowSize})
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

	// 按 seq 范围查询消息内容
	seen := make(map[int]bool)
	var results []RAGResult
	for _, r := range merged {
		winRows, err := db.Query(
			`SELECT seq, datetime, sender, content FROM vec_messages
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
	return results, seqSet, nil
}
