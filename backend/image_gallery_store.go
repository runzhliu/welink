package main

// image_gallery_store.go — 「AI 画廊」持久化
//
// 每一张成功生成的图都落 images 一行，hash 与磁盘 png 文件名同名（沿用 imageHashV2）。
// images_fts 提供 prompt + tags 的全文检索。
//
// 软删策略：DELETE 走软删（写 deleted_at），后台 GC 每天清理一次 deleted_at < now-30d 的物理 png + 行。

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

// ImageRecord 对应 images 表一行 + 上一段 used_in 解析后的结构。
type ImageRecord struct {
	Hash       string         `json:"hash"`
	Prompt     string         `json:"prompt"`
	Scene      string         `json:"scene"`
	Provider   string         `json:"provider"`
	Model      string         `json:"model"`
	Size       string         `json:"size"`
	TaskID     string         `json:"task_id,omitempty"`
	ParentHash string         `json:"parent_hash,omitempty"`
	Starred    bool           `json:"starred"`
	Tags       []string       `json:"tags,omitempty"`
	UsedIn     []UsedInEntry  `json:"used_in,omitempty"`
	CreatedAt  int64          `json:"created_at"`
	DeletedAt  int64          `json:"deleted_at,omitempty"`
	URL        string         `json:"url,omitempty"` // 拼出来的 /api/image/cache/<hash>
}

// UsedInEntry 标记某张图在哪些地方被引用了。
//   kind: avatar / highlight / year_review_cover / playground / ...
//   ref:  与 kind 相关的引用键（如 wxid_xxx / room@chatroom）
type UsedInEntry struct {
	Kind string `json:"kind"`
	Ref  string `json:"ref,omitempty"`
	At   int64  `json:"at,omitempty"`
}

func initImageGalleryTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS images (
		hash         TEXT PRIMARY KEY,
		prompt       TEXT NOT NULL,
		scene        TEXT NOT NULL DEFAULT '',
		provider     TEXT NOT NULL,
		model        TEXT NOT NULL,
		size         TEXT NOT NULL,
		task_id      TEXT NOT NULL DEFAULT '',
		parent_hash  TEXT NOT NULL DEFAULT '',
		starred      INTEGER NOT NULL DEFAULT 0,
		tags_json    TEXT NOT NULL DEFAULT '[]',
		used_in_json TEXT NOT NULL DEFAULT '[]',
		created_at   INTEGER NOT NULL,
		deleted_at   INTEGER NOT NULL DEFAULT 0
	)`)
	if err != nil {
		return fmt.Errorf("image_gallery_store: create: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_images_scene_created ON images(scene, created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_images_starred       ON images(starred, created_at DESC)`)
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_images_deleted       ON images(deleted_at)`)

	// FTS5 虚拟表（contentless）。prompt + 拍平的 tags 字符串。
	// 与现有 ai_store 里 FTS 用法一致。
	_, _ = aiDB.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
		hash UNINDEXED, prompt, tags, content=''
	)`)
	return nil
}

