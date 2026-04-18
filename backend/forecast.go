package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// registerForecastRoutes 注册关系预测相关 API 路由。
func registerForecastRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/contacts/relationship-forecast", forecastHandler(getSvc))
}

// GET /api/contacts/relationship-forecast?top=5
// 基于过去 6 个月消息节奏给出 4 档趋势 + 建议主动联系列表。
func forecastHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		topN := 5
		if v := c.Query("top"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
				topN = n
			}
		}
		includeAll := c.Query("include_all") == "1"
		resp := svc.GetRelationshipForecast(topN, includeAll)

		// 过滤被忽略的联系人
		prefs := loadPreferences()
		if len(prefs.ForecastIgnored) > 0 {
			ignored := make(map[string]struct{}, len(prefs.ForecastIgnored))
			for _, u := range prefs.ForecastIgnored {
				ignored[u] = struct{}{}
			}
			filter := func(list []service.ForecastEntry) []service.ForecastEntry {
				out := list[:0]
				for _, e := range list {
					if _, skip := ignored[e.Username]; !skip {
						out = append(out, e)
					}
				}
				return out
			}
			resp.SuggestContact = filter(resp.SuggestContact)
			if resp.All != nil {
				resp.All = filter(resp.All)
			}
		}

		c.JSON(http.StatusOK, resp)
	}
}
