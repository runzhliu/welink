package main

// golden_quotes.go — 群金句榜 HTTP 路由
//
// API: GET /api/groups/golden-quotes?room=<roomid>&limit=<n>&refresh=1
//
// 真正的扫描在 service.GetGroupGoldenQuotes 里完成（含 10 分钟缓存）。
// 这里只做参数校验 + 转发。

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

func registerGoldenQuotesRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/groups/golden-quotes", goldenQuotesHandler(getSvc))
}

func goldenQuotesHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		room := strings.TrimSpace(c.Query("room"))
		if room == "" || !strings.HasSuffix(room, "@chatroom") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "room 必填且必须是群聊（以 @chatroom 结尾）"})
			return
		}

		limit := 10
		if v := strings.TrimSpace(c.Query("limit")); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}

		from, to := svc.Filter()

		data, err := svc.GetGroupGoldenQuotes(room, limit, from, to)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		if len(data.Quotes) == 0 {
			// 不报错：前端给个友好的"还没产生金句"空态
			c.JSON(http.StatusOK, data)
			return
		}
		c.JSON(http.StatusOK, data)
	}
}
