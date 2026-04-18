package main

import "strings"

// swaggerSpec returns the OpenAPI 3.0 JSON specification for the WeLink API.
// appVersion 由 -ldflags 注入（有 tag 时为 tag，否则为 commit hash）。
func swaggerSpec() []byte {
	spec := `{
  "openapi": "3.0.3",
  "info": {
    "title": "WeLink API",
    "description": "微信聊天数据分析平台后端接口文档",
    "version": "{{VERSION}}"
  },
  "servers": [
    { "url": "/api", "description": "WeLink Backend" }
  ],
  "tags": [
    { "name": "初始化", "description": "索引与状态" },
    { "name": "联系人", "description": "好友统计与分析" },
    { "name": "关系预测", "description": "4 档趋势 + 建议主动联系 + AI 开场白" },
    { "name": "群聊", "description": "群聊分析" },
    { "name": "有趣发现", "description": "趣味统计卡片" },
    { "name": "日历", "description": "时光机 / 日历 / 纪念日" },
    { "name": "搜索", "description": "消息全文搜索" },
    { "name": "AI", "description": "AI 对话分析与补全" },
    { "name": "AI 分身", "description": "学习联系人风格并模拟对话" },
    { "name": "AI 群聊模拟", "description": "按群友风格模拟群聊" },
    { "name": "Skills", "description": "技能包炼化与管理" },
    { "name": "RAG", "description": "FTS5 全文检索 + 向量混合检索" },
    { "name": "向量检索", "description": "语义向量嵌入与相似度搜索" },
    { "name": "记忆提炼", "description": "LLM 提炼关键事实并持久化" },
    { "name": "认证", "description": "Gemini OAuth 等第三方认证" },
    { "name": "偏好设置", "description": "用户偏好（LLM 配置、屏蔽名单等）" },
    { "name": "应用管理", "description": "App 模式配置与日志（macOS/Windows 桌面端）" },
    { "name": "数据库", "description": "原始数据库管理与 SQL 查询" },
    { "name": "导出中心", "description": "年度回顾/对话归档/AI 历史/记忆图谱 × Markdown/Notion/飞书/WebDAV/S3/Dropbox/Google Drive/OneDrive" },
    { "name": "系统", "description": "头像代理、健康检查等" }
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
                    "total_cached":   { "type": "integer" },
                    "last_error":     { "type": "string", "description": "最近一次索引失败原因（cancelled / panic: ...）" },
                    "progress": {
                      "type": "object",
                      "description": "仅索引中存在",
                      "properties": {
                        "done":            { "type": "integer" },
                        "total":           { "type": "integer" },
                        "current_contact": { "type": "string" },
                        "elapsed_ms":      { "type": "integer" }
                      }
                    }
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
        "description": "返回当前运行模式、配置状态、数据目录、探测过的候选路径等；App/Docker 共用。",
        "responses": {
          "200": {
            "description": "应用信息",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "app_mode":     { "type": "boolean", "description": "是否为桌面 App 模式" },
                    "needs_setup":  { "type": "boolean", "description": "是否尚未配置或服务未就绪" },
                    "ready":        { "type": "boolean", "description": "服务层是否就绪" },
                    "version":      { "type": "string",  "example": "0.1.1", "description": "应用版本号" },
                    "platform":     { "type": "string",  "example": "darwin", "description": "runtime.GOOS" },
                    "data_dir":     { "type": "string",  "description": "当前配置的数据目录" },
                    "reason":       { "type": "string",  "description": "最近一次 reinit 失败原因" },
                    "probed_paths": { "type": "array", "items": { "type": "string" }, "description": "启动时探测过的候选目录" },
                    "can_demo":     { "type": "boolean", "description": "是否支持一键切到 demo（当前仅桌面版）" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/cancel-index": {
      "post": {
        "tags": ["初始化"],
        "summary": "取消正在进行的索引",
        "description": "中止当前的 performAnalysis goroutine（通过 context cancel）。非索引状态下调用是 no-op。",
        "responses": {
          "200": { "description": "已发出取消信号", "content": { "application/json": { "schema": { "type": "object", "properties": { "cancelled": { "type": "boolean" } } } } } }
        }
      }
    },
    "/diagnostics": {
      "get": {
        "tags": ["应用管理"],
        "summary": "诊断：数据目录 / 索引 / LLM / 磁盘",
        "description": "聚合检查数据目录健康、索引状态、LLM 探活（OpenAI 兼容端点 GET /models，5s 超时）、磁盘占用。整个请求上限约 6s。",
        "responses": {
          "200": {
            "description": "诊断结果",
            "content": { "application/json": { "schema": {
              "type": "object",
              "properties": {
                "generated_at": { "type": "string", "format": "date-time" },
                "data_dir":     { "type": "object" },
                "index":        { "type": "object" },
                "llm_profiles": { "type": "array", "items": { "type": "object" } },
                "disk":         { "type": "object" }
              }
            } } }
          }
        }
      }
    },
    "/preferences/download-dir": {
      "get": {
        "tags": ["偏好设置"],
        "summary": "读取导出图片保存目录",
        "description": "返回用户配置值 (configured) 和实际生效值 (effective，含平台默认 fallback)。",
        "responses": { "200": { "description": "OK" } }
      },
      "put": {
        "tags": ["偏好设置"],
        "summary": "设置导出图片保存目录",
        "description": "必须在 UserHomeDir 下且可写；校验失败自动回滚。空串 = 恢复平台默认。",
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "type": "object", "properties": { "download_dir": { "type": "string" } } } } }
        },
        "responses": { "200": { "description": "OK" }, "400": { "description": "目录无效或不可写" } }
      }
    },
    "/app/reveal": {
      "post": {
        "tags": ["应用管理"],
        "summary": "在 Finder / Explorer 中定位文件（App 模式）",
        "description": "macOS 调 open -R；Windows 调 explorer /select。路径必须在下载目录之下，防止任意读。",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "path": { "type": "string" } } } } } },
        "responses": { "200": { "description": "OK" }, "400": { "description": "路径不在下载目录下" } }
      }
    },
    "/app/ai-backup": {
      "post": {
        "tags": ["应用管理"],
        "summary": "AI 数据备份到下载目录（App 模式）",
        "description": "用 SQLite VACUUM INTO 写自洽快照到下载目录，返回路径供前端展示 + reveal。",
        "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "type": "object", "properties": { "path": { "type": "string" }, "size": { "type": "integer" } } } } } } }
      }
    },
    "/ai-backup-download": {
      "get": {
        "tags": ["应用管理"],
        "summary": "AI 数据流式下载（Docker / 浏览器）",
        "description": "用 VACUUM INTO 写临时快照后 stream，避免 stream 中途数据库被改。Content-Disposition: attachment。",
        "responses": { "200": { "description": "SQLite 文件流", "content": { "application/octet-stream": {} } } }
      }
    },
    "/app/ai-restore": {
      "post": {
        "tags": ["应用管理"],
        "summary": "从备份恢复 AI 数据",
        "description": "multipart 上传 .db → sanity check (sqlite + 含预期表) → 旧文件 rename 为 .bak → 替换 → InitAIDB 重新打开。",
        "requestBody": { "required": true, "content": { "multipart/form-data": { "schema": { "type": "object", "properties": { "file": { "type": "string", "format": "binary" } } } } } },
        "responses": { "200": { "description": "OK" }, "400": { "description": "文件不是有效备份" } }
      }
    },
    "/app/data-profiles": {
      "get": {
        "tags": ["应用管理"],
        "summary": "列出所有数据目录 profile",
        "responses": { "200": { "description": "OK" } }
      },
      "put": {
        "tags": ["应用管理"],
        "summary": "批量保存数据目录 profile 列表",
        "description": "覆盖式保存；id 为空的 profile 会自动分配。",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "profiles": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" }, "path": { "type": "string" } } } } } } } } },
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/app/switch-profile": {
      "post": {
        "tags": ["应用管理"],
        "summary": "热切换激活的数据目录",
        "description": "走预校验 + reinitSvc 热替换，无需重启进程。前端应清掉 hasStarted 并 reload。",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "id": { "type": "string" } } } } } },
        "responses": { "200": { "description": "OK" }, "400": { "description": "profile 无效或校验失败" } }
      }
    },
    "/fun/companion-time": {
      "get": {
        "tags": ["联系人"],
        "summary": "陪伴时长统计（基于 session）",
        "description": "把每个联系人的消息按 SessionGapSeconds 切成会话，累加各会话的时长，得到总陪伴分钟数。结果缓存 10 分钟；传 refresh=1 强制重算。",
        "parameters": [
          { "name": "refresh", "in": "query", "required": false, "schema": { "type": "integer", "enum": [0, 1] } }
        ],
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/ai/usage-stats": {
      "get": {
        "tags": ["AI"],
        "summary": "AI 用量统计",
        "description": "聚合所有 ai_conversations 里 assistant 消息的字符数和估算 tokens（tokens_per_sec × elapsed_secs），按 provider/model 分组。",
        "responses": { "200": { "description": "用量统计" } }
      }
    },
    "/ai/conversations/search": {
      "get": {
        "tags": ["AI"],
        "summary": "AI 对话全局子串搜索",
        "description": "在所有 ai_conversations 的 JSON 消息体里做 LIKE 搜索，返回 ~40 字前后上下文片段。",
        "parameters": [
          { "name": "q",     "in": "query", "required": true,  "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "required": false, "schema": { "type": "integer", "default": 30, "maximum": 100 } }
        ],
        "responses": { "200": { "description": "匹配结果", "content": { "application/json": { "schema": { "type": "object", "properties": { "hits": { "type": "array", "items": { "type": "object" } } } } } } } }
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
    "/calendar/heatmap": {
      "get": {
        "tags": ["日历"],
        "summary": "全历史日历热力图",
        "responses": { "200": { "description": "日期→消息数映射" } }
      }
    },
    "/calendar/day": {
      "get": {
        "tags": ["日历"],
        "summary": "某天的活跃联系人和群聊",
        "parameters": [{ "name": "date", "in": "query", "required": true, "schema": { "type": "string" }, "example": "2024-01-15" }],
        "responses": { "200": { "description": "返回 contacts 和 groups 数组" } }
      }
    },
    "/anniversaries": {
      "get": {
        "tags": ["日历"],
        "summary": "纪念日数据（自动检测 + 好友里程碑 + 自定义）",
        "responses": { "200": { "description": "detected/milestones/custom 三个数组" } }
      }
    },
    "/ai/analyze": {
      "post": {
        "tags": ["AI"],
        "summary": "流式 AI 分析（SSE）",
        "description": "前端发送消息历史，后端转发 LLM 并流式返回。",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "username": { "type": "string" }, "is_group": { "type": "boolean" }, "messages": { "type": "array", "items": { "type": "object" } }, "profile_id": { "type": "string" } } } } } },
        "responses": { "200": { "description": "SSE 流，每条 data: 为 StreamChunk JSON" } }
      }
    },
    "/ai/complete": {
      "post": {
        "tags": ["AI"],
        "summary": "非流式单次 LLM 补全",
        "responses": { "200": { "description": "返回 content 和 error 字段" } }
      }
    },
    "/ai/llm/test": {
      "post": {
        "tags": ["AI"],
        "summary": "测试 LLM 连接",
        "responses": { "200": { "description": "测试结果" } }
      }
    },
    "/ai/clone/session/{username}": {
      "get": {
        "tags": ["AI 分身"],
        "summary": "检查是否有缓存的 AI 分身档案",
        "parameters": [{ "name": "username", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "exists/session_id/private_count/group_count 等" } }
      }
    },
    "/ai/clone/learn": {
      "post": {
        "tags": ["AI 分身"],
        "summary": "学习联系人聊天风格（SSE 多步进度）",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "username": { "type": "string" }, "count": { "type": "integer" }, "groups": { "type": "array", "items": { "type": "string" } }, "bio": { "type": "string" }, "extract_profile": { "type": "boolean" } } } } } },
        "responses": { "200": { "description": "SSE 流，推送 step 进度和最终 session_id" } }
      }
    },
    "/ai/clone/chat": {
      "post": {
        "tags": ["AI 分身"],
        "summary": "与 AI 分身对话（SSE 流式）",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "session_id": { "type": "string" }, "messages": { "type": "array", "items": { "type": "object" } }, "profile_id": { "type": "string" } } } } } },
        "responses": { "200": { "description": "SSE 流式响应" } }
      }
    },
    "/ai/group-sim": {
      "post": {
        "tags": ["AI 群聊模拟"],
        "summary": "模拟群聊对话（SSE 流式）",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "group_username": { "type": "string" }, "message_count": { "type": "integer" }, "profile_id": { "type": "string" }, "user_message": { "type": "string" }, "rounds": { "type": "integer" }, "topic": { "type": "string" }, "mood": { "type": "string" }, "members": { "type": "array", "items": { "type": "string" } } } } } } },
        "responses": { "200": { "description": "SSE 流，每条 data: 为 {speaker, content}，最后 {done: true}" } }
      }
    },
    "/ai/conversations": {
      "get": {
        "tags": ["AI"],
        "summary": "获取 AI 对话历史",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" }, "example": "contact:wxid" }],
        "responses": { "200": { "description": "对话历史 JSON" } }
      },
      "put": {
        "tags": ["AI"],
        "summary": "保存 AI 对话历史",
        "responses": { "200": { "description": "保存成功" } }
      },
      "delete": {
        "tags": ["AI"],
        "summary": "删除 AI 对话历史",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "删除成功" } }
      }
    },
    "/ai/rag/index-status": {
      "get": {
        "tags": ["RAG"],
        "summary": "查询 FTS5 全文索引状态",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "索引状态" } }
      }
    },
    "/ai/rag/build-index": {
      "post": {
        "tags": ["RAG"],
        "summary": "构建 FTS5 全文索引（SSE 进度）",
        "responses": { "200": { "description": "SSE 进度流" } }
      }
    },
    "/ai/rag": {
      "post": {
        "tags": ["RAG"],
        "summary": "混合检索 + LLM 流式分析",
        "responses": { "200": { "description": "SSE 流式响应" } }
      }
    },
    "/ai/day-rag": {
      "post": {
        "tags": ["RAG"],
        "summary": "跨联系人单日聚合分析（时光机 AI）",
        "responses": { "200": { "description": "SSE 流式响应" } }
      }
    },
    "/ai/vec/index-status": {
      "get": {
        "tags": ["向量检索"],
        "summary": "查询向量索引状态",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "索引状态" } }
      }
    },
    "/ai/vec/build-index": {
      "post": {
        "tags": ["向量检索"],
        "summary": "构建向量嵌入索引",
        "responses": { "200": { "description": "构建结果" } }
      }
    },
    "/ai/vec/build-progress": {
      "get": {
        "tags": ["向量检索"],
        "summary": "向量索引构建进度",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "进度信息" } }
      }
    },
    "/ai/vec/test-embedding": {
      "post": {
        "tags": ["向量检索"],
        "summary": "测试 Embedding 提供商连接",
        "responses": { "200": { "description": "测试结果" } }
      }
    },
    "/ai/mem/status": {
      "get": {
        "tags": ["记忆提炼"],
        "summary": "查询已提炼的记忆事实数量",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "fact_count 等" } }
      }
    },
    "/ai/mem/facts": {
      "get": {
        "tags": ["记忆提炼"],
        "summary": "获取所有记忆事实",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "facts 数组" } }
      }
    },
    "/ai/mem/build": {
      "post": {
        "tags": ["记忆提炼"],
        "summary": "开始/继续记忆提炼",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "提炼进度" } }
      }
    },
    "/ai/mem/pause": {
      "post": {
        "tags": ["记忆提炼"],
        "summary": "暂停记忆提炼",
        "parameters": [{ "name": "key", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "暂停成功" } }
      }
    },
    "/ai/mem/test": {
      "post": {
        "tags": ["记忆提炼"],
        "summary": "测试记忆提炼模型配置",
        "responses": { "200": { "description": "测试结果" } }
      }
    },
    "/auth/gemini/url": {
      "get": {
        "tags": ["认证"],
        "summary": "获取 Gemini OAuth 授权 URL",
        "responses": { "200": { "description": "url 字段" } }
      }
    },
    "/auth/gemini/callback": {
      "get": {
        "tags": ["认证"],
        "summary": "Gemini OAuth 回调",
        "responses": { "200": { "description": "授权成功" } }
      }
    },
    "/auth/gemini/status": {
      "get": {
        "tags": ["认证"],
        "summary": "检查 Gemini 授权状态",
        "responses": { "200": { "description": "authorized 布尔值" } }
      }
    },
    "/auth/gemini": {
      "delete": {
        "tags": ["认证"],
        "summary": "撤销 Gemini 授权",
        "responses": { "200": { "description": "撤销成功" } }
      }
    },
    "/preferences/llm": {
      "put": {
        "tags": ["偏好设置"],
        "summary": "更新 LLM 配置（多 Profile、Embedding、记忆提炼）",
        "responses": { "200": { "description": "保存成功" } }
      }
    },
    "/preferences/anniversaries": {
      "put": {
        "tags": ["偏好设置"],
        "summary": "保存自定义纪念日",
        "responses": { "200": { "description": "保存成功" } }
      }
    },
    "/app/save-file": {
      "post": {
        "tags": ["应用管理"],
        "summary": "保存文件到 ~/Downloads（App 模式）",
        "responses": { "200": { "description": "path 字段" } }
      }
    },
    "/app/frontend-log": {
      "post": {
        "tags": ["应用管理"],
        "summary": "接收前端日志写入 frontend.log",
        "responses": { "200": { "description": "ok" } }
      }
    },
    "/groups/relationships": {
      "get": {
        "tags": ["群聊"],
        "summary": "群聊人物关系图",
        "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "nodes + edges 图结构" } }
      }
    },
    "/avatar": {
      "get": {
        "tags": ["系统"],
        "summary": "头像代理（缓存 + CORS）",
        "parameters": [{ "name": "url", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "图片数据" } }
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
    },
    "/contacts/self-portrait": {
      "get": { "tags": ["联系人"], "summary": "本人自画像（发送量/活跃时段/最常联系）", "responses": { "200": { "description": "自画像数据" } } }
    },
    "/contacts/money-overview": {
      "get": { "tags": ["联系人"], "summary": "红包 / 转账全局概览", "responses": { "200": { "description": "月度趋势 + 联系人排行" } } }
    },
    "/contacts/urls": {
      "get": { "tags": ["联系人"], "summary": "聊天里的所有 URL 按域名聚合", "responses": { "200": { "description": "URL 列表 + 上下文" } } }
    },
    "/contacts/social-breadth": {
      "get": { "tags": ["联系人"], "summary": "每日社交广度曲线", "responses": { "200": { "description": "每日联系过的不同人数" } } }
    },
    "/contacts/similarity": {
      "get": {
        "tags": ["联系人"], "summary": "联系人两两相似度排行（18 维余弦）",
        "parameters": [{ "name": "top", "in": "query", "schema": { "type": "integer", "default": 20 } }],
        "responses": { "200": { "description": "Top N 对" } }
      }
    },
    "/contacts/common-circle": {
      "get": {
        "tags": ["联系人"], "summary": "两人的共同社交圈（共同群 + 共同好友推测）",
        "parameters": [
          { "name": "user1", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "user2", "in": "query", "required": true, "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "共同圈子数据" } }
      }
    },
    "/contacts/secret-words": {
      "get": {
        "tags": ["联系人"], "summary": "秘语雷达（TF-IDF 专属词云）",
        "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "词云数据" } }
      }
    },
    "/contacts/ai-summary": {
      "get": {
        "tags": ["联系人"], "summary": "低 token 关系摘要（/ai/analyze 打底）",
        "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "摘要 JSON" } }
      }
    },
    "/contacts/relationship-forecast": {
      "get": {
        "tags": ["关系预测"], "summary": "4 档趋势 + 建议主动联系",
        "parameters": [
          { "name": "top", "in": "query", "schema": { "type": "integer", "default": 5 } },
          { "name": "include_all", "in": "query", "schema": { "type": "string", "enum": ["0", "1"] }, "description": "1 时返回全档 + 12 月折线" }
        ],
        "responses": { "200": { "description": "预测结果" } }
      }
    },
    "/contacts/icebreaker": {
      "post": {
        "tags": ["关系预测"], "summary": "LLM 起草 4 条破冰开场白",
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "type": "object", "properties": {
            "username": { "type": "string" }, "profile_id": { "type": "string" }
          }, "required": ["username"] } } }
        },
        "responses": { "200": { "description": "drafts + display_name + days_since_last" } }
      }
    },
    "/groups/year-review": {
      "get": {
        "tags": ["群聊"], "summary": "AI 群聊年度回顾（Wrapped 风格）",
        "parameters": [
          { "name": "username", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "year", "in": "query", "schema": { "type": "integer" } },
          { "name": "profile_id", "in": "query", "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "Top 成员/最忙一天/月度趋势/AI 金句/年度叙事" } }
      }
    },
    "/fun/ghost-months": {
      "get": { "tags": ["有趣发现"], "summary": "Ghost 月：单月消息骤降 ≥80%", "responses": { "200": { "description": "列表" } } }
    },
    "/fun/like-me": {
      "get": { "tags": ["有趣发现"], "summary": "最像我的朋友 Top 5", "responses": { "200": { "description": "列表" } } }
    },
    "/fun/word-almanac": {
      "get": { "tags": ["有趣发现"], "summary": "词语年鉴（按年分桶代表词）", "responses": { "200": { "description": "按年分组" } } }
    },
    "/fun/insomnia-top": {
      "get": { "tags": ["有趣发现"], "summary": "失眠陪聊榜（凌晨 2-4 点响应率 Top 5）", "responses": { "200": { "description": "列表" } } }
    },
    "/databases/nl-query": {
      "post": {
        "tags": ["数据库"], "summary": "自然语言查数据（中文问 AI 写 SQL）",
        "description": "LLM 读 schema → 输出 {db, sql, explain} JSON → 后端执行只读 SQL 并返回结果。严格限 SELECT/PRAGMA + LIMIT 50。mode=contact_messages 时自动跨库定位。",
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "type": "object", "properties": {
            "question": { "type": "string" }, "profile_id": { "type": "string" }
          }, "required": ["question"] } } }
        },
        "responses": { "200": { "description": "db/sql/explain/columns/rows" } }
      }
    },
    "/preferences/forecast-ignored": {
      "put": {
        "tags": ["偏好设置"], "summary": "关系预测忽略名单保存",
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "type": "object", "properties": {
            "forecast_ignored": { "type": "array", "items": { "type": "string" } }
          } } } }
        },
        "responses": { "200": { "description": "{ ok: true }" } }
      }
    },
    "/preferences/prompts": {
      "put": { "tags": ["偏好设置"], "summary": "自定义 Prompt 模板保存", "responses": { "200": { "description": "{ ok: true }" } } }
    },
    "/preferences/config": {
      "put": { "tags": ["偏好设置"], "summary": "基本配置保存（端口/日志/时区/worker 等）", "responses": { "200": { "description": "{ ok: true }" } } }
    },
    "/ai/forge-skill": {
      "post": { "tags": ["Skills"], "summary": "异步炼化 Skill 包", "responses": { "200": { "description": "skill_id + 初始状态" } } }
    },
    "/skills": {
      "get": { "tags": ["Skills"], "summary": "Skills 列表（状态/耗时/错误）", "responses": { "200": { "description": "数组" } } }
    },
    "/skills/{id}": {
      "get": { "tags": ["Skills"], "summary": "单个 Skill 详情", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "详情" } } },
      "delete": { "tags": ["Skills"], "summary": "删除 Skill（含本地文件）", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "{ ok: true }" } } }
    },
    "/skills/{id}/download": {
      "get": { "tags": ["Skills"], "summary": "下载 Skill zip 包", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "application/zip" } } }
    },
    "/export/preview": {
      "post": { "tags": ["导出中心"], "summary": "预览 Markdown（不写文件）", "responses": { "200": { "description": "docs[]" } } }
    },
    "/export/markdown": {
      "post": { "tags": ["导出中心"], "summary": "下载 Markdown（单文件 .md / 多文件 .zip）", "responses": { "200": { "description": "文件流" } } }
    },
    "/export/notion": {
      "post": { "tags": ["导出中心"], "summary": "推送到 Notion（每 doc 新建 Page）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/feishu": {
      "post": { "tags": ["导出中心"], "summary": "导入飞书云空间（upload_all + import_tasks 异步轮询）", "responses": { "200": { "description": "results[] + docx URL" } } }
    },
    "/export/webdav": {
      "post": { "tags": ["导出中心"], "summary": "上传 WebDAV（坚果云/Nextcloud/群晖等）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/s3": {
      "post": { "tags": ["导出中心"], "summary": "上传 S3 兼容（AWS/R2/OSS/COS/七牛/MinIO）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/dropbox": {
      "post": { "tags": ["导出中心"], "summary": "上传 Dropbox（PAT 模式）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/gdrive": {
      "post": { "tags": ["导出中心"], "summary": "上传 Google Drive（OAuth 2.0，先走 /oauth/gdrive/start 授权）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/onedrive": {
      "post": { "tags": ["导出中心"], "summary": "上传 OneDrive（Microsoft Identity OAuth）", "responses": { "200": { "description": "results[]" } } }
    },
    "/export/config": {
      "get": { "tags": ["导出中心"], "summary": "获取脱敏配置（secret → __HAS_KEY__ 占位符）", "responses": { "200": { "description": "ExportConfigDTO" } } },
      "put": { "tags": ["导出中心"], "summary": "保存配置（遇占位符保留原值）", "responses": { "200": { "description": "{ ok: true }" } } }
    },
    "/export/oauth/gdrive/start": {
      "get": { "tags": ["导出中心"], "summary": "跳转到 Google OAuth 授权页", "responses": { "302": { "description": "Redirect" } } }
    },
    "/export/oauth/gdrive/callback": {
      "get": { "tags": ["导出中心"], "summary": "接收授权码换 access + refresh token", "responses": { "200": { "description": "授权成功 HTML" } } }
    },
    "/export/oauth/onedrive/start": {
      "get": { "tags": ["导出中心"], "summary": "跳转到 Microsoft Identity OAuth 授权页", "responses": { "302": { "description": "Redirect" } } }
    },
    "/export/oauth/onedrive/callback": {
      "get": { "tags": ["导出中心"], "summary": "接收授权码换 token", "responses": { "200": { "description": "授权成功 HTML" } } }
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
	spec = strings.Replace(spec, "{{VERSION}}", appVersion, 1)
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
