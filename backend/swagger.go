package main

// swaggerSpec returns the OpenAPI 3.0 JSON specification for the WeLink API.
func swaggerSpec() []byte {
	spec := `{
  "openapi": "3.0.3",
  "info": {
    "title": "WeLink API",
    "description": "微信聊天数据分析平台后端接口文档",
    "version": "1.0.0"
  },
  "servers": [
    { "url": "/api", "description": "WeLink Backend" }
  ],
  "tags": [
    { "name": "初始化", "description": "索引与状态" },
    { "name": "联系人", "description": "好友统计与分析" },
    { "name": "群聊", "description": "群聊分析" },
    { "name": "数据库", "description": "原始数据库管理" }
  ],
  "paths": {
    "/init": {
      "post": {
        "tags": ["初始化"],
        "summary": "触发索引",
        "description": "传入时间范围，后端清除缓存并重新建立索引。from/to 为 Unix 秒时间戳，传 0 或省略表示不限制。",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "from": { "type": "integer", "example": 1704067200, "description": "开始时间 (Unix 秒)" },
                  "to":   { "type": "integer", "example": 0,          "description": "结束时间 (Unix 秒)，0 = 不限" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "已开始索引",
            "content": {
              "application/json": {
                "schema": { "type": "object", "properties": { "status": { "type": "string", "example": "indexing" } } }
              }
            }
          }
        }
      }
    },
    "/status": {
      "get": {
        "tags": ["初始化"],
        "summary": "查询索引状态",
        "responses": {
          "200": {
            "description": "当前状态",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "is_indexing":    { "type": "boolean" },
                    "is_initialized": { "type": "boolean" },
                    "total_cached":   { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/health": {
      "get": {
        "tags": ["初始化"],
        "summary": "健康检查",
        "responses": {
          "200": {
            "description": "服务正常",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status":       { "type": "string", "example": "ok" },
                    "db_connected": { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/contacts/stats": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取所有联系人统计",
        "description": "返回缓存的联系人列表，包含消息数量、时间、类型分布等。索引完成前返回空数组。",
        "responses": {
          "200": {
            "description": "联系人统计列表",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/ContactStats" }
                }
              }
            }
          }
        }
      }
    },
    "/contacts/detail": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取联系人深度分析",
        "description": "返回指定联系人的 24h 活跃分布、周分布、日历热力图、深夜消息数、红包数、发起率等。",
        "parameters": [
          {
            "name": "username",
            "in": "query",
            "required": true,
            "schema": { "type": "string" },
            "description": "联系人 wxid"
          }
        ],
        "responses": {
          "200": {
            "description": "深度分析结果",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ContactDetail" }
              }
            }
          },
          "400": { "description": "缺少 username 参数" }
        }
      }
    },
    "/contacts/wordcloud": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取词云数据",
        "parameters": [
          {
            "name": "username",
            "in": "query",
            "required": true,
            "schema": { "type": "string" },
            "description": "联系人 wxid"
          }
        ],
        "responses": {
          "200": {
            "description": "词频列表",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "word":  { "type": "string" },
                      "count": { "type": "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/global": {
      "get": {
        "tags": ["联系人"],
        "summary": "全局统计",
        "description": "返回总好友数、总消息数、月度趋势、24h 热力图、消息类型分布、深夜排行等。",
        "responses": {
          "200": {
            "description": "全局统计数据",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/GlobalStats" }
              }
            }
          }
        }
      }
    },
    "/groups": {
      "get": {
        "tags": ["群聊"],
        "summary": "获取群聊列表",
        "responses": {
          "200": {
            "description": "群聊摘要列表",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/GroupInfo" }
                }
              }
            }
          }
        }
      }
    },
    "/groups/detail": {
      "get": {
        "tags": ["群聊"],
        "summary": "获取群聊深度分析",
        "description": "返回指定群聊的活跃分布、成员发言排行、高频词等。",
        "parameters": [
          {
            "name": "username",
            "in": "query",
            "required": true,
            "schema": { "type": "string" },
            "description": "群聊 wxid（以 @ 结尾的 chatroom ID）"
          }
        ],
        "responses": {
          "200": {
            "description": "群聊分析结果",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/GroupDetail" }
              }
            }
          },
          "400": { "description": "缺少 username 参数" }
        }
      }
    },
    "/databases": {
      "get": {
        "tags": ["数据库"],
        "summary": "获取数据库列表",
        "responses": {
          "200": {
            "description": "数据库信息列表",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/DBInfo" }
                }
              }
            }
          }
        }
      }
    },
    "/databases/{dbName}/tables": {
      "get": {
        "tags": ["数据库"],
        "summary": "获取指定数据库的表列表",
        "parameters": [
          { "name": "dbName", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "表列表" },
          "400": { "description": "数据库不存在" }
        }
      }
    },
    "/databases/{dbName}/tables/{tableName}/schema": {
      "get": {
        "tags": ["数据库"],
        "summary": "获取表结构",
        "parameters": [
          { "name": "dbName",    "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "tableName", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "列定义列表" },
          "400": { "description": "表不存在" }
        }
      }
    },
    "/databases/{dbName}/tables/{tableName}/data": {
      "get": {
        "tags": ["数据库"],
        "summary": "获取表数据（分页）",
        "parameters": [
          { "name": "dbName",    "in": "path",  "required": true,  "schema": { "type": "string" } },
          { "name": "tableName", "in": "path",  "required": true,  "schema": { "type": "string" } },
          { "name": "offset",    "in": "query", "required": false, "schema": { "type": "integer", "default": 0 } },
          { "name": "limit",     "in": "query", "required": false, "schema": { "type": "integer", "default": 50, "maximum": 200 } }
        ],
        "responses": {
          "200": { "description": "分页数据" },
          "400": { "description": "表不存在" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "ContactStats": {
        "type": "object",
        "properties": {
          "username":           { "type": "string" },
          "nickname":           { "type": "string" },
          "remark":             { "type": "string" },
          "alias":              { "type": "string" },
          "big_head_url":       { "type": "string" },
          "small_head_url":     { "type": "string" },
          "total_messages":     { "type": "integer" },
          "first_message_time": { "type": "string", "format": "date-time" },
          "last_message_time":  { "type": "string", "format": "date-time" },
          "first_msg":          { "type": "string" },
          "type_pct":           { "type": "object", "additionalProperties": { "type": "number" } },
          "type_cnt":           { "type": "object", "additionalProperties": { "type": "integer" } }
        }
      },
      "ContactDetail": {
        "type": "object",
        "properties": {
          "hourly_dist":       { "type": "array", "items": { "type": "integer" }, "description": "24 小时分布 [0..23]" },
          "weekly_dist":       { "type": "array", "items": { "type": "integer" }, "description": "周分布 [0=周日..6=周六]" },
          "daily_heatmap":     { "type": "object", "additionalProperties": { "type": "integer" }, "description": "日期 → 消息数" },
          "late_night_count":  { "type": "integer" },
          "money_count":       { "type": "integer" },
          "initiation_count":  { "type": "integer" },
          "total_sessions":    { "type": "integer" }
        }
      },
      "GlobalStats": {
        "type": "object",
        "properties": {
          "total_friends":      { "type": "integer" },
          "zero_msg_friends":   { "type": "integer" },
          "total_messages":     { "type": "integer" },
          "monthly_trend":      { "type": "object", "additionalProperties": { "type": "integer" } },
          "hourly_heatmap":     { "type": "array", "items": { "type": "integer" } },
          "type_distribution":  { "type": "object", "additionalProperties": { "type": "integer" } },
          "late_night_ranking": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name":             { "type": "string" },
                "late_night_count": { "type": "integer" },
                "total_messages":   { "type": "integer" },
                "ratio":            { "type": "number" }
              }
            }
          }
        }
      },
      "GroupInfo": {
        "type": "object",
        "properties": {
          "username":          { "type": "string" },
          "name":              { "type": "string" },
          "small_head_url":    { "type": "string" },
          "total_messages":    { "type": "integer" },
          "last_message_time": { "type": "string", "format": "date-time" }
        }
      },
      "GroupDetail": {
        "type": "object",
        "properties": {
          "hourly_dist":  { "type": "array", "items": { "type": "integer" } },
          "weekly_dist":  { "type": "array", "items": { "type": "integer" } },
          "daily_heatmap": { "type": "object", "additionalProperties": { "type": "integer" } },
          "member_rank": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "speaker": { "type": "string" },
                "count":   { "type": "integer" }
              }
            }
          },
          "top_words": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "word":  { "type": "string" },
                "count": { "type": "integer" }
              }
            }
          }
        }
      },
      "DBInfo": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "path": { "type": "string" },
          "size": { "type": "integer" },
          "type": { "type": "string", "enum": ["contact", "message"] }
        }
      }
    }
  }
}`
	return []byte(spec)
}

// swaggerUI returns the Swagger UI HTML page pointing at /api/swagger.json.
func swaggerUI() []byte {
	html := `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>WeLink API 文档</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #f8f9fb; }
    .swagger-ui .topbar { background: #07c160; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/swagger.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      defaultModelsExpandDepth: 1,
    });
  </script>
</body>
</html>`
	return []byte(html)
}