// UpsertImageRecord 落一张图（成功生成时由 worker 调）。同 hash 已存在则 patch：
//   - 强制把 deleted_at 清零（用户重新生成相同 prompt = 复活）
//   - 不动 starred / tags / used_in（保留用户标记）
func UpsertImageRecord(r *ImageRecord) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_gallery_store: db not initialized")
	}
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	tagsJSON, _ := json.Marshal(r.Tags)
	usedInJSON, _ := json.Marshal(r.UsedIn)

	// 先尝试 update（软删的会被复活）
	res, err := aiDB.Exec(`UPDATE images SET deleted_at = 0 WHERE hash = ?`, r.Hash)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		// FTS 行已有，不重建
		return nil
	}

	_, err = aiDB.Exec(`INSERT INTO images
		(hash, prompt, scene, provider, model, size, task_id, parent_hash, starred, tags_json, used_in_json, created_at, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
		r.Hash, r.Prompt, r.Scene, r.Provider, r.Model, r.Size, r.TaskID, r.ParentHash,
		string(tagsJSON), string(usedInJSON), r.CreatedAt)
	if err != nil {
		return err
	}
	// FTS 索引
	_, _ = aiDB.Exec(`INSERT INTO images_fts(hash, prompt, tags) VALUES (?, ?, ?)`,
		r.Hash, r.Prompt, strings.Join(r.Tags, " "))
	return nil
}

// AppendImageUsedIn 给一张图加一条 used_in 引用。同 (kind, ref) 已存在不重复。
func AppendImageUsedIn(hash string, entry UsedInEntry) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_gallery_store: db not initialized")
	}
	var raw string
	err := aiDB.QueryRow(`SELECT used_in_json FROM images WHERE hash = ?`, hash).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil // 图还没入库，跳过；worker 入库时本身会带 used_in
	}
	if err != nil {
		return err
	}
	var arr []UsedInEntry
	_ = json.Unmarshal([]byte(raw), &arr)
	for _, e := range arr {
		if e.Kind == entry.Kind && e.Ref == entry.Ref {
			return nil
		}
	}
	if entry.At == 0 {
		entry.At = time.Now().Unix()
	}
	arr = append(arr, entry)
	out, _ := json.Marshal(arr)
	_, err = aiDB.Exec(`UPDATE images SET used_in_json = ? WHERE hash = ?`, string(out), hash)
	return err
}

// GetImageRecord 单张图详情。软删的也返回（前端可显示「已删除」状态）。
func GetImageRecord(hash string) (*ImageRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("image_gallery_store: db not initialized")
	}
	r, err := scanImageRow(aiDB.QueryRow(`SELECT hash, prompt, scene, provider, model, size, task_id, parent_hash,
		starred, tags_json, used_in_json, created_at, deleted_at FROM images WHERE hash = ?`, hash))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

// ListImagesFilter 是 GET /api/images 的查询参数集。
type ListImagesFilter struct {
	Q              string // 关键词（命中 FTS）
	Scene          string // 限定 scene
	Provider       string // 限定 provider
	StarredOnly    bool
	IncludeDeleted bool
	Limit, Offset  int
}

// ListImages 返回画廊列表。
func ListImages(f ListImagesFilter) ([]ImageRecord, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("image_gallery_store: db not initialized")
	}
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 60
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	conds := []string{}
	args := []any{}
	if !f.IncludeDeleted {
		conds = append(conds, "deleted_at = 0")
	}
	if f.Scene != "" {
		conds = append(conds, "scene = ?")
		args = append(args, f.Scene)
	}
	if f.Provider != "" {
		conds = append(conds, "provider = ?")
		args = append(args, f.Provider)
	}
	if f.StarredOnly {
		conds = append(conds, "starred = 1")
	}

	q := strings.TrimSpace(f.Q)
	var rows *sql.Rows
	var err error
	if q != "" {
		// FTS 搜索：把 q 当 prefix 匹配（FTS5 默认 token 行为）。
		ftsQuery := strings.ReplaceAll(q, `"`, `""`)
		base := `SELECT i.hash, i.prompt, i.scene, i.provider, i.model, i.size, i.task_id, i.parent_hash,
			i.starred, i.tags_json, i.used_in_json, i.created_at, i.deleted_at
			FROM images i JOIN images_fts f ON f.hash = i.hash
			WHERE images_fts MATCH ?`
		if len(conds) > 0 {
			base += " AND " + strings.Join(conds, " AND ")
		}
		base += " ORDER BY i.starred DESC, i.created_at DESC LIMIT ? OFFSET ?"
		args = append([]any{ftsQuery}, args...)
		args = append(args, f.Limit, f.Offset)
		rows, err = aiDB.Query(base, args...)
	} else {
		base := `SELECT hash, prompt, scene, provider, model, size, task_id, parent_hash,
			starred, tags_json, used_in_json, created_at, deleted_at FROM images`
		if len(conds) > 0 {
			base += " WHERE " + strings.Join(conds, " AND ")
		}
		base += " ORDER BY starred DESC, created_at DESC LIMIT ? OFFSET ?"
		args = append(args, f.Limit, f.Offset)
		rows, err = aiDB.Query(base, args...)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImageRecord
	for rows.Next() {
		r, e := scanImageRow(rows)
		if e != nil {
			continue
		}
		out = append(out, *r)
	}
	return out, nil
}

// CountImages 与 ListImages 同条件下的总数（不分页）。前端做翻页用。
func CountImages(f ListImagesFilter) (int, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("image_gallery_store: db not initialized")
	}
	conds := []string{}
	args := []any{}
	if !f.IncludeDeleted {
		conds = append(conds, "deleted_at = 0")
	}
	if f.Scene != "" {
		conds = append(conds, "scene = ?")
		args = append(args, f.Scene)
	}
	if f.Provider != "" {
		conds = append(conds, "provider = ?")
		args = append(args, f.Provider)
	}
	if f.StarredOnly {
		conds = append(conds, "starred = 1")
	}
	q := strings.TrimSpace(f.Q)
	var count int
	if q != "" {
		base := `SELECT COUNT(*) FROM images i JOIN images_fts f ON f.hash = i.hash WHERE images_fts MATCH ?`
		if len(conds) > 0 {
			base += " AND " + strings.Join(conds, " AND ")
		}
		args = append([]any{q}, args...)
		err := aiDB.QueryRow(base, args...).Scan(&count)
		return count, err
	}
	base := `SELECT COUNT(*) FROM images`
	if len(conds) > 0 {
		base += " WHERE " + strings.Join(conds, " AND ")
	}
	err := aiDB.QueryRow(base, args...).Scan(&count)
	return count, err
}

