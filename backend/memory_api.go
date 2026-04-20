package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// registerMemoryRoutes 挂载 Memory UI 相关端点。
// 目标：让用户可见、可编辑、可置顶 LLM 提炼出来的事实（mem_facts）。
func registerMemoryRoutes(api *gin.RouterGroup) {
	// 全局列表 + 筛选
	api.GET("/memory/list", func(c *gin.Context) {
		contact := c.Query("contact")                // 为空则全量
		q := strings.TrimSpace(c.Query("q"))         // 关键词（fact LIKE）
		pinnedOnly := c.Query("pinned") == "1"
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 500 {
			limit = 100
		}
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}

		db := getAIDB()
		if db == nil {
			c.JSON(http.StatusOK, gin.H{"facts": []MemFact{}, "total": 0})
			return
		}

		whereParts := []string{}
		args := []interface{}{}
		if contact != "" {
			whereParts = append(whereParts, "contact_key = ?")
			args = append(args, contact)
		}
		if pinnedOnly {
			whereParts = append(whereParts, "pinned = 1")
		}
		if q != "" {
			whereParts = append(whereParts, "fact LIKE ?")
			args = append(args, "%"+q+"%")
		}
		where := ""
		if len(whereParts) > 0 {
			where = " WHERE " + strings.Join(whereParts, " AND ")
		}

		// 先统计总数
		var total int
		_ = db.QueryRow("SELECT COUNT(*) FROM mem_facts"+where, args...).Scan(&total)

		// 查列表（置顶优先，创建时间倒序）
		query := "SELECT id, contact_key, fact, source_from, source_to, pinned, created_at, updated_at FROM mem_facts" +
			where + " ORDER BY pinned DESC, id DESC LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
		rows, err := db.Query(query, args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		facts := []MemFact{}
		for rows.Next() {
			var f MemFact
			var pinned int
			rows.Scan(&f.ID, &f.ContactKey, &f.Fact, &f.SourceFrom, &f.SourceTo, &pinned, &f.CreatedAt, &f.UpdatedAt)
			f.Pinned = pinned != 0
			facts = append(facts, f)
		}
		c.JSON(http.StatusOK, gin.H{"facts": facts, "total": total})
	})

	// 每个 contact 的事实数量统计（填充左侧筛选面板）
	api.GET("/memory/contacts", func(c *gin.Context) {
		db := getAIDB()
		if db == nil {
			c.JSON(http.StatusOK, gin.H{"contacts": []gin.H{}})
			return
		}
		rows, err := db.Query(`
			SELECT contact_key, COUNT(*) AS n, SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) AS pinned
			FROM mem_facts
			GROUP BY contact_key
			ORDER BY n DESC`)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		items := []gin.H{}
		for rows.Next() {
			var key string
			var n, pinned int
			rows.Scan(&key, &n, &pinned)
			items = append(items, gin.H{"contact_key": key, "count": n, "pinned_count": pinned})
		}
		c.JSON(http.StatusOK, gin.H{"contacts": items})
	})

	// 编辑 fact 内容
	api.PUT("/memory/:id", func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 非法"})
			return
		}
		var body struct {
			Fact string `json:"fact"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Fact) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "fact 不能为空"})
			return
		}
		db := getAIDB()
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI DB 未就绪"})
			return
		}
		res, err := db.Exec("UPDATE mem_facts SET fact = ?, updated_at = ? WHERE id = ?",
			strings.TrimSpace(body.Fact), time.Now().Unix(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "记忆不存在"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 删除
	api.DELETE("/memory/:id", func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 非法"})
			return
		}
		db := getAIDB()
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI DB 未就绪"})
			return
		}
		if _, err := db.Exec("DELETE FROM mem_facts WHERE id = ?", id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 置顶 / 取消置顶
	api.PUT("/memory/:id/pin", func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 非法"})
			return
		}
		var body struct {
			Pinned bool `json:"pinned"`
		}
		_ = c.ShouldBindJSON(&body)
		db := getAIDB()
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI DB 未就绪"})
			return
		}
		val := 0
		if body.Pinned {
			val = 1
		}
		if _, err := db.Exec("UPDATE mem_facts SET pinned = ?, updated_at = ? WHERE id = ?",
			val, time.Now().Unix(), id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "pinned": body.Pinned})
	})
}

// getAIDB 并发安全地取 aiDB 快照；nil 表示未就绪。
func getAIDB() *sql.DB {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	return aiDB
}

// GetPinnedMemFacts 返回所有 pinned 的事实（可选按 contact_key 过滤）。
// 用于 AI 对话时自动 prepend 到 system prompt。
func GetPinnedMemFacts(contactKey string) ([]MemFact, error) {
	db := getAIDB()
	if db == nil {
		return nil, nil
	}
	var rows *sql.Rows
	var err error
	if contactKey != "" {
		rows, err = db.Query(
			"SELECT id, contact_key, fact, source_from, source_to, created_at, updated_at FROM mem_facts WHERE pinned = 1 AND contact_key = ? ORDER BY updated_at DESC",
			contactKey)
	} else {
		rows, err = db.Query(
			"SELECT id, contact_key, fact, source_from, source_to, created_at, updated_at FROM mem_facts WHERE pinned = 1 ORDER BY updated_at DESC")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MemFact
	for rows.Next() {
		var f MemFact
		rows.Scan(&f.ID, &f.ContactKey, &f.Fact, &f.SourceFrom, &f.SourceTo, &f.CreatedAt, &f.UpdatedAt)
		f.Pinned = true
		out = append(out, f)
	}
	return out, nil
}

// BuildPinnedMemoryBlock 把当前置顶事实拼成一段 system prompt 片段。
// 为空字符串表示没有置顶事实可插入。
func BuildPinnedMemoryBlock(contactKey string) string {
	facts, err := GetPinnedMemFacts(contactKey)
	if err != nil || len(facts) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("\n\n── 用户置顶的背景事实（始终记住这些）──\n")
	for _, f := range facts {
		fmt.Fprintf(&sb, "- %s\n", f.Fact)
	}
	return sb.String()
}
