package main

// vn_store.go — 视觉小说（VN / 互动小说）的持久化层
//
// 3 张表（均落 ai_analysis.db，受 aiDBMu 保护）：
//   vn_stories             一次游玩的元数据 + 当前 state
//   vn_chapters            每章一行（含 narration / choices / 玩家选项 / 状态快照）
//   vn_endings_unlocked    某联系人解锁过的结局（多周目展示「还差几个未通」）
//
// 设计注解：
//   - 整段剧情由 vn.go 「按需流式」生成；每章生成后立即 INSERT，玩家选完后 UPDATE chosen_idx
//   - state 每章合并一次（state_delta 加到 vn_stories.state_json）；chapters.state_after
//     保存玩家选完后的快照，便于读档 rewind 回到任意章
//   - 玩家选项 -1 = 未选；存档 status 终态为 ended
//   - vn_endings_unlocked 用 (username, ending_type) 联合主键，多次达成同结局只记第一次

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// 状态常量
const (
	VNStoryRunning = "running"
	VNStoryEnded   = "ended"

	VNEndingTrue   = "true"
	VNEndingHappy  = "happy"
	VNEndingNormal = "normal"
	VNEndingBad    = "bad"
	VNEndingSecret = "secret"

	VNModeFree   = "free"
	VNModeQuest  = "quest"
	VNModeMemory = "memory"
)

// VNFact 是从 mem_facts 抽样作为剧情素材的最小结构（开局时快照进 vn_stories）。
type VNFact struct {
	Fact string `json:"fact"`
}

// VNChoice 单个分支选项；前端展示，玩家选完写回 chapter.chosen_idx。
type VNChoice struct {
	Text       string                 `json:"text"`
	Tone       string                 `json:"tone,omitempty"`       // soft / firm / silent / playful / ...
	StateDelta map[string]interface{} `json:"state_delta,omitempty"` // {affinity:+5, flags:["mentioned_japan"]}
}

// VNEndingPayload 结局判定结果。在最后一章 LLM 一并返回。
type VNEndingPayload struct {
	Type          string   `json:"type"` // true|happy|normal|bad|secret
	Title         string   `json:"title"`
	Epilogue      string   `json:"epilogue"`
	TurningPoints []string `json:"turning_points,omitempty"` // 每章一句话回顾
}

// VNState 跑剧的运行时状态。
type VNState struct {
	Affinity     int      `json:"affinity"`      // 0-100
	Tension      int      `json:"tension"`       // 0-100
	Flags        []string `json:"flags"`         // 已触发的关键事件标签
	CriticalHits int      `json:"critical_hits"` // 命中 critical_choice 次数
	Dealbreaker  bool     `json:"dealbreaker"`   // 是否踩雷
}

// VNStory 一次游玩的元数据 + 当前状态（vn_stories 一行）。
type VNStory struct {
	ID           int64           `json:"id"`
	Username     string          `json:"username"`
	Title        string          `json:"title"`
	Synopsis     string          `json:"synopsis"`
	Mode         string          `json:"mode"`  // free / quest / memory
	Quest        string          `json:"quest"` // mode=quest 时玩家给的目标
	PersonaSnap  string          `json:"persona_snap"`  // 开局时 clone_profile.prompt 快照
	FactsSnap    []VNFact        `json:"facts_snap"`
	State        VNState         `json:"state"`
	Status       string          `json:"status"`         // running / ended
	EndingType   string          `json:"ending_type,omitempty"`
	Ending       *VNEndingPayload `json:"ending,omitempty"`
	MaxChapters  int             `json:"max_chapters"`
	ProfileID    string          `json:"profile_id,omitempty"`
	CreatedAt    int64           `json:"created_at"`
	EndedAt      int64           `json:"ended_at,omitempty"`
	UpdatedAt    int64           `json:"updated_at"`
}

// VNChapter 一章（vn_chapters 一行）。
type VNChapter struct {
	ID          int64      `json:"id"`
	StoryID     int64      `json:"story_id"`
	ChapterIdx  int        `json:"chapter_idx"`
	Narration   string     `json:"narration"`
	Choices     []VNChoice `json:"choices"`
	ChosenIdx   int        `json:"chosen_idx"`   // -1 = 未选
	StateAfter  VNState    `json:"state_after"`  // 玩家选完后的状态（用于读档回滚）
	ImageHash   string     `json:"image_hash,omitempty"`
	GeneratedAt int64      `json:"generated_at"`
	DecidedAt   int64      `json:"decided_at,omitempty"`
}

// VNEndingUnlocked 解锁过的结局（按 username 聚合用）。
type VNEndingUnlocked struct {
	EndingType string `json:"ending_type"`
	StoryID    int64  `json:"story_id"`
	UnlockedAt int64  `json:"unlocked_at"`
}

func initVNTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS vn_stories (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		username        TEXT    NOT NULL,
		title           TEXT    NOT NULL DEFAULT '',
		synopsis        TEXT    NOT NULL DEFAULT '',
		mode            TEXT    NOT NULL DEFAULT 'free',
		quest           TEXT    NOT NULL DEFAULT '',
		persona_snap    TEXT    NOT NULL DEFAULT '',
		facts_snap_json TEXT    NOT NULL DEFAULT '[]',
		state_json      TEXT    NOT NULL DEFAULT '{}',
		status          TEXT    NOT NULL DEFAULT 'running',
		ending_type     TEXT    NOT NULL DEFAULT '',
		ending_json     TEXT    NOT NULL DEFAULT '{}',
		max_chapters    INTEGER NOT NULL DEFAULT 6,
		profile_id      TEXT    NOT NULL DEFAULT '',
		created_at      INTEGER NOT NULL,
		ended_at        INTEGER NOT NULL DEFAULT 0,
		updated_at      INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("vn_store: create vn_stories: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_vn_stories_user ON vn_stories(username, updated_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_vn_stories_status ON vn_stories(status)`)

	_, err = aiDB.Exec(`CREATE TABLE IF NOT EXISTS vn_chapters (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		story_id       INTEGER NOT NULL,
		chapter_idx    INTEGER NOT NULL,
		narration      TEXT    NOT NULL DEFAULT '',
		choices_json   TEXT    NOT NULL DEFAULT '[]',
		chosen_idx     INTEGER NOT NULL DEFAULT -1,
		state_after    TEXT    NOT NULL DEFAULT '{}',
		image_hash     TEXT    NOT NULL DEFAULT '',
		generated_at   INTEGER NOT NULL,
		decided_at     INTEGER NOT NULL DEFAULT 0,
		UNIQUE(story_id, chapter_idx)
	)`)
	if err != nil {
		return fmt.Errorf("vn_store: create vn_chapters: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_vn_chapters_story ON vn_chapters(story_id, chapter_idx)`)

	_, err = aiDB.Exec(`CREATE TABLE IF NOT EXISTS vn_endings_unlocked (
		username     TEXT    NOT NULL,
		ending_type  TEXT    NOT NULL,
		story_id     INTEGER NOT NULL,
		unlocked_at  INTEGER NOT NULL,
		PRIMARY KEY (username, ending_type)
	)`)
	if err != nil {
		return fmt.Errorf("vn_store: create vn_endings_unlocked: %w", err)
	}
	return nil
}

// ── vn_stories CRUD ──────────────────────────────────────────────────────────

// InsertVNStory 写一条新存档。返回自增 id。
func InsertVNStory(s *VNStory) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("vn_store: db not initialized")
	}
	now := time.Now().Unix()
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	if s.Status == "" {
		s.Status = VNStoryRunning
	}
	if s.MaxChapters <= 0 {
		s.MaxChapters = 6
	}
	factsJSON, _ := json.Marshal(s.FactsSnap)
	stateJSON, _ := json.Marshal(s.State)
	endingJSON := []byte("{}")
	if s.Ending != nil {
		endingJSON, _ = json.Marshal(s.Ending)
	}
	res, err := aiDB.Exec(`INSERT INTO vn_stories
		(username, title, synopsis, mode, quest, persona_snap, facts_snap_json, state_json,
		 status, ending_type, ending_json, max_chapters, profile_id, created_at, ended_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.Username, s.Title, s.Synopsis, s.Mode, s.Quest, s.PersonaSnap,
		string(factsJSON), string(stateJSON),
		s.Status, s.EndingType, string(endingJSON), s.MaxChapters, s.ProfileID,
		s.CreatedAt, s.EndedAt, s.UpdatedAt)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	s.ID = id
	return id, nil
}

// GetVNStory 按 id 查存档。不存在返回 (nil, nil)。
func GetVNStory(id int64) (*VNStory, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("vn_store: db not initialized")
	}
	return scanVNStory(aiDB.QueryRow(`SELECT
		id, username, title, synopsis, mode, quest, persona_snap, facts_snap_json, state_json,
		status, ending_type, ending_json, max_chapters, profile_id, created_at, ended_at, updated_at
		FROM vn_stories WHERE id = ?`, id))
}

// ListVNStoriesByUsername 按联系人列出存档（按 updated_at 倒序）。
func ListVNStoriesByUsername(username string, limit int) ([]VNStory, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("vn_store: db not initialized")
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := aiDB.Query(`SELECT
		id, username, title, synopsis, mode, quest, persona_snap, facts_snap_json, state_json,
		status, ending_type, ending_json, max_chapters, profile_id, created_at, ended_at, updated_at
		FROM vn_stories WHERE username = ? ORDER BY updated_at DESC LIMIT ?`, username, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VNStory
	for rows.Next() {
		s, e := scanVNStory(rows)
		if e != nil || s == nil {
			continue
		}
		out = append(out, *s)
	}
	return out, nil
}

// UpdateVNStoryState 仅更新 state + updated_at（每章合并 state_delta 后写一次）。
func UpdateVNStoryState(id int64, state VNState) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	b, _ := json.Marshal(state)
	_, err := aiDB.Exec(`UPDATE vn_stories SET state_json = ?, updated_at = ? WHERE id = ?`,
		string(b), time.Now().Unix(), id)
	return err
}

// UpdateVNStoryTitle 仅更新 title + synopsis（第 1 章生成时由 LLM 回填）。
func UpdateVNStoryTitle(id int64, title, synopsis string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE vn_stories SET title = ?, synopsis = ?, updated_at = ? WHERE id = ?`,
		title, synopsis, time.Now().Unix(), id)
	return err
}

// EndVNStory 标存档为 ended + 写 ending 元数据。
func EndVNStory(id int64, endingType string, ending VNEndingPayload) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	endingJSON, _ := json.Marshal(ending)
	now := time.Now().Unix()
	_, err := aiDB.Exec(`UPDATE vn_stories
		SET status = ?, ending_type = ?, ending_json = ?, ended_at = ?, updated_at = ?
		WHERE id = ?`,
		VNStoryEnded, endingType, string(endingJSON), now, now, id)
	return err
}

