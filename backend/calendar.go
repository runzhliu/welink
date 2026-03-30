package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// registerCalendarRoutes 注册时光轴相关的 API 路由。
func registerCalendarRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/calendar/heatmap", calendarHeatmapHandler(getSvc))
	prot.GET("/calendar/trend", calendarTrendHandler(getSvc))
	prot.GET("/calendar/day", calendarDayHandler(getSvc))
	prot.GET("/calendar/messages", calendarMessagesHandler(getSvc))
}

// GET /api/calendar/heatmap
// 返回全局每日消息量热力图 {"heatmap": {"2024-01-15": 42, ...}}
func calendarHeatmapHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		heatmap := svc.GetCalendarHeatmap()
		if heatmap == nil {
			heatmap = map[string]int{}
		}
		c.JSON(http.StatusOK, gin.H{"heatmap": heatmap})
	}
}

// GET /api/calendar/trend?days=90
// 返回最近 N 天的每日消息量，格式 [{"date":"2024-01-15","count":42},...]
func calendarTrendHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		days, _ := strconv.Atoi(c.DefaultQuery("days", "90"))
		if days <= 0 || days > 365 {
			days = 90
		}
		heatmap := svc.GetCalendarHeatmap()

		type dayEntry struct {
			Date  string `json:"date"`
			Count int    `json:"count"`
		}
		trend := make([]dayEntry, days)
		now := time.Now()
		for i := 0; i < days; i++ {
			date := now.AddDate(0, 0, -(days-1-i)).Format("2006-01-02")
			trend[i] = dayEntry{Date: date, Count: heatmap[date]}
		}
		c.JSON(http.StatusOK, trend)
	}
}

// GET /api/calendar/day?date=2024-01-15
// 返回该天有消息的联系人和群聊列表，格式 {"contacts":[...],"groups":[...]}
func calendarDayHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		date := c.Query("date")
		if date == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date 参数必填"})
			return
		}
		contacts, groups := svc.GetDayActivity(date)
		if contacts == nil {
			contacts = []service.CalendarDayEntry{}
		}
		if groups == nil {
			groups = []service.CalendarDayEntry{}
		}
		c.JSON(http.StatusOK, gin.H{
			"contacts": contacts,
			"groups":   groups,
		})
	}
}

// GET /api/calendar/messages?date=2024-01-15&username=xxx&is_group=0
// 返回指定联系人/群聊某天的聊天记录
func calendarMessagesHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		date := c.Query("date")
		username := c.Query("username")
		isGroup := c.Query("is_group") == "1"
		if date == "" || username == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date 和 username 参数必填"})
			return
		}
		if isGroup {
			msgs := svc.GetGroupDayMessages(username, date)
			if msgs == nil {
				msgs = []service.GroupChatMessage{}
			}
			c.JSON(http.StatusOK, msgs)
		} else {
			msgs := svc.GetDayMessages(username, date)
			if msgs == nil {
				msgs = []service.ChatMessage{}
			}
			c.JSON(http.StatusOK, msgs)
		}
	}
}
