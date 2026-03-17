package service

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"welink/backend/pkg/db"
)

// SentimentPoint 单个月份的情感数据点
type SentimentPoint struct {
	Month string  `json:"month"` // "2024-03"
	Score float64 `json:"score"` // 0~1，越高越积极
	Count int     `json:"count"` // 该月参与评分的消息条数（含中性）
}

// SentimentResult 情感分析结果
type SentimentResult struct {
	Monthly  []SentimentPoint `json:"monthly"`
	Overall  float64          `json:"overall"`  // 全局平均分
	Positive int              `json:"positive"` // 积极消息数
	Negative int              `json:"negative"` // 消极消息数
	Neutral  int              `json:"neutral"`  // 中性消息数
}

// ---- 情感词典 ----
// 只保留极性明确的词，去除口语填充词（"好"、"行"、"可以"、"哈哈" 等）

var positiveWords = []string{
	// 喜悦 / 开心
	"开心", "高兴", "快乐", "幸福", "愉快", "欢喜", "喜悦", "欣慰", "心情好",
	// 喜爱
	"喜欢", "爱", "爱你", "宝贝", "亲爱", "心动", "暗恋",
	// 赞扬 / 肯定
	"棒", "厉害", "牛", "太棒了", "很棒", "好棒", "优秀", "出色", "聪明", "能干",
	"完美", "漂亮", "好看", "帅", "美", "可爱", "赞", "666", "6666",
	// 感谢
	"感谢", "谢谢", "感激", "感动", "暖", "暖心", "贴心", "温柔", "体贴",
	// 成功 / 顺利
	"成功", "顺利", "通过", "搞定", "完成", "达成", "实现", "进步", "提升",
	// 期待 / 惊喜
	"期待", "惊喜", "好期待", "太好了", "太棒了", "好激动", "激动", "兴奋",
	// 满意 / 舒适
	"满意", "舒服", "舒适", "享受", "放松", "轻松", "愉悦",
	// 加油 / 支持
	"加油", "支持", "鼓励", "相信", "祝贺", "恭喜", "庆祝", "欢迎",
	// 有趣
	"有趣", "好玩", "好笑", "开怀", "哈哈哈哈哈",
	// 甜蜜
	"甜", "甜蜜", "幸运", "美好", "美妙", "好幸福",
}

var negativeWords = []string{
	// 悲伤
	"难过", "伤心", "哭", "哭了", "哭泣", "流泪", "委屈", "心疼", "痛苦",
	"心碎", "想哭", "好难受", "难受", "难受死了",
	// 焦虑 / 担忧
	"焦虑", "担心", "害怕", "恐惧", "紧张", "忐忑", "不安", "惶恐", "慌",
	// 愤怒
	"愤怒", "生气", "发火", "火大", "气死", "气死我了", "好气", "烦死",
	"讨厌", "恶心", "恨", "滚", "闭嘴", "滚开",
	// 失望 / 沮丧
	"失望", "沮丧", "遗憾", "后悔", "可惜", "无奈", "心灰意冷",
	// 疲惫 / 痛苦
	"累", "累死了", "好累", "疲惫", "疲倦", "精疲力竭",
	"头疼", "头痛", "胃疼", "难受", "不舒服", "生病", "发烧",
	// 厌烦
	"烦", "烦恼", "烦透了", "烦死了", "烦人", "无聊", "厌烦", "厌倦",
	// 孤独
	"孤独", "寂寞", "孤单", "好孤独", "一个人",
	// 绝望 / 崩溃
	"崩溃", "绝望", "心塞", "好绝望", "撑不住", "坚持不下去",
	// 负面事件
	"失败", "失去", "分手", "离开", "死", "完了", "糟糕", "糟透了",
	"倒霉", "运气差", "坏运气",
}

// intensifiers 程度副词
var intensifiers = map[string]float64{
	"非常": 1.6, "特别": 1.5, "超级": 1.5, "极其": 1.7, "十分": 1.4,
	"太":   1.4, "真的": 1.3, "真":   1.2, "好":   1.2, "超":   1.4,
	"相当": 1.3, "挺":   1.2, "蛮":   1.2, "很":   1.2, "极":   1.5,
	"格外": 1.3, "尤为": 1.3, "异常": 1.4,
}

// negations 否定词
var negations = []string{"不", "没", "别", "莫", "勿", "未", "非", "无", "没有", "从未", "从来不"}

// ---- 句子级评分 ----

// tokenize 把句子按字边界拆成词元列表（每个汉字或英文单词为一个 token）
// 同时识别词典中的多字词优先匹配
func tokenize(text string) []string {
	runes := []rune(text)
	var tokens []string
	i := 0
	for i < len(runes) {
		// 尝试贪心匹配最长的已知词（否定词 / 程度副词 / 情感词）
		matched := false
		for length := 6; length >= 2; length-- {
			if i+length > len(runes) {
				continue
			}
			candidate := string(runes[i : i+length])
			if isKnownWord(candidate) {
				tokens = append(tokens, candidate)
				i += length
				matched = true
				break
			}
		}
		if !matched {
			tokens = append(tokens, string(runes[i:i+1]))
			i++
		}
	}
	return tokens
}

func isKnownWord(w string) bool {
	for _, neg := range negations {
		if w == neg {
			return true
		}
	}
	if _, ok := intensifiers[w]; ok {
		return true
	}
	for _, pw := range positiveWords {
		if w == pw {
			return true
		}
	}
	for _, nw := range negativeWords {
		if w == nw {
			return true
		}
	}
	return false
}

