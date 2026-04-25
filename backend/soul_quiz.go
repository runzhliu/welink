package main

// soul_quiz.go — 灵魂提问机
//
// 选一个联系人，AI 基于你们的聊天记录出 5 道"只有你们俩才答得上来"的选择题。
// 玩法：自己测自己 / 发给对方测默契 / 当作纪念。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

type SoulQuestion struct {
	Question     string   `json:"question"`
	Options      []string `json:"options"`        // 4 个选项
	AnswerIndex  int      `json:"answer_index"`   // 0-3
	Why          string   `json:"why,omitempty"`  // 答案的依据，一句话
	Category     string   `json:"category"`       // "回忆" / "口头禅" / "时间" / "习惯" / "梗"
}

type SoulQuizResponse struct {
	DisplayName string         `json:"display_name"`
	Questions   []SoulQuestion `json:"questions"`
}

func registerSoulQuizRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/soul-quiz", soulQuizHandler(getSvc))
}

func soulQuizHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var body struct {
			Username  string `json:"username"`
			ProfileID string `json:"profile_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}

		var displayName string
		for _, st := range svc.GetCachedStats() {
			if st.Username == body.Username {
				displayName = st.Remark
				if displayName == "" {
					displayName = st.Nickname
				}
				if displayName == "" {
					displayName = st.Username
				}
				break
			}
		}
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		msgs := svc.ExportContactMessagesAll(body.Username)
		if len(msgs) < 50 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "消息太少（少于 50 条），出不出有意思的题"})
			return
		}

		// 采样：均匀分布抽 ~120 条文本消息（避免只看到最近的）
		var textOnly []service.ChatMessage
		for _, m := range msgs {
			if m.Type == 1 && strings.TrimSpace(m.Content) != "" {
				textOnly = append(textOnly, m)
			}
		}
		if len(textOnly) < 50 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "文本消息太少，出题困难"})
			return
		}
		picks := evenSample(textOnly, 120)
		// 拼成 [日期 时间] speaker: 内容
		var lines []string
		for _, m := range picks {
			speaker := "我"
			if !m.IsMine {
				speaker = displayName
			}
			content := strings.TrimSpace(m.Content)
			if r := []rune(content); len(r) > 80 {
				content = string(r[:80]) + "…"
			}
			lines = append(lines, fmt.Sprintf("[%s %s] %s: %s", m.Date, m.Time, speaker, content))
		}

		systemPrompt := `你是一位擅长出"默契测试题"的好友。下面给出我和某位联系人的微信聊天采样。请基于这些聊天，给我们出 5 道选择题，要求"只有我们俩之间才答得上来"。

题目类型从这几类挑（尽量分散）：
- 「回忆」某次聊天里发生的具体事情
- 「口头禅」我或对方常说的某句话
- 「时间」某件事发生在大概什么时候 / 某段聊天习惯发生在一天的什么时段
- 「习惯」对方常用的表情、口头禅、回避的话题
- 「梗」我们之间反复出现的某个独有玩笑/称呼

每题严格 4 个选项，1 个正确，3 个迷惑选项要"看起来都像答案但只有一个对得上聊天记录"。
迷惑选项要拟真：用真实存在但不准确的细节（比如把日期挪一周、把人名换个相似的、把口头禅换成另一个常见但他没用的）。

输出严格 JSON，不要 markdown：
{"questions":[
  {"category":"梗","question":"...","options":["A","B","C","D"],"answer_index":2,"why":"在 2024-03-15 的聊天里他说过 'XXX'"}
]}

要求：
- 题目和选项语气自然口语，像在朋友圈做小测试
- question 15-40 字
- 每个 option 5-20 字，长度尽量相近
- answer_index 是 0-3 整数
- why 是一句话依据（用聊天里出现过的具体细节，不要泛泛"因为他喜欢"）
- 每题 category 必须从「回忆」「口头禅」「时间」「习惯」「梗」5 个里挑，5 题尽量不要重复同一类
- 不要出"在吗""收到"这种没有信息量的题
- 不要出敏感（性别认同、政治、健康病史）题
- 严格输出 5 题`

		userPrompt := fmt.Sprintf("联系人：%s\n采样的聊天片段：\n%s",
			displayName, strings.Join(lines, "\n"))

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
			{Role: "user", Content: userPrompt},
		}, profPrefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败：" + err.Error()})
			return
		}
		raw = stripCodeFence(raw)
		var parsed struct {
			Questions []SoulQuestion `json:"questions"`
		}
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "LLM 返回格式异常：" + err.Error(),
				"raw":   raw,
			})
			return
		}
		// 健全性：过滤掉非法的题
		valid := parsed.Questions[:0]
		for _, q := range parsed.Questions {
			if len(q.Options) != 4 {
				continue
			}
			if q.AnswerIndex < 0 || q.AnswerIndex > 3 {
				continue
			}
			if strings.TrimSpace(q.Question) == "" {
				continue
			}
			valid = append(valid, q)
		}
		if len(valid) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 没出有效的题"})
			return
		}

		c.JSON(http.StatusOK, SoulQuizResponse{
			DisplayName: displayName,
			Questions:   valid,
		})
	}
}

// evenSample 在 src 上等距采样 want 条；len(src) <= want 时原样返回
func evenSample(src []service.ChatMessage, want int) []service.ChatMessage {
	if len(src) <= want {
		out := make([]service.ChatMessage, len(src))
		copy(out, src)
		return out
	}
	out := make([]service.ChatMessage, 0, want)
	step := float64(len(src)) / float64(want)
	for i := 0; i < want; i++ {
		idx := int(float64(i) * step)
		if idx >= len(src) {
			idx = len(src) - 1
		}
		out = append(out, src[idx])
	}
	return out
}
