package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// registerAnniversaryRoutes 注册纪念日相关的 API 路由。
func registerAnniversaryRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/anniversaries", anniversaryHandler(getSvc))
}

// GET /api/anniversaries
// 返回自动检测的生日、友谊里程碑，以及用户自定义纪念日
func anniversaryHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		detected, milestones := svc.DetectAnniversaries()

		// 加载用户自定义纪念日
		prefs := loadPreferences()

		c.JSON(http.StatusOK, gin.H{
			"detected":   detected,
			"milestones": milestones,
			"custom":     prefs.CustomAnniversaries,
		})
	}
}
