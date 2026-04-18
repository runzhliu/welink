package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// registerIcebreakerRoutes 注册 AI 开场白草稿路由。
func registerIcebreakerRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/icebreaker", icebreakerHandler(getSvc))
}

// IcebreakerDraft 单条开场白草稿
type IcebreakerDraft struct {
	Tone string `json:"tone"`
	Text string `json:"text"`
}

// IcebreakerResponse 接口响应
type IcebreakerResponse struct {
	Drafts      []IcebreakerDraft `json:"drafts"`
	DisplayName string            `json:"display_name"`
	DaysSince   int               `json:"days_since_last"`
}

// POST /api/contacts/icebreaker
// 给一个「降温/濒危」联系人起草 3-5 条主动联系的开场白
func icebreakerHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
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

		// 查联系人基础信息
		var displayName string
		var totalMsgs, firstTs, lastTs int64
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
				firstTs = stat.FirstMessageTs
				lastTs = stat.LastMessageTs
				break
			}
		}
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在或无消息记录"})
			return
		}

		// 取最近 40 条文本消息做风味采样
		msgs := svc.ExportContactMessages(body.Username, 0, 0)
		var textLines []string
		for i := len(msgs) - 1; i >= 0 && len(textLines) < 40; i-- {
			m := msgs[i]
			if m.Type != 1 {
				continue
			}
			content := strings.TrimSpace(m.Content)
			if content == "" {
				continue
			}
			// 单条超过 120 字的截断，避免整块占满预算
			if len([]rune(content)) > 120 {
				content = string([]rune(content)[:120]) + "…"
			}
			speaker := "我"
			if !m.IsMine {
				speaker = displayName
			}
			textLines = append(textLines, fmt.Sprintf("%s: %s", speaker, content))
		}
		// 反转回正序
		for i, j := 0, len(textLines)-1; i < j; i, j = i+1, j-1 {
			textLines[i], textLines[j] = textLines[j], textLines[i]
		}

		if len(textLines) < 3 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "文本消息不足，无法生成开场白"})
			return
		}

		// 计算沉默天数
		now := time.Now().Unix()
		var daysSince int
		if lastTs > 0 {
			daysSince = int((now - lastTs) / 86400)
		}
		knowYears := 0
		if firstTs > 0 {
			knowYears = int((now - firstTs) / (86400 * 365))
		}

		// 构建 prompt
		systemPrompt := `你是一位擅长人际沟通的朋友。根据我和某位联系人的微信聊天片段，帮我写 4 条适合「最近不太联系」之后主动破冰的开场白草稿。

要求：
- 口吻非常自然，像平时发微信，不要客套也不要文艺腔
- 4 条覆盖不同调性：关心近况 / 回忆共同话题 / 轻松调侃 / 约见面或约做点什么
- 每条 15-35 字，不要太长也不要太短
- 如果聊天片段里有明显正在进行的话题、共同兴趣或近期发生的事，一定要用上（比人物标签更有说服力）
- 避免敏感话题（工作烦恼、家庭状况、感情八卦），除非聊天片段已明确涉及
- 输出严格 JSON，不要用 markdown code fence：
  {"drafts":[{"tone":"关心近况","text":"..."},{"tone":"回忆话题","text":"..."},{"tone":"轻松调侃","text":"..."},{"tone":"约见","text":"..."}]}`

		var ctxParts []string
		ctxParts = append(ctxParts, fmt.Sprintf("联系人：%s", displayName))
		if knowYears >= 1 {
			ctxParts = append(ctxParts, fmt.Sprintf("相识：%d 年", knowYears))
		}
		if daysSince > 0 {
			ctxParts = append(ctxParts, fmt.Sprintf("上次聊天：%d 天前", daysSince))
		}
		ctxParts = append(ctxParts, fmt.Sprintf("累计消息：%d 条", totalMsgs))

		userPrompt := fmt.Sprintf("背景：\n%s\n\n最近的聊天片段（由旧到新）：\n%s",
			strings.Join(ctxParts, "\n"),
			strings.Join(textLines, "\n"))

		// 调用 LLM（按 profile）
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

		// 清理 markdown fence（部分模型不听话）
		raw = strings.TrimSpace(raw)
		if strings.HasPrefix(raw, "```") {
			if idx := strings.Index(raw, "\n"); idx >= 0 {
				raw = raw[idx+1:]
			}
			if idx := strings.LastIndex(raw, "```"); idx >= 0 {
				raw = raw[:idx]
			}
		}
		raw = strings.TrimSpace(raw)

		var parsed struct {
			Drafts []IcebreakerDraft `json:"drafts"`
		}
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":     "LLM 返回格式异常：" + err.Error(),
				"raw":       raw,
			})
			return
		}
		if len(parsed.Drafts) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 没返回任何草稿"})
			return
		}

		c.JSON(http.StatusOK, IcebreakerResponse{
			Drafts:      parsed.Drafts,
			DisplayName: displayName,
			DaysSince:   daysSince,
		})
	}
}
