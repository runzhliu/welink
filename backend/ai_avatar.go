package main

// ai_avatar.go — 联系人 AI 头像（基于聊天风格生成的抽象代表性图标）。
//
//   POST /api/contacts/ai-avatar
//     body: { "username": "xxx" }
//     resp: { "url": "/api/image/cache/<hash>", "tags": ["温柔","严谨","碎碎念"] }
//
// 流程：取最近 200 条 TA 的消息 → LLM 出 3-5 个性格关键词 → 拼 prompt 调 GenerateImage。
// LLM 那一步小且便宜，全程 < 30s。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

func registerAIAvatarRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.POST("/contacts/ai-avatar", aiAvatarHandler(getSvc))
}

type aiAvatarRequest struct {
	Username string `json:"username"`
}

type aiAvatarResponse struct {
	URL  string   `json:"url"`
	Hash string   `json:"hash"`
	Tags []string `json:"tags,omitempty"`
}

func aiAvatarHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var req aiAvatarRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}

		prefs := loadPreferences()
		if !prefs.ImageEnabled && !DemoMockActive() {
			c.JSON(http.StatusForbidden, gin.H{"error": "AI 生图未启用"})
			return
		}

		// 取该联系人最近 200 条消息（IsMine=false 的，即 TA 发的）
		msgs := svc.ExportContactMessagesAll(req.Username)
		theirTexts := make([]string, 0, 200)
		// 倒序取最新的 TA 发出的文字消息
		for i := len(msgs) - 1; i >= 0 && len(theirTexts) < 200; i-- {
			m := msgs[i]
			if m.IsMine {
				continue
			}
			if m.Type != 1 { // 只要 type=1 的文字消息
				continue
			}
			t := strings.TrimSpace(m.Content)
			if t == "" {
				continue
			}
			theirTexts = append(theirTexts, t)
		}
		if len(theirTexts) < 10 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "TA 的文字消息太少（< 10 条），无法提炼风格"})
			return
		}

		// LLM 提炼 3-5 个性格关键词
		tags, err := llmExtractAvatarTags(theirTexts, prefs)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "提炼性格关键词失败：" + err.Error()})
			return
		}

		// 拼生图 prompt
		prompt := buildAvatarPrompt(tags)
		cfg := defaultImageConfig(prefs)
		hash, err := GenerateImage(prompt, "1024x1024", cfg)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, aiAvatarResponse{
			URL:  "/api/image/cache/" + hash,
			Hash: hash,
			Tags: tags,
		})
	}
}

// llmExtractAvatarTags 让 LLM 从消息样本里抽 3-5 个性格关键词。
// 返回严格 JSON 数组；失败时返回兜底关键词。
func llmExtractAvatarTags(samples []string, prefs Preferences) ([]string, error) {
	// 均匀抽 60 条做上下文（避免长上下文 + 加快响应）
	if len(samples) > 60 {
		step := len(samples) / 60
		picked := make([]string, 0, 60)
		for i := 0; i < len(samples) && len(picked) < 60; i += step {
			picked = append(picked, samples[i])
		}
		samples = picked
	}

	system := `你是一个擅长从只言片语里抽出人物气质的观察者。
基于消息样本，输出严格 JSON：
{"tags": ["关键词1","关键词2","关键词3"]}

要求：
- 3-5 个关键词，每个 2-4 个汉字
- 关键词描述气质 / 性格 / 表达风格，不描述外貌
- 例如：温柔细腻 / 直言不讳 / 段子手 / 文艺 / 理性派 / 碎碎念 / 高冷 / 暖男 / 沙雕 / 学术
- 不要 markdown，直接裸 JSON`

	user := "消息样本：\n" + strings.Join(samples, "\n")

	raw, err := CompleteLLM([]LLMMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}, prefs)
	if err != nil {
		return nil, err
	}
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
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("LLM 返回格式异常：%w", err)
	}
	if len(parsed.Tags) == 0 {
		return []string{"独特", "鲜明"}, nil
	}
	if len(parsed.Tags) > 5 {
		parsed.Tags = parsed.Tags[:5]
	}
	return parsed.Tags, nil
}

// buildAvatarPrompt 把性格关键词转成生图 prompt。
// 明确不画人脸 + 抽象意象 + 圆形构图，适合做头像。
func buildAvatarPrompt(tags []string) string {
	return fmt.Sprintf(
		`极简抽象头像。气质关键词：%s。`+
			`风格：柔和水彩、几何意象、暖色调、圆形构图、留白干净。`+
			`严格要求：不出现具体人物面孔、不出现五官、不出现文字、不出现品牌 logo。`+
			`只用色彩、光影、简单几何形态来表达气质。`,
		strings.Join(tags, "、"),
	)
}