// DeleteVNStory 删存档 + 级联删 chapters（手动）。
func DeleteVNStory(id int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	if _, err := aiDB.Exec(`DELETE FROM vn_chapters WHERE story_id = ?`, id); err != nil {
		return err
	}
	_, err := aiDB.Exec(`DELETE FROM vn_stories WHERE id = ?`, id)
	return err
}

// ── vn_chapters CRUD ────────────────────────────────────────────────────────

// InsertVNChapter 新章入库。chosen_idx 初始 -1。
func InsertVNChapter(ch *VNChapter) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("vn_store: db not initialized")
	}
	if ch.GeneratedAt == 0 {
		ch.GeneratedAt = time.Now().Unix()
	}
	if ch.ChosenIdx == 0 {
		// 防御：调用方应显式置 -1，避免漏初始化
		ch.ChosenIdx = -1
	}
	choicesJSON, _ := json.Marshal(ch.Choices)
	stateJSON, _ := json.Marshal(ch.StateAfter)
	res, err := aiDB.Exec(`INSERT INTO vn_chapters
		(story_id, chapter_idx, narration, choices_json, chosen_idx, state_after, image_hash, generated_at, decided_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ch.StoryID, ch.ChapterIdx, ch.Narration, string(choicesJSON), ch.ChosenIdx,
		string(stateJSON), ch.ImageHash, ch.GeneratedAt, ch.DecidedAt)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	ch.ID = id
	return id, nil
}

// UpdateVNChapterChosen 写回玩家所选选项 + 选完后的状态快照。
func UpdateVNChapterChosen(storyID int64, chapterIdx, chosenIdx int, stateAfter VNState) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	b, _ := json.Marshal(stateAfter)
	_, err := aiDB.Exec(`UPDATE vn_chapters
		SET chosen_idx = ?, state_after = ?, decided_at = ?
		WHERE story_id = ? AND chapter_idx = ?`,
		chosenIdx, string(b), time.Now().Unix(), storyID, chapterIdx)
	return err
}

// UpdateVNChapterImage 写回封面图 hash。
func UpdateVNChapterImage(storyID int64, chapterIdx int, imageHash string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE vn_chapters SET image_hash = ? WHERE story_id = ? AND chapter_idx = ?`,
		imageHash, storyID, chapterIdx)
	return err
}

// ListVNChapters 按 chapter_idx 升序返回某存档的所有章节。
func ListVNChapters(storyID int64) ([]VNChapter, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("vn_store: db not initialized")
	}
	rows, err := aiDB.Query(`SELECT id, story_id, chapter_idx, narration, choices_json, chosen_idx,
		state_after, image_hash, generated_at, decided_at
		FROM vn_chapters WHERE story_id = ? ORDER BY chapter_idx ASC`, storyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VNChapter
	for rows.Next() {
		var ch VNChapter
		var choicesJSON, stateJSON string
		if err := rows.Scan(&ch.ID, &ch.StoryID, &ch.ChapterIdx, &ch.Narration, &choicesJSON,
			&ch.ChosenIdx, &stateJSON, &ch.ImageHash, &ch.GeneratedAt, &ch.DecidedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(choicesJSON), &ch.Choices)
		_ = json.Unmarshal([]byte(stateJSON), &ch.StateAfter)
		out = append(out, ch)
	}
	return out, nil
}

