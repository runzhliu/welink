package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// This version deliberately manages one policy, matching the existing agent
// query contract. Never silently replace a credential created by another client.
func registerAgentManagementRoutes(api *gin.RouterGroup, sensitiveGate gin.HandlerFunc, owner func() string) {
	var mu sync.Mutex
	group := api.Group("/agent/access")
	group.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if demoModeEnabled() {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "公开 Demo 不支持 Agent 授权"})
			return
		}
		c.Next()
	}, sensitiveGate)
	group.GET("", func(c *gin.Context) {
		mu.Lock()
		defer mu.Unlock()
		data, err := os.ReadFile(agentAccessPath())
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusOK, gin.H{"state": "none"})
			return
		}
		var policy agentAccessPolicy
		if err != nil || json.Unmarshal(data, &policy) != nil || policy.TokenSHA256 == "" || policy.ExpiresAt.IsZero() {
			c.JSON(http.StatusOK, gin.H{"state": "invalid"})
			return
		}
		state := "active"
		if !time.Now().Before(policy.ExpiresAt) {
			state = "expired"
		}
		if state == "active" && policy.OwnerID == "" {
			state = "legacy"
		}
		if policy.OwnerID != "" && policy.OwnerID != owner() {
			state = "other_account"
		}
		if state == "other_account" {
			c.JSON(http.StatusOK, gin.H{"state": state, "expires_at": policy.ExpiresAt})
			return
		}
		c.JSON(http.StatusOK, gin.H{"state": state, "conversations": policy.Conversations, "actions": policy.Actions, "expires_at": policy.ExpiresAt})
	})
	group.POST("", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
		var input struct {
			Conversations []string `json:"conversations"`
			Actions       []string `json:"actions"`
			Hours         int      `json:"hours"`
		}
		if c.ShouldBindJSON(&input) != nil || !validAgentGrant(input.Conversations, input.Actions, input.Hours) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请选择有效会话、查询权限和有效期"})
			return
		}
		ownerID := owner()
		if ownerID == "" {
			c.JSON(http.StatusConflict, gin.H{"error": "当前数据账号尚未就绪，请完成索引后重试"})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		path := agentAccessPath()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法创建授权目录"})
			return
		}
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法生成授权凭据"})
			return
		}
		token := hex.EncodeToString(secret)
		digest := sha256.Sum256([]byte(token))
		policy := agentAccessPolicy{TokenSHA256: hex.EncodeToString(digest[:]), OwnerID: ownerID, Conversations: input.Conversations, Actions: input.Actions, ExpiresAt: time.Now().UTC().Add(time.Duration(input.Hours) * time.Hour)}
		data, err := json.Marshal(policy)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法创建授权"})
			return
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"error": "已有 Agent 授权，请先撤销后再创建"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法保存授权"})
			return
		}
		_, writeErr := file.Write(data)
		if writeErr == nil {
			writeErr = file.Sync()
		}
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(path)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法保存授权"})
			return
		}
		// The plaintext credential is returned once, never stored by WeLink.
		c.JSON(http.StatusCreated, gin.H{"token": token, "expires_at": policy.ExpiresAt})
	})
	group.DELETE("", func(c *gin.Context) {
		mu.Lock()
		defer mu.Unlock()
		if err := os.Remove(agentAccessPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法撤销授权"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"state": "none"})
	})
}

func validAgentGrant(conversations, actions []string, hours int) bool {
	if len(conversations) == 0 || len(conversations) > 50 || len(actions) == 0 || len(actions) > 3 || (hours != 24 && hours != 168 && hours != 720) {
		return false
	}
	seen := map[string]bool{}
	for _, value := range conversations {
		if value == "" || len(value) > 128 || !utf8.ValidString(value) || strings.TrimSpace(value) != value || strings.IndexFunc(value, unicode.IsControl) >= 0 || seen[value] {
			return false
		}
		seen[value] = true
	}
	seen = map[string]bool{}
	for _, value := range actions {
		if (value != "dates" && value != "day" && value != "search") || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
