package main

// parallel_chat.go — 平行宇宙对话
//
// 选一个联系人 + 一个"如果"场景（"如果我们 5 年前就认识 / 如果我现在跟他求婚 /
// 如果我们是同事"），AI 用 ta 的画像生成一段虚构的群聊。
// 复用虚拟群聊里 buildMemberPersona / streamLLMCoreWithProfile 那套。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

func registerParallelChatRoutes(api *gin.RouterGroup, getSvc func() *service.ContactService) {
	// SSE 流式：和虚拟群聊一样的协议（meta + delta + done + turn_end）
	api.POST("/ai/parallel-chat", func(c *gin.Context) {
		var body struct {
			Username    string `json:"username"`     // 对方 wxid
			Scenario    string `json:"scenario"`     // 场景描述
			Turns       int    `json:"turns"`        // 一次性生成几轮（双方各 N/2 句）；默认 8，最多 20
			ProfileID   string `json:"profile_id"`
			SampleCount int    `json:"sample_count"` // 未训练分身时每人用多少条历史样例；默认 30
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}
		if strings.TrimSpace(body.Scenario) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scenario 必填（描述这是什么平行宇宙）"})
			return
		}
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		// 校验联系人存在；buildMemberPersona 找不到时会用裸 wxid 当 displayName，
		// 后端 emit 出来的 display_name 跟前端 picked.display_name 对不上，前端会丢消息。
		if !svc.HasContact(body.Username) {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先配置 AI 接口"})
			return
		}

		sampleCount := body.SampleCount
		if sampleCount <= 0 {
			sampleCount = 30
		}
		if sampleCount > 200 {
			sampleCount = 200
		}
		turns := body.Turns
		if turns <= 0 {
			turns = 8
		}
		if turns > 20 {
			turns = 20
		}

		theirName, theirPersona := buildMemberPersona(svc, body.Username, sampleCount)

		var sb strings.Builder
		sb.WriteString("这是一段「平行宇宙」虚构对话。我和【")
		sb.WriteString(theirName)
		sb.WriteString("】在一个假设的场景里聊天。\n\n")
		sb.WriteString("场景设定：" + body.Scenario + "\n\n")
		sb.WriteString("【" + theirName + "】平时的说话风格如下：\n")
		sb.WriteString(theirPersona)
		sb.WriteString("\n\n")

		fmt.Fprintf(&sb, "请生成接下来 %d 条对话，规则：\n", turns)
		sb.WriteString("1. 一行一条，**严格**用格式：`名字：消息内容`（中文全角冒号）\n")
		sb.WriteString("2. 名字只用「我」或「" + theirName + "」，不要其他名字\n")
		sb.WriteString("3. 严格扣住「场景设定」展开，不要变成日常寒暄\n")
		sb.WriteString("4. 「我」的语气放轻松自然；「" + theirName + "」要贴 ta 平时的风格（用词、口头禅、表情使用）\n")
		sb.WriteString("5. 不要每句都换话题，要像真实聊天一样有上下文承接\n")
		sb.WriteString("6. 每条 1-2 句、≤ 40 字\n")
		sb.WriteString("7. 双方轮流发言，偶尔同一人连发两条做补充\n")
		sb.WriteString("8. 不要旁白、不要解释、不要编号、不要 code fence\n")

		userPrompt := "请开始这段平行宇宙对话："

		// 流式响应（和虚拟群聊一样的格式：每条 emit `meta + delta + turn_end`）
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		send := func(obj map[string]interface{}) {
			b, _ := json.Marshal(obj)
			fmt.Fprintf(c.Writer, "data: %s\n\n", b)
			flusher.Flush()
		}

		var buf strings.Builder
		emitted := 0
		emitLine := func(raw string) {
			raw = strings.TrimSpace(raw)
			if raw == "" || emitted >= turns {
				return
			}
			// 取行首 12 个 rune 内的"第一个冒号"（中文/半角都接受）作为分隔符。
			// 不能像之前那样 strings.Index(raw, "：")，否则若说话人写半角 `:`、
			// 而消息内容里恰好含全角 `：`，会被错切到内容里 → 整条丢。
			name, content := splitSpeakerLine(raw)
			if name == "" || content == "" {
				return
			}
			name = strings.Trim(name, "[]【】 ")
			var speaker string
			if name == "我" || strings.EqualFold(name, "me") || strings.EqualFold(name, "I") {
				speaker = "我"
			} else if name == theirName {
				speaker = body.Username
			} else {
				return // 名字超出，跳过
			}
			send(map[string]interface{}{
				"speaker":      speaker,
				"display_name": name,
				"meta":         true,
			})
			send(map[string]interface{}{"delta": content})
			send(map[string]interface{}{"turn_end": true})
			emitted++
		}

		streamLLMCoreWithProfile(func(chunk StreamChunk) {
			if chunk.Error != "" {
				send(map[string]interface{}{"error": chunk.Error})
				return
			}
			if chunk.Delta != "" {
				buf.WriteString(chunk.Delta)
				for {
					s := buf.String()
					nl := strings.Index(s, "\n")
					if nl == -1 {
						break
					}
					emitLine(s[:nl])
					buf.Reset()
					buf.WriteString(s[nl+1:])
				}
			}
			if chunk.Done {
				if buf.Len() > 0 {
					emitLine(buf.String())
					buf.Reset()
				}
				send(map[string]interface{}{"done": true})
			}
		}, []LLMMessage{
			{Role: "system", Content: sb.String()},
			{Role: "user", Content: userPrompt},
		}, prefs, body.ProfileID)
	})
}

// splitSpeakerLine 从 "名字：内容" 这类行抽出 (name, content)。
// 只看行首前 12 个 rune 内的首个冒号（: 或 ：），避免内容里的冒号干扰；
// 找不到返回空串。
func splitSpeakerLine(raw string) (string, string) {
	const maxNameRunes = 12
	cnt := 0
	byteIdx := -1
	sepRuneLen := 0
	for i, r := range raw {
		if r == '：' || r == ':' {
			byteIdx = i
			sepRuneLen = len(string(r))
			break
		}
		cnt++
		if cnt > maxNameRunes {
			break
		}
	}
	if byteIdx <= 0 {
		return "", ""
	}
	name := strings.TrimSpace(raw[:byteIdx])
	content := strings.TrimSpace(raw[byteIdx+sepRuneLen:])
	return name, content
}