// RewindVNChapters 删除 > to_chapter 的所有章节（读档回滚用）。
// 调用方负责把 stories.state_json 同步回 chapters[to].state_after。
func RewindVNChapters(storyID int64, toChapter int) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("vn_store: db not initialized")
	}
	res, err := aiDB.Exec(`DELETE FROM vn_chapters WHERE story_id = ? AND chapter_idx > ?`,
		storyID, toChapter)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	// 同时把 status 重置为 running（结局可能已经写过）
	_, _ = aiDB.Exec(`UPDATE vn_stories SET status = ?, ending_type = '', ending_json = '{}', ended_at = 0, updated_at = ?
		WHERE id = ?`, VNStoryRunning, time.Now().Unix(), storyID)
	return n, nil
}

// ── vn_endings_unlocked ─────────────────────────────────────────────────────

// UnlockVNEnding 第一次达成某结局时落一条。已存在则 no-op。
func UnlockVNEnding(username, endingType string, storyID int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("vn_store: db not initialized")
	}
	_, err := aiDB.Exec(`INSERT OR IGNORE INTO vn_endings_unlocked
		(username, ending_type, story_id, unlocked_at) VALUES (?, ?, ?, ?)`,
		username, endingType, storyID, time.Now().Unix())
	return err
}

// ListVNEndingsUnlocked 列出某联系人已解锁的结局。
func ListVNEndingsUnlocked(username string) ([]VNEndingUnlocked, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("vn_store: db not initialized")
	}
	rows, err := aiDB.Query(`SELECT ending_type, story_id, unlocked_at FROM vn_endings_unlocked
		WHERE username = ? ORDER BY unlocked_at DESC`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VNEndingUnlocked
	for rows.Next() {
		var e VNEndingUnlocked
		if err := rows.Scan(&e.EndingType, &e.StoryID, &e.UnlockedAt); err == nil {
			out = append(out, e)
		}
	}
	return out, nil
}

// ── 内部工具 ────────────────────────────────────────────────────────────────

type vnRowScanner interface {
	Scan(dest ...any) error
}

func scanVNStory(rs vnRowScanner) (*VNStory, error) {
	var s VNStory
	var factsJSON, stateJSON, endingJSON string
	err := rs.Scan(&s.ID, &s.Username, &s.Title, &s.Synopsis, &s.Mode, &s.Quest, &s.PersonaSnap,
		&factsJSON, &stateJSON, &s.Status, &s.EndingType, &endingJSON,
		&s.MaxChapters, &s.ProfileID, &s.CreatedAt, &s.EndedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(factsJSON), &s.FactsSnap)
	_ = json.Unmarshal([]byte(stateJSON), &s.State)
	if endingJSON != "" && endingJSON != "{}" {
		var ep VNEndingPayload
		if e := json.Unmarshal([]byte(endingJSON), &ep); e == nil && ep.Type != "" {
			s.Ending = &ep
		}
	}
	return &s, nil
}

// MergeVNState 把 LLM 返回的 state_delta 合并到当前 state，做边界夹板。
// 用 map[string]interface{} 接收以容忍部分字段缺失。
func MergeVNState(cur VNState, delta map[string]interface{}) VNState {
	if delta == nil {
		return cur
	}
	if v, ok := delta["affinity"]; ok {
		cur.Affinity = clampInt(cur.Affinity+intFromAny(v), 0, 100)
	}
	if v, ok := delta["tension"]; ok {
		cur.Tension = clampInt(cur.Tension+intFromAny(v), 0, 100)
	}
	if v, ok := delta["critical_hits"]; ok {
		cur.CriticalHits += intFromAny(v)
		if cur.CriticalHits < 0 {
			cur.CriticalHits = 0
		}
	}
	if v, ok := delta["dealbreaker"]; ok {
		if b, ok := v.(bool); ok && b {
			cur.Dealbreaker = true
		}
	}
	if v, ok := delta["flags"]; ok {
		if arr, ok := v.([]interface{}); ok {
			for _, f := range arr {
				if s, ok := f.(string); ok && s != "" && !containsString(cur.Flags, s) {
					cur.Flags = append(cur.Flags, s)
				}
			}
		}
	}
	return cur
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func intFromAny(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func containsString(arr []string, s string) bool {
	for _, x := range arr {
		if x == s {
			return true
		}
	}
	return false
}
