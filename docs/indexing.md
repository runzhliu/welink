# 索引与初始化说明


## 初始化流程

### 触发方式

前端在用户设置好时间范围后，调用 `POST /api/init`：

```json
{ "from": 1640966400, "to": 1704067200 }
```

后端立即返回 `{ "status": "indexing" }`，实际分析在后台 goroutine 中异步执行。

### 初始化步骤

```
POST /api/init
    │
    ├── 1. 设置 filterFrom / filterTo（全局时间过滤范围）
    ├── 2. 清空内存缓存（cache、global、groupDetailCache）
    ├── 3. 将 isIndexing = true, isInitialized = false
    └── 4. 启动后台 goroutine → performAnalysis()
              │
              ├── 从 contact.db 读取所有有效联系人
              ├── 并发 4 worker 处理每个联系人：
              │     ├── 扫描所有 message_N.db 的对应 Msg_<hash> 表
              │     ├── 统计总消息数、对方消息数、我的消息数
              │     ├── 记录首条/末条消息时间
              │     ├── 按消息类型分类统计（文本/图片/语音/视频/表情/其他）
              │     ├── 读取并解码第一条有效文本（first_msg）
              │     ├── 统计深夜消息（0~5 点）
              │     └── 统计全局小时热力、日期热力、类型分布
              ├── 构建深夜密友排行（前 20，至少 100 条消息）
              ├── 计算全局统计（总人数、总消息、最忙天、表情王）
              ├── 将结果写入内存缓存（cacheMu.Lock）
              └── 设置 isIndexing = false, isInitialized = true
```

### 轮询状态

前端每 2 秒轮询 `GET /api/status`：

```json
{
  "is_indexing":    true,   // 正在索引
  "is_initialized": false,
  "total_cached":   0
}
```

直到 `is_initialized = true` 才允许进入主界面。

### 自动重新初始化

后端重启后内存缓存清空。恢复"上次的时间范围"有两条路径，按以下优先级生效：

1. **后端自动 init**（推荐路径）：用户调用 `/api/init` 或在 setup 页选好数据目录后，后端会把 `from / to` 同时写入 `preferences.json` 的 `default_init_from / default_init_to` 字段。下次进程启动时 `NewContactService` 读到非零值会自动开始索引，**无需前端介入**，也不依赖浏览器 localStorage。
2. **前端兜底补救**：如果第 1 步没保存（例如用旧版本启动过、preferences.json 被删除），前端检测到 `is_initialized = false` 且 localStorage 里有 `welink_hasStarted = true` 时，会用 `welink_timeRange` 缓存的范围重新调一次 `/api/init`。

> 路径 1 是 v0.x 之后的行为。早期版本只走路径 2，所以**清浏览器缓存 / 换浏览器 / 容器换主机访问**会导致重启后被引导到 WelcomePage 重选时间。如果遇到这种问题，确认下 `preferences.json`（Docker 下挂在 `welink-prefs` 卷里的 `/app/prefs/preferences.json`）的 `default_init_from / default_init_to` 是否非零，没有就重新选一次时间，往后就稳了。

#### preferences.json 字段示例

```json
{
  "data_dir": "/app/data",
  "default_init_from": 0,
  "default_init_to": 1735689600,
  "...": "..."
}
```

- `default_init_from = 0` 表示不限起点（取所有历史消息）
- `default_init_to`  为目标时刻 Unix 秒；Demo 模式下是当前时间 + 10 年


## SQLite 索引优化

### 索引创建时机

**DBManager 初始化时**（`NewDBManager` 调用时）对所有 message_N.db 执行，每个 `Msg_*` 表创建三个索引：

```sql
-- 1. 时间索引（最常用：按时间范围查询消息）
CREATE INDEX IF NOT EXISTS idx_Msg_<hash>_create_time
ON [Msg_<hash>] (create_time);

-- 2. 类型索引（按消息类型过滤，如 local_type=1 取文本消息）
CREATE INDEX IF NOT EXISTS idx_Msg_<hash>_local_type
ON [Msg_<hash>] (local_type);

-- 3. 复合索引（类型 + 时间，用于词云/情感分析的组合查询）
CREATE INDEX IF NOT EXISTS idx_Msg_<hash>_local_type_create_time
ON [Msg_<hash>] (local_type, create_time);
```