// UpdateImagePatch 批量字段更新（star / tags / 加 used_in）。
type ImagePatch struct {
	Starred    *bool        `json:"starred,omitempty"`
	Tags       *[]string    `json:"tags,omitempty"`
	AppendUsed *UsedInEntry `json:"-"`
}

func PatchImage(hash string, p ImagePatch) error {
	if p.AppendUsed != nil {
		if err := AppendImageUsedIn(hash, *p.AppendUsed); err != nil {
			return err
		}
	}
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_gallery_store: db not initialized")
	}
	fields := []string{}
	args := []any{}
	if p.Starred != nil {
		fields = append(fields, "starred = ?")
		if *p.Starred {
			args = append(args, 1)
		} else {
			args = append(args, 0)
		}
	}
	if p.Tags != nil {
		tagsJSON, _ := json.Marshal(*p.Tags)
		fields = append(fields, "tags_json = ?")
		args = append(args, string(tagsJSON))
		// 同步 FTS
		_, _ = aiDB.Exec(`UPDATE images_fts SET tags = ? WHERE hash = ?`,
			strings.Join(*p.Tags, " "), hash)
	}
	if len(fields) == 0 {
		return nil
	}
	args = append(args, hash)
	_, err := aiDB.Exec(`UPDATE images SET `+strings.Join(fields, ", ")+` WHERE hash = ?`, args...)
	return err
}

// SoftDeleteImage 软删（写 deleted_at）。
func SoftDeleteImage(hash string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_gallery_store: db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE images SET deleted_at = ? WHERE hash = ?`, time.Now().Unix(), hash)
	return err
}

// HardDeleteImage 立即删 DB 行 + FTS + 物理 png。
func HardDeleteImage(hash string) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("image_gallery_store: db not initialized")
	}
	_, _ = aiDB.Exec(`DELETE FROM images WHERE hash = ?`, hash)
	_, _ = aiDB.Exec(`DELETE FROM images_fts WHERE hash = ?`, hash)
	if path, ok := imageCachePath(hash); ok {
		_ = os.Remove(path)
	}
	return nil
}

// GCDeletedImages 清理软删超过 retentionDays 的物理文件 + DB 行。
// 返回清理数量。
func GCDeletedImages(retentionDays int) (int, error) {
	if retentionDays <= 0 {
		retentionDays = 30
	}
	cutoff := time.Now().Unix() - int64(retentionDays*86400)

	aiDBMu.Lock()
	if aiDB == nil {
		aiDBMu.Unlock()
		return 0, fmt.Errorf("image_gallery_store: db not initialized")
	}
	rows, err := aiDB.Query(`SELECT hash FROM images WHERE deleted_at > 0 AND deleted_at < ?`, cutoff)
	if err != nil {
		aiDBMu.Unlock()
		return 0, err
	}
	var hashes []string
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err == nil {
			hashes = append(hashes, h)
		}
	}
	rows.Close()
	aiDBMu.Unlock()

	n := 0
	for _, h := range hashes {
		if err := HardDeleteImage(h); err == nil {
			n++
		}
	}
	return n, nil
}

// StartGalleryGC 启动后台 ticker 每天跑一次 GC（30 天保留）。
func StartGalleryGC() {
	go func() {
		// 启动后 1 分钟先跑一次（清陈年遗留），之后每 24 小时一次
		time.Sleep(time.Minute)
		for {
			if n, err := GCDeletedImages(30); err == nil && n > 0 {
				slog.Info("image_gallery: GC 完成", "removed", n)
			}
			time.Sleep(24 * time.Hour)
		}
	}()
}

// scanImageRow 复用：rows / *Row 都有 Scan，用接口抽。
type rowScanner interface {
	Scan(dest ...any) error
}

func scanImageRow(rs rowScanner) (*ImageRecord, error) {
	var r ImageRecord
	var starredInt int
	var tagsJSON, usedInJSON string
	if err := rs.Scan(&r.Hash, &r.Prompt, &r.Scene, &r.Provider, &r.Model, &r.Size, &r.TaskID, &r.ParentHash,
		&starredInt, &tagsJSON, &usedInJSON, &r.CreatedAt, &r.DeletedAt); err != nil {
		return nil, err
	}
	r.Starred = starredInt != 0
	_ = json.Unmarshal([]byte(tagsJSON), &r.Tags)
	_ = json.Unmarshal([]byte(usedInJSON), &r.UsedIn)
	if r.Hash != "" {
		r.URL = "/api/image/cache/" + r.Hash
	}
	return &r, nil
}
