package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// registerLockRoutes 挂载屏幕锁相关端点。锁定状态本身在前端，后端只负责 PIN 验证和设置持久化。
func registerLockRoutes(api *gin.RouterGroup) {
	api.GET("/lock/status", func(c *gin.Context) {
		p := loadPreferences()
		c.JSON(http.StatusOK, gin.H{
			"enabled":           p.LockPinHash != "",
			"auto_lock_minutes": p.AutoLockMinutes,
			"lock_on_startup":   p.LockOnStartup,
		})
	})

	api.POST("/lock/setup", func(c *gin.Context) {
		var body struct{ Pin string }
		if err := c.ShouldBindJSON(&body); err != nil || !validPin(body.Pin) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN 必须为 4-32 位"})
			return
		}
		existing := loadPreferences()
		if existing.LockPinHash != "" {
			c.JSON(http.StatusConflict, gin.H{"error": "已设置 PIN，请先验证旧 PIN 再修改"})
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(body.Pin), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成哈希失败：" + err.Error()})
			return
		}
		existing.LockPinHash = string(hash)
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		log.Printf("[LOCK] PIN initialized")
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api.POST("/lock/verify", func(c *gin.Context) {
		var body struct{ Pin string }
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		p := loadPreferences()
		if p.LockPinHash == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "尚未设置 PIN"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(p.LockPinHash), []byte(body.Pin)); err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.POST("/lock/change", func(c *gin.Context) {
		var body struct {
			OldPin string `json:"old_pin"`
			NewPin string `json:"new_pin"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || !validPin(body.NewPin) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "新 PIN 必须为 4-32 位"})
			return
		}
		existing := loadPreferences()
		if existing.LockPinHash == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "尚未设置 PIN"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(existing.LockPinHash), []byte(body.OldPin)); err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false})
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPin), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成哈希失败：" + err.Error()})
			return
		}
		existing.LockPinHash = string(hash)
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		log.Printf("[LOCK] PIN changed")
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.POST("/lock/disable", func(c *gin.Context) {
		var body struct{ Pin string }
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		existing := loadPreferences()
		if existing.LockPinHash == "" {
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(existing.LockPinHash), []byte(body.Pin)); err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false})
			return
		}
		existing.LockPinHash = ""
		existing.AutoLockMinutes = 0
		existing.LockOnStartup = false
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		log.Printf("[LOCK] PIN disabled")
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.PUT("/lock/settings", func(c *gin.Context) {
		var body struct {
			AutoLockMinutes int  `json:"auto_lock_minutes"`
			LockOnStartup   bool `json:"lock_on_startup"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		// 只允许预设档位，避免前端乱传
		switch body.AutoLockMinutes {
		case 0, 30, 60, 120:
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "auto_lock_minutes 必须是 0/30/60/120"})
			return
		}
		existing := loadPreferences()
		existing.AutoLockMinutes = body.AutoLockMinutes
		existing.LockOnStartup = body.LockOnStartup
		if err := savePreferences(existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
}

// validPin 要求 PIN 长度在 4-32，字符不限（数字 / 字母 / 符号都允许）
func validPin(pin string) bool {
	trimmed := strings.TrimSpace(pin)
	l := len(trimmed)
	return l >= 4 && l <= 32 && trimmed == pin
}
