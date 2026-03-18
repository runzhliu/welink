/*
 * WeLink — 微信聊天数据分析平台
 * Copyright (C) 2026 runzhliu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"welink/backend/config"
	"welink/backend/pkg/db"
	"welink/backend/pkg/seed"
	"welink/backend/service"

	"github.com/gin-gonic/gin"
)

func main() {
	// 1. 加载配置（config.yaml > 环境变量 > 默认值）
	cfg := config.Load("")
	log.Printf("WeLink config: data_dir=%s port=%s timezone=%s workers=%d",
		cfg.Data.Dir, cfg.Server.Port, cfg.Analysis.Timezone, cfg.Analysis.WorkerCount)

	// 2. 初始化数据库管理器（DEMO_MODE 时先生成示例数据）
	if os.Getenv("DEMO_MODE") == "true" {
		demoDir := cfg.Data.Dir
		log.Printf("[DEMO] Demo mode enabled, generating sample databases in %s", demoDir)
		if err := seed.Generate(demoDir); err != nil {
			log.Fatalf("Failed to generate demo databases: %v", err)
		}
	}

	dbMgr, err := db.NewDBManager(cfg.Data.Dir)
	if err != nil {
		log.Fatalf("Init DB failed: %v", err)
	}

	// 3. 初始化服务层
	contactSvc := service.NewContactService(dbMgr, cfg)

	// 4. 初始化 Gin 路由
	r := gin.Default()

	// 跨域设置
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		// 极速获取缓存后的统计信息
		api.GET("/contacts/stats", func(c *gin.Context) {
			stats := contactSvc.GetCachedStats()
			c.JSON(http.StatusOK, stats)
		})

		// 获取全局统计数据
		api.GET("/global", func(c *gin.Context) {
			c.JSON(http.StatusOK, contactSvc.GetGlobal())
		})

		// 获取词云数据
		api.GET("/contacts/wordcloud", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, contactSvc.GetWordCloud(uname, includeMine))
		})

		// 群聊列表
		api.GET("/groups", func(c *gin.Context) {
			c.JSON(http.StatusOK, contactSvc.GetGroups())
		})

		// 群聊某天聊天记录
		api.GET("/groups/messages", func(c *gin.Context) {
			uname := c.Query("username")
			date := c.Query("date")
			if uname == "" || date == "" {
				c.JSON(400, gin.H{"error": "username and date required"})
				return
			}
			c.JSON(http.StatusOK, contactSvc.GetGroupDayMessages(uname, date))
		})

		// 群聊深度画像
		api.GET("/groups/detail", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, contactSvc.GetGroupDetail(uname))
		})

		// 获取与联系人的共同群聊
		api.GET("/contacts/common-groups", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, contactSvc.GetCommonGroups(uname))
		})

		// 获取联系人深度分析（小时/周/日历/深夜/红包/主动率）
		api.GET("/contacts/detail", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			c.JSON(http.StatusOK, contactSvc.GetContactDetail(uname))
		})

		// 某天的聊天记录（日历点击）
		api.GET("/contacts/messages", func(c *gin.Context) {
			uname := c.Query("username")
			date := c.Query("date") // "2024-03-15"
			if uname == "" || date == "" {
				c.JSON(400, gin.H{"error": "username and date required"})
				return
			}
			c.JSON(http.StatusOK, contactSvc.GetDayMessages(uname, date))
		})

		// 搜索联系人聊天记录
		api.GET("/contacts/search", func(c *gin.Context) {
			uname := c.Query("username")
			q := c.Query("q")
			if uname == "" || q == "" {
				c.JSON(400, gin.H{"error": "username and q required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, contactSvc.SearchMessages(uname, q, includeMine))
		})

		// 某月的文本消息（情感分析详情）
		api.GET("/contacts/messages/month", func(c *gin.Context) {
			uname := c.Query("username")
			month := c.Query("month") // "2024-03"
			if uname == "" || month == "" {
				c.JSON(400, gin.H{"error": "username and month required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, contactSvc.GetMonthMessages(uname, month, includeMine))
		})

		// 情感分析
		api.GET("/contacts/sentiment", func(c *gin.Context) {
			uname := c.Query("username")
			if uname == "" {
				c.JSON(400, gin.H{"error": "username required"})
				return
			}
			includeMine := c.Query("include_mine") == "true"
			c.JSON(http.StatusOK, contactSvc.GetSentimentAnalysis(uname, includeMine))
		})

		// 时间范围过滤统计（from/to 为 Unix 秒时间戳）
		api.GET("/stats/filter", func(c *gin.Context) {
			var from, to int64
			fmt.Sscanf(c.Query("from"), "%d", &from)
			fmt.Sscanf(c.Query("to"), "%d", &to)
			result := contactSvc.AnalyzeWithFilter(from, to)
			if result == nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "analysis failed"})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// 获取数据库管理信息
		api.GET("/databases", func(c *gin.Context) {
			c.JSON(http.StatusOK, dbMgr.GetDBInfos())
		})

		// 获取指定数据库的表列表
		api.GET("/databases/:dbName/tables", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tables, err := dbMgr.GetTables(dbName)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, tables)
		})

		// 获取表结构
		api.GET("/databases/:dbName/tables/:tableName/schema", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tableName := c.Param("tableName")
			cols, err := dbMgr.GetTableSchema(dbName, tableName)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, cols)
		})

		// 获取表数据（分页）
		api.GET("/databases/:dbName/tables/:tableName/data", func(c *gin.Context) {
			dbName := c.Param("dbName")
			tableName := c.Param("tableName")
			offset := 0
			limit := 50
			if v := c.Query("offset"); v != "" {
				fmt.Sscanf(v, "%d", &offset)
			}
			if v := c.Query("limit"); v != "" {
				fmt.Sscanf(v, "%d", &limit)
				if limit > 200 {
					limit = 200
				}
			}
			data, err := dbMgr.GetTableData(dbName, tableName, offset, limit)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, data)
		})

		// 初始化/重新索引（前端传入时间范围后调用）
		api.POST("/init", func(c *gin.Context) {
			var body struct {
				From int64 `json:"from"`
				To   int64 `json:"to"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(400, gin.H{"error": "invalid body"})
				return
			}
			contactSvc.Reinitialize(body.From, body.To)
			c.JSON(200, gin.H{"status": "indexing"})
		})

		// 获取后端索引状态
		api.GET("/status", func(c *gin.Context) {
			c.JSON(200, contactSvc.GetStatus())
		})

		// 健康检查
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok", "db_connected": len(dbMgr.MessageDBs)})
		})

		// OpenAPI 规范
		api.GET("/swagger.json", func(c *gin.Context) {
			c.Data(http.StatusOK, "application/json", swaggerSpec())
		})
	}

	// Swagger UI
	r.GET("/swagger", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/swagger/")
	})
	r.GET("/swagger/", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", swaggerUI())
	})

	log.Printf("WeLink Backend serving on :%s", cfg.Server.Port)
	r.Run(":" + cfg.Server.Port)
}
