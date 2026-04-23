package main

// virtual_group_store.go — 虚拟群聊会话持久化
//
// 用户在创意实验室里拉了一桌人聊了一堆，关掉标签页就没了体验太亏。
// 这里落库，下次还能载入接着聊 / 改成员 / 导图。

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type VGMember struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar,omitempty"`
}

type VGMessage struct {
	Speaker     string `json:"speaker"`
	DisplayName string `json:"display_name"`
	Content     string `json:"content"`
	Avatar      string `json:"avatar,omitempty"`
}

type VirtualGroupSession struct {
	ID        int64       `json:"id"`
	Name      string      `json:"name"`
	Topic     string      `json:"topic"`
	Members   []VGMember  `json:"members"`
	History   []VGMessage `json:"history"`
	CreatedAt int64       `json:"created_at"`
	UpdatedAt int64       `json:"updated_at"`
}

func initVirtualGroupTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS virtual_group_sessions (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		name          TEXT    NOT NULL DEFAULT '',
		topic         TEXT    NOT NULL DEFAULT '',
		members_json  TEXT    NOT NULL DEFAULT '[]',
		history_json  TEXT    NOT NULL DEFAULT '[]',
		created_at    INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("virtual_group_store: create: %w", err)
	}
	_, _ = aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_vgs_updated ON virtual_group_sessions(updated_at DESC)`)
	return nil
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

func saveVirtualGroupSession(s *VirtualGroupSession) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("db not initialized")
	}
	mj, _ := json.Marshal(s.Members)
	hj, _ := json.Marshal(s.History)
	now := time.Now().Unix()
	if s.ID > 0 {
		_, err := aiDB.Exec(`UPDATE virtual_group_sessions
			SET name=?, topic=?, members_json=?, history_json=?, updated_at=?
			WHERE id = ?`,
			s.Name, s.Topic, string(mj), string(hj), now, s.ID)
		return s.ID, err
	}
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	res, err := aiDB.Exec(`INSERT INTO virtual_group_sessions
		(name, topic, members_json, history_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		s.Name, s.Topic, string(mj), string(hj), s.CreatedAt, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func listVirtualGroupSessions(limit int) ([]VirtualGroupSession, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := aiDB.Query(`SELECT id, name, topic, members_json, history_json, created_at, updated_at
		FROM virtual_group_sessions ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VirtualGroupSession{}
	for rows.Next() {
		var s VirtualGroupSession
		var mj, hj string
		if err := rows.Scan(&s.ID, &s.Name, &s.Topic, &mj, &hj, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(mj), &s.Members)
		_ = json.Unmarshal([]byte(hj), &s.History)
		out = append(out, s)
	}
	return out, nil
}

func getVirtualGroupSession(id int64) (*VirtualGroupSession, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	var s VirtualGroupSession
	var mj, hj string
	err := aiDB.QueryRow(`SELECT id, name, topic, members_json, history_json, created_at, updated_at
		FROM virtual_group_sessions WHERE id = ?`, id).Scan(
		&s.ID, &s.Name, &s.Topic, &mj, &hj, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(mj), &s.Members)
	_ = json.Unmarshal([]byte(hj), &s.History)
	return &s, nil
}

func deleteVirtualGroupSession(id int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("db not initialized")
	}
	_, err := aiDB.Exec(`DELETE FROM virtual_group_sessions WHERE id = ?`, id)
	return err
}

// ── 路由 ──────────────────────────────────────────────────────────────────────

func registerVirtualGroupStoreRoutes(api *gin.RouterGroup) {
	// GET /api/ai/virtual-group/sessions
	api.GET("/ai/virtual-group/sessions", func(c *gin.Context) {
		list, err := listVirtualGroupSessions(100)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"sessions": list})
	})

	// GET /api/ai/virtual-group/sessions/:id
	api.GET("/ai/virtual-group/sessions/:id", func(c *gin.Context) {
		var id int64
		fmt.Sscanf(c.Param("id"), "%d", &id)
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 不合法"})
			return
		}
		s, err := getVirtualGroupSession(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if s == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到"})
			return
		}
		c.JSON(http.StatusOK, s)
	})

	// POST /api/ai/virtual-group/sessions — body 带 id 则更新，否则新建
	api.POST("/ai/virtual-group/sessions", func(c *gin.Context) {
		var s VirtualGroupSession
		if err := c.ShouldBindJSON(&s); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if len(s.Members) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "至少要有成员"})
			return
		}
		id, err := saveVirtualGroupSession(&s)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": id})
	})

	// DELETE /api/ai/virtual-group/sessions/:id
	api.DELETE("/ai/virtual-group/sessions/:id", func(c *gin.Context) {
		var id int64
		fmt.Sscanf(c.Param("id"), "%d", &id)
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 不合法"})
			return
		}
		if err := deleteVirtualGroupSession(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}
