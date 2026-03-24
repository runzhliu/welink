package main

// swaggerSpec returns the OpenAPI 3.0 JSON specification for the WeLink API.
func swaggerSpec() []byte {
	spec := `{
  "openapi": "3.0.3",
  "info": {
    "title": "WeLink API",
    "description": "微信聊天数据分析平台后端接口文档",
    "version": "0.0.2"
  },
  "servers": [
    { "url": "/api", "description": "WeLink Backend" }
  ],
  "tags": [
    { "name": "初始化", "description": "索引与状态" },
    { "name": "应用管理", "description": "App 模式配置与日志（macOS/Windows 桌面端）" },
    { "name": "偏好设置", "description": "用户偏好（屏蔽名单等）" },
    { "name": "联系人", "description": "好友统计与分析" },
    { "name": "群聊", "description": "群聊分析" },
    { "name": "搜索", "description": "消息全文搜索" },
    { "name": "分析", "description": "情感分析与关系统计" },
    { "name": "数据库", "description": "原始数据库管理与 SQL 查询" }
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
    "/app/info": {
      "get": {
        "tags": ["应用管理"],
        "summary": "获取应用信息",
        "description": "返回当前运行模式（App/Docker）、是否需要初始化配置、服务层是否就绪、版本号。",
        "responses": {
          "200": {
            "description": "应用信息",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "app_mode":    { "type": "boolean", "description": "是否为桌面 App 模式" },
                    "needs_setup": { "type": "boolean", "description": "App 模式下是否尚未配置数据目录" },
                    "ready":       { "type": "boolean", "description": "服务层是否就绪" },
                    "version":     { "type": "string",  "example": "0.0.2", "description": "应用版本号" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/app/config": {
      "get": {
        "tags": ["应用管理"],
        "summary": "读取当前 App 配置",
        "description": "仅 App 模式有效。返回已保存的 data_dir / log_dir 配置。",
        "responses": {
          "200": {
            "description": "当前配置（未配置时返回空对象）",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/AppConfig" }
              }
            }
          }
        }
      }
    },
    "/app/setup": {
      "post": {
        "tags": ["应用管理"],
        "summary": "初始化 App 配置",
        "description": "App 模式首次启动时调用，保存数据目录并热替换服务层。data_dir 为空则启用演示模式。",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/AppConfig" }
            }
          }
        },
        "responses": {
          "200": { "description": "配置成功" },
          "400": { "description": "目录无效或格式错误" }
        }
      }
    },
    "/app/restart": {
      "post": {
        "tags": ["应用管理"],
        "summary": "保存新配置并重启进程",
        "description": "更新 data_dir / log_dir 后自动重启后端进程（约 300ms 延迟）。",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/AppConfig" }
            }
          }
        },
        "responses": {
          "200": { "description": "已触发重启", "content": { "application/json": { "schema": { "type": "object", "properties": { "status": { "type": "string", "example": "restarting" } } } } } },
          "400": { "description": "目录无效" }
        }
      }
    },
    "/app/browse": {
      "get": {
        "tags": ["应用管理"],
        "summary": "调起原生文件夹选择器（仅 App 模式）",
        "parameters": [
          { "name": "prompt", "in": "query", "required": false, "schema": { "type": "string", "default": "选择目录" }, "description": "选择器标题文字" }
        ],
        "responses": {
          "200": { "description": "用户选择的路径", "content": { "application/json": { "schema": { "type": "object", "properties": { "path": { "type": "string" } } } } } },
          "400": { "description": "用户取消或非 App 模式" }
        }
      }
    },
    "/app/bundle-logs": {
      "post": {
        "tags": ["应用管理"],
        "summary": "打包日志文件",
        "description": "将 log_dir 下所有 *.log 文件打成 ZIP，返回 ZIP 文件路径，方便用户上传反馈。",
        "responses": {
          "200": {
            "description": "ZIP 路径",
            "content": {
              "application/json": {
                "schema": { "type": "object", "properties": { "path": { "type": "string", "description": "生成的 ZIP 文件绝对路径" } } }
              }
            }
          },
          "400": { "description": "未配置日志目录" },
          "500": { "description": "读取目录或创建 ZIP 失败" }
        }
      }
    },
    "/open-url": {
      "get": {
        "tags": ["应用管理"],
        "summary": "用系统浏览器打开外部链接（仅 App 模式）",
        "description": "仅允许 https 协议，非 App 模式同样可调用但效果取决于平台。",
        "parameters": [
          { "name": "url", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "成功打开" },
          "400": { "description": "URL 无效或打开失败" }
        }
      }
    },
    "/preferences": {
      "get": {
        "tags": ["偏好设置"],
        "summary": "读取用户偏好",
        "description": "返回当前已保存的偏好，包含屏蔽用户列表和屏蔽群聊列表。",
        "responses": {
          "200": {
            "description": "偏好数据",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Preferences" }
              }
            }
          }
        }
      },
      "put": {
        "tags": ["偏好设置"],
        "summary": "保存用户偏好",
        "description": "只更新 blocked_users / blocked_groups 字段，App 配置字段（data_dir 等）保持不变。",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/Preferences" }
            }
          }
        },
        "responses": {
          "200": { "description": "保存成功，返回合并后的偏好" },
          "400": { "description": "请求格式错误" },
          "500": { "description": "写入失败" }
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
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" }, "description": "联系人 wxid" }
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
    "/contacts/messages": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取某天聊天记录",
        "description": "返回指定联系人在某日的所有聊天消息，用于日历热力图点击展开。",
        "parameters": [
          { "name": "username", "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "date",     "in": "query", "required": true,  "schema": { "type": "string", "example": "2024-03-15" }, "description": "日期 YYYY-MM-DD" }
        ],
        "responses": {
          "200": { "description": "消息列表", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/ChatMessage" } } } } },
          "400": { "description": "缺少参数" }
        }
      }
    },
    "/contacts/messages/month": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取某月文本消息（情感分析详情）",
        "parameters": [
          { "name": "username",     "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "month",        "in": "query", "required": true,  "schema": { "type": "string", "example": "2024-03" }, "description": "月份 YYYY-MM" },
          { "name": "include_mine", "in": "query", "required": false, "schema": { "type": "boolean" }, "description": "是否包含我发送的消息" }
        ],
        "responses": {
          "200": { "description": "当月文本消息列表" },
          "400": { "description": "缺少参数" }
        }
      }
    },
    "/contacts/wordcloud": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取词云数据",
        "parameters": [
          { "name": "username",     "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "include_mine", "in": "query", "required": false, "schema": { "type": "boolean" }, "description": "是否统计我发送的消息" }
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
    "/contacts/common-groups": {
      "get": {
        "tags": ["联系人"],
        "summary": "获取与联系人的共同群聊",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "共同群聊列表", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/GroupInfo" } } } } },
          "400": { "description": "缺少 username 参数" }
        }
      }
    },
    "/contacts/cooling": {
      "get": {
        "tags": ["联系人"],
        "summary": "关系降温榜",
        "description": "返回曾经频繁联系、但近期消息量明显下降的联系人排行。",
        "responses": {
          "200": { "description": "降温榜列表" }
        }
      }
    },
    "/contacts/search": {
      "get": {
        "tags": ["搜索"],
        "summary": "搜索联系人聊天记录",
        "parameters": [
          { "name": "username",     "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "q",            "in": "query", "required": true,  "schema": { "type": "string" }, "description": "搜索关键词" },
          { "name": "include_mine", "in": "query", "required": false, "schema": { "type": "boolean" } }
        ],
        "responses": {
          "200": { "description": "匹配消息列表", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/ChatMessage" } } } } },
          "400": { "description": "缺少参数" }
        }
      }
    },
    "/contacts/export": {
      "get": {
        "tags": ["联系人"],
        "summary": "导出联系人全量聊天记录",
        "description": "返回指定联系人在已索引时间范围内的全量消息，最多 50000 条，按时间正序排列。",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "全量消息列表（最多 50000 条）", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/ChatMessage" } } } } },
          "400": { "description": "缺少 username 参数" }
        }
      }
    },
    "/contacts/sentiment": {
      "get": {
        "tags": ["分析"],
        "summary": "情感分析",
        "description": "基于文本内容对联系人聊天记录进行情感倾向分析，返回按月统计的情感分布。",
        "parameters": [
          { "name": "username",     "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "include_mine", "in": "query", "required": false, "schema": { "type": "boolean" } }
        ],
        "responses": {
          "200": { "description": "情感分析结果" },
          "400": { "description": "缺少 username 参数" }
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
    "/stats/filter": {
      "get": {
        "tags": ["分析"],
        "summary": "时间范围过滤统计",
        "description": "在指定时间范围内重新计算联系人统计，不影响已有缓存。",
        "parameters": [
          { "name": "from", "in": "query", "required": false, "schema": { "type": "integer" }, "description": "开始时间 Unix 秒，0 = 不限" },
          { "name": "to",   "in": "query", "required": false, "schema": { "type": "integer" }, "description": "结束时间 Unix 秒，0 = 不限" }
        ],
        "responses": {
          "200": { "description": "过滤后的统计数据" },
          "500": { "description": "分析失败" }
        }
      }
    },
    "/search": {
      "get": {
        "tags": ["搜索"],
        "summary": "全局消息搜索",
        "description": "跨所有联系人和群聊搜索消息，支持按类型过滤。",
        "parameters": [
          { "name": "q",    "in": "query", "required": true,  "schema": { "type": "string" }, "description": "搜索关键词" },
          { "name": "type", "in": "query", "required": false, "schema": { "type": "string", "enum": ["all", "contact", "group"], "default": "all" }, "description": "搜索范围：all=全部, contact=仅私聊, group=仅群聊" }
        ],
        "responses": {
          "200": { "description": "搜索结果列表" },
          "400": { "description": "缺少 q 参数" }
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
        "description": "返回指定群聊的活跃分布、成员发言排行（Top 500）、高频词等。",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" }, "description": "群聊 wxid（chatroom ID）" }
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
    "/groups/messages": {
      "get": {
        "tags": ["群聊"],
        "summary": "获取群聊某天聊天记录",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "date",     "in": "query", "required": true, "schema": { "type": "string", "example": "2024-03-15" }, "description": "日期 YYYY-MM-DD" }
        ],
        "responses": {
          "200": { "description": "群聊消息列表" },
          "400": { "description": "缺少参数" }
        }
      }
    },
    "/groups/search": {
      "get": {
        "tags": ["搜索"],
        "summary": "搜索群聊聊天记录",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "q",        "in": "query", "required": true, "schema": { "type": "string" }, "description": "搜索关键词" }
        ],
        "responses": {
          "200": { "description": "匹配消息列表" },
          "400": { "description": "缺少参数" }
        }
      }
    },
    "/groups/export": {
      "get": {
        "tags": ["群聊"],
        "summary": "导出群聊全量聊天记录",
        "description": "返回指定群聊在已索引时间范围内的全量消息，最多 50000 条，按时间正序排列。",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "全量消息列表（最多 50000 条）" },
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
    },
    "/databases/{dbName}/query": {
      "post": {
        "tags": ["数据库"],
        "summary": "执行只读 SQL 查询",
        "description": "在指定数据库上执行 SELECT / PRAGMA / EXPLAIN 语句（不允许写操作），最多返回 500 行。",
        "parameters": [
          { "name": "dbName", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["sql"],
                "properties": {
                  "sql": { "type": "string", "example": "SELECT * FROM message LIMIT 10" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "查询结果",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/QueryResult" }
              }
            }
          },
          "400": { "description": "缺少 sql 参数或数据库不存在" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "AppConfig": {
        "type": "object",
        "properties": {
          "data_dir": { "type": "string", "description": "微信解密数据库目录" },
          "log_dir":  { "type": "string", "description": "日志输出目录" },
          "demo_mode":{ "type": "boolean", "description": "是否为演示模式（data_dir 为空时自动开启）" }
        }
      },
      "Preferences": {
        "type": "object",
        "properties": {
          "blocked_users":  { "type": "array", "items": { "type": "string" }, "description": "屏蔽的用户标识列表（wxid / nickname / remark）" },
          "blocked_groups": { "type": "array", "items": { "type": "string" }, "description": "屏蔽的群聊 wxid 列表" }
        }
      },
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
      "ChatMessage": {
        "type": "object",
        "properties": {
          "msg_id":       { "type": "integer" },
          "create_time":  { "type": "integer", "description": "Unix 秒时间戳" },
          "type":         { "type": "integer", "description": "微信消息类型（1=文字, 3=图片, 34=语音, 43=视频, 49=链接/文件等）" },
          "is_sender":    { "type": "integer", "description": "1 = 我发送，0 = 对方发送" },
          "content":      { "type": "string" },
          "talker":       { "type": "string", "description": "发言者 wxid（群聊时为成员 wxid）" }
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
            "description": "成员发言排行，最多 500 人",
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
      },
      "QueryResult": {
        "type": "object",
        "properties": {
          "columns": { "type": "array", "items": { "type": "string" }, "description": "列名列表" },
          "rows":    { "type": "array", "items": { "type": "array", "items": {} }, "description": "数据行，最多 500 行" },
          "error":   { "type": "string", "description": "若查询失败则返回错误信息" }
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