### 为什么需要这些索引

| 场景 | 使用的索引 | SQL 示例 |
|------|-----------|---------|
| 按时间范围统计消息数 | `create_time` | `WHERE create_time >= X AND create_time <= Y` |
| 获取某天的聊天记录 | `create_time` | `WHERE create_time >= dayStart AND create_time < dayEnd` |
| 获取文本消息（词云/情感） | `local_type` 或复合 | `WHERE local_type = 1` |
| 词云+时间范围 | 复合 | `WHERE local_type=1 AND create_time >= X` |

### 索引创建策略

使用 `CREATE INDEX IF NOT EXISTS` — 已存在则跳过，重启不会重复创建，不影响启动速度。


## 并发模型

### 联系人分析并发

```
sem = make(chan struct{}, 4)   // 信号量，最大 4 个并发 worker

for each contact:
    go func():
        sem <- {}              // 获取槽位（满则阻塞）
        defer <-sem            // 完成后释放
        // 查询该联系人的消息（I/O 密集）
        // 包括：消息统计、类型分析、时间计算、发送者统计

wg.Wait()                      // 等待所有联系人处理完毕
```

### 分词器（非线程安全）

gse（go-seg-engine）不支持并发，词云/群聊分词用互斥锁串行处理：

```go
s.segmenterMu.Lock()
for _, text := range texts {
    segs = s.segmenter.Cut(text, true)
}
s.segmenterMu.Unlock()
```

### 内存缓存读写

```go
// 读（GetCachedStats、GetGlobal 等高频接口）
s.cacheMu.RLock()
defer s.cacheMu.RUnlock()
return s.cache

// 写（performAnalysis 完成后写一次）
s.cacheMu.Lock()
s.cache = result
s.global = newGlobal
s.cacheMu.Unlock()
```

### 群聊详情懒加载

```go
// 读（命中缓存直接返回）
s.groupDetailMu.RLock()
if cached, ok := s.groupDetailCache[username]; ok {
    s.groupDetailMu.RUnlock()
    return cached
}
s.groupDetailMu.RUnlock()

// 未命中：计算 + 写缓存
detail := computeGroupDetail(username)
s.groupDetailMu.Lock()
s.groupDetailCache[username] = detail
s.groupDetailMu.Unlock()
```


## zstd 解码器复用

消息内容解压频繁调用，使用 `sync.Pool` 避免重复创建解码器：

```go
var zstdDecoderPool = sync.Pool{
    New: func() any {
        d, _ := zstd.NewReader(nil)
        return d
    },
}

// 使用时
dec := zstdDecoderPool.Get().(*zstd.Decoder)
dec.Reset(bytes.NewReader(rawContent))
result, _ := io.ReadAll(dec)
zstdDecoderPool.Put(dec)
```


## 时间过滤机制

`filterFrom` / `filterTo` 在 `Reinitialize` 时设定，`timeWhere()` 方法动态生成 SQL WHERE 子句：

```go
func (s *ContactService) timeWhere() string {
    from, to := s.filterFrom, s.filterTo
    if from > 0 && to > 0 {
        return fmt.Sprintf(" WHERE create_time >= %d AND create_time <= %d", from, to)
    } else if from > 0 {
        return fmt.Sprintf(" WHERE create_time >= %d", from)
    } else if to > 0 {
        return fmt.Sprintf(" WHERE create_time <= %d", to)
    }
    return ""  // 全部时间
}
```

该 WHERE 子句被复用于：
- 联系人消息统计（performAnalysis）
- 联系人深度分析（GetContactDetail）
- 词云生成（GetWordCloud）
- 情感分析（GetSentimentAnalysis）
- 群聊分析（GetGroups / GetGroupDetail）


## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `../decrypted` | 解密后数据库根目录 |
| `PORT` | `8080` | 后端监听端口 |

Docker Compose 下通常设置：
```
DATA_DIR=/data
PORT=8080
```
