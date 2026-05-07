package main

// promise_debts.go — 「人情债」 / 承诺与邀约挖掘
//
// 选一个联系人 → 扫所有聊天记录 → 用宽口径正则把"承诺/邀约/约定"嫌疑句捞出来
// → 取上下文窗口 → 送给 LLM 做精筛 + 结构化抽取
// → 返回一份「未必兑现」清单：方向 / 类别 / 目标日期 / 原文引用 / 原文当时日期
//
// 与高光瞬间的差别：高光是"已发生的故事"，人情债是"说过但可能没做的承诺"。
//
// API: POST /api/contacts/promise-debts
//   body: { username, profile_id?, msg_limit? }

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// 单条人情债
type PromiseDebt struct {
	Text           string `json:"text"`              // LLM 概括的承诺内容（10-30 字，第三人称）
	Direction      string `json:"direction"`         // "i_owe" / "they_owe" / "mutual"
	Category       string `json:"category"`          // "聚餐" / "见面" / "寄送" / "借还" / "通话" / "旅行邀约" / "答复" / "其他"
	TargetDate     string `json:"target_date"`       // "2026-05-12" 解析得到时填，否则空
	TargetDateText string `json:"target_date_text"`  // 原文出现的时间表达："下周三" / "等我回国" / ""
	SourceQuote    string `json:"source_quote"`      // 原文（最多 80 字）
	SourceSpeaker  string `json:"source_speaker"`    // "我" / 对方 displayName
	SourceDate     string `json:"source_date"`       // 原话发生的日期 YYYY-MM-DD
	Confidence     string `json:"confidence"`        // "high" / "medium" / "low"
}

// 接口响应
type PromiseDebtsResponse struct {
	DisplayName      string        `json:"display_name"`
	Avatar           string        `json:"avatar,omitempty"`
	TotalMessages    int64         `json:"total_messages"`
	ScannedMessages  int           `json:"scanned_messages"`
	CandidateCount   int           `json:"candidate_count"`
	Debts            []PromiseDebt `json:"debts"`
	GeneratedAt      int64         `json:"generated_at"`
}

// 宽口径承诺/邀约嫌疑正则。
//
// 思路：常见承诺要么含"承诺动词"，要么是"未来时间词 + 行为动词"。
// 这一步只做"高 recall"，把所有嫌疑句捞回来后让 LLM 做精筛。
// 不在这里做更复杂的 NLP——任何漏判都靠 LLM 在加宽口径的窗口里救回来。
var promisePattern = regexp.MustCompile(
	`答应|承诺|保证|说好|约好|约定` +
		`|改天|下次|下回|回头|找时间|找空|得空|有空` +
		`|等我|等你|等下|等会` +
		`|约你|约一下|约个|约见|约出来` +
		`|请你吃|请你喝|我请|带你去|陪你去` +
		`|送你|送给你|寄你|寄给你|带给你|帮你|借你` +
		`|欠你|欠我` +
		`|别忘|记得|提醒` +
		`|下周|下个月|下下周|月底|年底|国庆|春节|过年|生日的时候` +
		`|明天|后天|大后天|今晚|这周|周末|下班|放假`)

// 提取候选窗口（同一窗口里包含多次命中）
type promiseWindow struct {
	StartIdx int
	EndIdx   int       // 闭区间
	HitDate  string    // 主命中那一条的日期
	HitTime  string    // 主命中那一条的时间
}

func registerPromiseDebtsRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/promise-debts", promiseDebtsHandler(getSvc))
}

func promiseDebtsHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var body struct {
			Username  string `json:"username"`
			ProfileID string `json:"profile_id"`
			MsgLimit  int    `json:"msg_limit"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}

		// 联系人元信息
		var displayName, avatar string
		var totalMsgs int64
		for _, stat := range svc.GetCachedStats() {
			if stat.Username == body.Username {
				displayName = stat.Remark
				if displayName == "" {
					displayName = stat.Nickname
				}
				if displayName == "" {
					displayName = stat.Username
				}
				totalMsgs = stat.TotalMessages
				avatar = stat.SmallHeadURL
				break
			}
		}
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		msgs := svc.ExportContactMessagesAll(body.Username)
		if len(msgs) < 30 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "消息太少（少于 30 条），暂时挑不出承诺/邀约"})
			return
		}

		// 只保留文本消息（type=1）做承诺扫描；图片/文件/转账等不可能含承诺词
		textMsgs := make([]service.ChatMessage, 0, len(msgs))
		for _, m := range msgs {
			if m.Type == 1 && strings.TrimSpace(m.Content) != "" {
				textMsgs = append(textMsgs, m)
			}
		}
		if len(textMsgs) < 20 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "文本消息太少（少于 20 条），暂时挑不出承诺"})
			return
		}

		// 第 1 步：扫命中
		hits := make([]int, 0, 64)
		for i, m := range textMsgs {
			if promisePattern.MatchString(m.Content) {
				hits = append(hits, i)
			}
		}
		if len(hits) == 0 {
			c.JSON(http.StatusOK, PromiseDebtsResponse{
				DisplayName:     displayName,
				Avatar:          avatar,
				TotalMessages:   totalMsgs,
				ScannedMessages: len(textMsgs),
				CandidateCount:  0,
				Debts:           []PromiseDebt{},
				GeneratedAt:     time.Now().Unix(),
			})
			return
		}

		// 第 2 步：按命中点扩成上下文窗口（前 2 条 + 后 5 条），合并相邻/重叠窗口
		const ctxBefore = 2
		const ctxAfter = 5
		windows := make([]promiseWindow, 0, len(hits))
		for _, h := range hits {
			s := h - ctxBefore
			if s < 0 {
				s = 0
			}
			e := h + ctxAfter
			if e >= len(textMsgs) {
				e = len(textMsgs) - 1
			}
			windows = append(windows, promiseWindow{
				StartIdx: s, EndIdx: e,
				HitDate: textMsgs[h].Date, HitTime: textMsgs[h].Time,
			})
		}
		// 合并重叠
		sort.Slice(windows, func(i, j int) bool { return windows[i].StartIdx < windows[j].StartIdx })
		merged := windows[:0]
		for _, w := range windows {
			if len(merged) > 0 && w.StartIdx <= merged[len(merged)-1].EndIdx+1 {
				if w.EndIdx > merged[len(merged)-1].EndIdx {
					merged[len(merged)-1].EndIdx = w.EndIdx
				}
			} else {
				merged = append(merged, w)
			}
		}

		// 第 3 步：偏好近期（保留最近 80 个窗口）。LLM 输入控制在 ~20k tokens 内
		const maxWindows = 80
		if len(merged) > maxWindows {
			merged = merged[len(merged)-maxWindows:]
		}

		// 第 4 步：拼 LLM prompt
		systemPrompt := `你是一位严谨的"对话承诺审计师"。下面给出我和某位联系人的若干段聊天上下文（每段都因含有疑似承诺/邀约关键词被挑出）。你的任务是从中找出**真实的、未明显已兑现**的承诺或邀约。

什么算承诺/邀约：
- 有明确"行动"意图：聚餐、见面、通话、寄送/带送某物、借还、回复某事、约旅行……
- 由具体某一方在某一天提出，对方至少看起来默认接受（未明确拒绝）
- 含目标时间或时间方向（"明天"/"下周"/"等我回国"/"找时间"/"下次"…）

什么不算（必须排除）：
- 已经在后续消息里看到兑现迹象（"已经发了"/"今天见到了"/"昨天那顿"等）
- 仅仅是寒暄、客套、表达情绪；无具体行动
- 太抽象的"以后再说"/"再看看"/"有机会"，且没有跟进
- 推荐 / 介绍 / 询问 / 提议但对方明确拒绝

对每一条命中，输出严格 JSON 数组，**不要 markdown code fence**：

{"debts":[
  {
    "text": "TA 答应下次去东京带我去那家拉面店",         // 10-30 字第三人称概括
    "direction": "they_owe",                          // "i_owe"=我欠TA / "they_owe"=TA欠我 / "mutual"=双方约定
    "category": "聚餐",                                // 聚餐/见面/寄送/借还/通话/旅行邀约/答复/其他
    "target_date_text": "下次去东京",                   // 原文里出现的时间表达，照抄
    "target_date": "",                                // 如果可推断为具体日期填 YYYY-MM-DD，否则空字符串
    "source_quote": "下次我们去东京我带你去尝那家拉面",   // 原文摘抄（≤80字）
    "source_speaker": "TA",                            // "我" 或 联系人显示名
    "source_date": "2024-08-12",                       // 原话发生那天
    "confidence": "high"                               // high/medium/low
  }
]}

要求：
- 同一件事在同一窗口被多次提到只输出一条（取最早提出的那次作 source_quote / source_date）
- text 用第三人称、聚焦"做什么"，避免"似乎"/"可能"
- direction 严格判断："我说我会..." → i_owe；"TA 说会..." → they_owe；"我们一起约..." → mutual
- 没找到任何承诺就返回 {"debts":[]}
- 最多输出 12 条，按"对方欠我>双方约定>我欠对方"以及 confidence 排序
- 不要解释、不要任何 JSON 之外的内容`

		var ub strings.Builder
		ub.WriteString(fmt.Sprintf("联系人：%s\n累计消息：%d 条\n窗口数：%d\n\n",
			displayName, totalMsgs, len(merged)))
		for i, w := range merged {
			fmt.Fprintf(&ub, "── 窗口 %d ──\n", i+1)
			for j := w.StartIdx; j <= w.EndIdx; j++ {
				m := textMsgs[j]
				speaker := "我"
				if !m.IsMine {
					speaker = displayName
				}
				content := strings.TrimSpace(m.Content)
				if rs := []rune(content); len(rs) > 80 {
					content = string(rs[:80]) + "…"
				}
				fmt.Fprintf(&ub, "[%s %s] %s: %s\n", m.Date, m.Time, speaker, content)
			}
			ub.WriteString("\n")
		}

		prefs := loadPreferences()
		profPrefs := prefs
		if body.ProfileID != "" {
			cfg := llmConfigForProfile(body.ProfileID, prefs)
			profPrefs.LLMProvider = cfg.provider
			profPrefs.LLMAPIKey = cfg.apiKey
			profPrefs.LLMBaseURL = cfg.baseURL
			profPrefs.LLMModel = cfg.model
		}

		raw, err := CompleteLLM([]LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: ub.String()},
		}, profPrefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败：" + err.Error()})
			return
		}

		raw = stripCodeFence(strings.TrimSpace(raw))
		var parsed struct {
			Debts []PromiseDebt `json:"debts"`
		}
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "LLM 返回格式异常：" + err.Error(),
				"raw":   raw,
			})
			return
		}

		// 后处理：归一化 confidence、direction、speaker 字段
		for i := range parsed.Debts {
			d := &parsed.Debts[i]
			d.Direction = normalizeDirection(d.Direction)
			d.Confidence = normalizeConfidence(d.Confidence)
			if d.SourceSpeaker == "对方" || d.SourceSpeaker == "ta" || d.SourceSpeaker == "TA" {
				d.SourceSpeaker = displayName
			}
		}

		// 按 direction 优先级 + confidence 排序，前端再按需过滤
		dirOrder := map[string]int{"they_owe": 0, "mutual": 1, "i_owe": 2, "": 3}
		confOrder := map[string]int{"high": 0, "medium": 1, "low": 2, "": 3}
		sort.SliceStable(parsed.Debts, func(i, j int) bool {
			a, b := parsed.Debts[i], parsed.Debts[j]
			if dirOrder[a.Direction] != dirOrder[b.Direction] {
				return dirOrder[a.Direction] < dirOrder[b.Direction]
			}
			if confOrder[a.Confidence] != confOrder[b.Confidence] {
				return confOrder[a.Confidence] < confOrder[b.Confidence]
			}
			// 较新的在前
			return a.SourceDate > b.SourceDate
		})

		c.JSON(http.StatusOK, PromiseDebtsResponse{
			DisplayName:     displayName,
			Avatar:          avatar,
			TotalMessages:   totalMsgs,
			ScannedMessages: len(textMsgs),
			CandidateCount:  len(merged),
			Debts:           parsed.Debts,
			GeneratedAt:     time.Now().Unix(),
		})
	}
}

func normalizeDirection(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case "i_owe", "me", "i", "我", "我欠", "我欠ta":
		return "i_owe"
	case "they_owe", "ta", "对方", "ta欠我", "对方欠我":
		return "they_owe"
	case "mutual", "both", "双方", "互相":
		return "mutual"
	}
	return "i_owe"
}

func normalizeConfidence(c string) string {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "high", "高":
		return "high"
	case "medium", "mid", "中":
		return "medium"
	case "low", "低":
		return "low"
	}
	return "medium"
}
