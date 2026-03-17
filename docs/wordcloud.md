# 词云生成说明


## 概述

WeLink 的词云基于 **go-ego/gse** 中文分词库对聊天记录做词频统计，返回 Top 120 词交给前端 [WordCloud2.js](https://github.com/timdream/wordcloud2.js) 渲染。


## 后端：分词与过滤

### 入口

```
GET /api/contacts/wordcloud?username=xxx&include_mine=false
```

### 处理流程

```
1. 查询该联系人所有 local_type=1 的文本消息
   └── include_mine=false → 只查对方发的（real_sender_id = 对方 rowid）

2. 解码消息内容（支持 zstd 压缩）

3. 去除微信表情符号，如 [捂脸] [偷笑]

4. 收集所有文本，统一交给 gse.Cut(text, true) 分词
   └── 分词使用锁保护（gse 非线程安全）

5. 过滤规则（逐词）：
   - UTF-8 非法 → 丢弃
   - 字符数 < 2 或 > 8 → 丢弃（过滤单字和长句残片）
   - 纯数字 → 丢弃
   - 在停用词表中 → 丢弃
   - 包含 emoji / 特殊符号 → 丢弃
   - 不含任何汉字或字母 → 丢弃

6. 最小词频过滤：
   minCount = max(2, len(消息总数) / 1000)
   词频 < minCount → 丢弃（去除低频噪声词）

7. 按词频降序排序，返回 Top 120
```


## 停用词表

停用词分为以下几类，共约 150 个：

| 类别 | 示例 |
|------|------|
| 人称代词 | 我 你 他 她 自己 大家 别人 |
| 结构助词 / 语气词 | 的 了 着 过 得 吧 啊 哦 呢 嗯 哈 |
| 口语语气 | 嗯嗯 哦哦 哈哈 哈哈哈 嘻嘻 呵呵 hhh hh ok |
| 副词 / 连词 | 也 都 还 就 才 又 很 太 非常 所以 因为 然后 |
| 时间副词 | 已经 刚刚 突然 终于 马上 立刻 |
| 高频无义动词 | 是 在 有 要 去 来 说 到 看 想 知道 觉得 |
| 口语填充词 | 其实 反正 那个 这个 感觉 只是 对吧 是的 |
| 形容词 / 代词 | 这 那 哪 什么 怎么 这样 那样 这么 那么 |
| 通用量词 | 个 件 种 次 下 遍 些 点 块 条 |
| 方位词 | 上 左 右 前 后 里 外 中 间 |

完整词表见 `backend/service/contact_service.go` 中的 `STOP_WORDS`。


## 前端：字号映射与渲染

### 字号：对数映射

词云字号使用**对数映射**，避免线性映射下头部词极大、尾部词极小的失衡问题：

```typescript
const logMax = Math.log(maxCount + 1)
const logMin = Math.log(Math.max(minCount, 1))
const logRange = logMax - logMin || 1

// minSize ~ maxSize 根据画布宽度动态缩放
const minSize = Math.round(13 * scale)   // scale = canvas.width / 600
const maxSize = Math.round(58 * scale)

size = minSize + ((log(count+1) - logMin) / logRange) * (maxSize - minSize)
```

效果：词频相差 10 倍，字号只相差约 1.5 倍，中间层级的词得到更合理的展示空间。

### WordCloud2 渲染参数

| 参数 | 值 | 说明 |
|------|----|------|
| `rotateRatio` | 0 | 中文词全部水平，不旋转 |
| `shuffle` | false | 高频词按顺序摆放，自然占据中心 |
| `gridSize` | `6 × scale` | 词间距随画布大小自适应 |
| `shrinkToFit` | true | 放不下时自动缩小 |
| `drawOutOfBound` | false | 不允许词超出边界 |
| `fontFamily` | PingFang SC / Microsoft YaHei | 中文字体优先 |

### 颜色

词的颜色从以下 5 色中随机选取：

```
#07c160  微信绿
#10aeff  蓝
#ff9500  橙
#fa5151  红
#576b95  紫蓝
```


## 与历史版本（v1）的区别

| | v1 | v2（当前） |
|--|----|-----------|
| 停用词数量 | ~40 个 | ~150 个 |
| 词长限制 | > 1 字符 | 2~8 字符（过滤长句残片） |
| 最小词频 | 无 | max(2, 消息数/1000) |
| 返回词数 | 80 | 120 |
| 字号映射 | 线性 `count/max × 72` | 对数映射 |
| 旋转 | 20% 的词旋转 | 全部水平（rotateRatio=0） |
| 摆放顺序 | 随机 shuffle | 按词频顺序（shuffle=false） |


## 群聊词云

群聊的词云逻辑与联系人词云相同，但数据源是群消息表，且在分词前会额外去除群消息前缀格式（`wxid:\n内容`）。群聊词云不支持 `include_mine` 过滤，统计所有成员的消息。


## 局限性

1. **GSE 词典**：使用默认词典，专有名词、网络用语可能被切分错误（如"打工人"可能被切成"打工"+"人"）
2. **同义词合并**：未做同义词聚合，"开心"和"开开心心"会分别计数
3. **英文处理**：英文单词不分词，直接作为整词处理，短于 2 字符的英文单词会被过滤
