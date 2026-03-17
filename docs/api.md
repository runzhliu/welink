# API 接口文档

> 后端基于 Go + Gin，默认监听 `:8080`，所有接口前缀 `/api`。
> 在线文档：访问 `/swagger/` 可查看 Swagger UI。


## 目录

- [初始化与状态](#初始化与状态)
- [联系人分析](#联系人分析)
- [群聊分析](#群聊分析)
- [数据库浏览器](#数据库浏览器)
- [其他](#其他)


## 初始化与状态

### `POST /api/init`

触发后端重新建立索引，必须在使用其他分析接口前调用。索引在后台异步进行。

**请求体**

```json
{
  "from": 1672531200,
  "to":   1704067200
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `from` | int64 | 开始时间（Unix 秒），`0` 表示不限 |
| `to`   | int64 | 结束时间（Unix 秒），`0` 表示不限 |

**响应**

```json
{ "status": "indexing" }
```


### `GET /api/status`

查询索引进度，前端用于轮询判断是否可以开始使用。

**响应**

```json
{
  "is_indexing":    false,
  "is_initialized": true,
  "total_cached":   312
}
```

| 字段 | 说明 |
|------|------|
| `is_indexing` | 是否正在索引 |
| `is_initialized` | 是否已完成初始化（可正常使用） |
| `total_cached` | 当前缓存的联系人数量 |


### `GET /api/health`

健康检查，返回数据库连接数。

**响应**

```json
{ "status": "ok", "db_connected": 5 }
```


## 联系人分析

### `GET /api/contacts/stats`

获取所有联系人的统计信息（从内存缓存返回，极速）。

> 在 `/api/init` 完成前返回空数组。

**响应** `[]ContactStatsExtended`

```json
[
  {
    "username":           "wxid_abc123",
    "nickname":           "张三",
    "remark":             "张三（同事）",
    "alias":              "",
    "flag":               3,
    "description":        "",
    "big_head_url":       "https://...",
    "small_head_url":     "https://...",
    "total_messages":     1234,
    "their_messages":     700,
    "my_messages":        534,
    "first_message_time": "2020-03-01",
    "last_message_time":  "2024-11-15",
    "first_msg":          "你好呀",
    "emoji_count":        42,
    "type_pct": {
      "文本": 80.5,
      "图片": 12.3,
      "语音": 5.0,
      "表情": 1.5,
      "视频": 0.5,
      "其他": 0.2
    },
    "type_cnt": {
      "文本": 993,
      "图片": 152
    }
  }
]
```


### `GET /api/global`

获取全局聚合统计（所有联系人汇总）。

**响应** `GlobalStats`

```json
{
  "total_friends":      312,
  "zero_msg_friends":   28,
  "total_messages":     186432,
  "busiest_day":        "2023-02-05",
  "busiest_day_count":  412,
  "emoji_king":         "张三（同事）",
  "monthly_trend": {
    "2023-01": 1234,
    "2023-02": 2100
  },
  "hourly_heatmap":     [12, 8, 3, 1, 0, 2, 15, 45, ...],
  "type_mix": {
    "文本": 150000,
    "图片": 20000
  },
  "late_night_ranking": [
    {
      "name":             "李四",
      "late_night_count": 342,
      "total_messages":   2100,
      "ratio":            16.3
    }
  ]
}
```


### `GET /api/contacts/detail`

获取单个联系人的深度分析（按需计算，非缓存）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username` | 是 | 联系人 wxid |

**响应** `ContactDetail`

```json
{
  "hourly_dist":     [5, 2, 1, 0, 0, 0, 8, 30, 55, ...],
  "weekly_dist":     [10, 85, 92, 78, 88, 60, 20],
  "daily_heatmap":   { "2023-01-15": 32, "2023-01-16": 18 },
  "late_night_count": 342,
  "money_count":      5,
  "initiation_count": 180,
  "total_sessions":   200
}
```

| 字段 | 说明 |
|------|------|
| `hourly_dist` | 长度 24，按小时统计消息数（索引 = 小时） |
| `weekly_dist` | 长度 7，`[0]` = 周日，`[1]` = 周一 … `[6]` = 周六 |
| `daily_heatmap` | `"YYYY-MM-DD"` → 当日消息数 |
| `late_night_count` | 0~5 点消息数 |
| `money_count` | 红包/转账次数（双方合计） |
| `initiation_count` | 你主动发起的对话段数 |
| `total_sessions` | 总对话段数（间隔 > 6h 视为新段） |


### `GET /api/contacts/wordcloud`

获取联系人的词云数据（中文分词 + 停用词过滤，返回 top 120）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username`    | 是 | 联系人 wxid |
| `include_mine` | 否 | 值为 `"true"` 时包含双方消息，默认仅对方 |

**响应** `[]WordCount`

```json
[
  { "word": "哈哈", "count": 312 },
  { "word": "知道", "count": 280 }
]
```


### `GET /api/contacts/sentiment`

按月份进行情感分析（基于关键词词典评分）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username`    | 是 | 联系人 wxid |
| `include_mine` | 否 | 值为 `"true"` 时包含双方消息，默认仅对方 |

**响应** `SentimentResult`

```json
{
  "monthly": [
    { "month": "2023-01", "score": 0.72, "count": 134 },
    { "month": "2023-02", "score": 0.58, "count": 98 }
  ],
  "overall":  0.68,
  "positive": 420,
  "negative": 85,
  "neutral":  210
}
```

| 字段 | 说明 |
|------|------|
| `score` | 0.0~1.0，0.5 为中性基线 |
| `overall` | 全部参与评分消息的平均分 |
| `positive` | score ≥ 0.6 的消息数 |
| `negative` | score ≤ 0.4 的消息数 |
| `neutral`  | 0.4 < score < 0.6 的消息数 |


### `GET /api/contacts/common-groups`

获取当前用户与指定联系人的共同群聊列表（在群消息表中查找对方是否有发言记录）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username` | 是 | 联系人 wxid |

**响应** `[]GroupInfo`（结构同 `/api/groups`）

```json
[
  {
    "username":           "12345678@chatroom",
    "name":               "工作群",
    "small_head_url":     "https://...",
    "total_messages":     8423,
    "first_message_time": "2021-06-01",
    "last_message_time":  "2024-11-15"
  }
]
```

> 返回空数组表示无共同群聊，而非错误。


### `GET /api/contacts/messages`

获取某一天与指定联系人的完整聊天记录（用于日历点击查看）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username` | 是 | 联系人 wxid |
| `date`     | 是 | 日期，格式 `"YYYY-MM-DD"`（北京时间） |

**响应** `[]ChatMessage`

```json
[
  { "time": "09:12", "content": "早上好", "is_mine": false, "type": 1 },
  { "time": "09:14", "content": "早！",   "is_mine": true,  "type": 1 },
  { "time": "10:30", "content": "[图片]", "is_mine": false, "type": 3 }
]
```

| 字段 | 说明 |
|------|------|
| `time` | HH:MM，北京时间 |
| `content` | 文本内容，非文本类型为描述字符串（见下表） |
| `is_mine` | `true` = 你发的 |
| `type` | 消息类型（见消息类型说明） |

**非文本消息内容映射**

| type | content 值 |
|------|-----------|
| 3  | `[图片]` |
| 34 | `[语音]` |
| 43 | `[视频]` |
| 47 | `[表情]` |
| 49（含 wcpay/redenvelope） | `[红包/转账]` |
| 49（其他） | `[链接/文件]` |
| 其他 | `[消息类型 N]` |


## 群聊分析

### `GET /api/groups`

获取所有有消息记录的群聊列表。

**响应** `[]GroupInfo`

```json
[
  {
    "username":           "12345678@chatroom",
    "name":               "工作群",
    "small_head_url":     "https://...",
    "total_messages":     8423,
    "first_message_time": "2021-06-01",
    "last_message_time":  "2024-11-15"
  }
]
```


### `GET /api/groups/detail`

获取群聊深度分析（懒加载，首次计算后缓存内存）。

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `username` | 是 | 群 @chatroom wxid |

**响应** `GroupDetail`

```json
{
  "hourly_dist":  [3, 1, 0, 0, 0, 1, 8, 45, ...],
  "weekly_dist":  [5, 120, 135, 110, 125, 80, 25],
  "daily_heatmap": { "2023-01-15": 48 },
  "member_rank": [
    { "speaker": "张三", "count": 1240 },
    { "speaker": "李四", "count": 980 }
  ],
  "top_words": [
    { "word": "明天", "count": 145 },
    { "word": "会议", "count": 120 }
  ]
}
```


## 数据库浏览器

### `GET /api/databases`

列出所有已加载的数据库文件。

**响应** `[]DBInfo`

```json
[
  { "name": "contact.db",   "path": "/data/contact/contact.db",   "size": 2097152, "type": "contact" },
  { "name": "message_1.db", "path": "/data/message/message_1.db", "size": 52428800, "type": "message" }
]
```


### `GET /api/databases/:dbName/tables`

列出指定数据库的所有表及行数。

**响应** `[]TableInfo`

```json
[
  { "name": "contact", "row_count": 512 },
  { "name": "Msg_96e07f9a...", "row_count": 3420 }
]
```


### `GET /api/databases/:dbName/tables/:tableName/schema`

查看表结构。

**响应** `[]ColumnInfo`

```json
[
  { "cid": 0, "name": "local_id", "type": "INTEGER", "not_null": false, "default_value": "", "primary_key": true },
  { "cid": 5, "name": "create_time", "type": "INTEGER", "not_null": false, "default_value": "", "primary_key": false }
]
```


### `GET /api/databases/:dbName/tables/:tableName/data`

分页获取表数据。

**Query 参数**

| 参数 | 默认值 | 最大值 | 说明 |
|------|--------|--------|------|
| `offset` | 0 | - | 起始行偏移 |
| `limit`  | 50 | 200 | 每页行数 |

**响应** `TableData`

```json
{
  "columns": ["local_id", "create_time", "message_content"],
  "rows": [[1, 1627920012, "你好"], [2, 1627920100, null]],
  "total": 3420
}
```


## 其他

### `GET /api/stats/filter`

用自定义时间范围计算统计（不更新缓存，即时返回）。

**Query 参数**

| 参数 | 说明 |
|------|------|
| `from` | 开始时间（Unix 秒），可省略 |
| `to`   | 结束时间（Unix 秒），可省略 |

**响应** `FilteredStats`

```json
{
  "contacts":    [ ...同 /api/contacts/stats... ],
  "global_stats": { ...同 /api/global... }
}
```


## 错误响应格式

```json
{ "error": "username required" }
```

HTTP 状态码：`400` Bad Request / `500` Internal Server Error。
