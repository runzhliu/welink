# 数据库结构说明

WeChat 解密后的数据库分两类：联系人库和消息库，均为 SQLite 格式。


## 目录结构

```
decrypted/
├── contact/
│   └── contact.db          # 唯一的联系人数据库
└── message/
    ├── message_0.db        # 消息数据库（分片）
    ├── message_1.db
    ├── message_2.db
    ├── ...
    └── message_N.db
    # 以下文件被排除加载：
    # message_fts*.db       全文搜索索引（不加载）
    # message_resource*.db  多媒体资源（不加载）
```


## contact.db — 联系人数据库

### 表：`contact`

主要联系人信息表。

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `username` | TEXT | 微信号（wxid 或自定义ID），核心标识符 |
| `nick_name` | TEXT | 对方设置的昵称 |
| `remark` | TEXT | 你给对方设置的备注名 |
| `alias` | TEXT | 别名 |
| `flag` | INTEGER | 位掩码，`flag & 3 != 0` 表示是好友 |
| `verify_flag` | INTEGER | 验证状态，`0` 表示正常联系人 |
| `big_head_url` | TEXT | 大头像 URL |
| `small_head_url` | TEXT | 小头像 URL |
| `description` | TEXT | 个人签名 |

**关键过滤规则（后端加载时）：**

```sql
SELECT * FROM contact WHERE verify_flag = 0
-- 再过滤掉：
--   username LIKE '%@chatroom'  → 群聊（单独处理）
--   username LIKE 'gh_%'        → 公众号
--   username = ''               → 空
-- 保留条件：(flag & 3 != 0) OR remark != ''
```

**显示名优先级：** `remark` > `nick_name` > `username`


### 表：`name2id`

联系人 username → 内部 ID 的映射（contact.db 中的版本）。

| 列名 | 类型 | 说明 |
|------|------|------|
| `user_name` | TEXT PK | 微信号 |
| ... | | |


### 表：`chat_room`

群聊基础信息。username 格式为 `xxxxxxxx@chatroom`。


## message_N.db — 消息数据库

消息数据按联系人分表存储，**每个联系人一张消息表**，多个 message_N.db 文件中可能都有同一个联系人的消息（跨 DB 分片）。


### 消息表命名规则

```
表名 = "Msg_" + MD5(username).hex()
```

示例：
```
username = "yoyo516123"
MD5      = "96e07f9a6ecbbda56f3f0598701cb263"
表名     = "Msg_96e07f9a6ecbbda56f3f0598701cb263"
```

Go 实现：
```go
func GetTableName(username string) string {
    hash := md5.Sum([]byte(username))
    return fmt.Sprintf("Msg_%s", hex.EncodeToString(hash[:]))
}
```


### 表：`Msg_<hash>` — 消息表

| 列名 | 类型 | 说明 |
|------|------|------|
| `local_id` | INTEGER PK | 本地消息ID |
| `server_id` | INTEGER | 服务端消息ID |
| `local_type` | INTEGER | **消息类型**（见下表） |
| `sort_seq` | INTEGER | 排序序号 |
| `real_sender_id` | INTEGER | 发送者在本 DB 的 `Name2Id.rowid` |
| `create_time` | INTEGER | 发送时间（Unix 秒） |
| `status` | INTEGER | 消息状态 |
| `message_content` | TEXT/BLOB | 消息内容（可能是 zstd 压缩） |
| `compress_content` | TEXT | 压缩内容备用字段 |
| `packed_info_data` | BLOB | Protobuf 格式的附件元数据 |
| `WCDB_CT_message_content` | INTEGER | 压缩类型标志，`4` = zstd 压缩 |

**消息类型（local_type）：**

| 值 | 类型 | 说明 |
|----|------|------|
| 1  | 文本 | 普通文字消息 |
| 3  | 图片 | |
| 34 | 语音 | |
| 43 | 视频 | |
| 47 | 表情/贴纸 | |
| 49 | 富媒体 | 链接/文件/红包/转账（需解析 content 内容区分） |
| 其他 | 系统消息等 | |