// scoreSentence 对单句打分，返回 0~1（0.5 为中性）
// 使用滑动窗口：否定词影响后 4 个 token；程度副词影响紧接的情感词
func scoreSentence(text string) (float64, bool) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) < 2 {
		return 0.5, false
	}

	tokens := tokenize(text)

	type scored struct {
		val    float64 // +1 positive, -1 negative
		weight float64
	}
	var scores []scored

	negMap := make(map[string]bool)
	for _, n := range negations {
		negMap[n] = true
	}

	posSet := make(map[string]bool)
	for _, w := range positiveWords {
		posSet[w] = true
	}
	negSet := make(map[string]bool)
	for _, w := range negativeWords {
		negSet[w] = true
	}

	// 否定词作用到后 N 个 token
	const negWindow = 4
	negCountdown := 0

	for i, tok := range tokens {
		if negMap[tok] {
			negCountdown = negWindow
			continue
		}
		if negCountdown > 0 {
			negCountdown--
		}

		// 检查前一个 token 是否是程度副词
		weight := 1.0
		if i > 0 {
			if w, ok := intensifiers[tokens[i-1]]; ok {
				weight = w
			}
		}
		// 跳过程度副词本身（它只作修饰用）
		if _, ok := intensifiers[tok]; ok {
			continue
		}

		polarity := 0.0
		if posSet[tok] {
			polarity = 1.0
		} else if negSet[tok] {
			polarity = -1.0
		}

		if polarity == 0 {
			continue
		}

		// 否定翻转
		if negCountdown > 0 {
			polarity = -polarity
		}

		scores = append(scores, scored{val: polarity, weight: weight})
	}

	if len(scores) == 0 {
		return 0.5, false
	}

	// 加权平均
	sumW := 0.0
	sumV := 0.0
	for _, s := range scores {
		sumW += s.weight
		sumV += s.val * s.weight
	}
	ratio := sumV / sumW // [-1, 1]

	// 映射到 [0.1, 0.9]
	score := 0.5 + ratio*0.4
	if score < 0.1 {
		score = 0.1
	}
	if score > 0.9 {
		score = 0.9
	}

	return math2dp(score), true
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func min64(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// GetSentimentAnalysis 对指定联系人的文本消息做情感分析
// 月度 count 包含所有文本消息（含中性），score 只来自有情感词的消息
func (s *ContactService) GetSentimentAnalysis(username string, includeMine bool) *SentimentResult {
	tableName := db.GetTableName(username)
	tw := s.timeWhere()

	var query string
	if tw == "" {
		query = fmt.Sprintf(
			"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s] WHERE local_type=1",
			tableName,
		)
	} else {
		query = fmt.Sprintf(
			"SELECT create_time, message_content, COALESCE(WCDB_CT_message_content,0) FROM [%s]%s AND local_type=1",
			tableName, tw,
		)
	}
	if !includeMine {
		query += fmt.Sprintf(" AND real_sender_id = (SELECT rowid FROM Name2Id WHERE user_name = %q)", username)
	}

	type monthBucket struct {
		scoreSum float64
		scored   int // 有情感的消息数
		total    int // 全部文本消息数（含中性）
	}
	buckets := make(map[string]*monthBucket)

	totalPos, totalNeg, totalNeutral := 0, 0, 0

	for _, mdb := range s.dbMgr.MessageDBs {
		rows, err := mdb.Query(query)
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			var rawContent []byte
			var ct int64
			rows.Scan(&ts, &rawContent, &ct)

			text := decodeGroupContent(rawContent, ct)
			text = strings.TrimSpace(text)
			if len([]rune(text)) < 2 || s.isSys(text) {
				continue
			}
			// 去掉微信表情符号
			text = wechatEmojiRe.ReplaceAllString(text, "")
			if len([]rune(text)) < 2 {
				continue
			}

			month := time.Unix(ts, 0).In(s.tz).Format("2006-01")
			if buckets[month] == nil {
				buckets[month] = &monthBucket{}
			}
			buckets[month].total++

			score, valid := scoreSentence(text)
			if !valid {
				totalNeutral++
				continue
			}

			buckets[month].scoreSum += score
			buckets[month].scored++

			if score >= 0.6 {
				totalPos++
			} else if score <= 0.4 {
				totalNeg++
			} else {
				totalNeutral++
			}
		}
		rows.Close()
	}

	if len(buckets) == 0 {
		return &SentimentResult{
			Monthly:  []SentimentPoint{},
			Overall:  0.5,
			Positive: 0,
			Negative: 0,
			Neutral:  0,
		}
	}

	// 组装月度数据
	months := make([]string, 0, len(buckets))
	for m := range buckets {
		months = append(months, m)
	}
	sort.Strings(months)

	points := make([]SentimentPoint, 0, len(months))
	totalScore := 0.0
	totalScored := 0

	for _, m := range months {
		b := buckets[m]
		avg := 0.5
		if b.scored > 0 {
			avg = math2dp(b.scoreSum / float64(b.scored))
		}
		points = append(points, SentimentPoint{
			Month: m,
			Score: avg,
			Count: b.total, // 用真实消息总数展示
		})
		totalScore += b.scoreSum
		totalScored += b.scored
	}

	overall := 0.5
	if totalScored > 0 {
		overall = math2dp(totalScore / float64(totalScored))
	}

	return &SentimentResult{
		Monthly:  points,
		Overall:  overall,
		Positive: totalPos,
		Negative: totalNeg,
		Neutral:  totalNeutral,
	}
}

func math2dp(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