**红包/转账识别（type=49）：**
```
message_content 包含 "wcpay"       → 微信支付/转账
message_content 包含 "redenvelope" → 红包
```


### 表：`Name2Id` — 发送者 ID 映射

**每个 message_N.db 都有独立的 Name2Id 表，同一联系人在不同 DB 中的 rowid 不同。**

| 列名 | 类型 | 说明 |
|------|------|------|
| `user_name` | TEXT PK | 微信号（wxid） |
| `is_session` | INTEGER | 是否为会话参与者 |

```sql
-- 查联系人在当前 DB 的 rowid
SELECT rowid FROM Name2Id WHERE user_name = 'yoyo516123'
```

**区分发送者的正确方式：**

```go
// ❌ 错误：不同 DB 中联系人的 rowid 不同，不能跨 DB 复用
contactRowID := queryOnce()  // 只查一次
for db in allDBs:
    isMine = (senderID != contactRowID)  // 跨 DB 使用会出错

// ✅ 正确：在每个 DB 中单独查询
for db in allDBs:
    contactRowID := db.QueryRow("SELECT rowid FROM Name2Id WHERE user_name = ?")
    isMine = (senderID != contactRowID)
```


### 表：`TimeStamp`

| 列名 | 类型 | 说明 |
|------|------|------|
| `timestamp` | INTEGER | DB 最后更新时间戳 |


### 表：`SendInfo`

| 列名 | 类型 | 说明 |
|------|------|------|
| `chat_name_id` | INTEGER | 会话 ID |
| `msg_local_id` | INTEGER | 消息本地 ID |


## 数据关联关系

```
contact.db/contact.username
    │
    ├── MD5(username) ──→ message_N.db/Msg_<hash>  （消息表，跨多个 DB）
    │                          │
    │                          ├── real_sender_id ──→ message_N.db/Name2Id.rowid
    │                          │                           │
    │                          │                           └── user_name → contact.username
    │                          │
    │                          └── create_time  （Unix 秒，UTC+8 北京时间）
    │
    └── username LIKE '%@chatroom' → 群聊（contact.db/chat_room）
```

### 跨 DB 消息汇总示例

```sql
-- 统计联系人 yoyo516123 的全部消息（需对所有 message_N.db 执行并求和）
SELECT COUNT(*), MIN(create_time), MAX(create_time)
FROM Msg_96e07f9a6ecbbda56f3f0598701cb263
-- 对每个 message_N.db 分别查询，结果累加
```


## 内容压缩

部分消息内容使用 zstd 压缩，判断方式：

```sql
-- WCDB_CT_message_content = 4 时，message_content 是 zstd 压缩的字节流
SELECT message_content, COALESCE(WCDB_CT_message_content, 0) FROM Msg_xxx
```

```go
if compressionType == 4 {
    decoder := zstd.NewReader(nil)
    text, _ = decoder.DecodeAll(rawContent, nil)
}
```


## 群消息发送者解析

群聊消息中，`real_sender_id` 指向 `Name2Id.rowid`，通过该表可还原发送者 wxid，再通过 contact.db 获取显示名：

```sql
-- 步骤1：找到 sender 的 wxid
SELECT user_name FROM Name2Id WHERE rowid = <real_sender_id>

-- 步骤2：通过 wxid 查联系人显示名
SELECT COALESCE(remark, nick_name, username) FROM contact
WHERE username = '<wxid>'
```


## 时间处理

所有 `create_time` 均为 Unix 秒时间戳，Go 中转换为北京时间（UTC+8）：

```go
var CST = time.FixedZone("CST", 8*3600)
func tsToTime(ts int64) time.Time {
    return time.Unix(ts, 0).In(CST)
}
```

日历查询时计算一天的范围：
```go
t, _ := time.ParseInLocation("2006-01-02", date, CST)
dayStart := t.Unix()          // 当天 00:00:00
dayEnd   := dayStart + 86400  // 次日 00:00:00
```
