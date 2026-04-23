package main

// virtual_group.go — AI 虚拟群聊
//
// 用户挑任意几个联系人放进一个虚拟群（这些人现实中可能从没在同群聊过），
// AI 扮演每个人轮流发言，让本来不认识的人"聊起来"。
//
// 和已有 /ai/group-sim 的区别：那个基于真实群现学现卖，这里数据源是
// 每个联系人的"分身画像"。风格来源优先级：
//   1. clone_profiles.prompt（用户已训练过的分身 → 最准）
//   2. 私聊样例（未训练时从对方最近消息抽 30 条兜底）

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// registerVirtualGroupRoutes 挂到 /api（在 clone 等路由附近注册）
func registerVirtualGroupRoutes(api *gin.RouterGroup, getSvc func() *service.ContactService) {
	// POST /api/ai/virtual-group/chat — 生成"下一发言人"的一句话（SSE 流式）
	api.POST("/ai/virtual-group/chat", func(c *gin.Context) {
		var body struct {
			Members      []string `json:"members"`       // 裸 username 数组，2-8 个
			History      []struct {
				Speaker string `json:"speaker"` // 成员 username 或 "我"
				Content string `json:"content"`
			} `json:"history"`
			NextSpeaker string `json:"next_speaker"` // 空 = 自动轮转 / "random" = 随机挑
			Topic       string `json:"topic"`
			ProfileID   string `json:"profile_id"`
			Turns       int    `json:"turns"`        // 一次性生成几句；<=1 = 单句（老行为）
			SampleCount int    `json:"sample_count"` // 未训练分身时每人用多少条历史样例；<=0 默认 30；上限 200
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if len(body.Members) < 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "至少需要 2 位成员"})
			return
		}
		if len(body.Members) > 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "单次虚拟群最多 8 位成员"})
			return
		}

		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先配置 AI 接口"})
			return
		}

		// 2. 为每个成员构造画像（clone_profiles 优先，私聊样例兜底）
		sampleCount := body.SampleCount
		if sampleCount <= 0 {
			sampleCount = 30
		}
		if sampleCount > 200 {
			sampleCount = 200
		}
		personas := make(map[string]string)
		displayNames := make(map[string]string)
		for _, uname := range body.Members {
			name, persona := buildMemberPersona(svc, uname, sampleCount)
			displayNames[uname] = name
			personas[uname] = persona
		}

		// 规范化 turns：单句走老逻辑；多句 2-15
		turns := body.Turns
		if turns <= 1 {
			turns = 1
		}
		if turns > 15 {
			turns = 15
		}

		// 1. 决定 speaker（仅 turns=1 需要；turns>1 时 LLM 自己选顺序）
		speaker := strings.TrimSpace(body.NextSpeaker)
		if turns == 1 {
			if speaker == "" || speaker == "auto" {
				speaker = pickNextSpeaker(body.Members, body.History)
			} else if speaker == "random" {
				speaker = body.Members[rand.Intn(len(body.Members))]
			}
			valid := false
			for _, m := range body.Members {
				if m == speaker {
					valid = true
					break
				}
			}
			if !valid {
				c.JSON(http.StatusBadRequest, gin.H{"error": "next_speaker 不在成员列表"})
				return
			}
		}

		// 3. 构造 system prompt
		var sb strings.Builder
		sb.WriteString("这是一个虚拟群聊，以下几位参与者在同一个群里互相对话。每位参与者的性格和说话风格如下：\n\n")
		for _, uname := range body.Members {
			fmt.Fprintf(&sb, "### %s\n%s\n\n", displayNames[uname], personas[uname])
		}
		if body.Topic != "" {
			fmt.Fprintf(&sb, "本次聊天话题或场景：%s\n\n", body.Topic)
		}

		if turns == 1 {
			sb.WriteString("规则：\n")
			sb.WriteString("1. 你要**严格以【" + displayNames[speaker] + "】的身份和风格**发一句话\n")
			sb.WriteString("2. 只输出这一句消息内容本身，不要带 \"" + displayNames[speaker] + "：\" 这样的前缀，也不要旁白或解释\n")
			sb.WriteString("3. 回复风格要贴合此人平时说话习惯（用词、长度、语气、表情使用）\n")
			sb.WriteString("4. 内容要自然承接上下文，像真实微信群聊一样，而不是辩论或演讲\n")
			sb.WriteString("5. 长度 1-3 句，总字数 ≤ 60（除非此人平时就话多）\n")
		} else {
			fmt.Fprintf(&sb, "规则（一次性输出 %d 条群聊对话）：\n", turns)
			sb.WriteString("1. 连续生成，一条一行，不要空行\n")
			sb.WriteString("2. 每一条**严格**用格式：`名字：消息内容`（名字后是中文全角冒号）\n")
			sb.WriteString("3. 名字必须从下面名单中挑（不要造新名字，不要写「我」）：\n")
			for _, uname := range body.Members {
				fmt.Fprintf(&sb, "   - %s\n", displayNames[uname])
			}
			sb.WriteString("4. 发言人要合理轮换，避免同一人连续；让对话像真实群聊（相互回应、偶尔插科打诨）\n")
			sb.WriteString("5. 每条控制在 1-3 句、总字数 ≤ 60，贴合各自说话习惯\n")
			sb.WriteString("6. 不要编号、不要旁白、不要解释、不要代码块围栏\n")
			sb.WriteString("7. 不要输出超过 " + fmt.Sprintf("%d", turns) + " 条\n")
		}

		// 4. 把历史拼成"XXX: 内容"行
		var userPart strings.Builder
		userPart.WriteString("群聊历史（由旧到新）：\n")
		if len(body.History) == 0 {
			userPart.WriteString("（尚无消息，请开启话题或自然打招呼）\n")
		} else {
			for _, h := range body.History {
				n := displayNames[h.Speaker]
				if n == "" {
					n = h.Speaker
				}
				fmt.Fprintf(&userPart, "%s：%s\n", n, h.Content)
			}
		}
		if turns == 1 {
			fmt.Fprintf(&userPart, "\n现在轮到【%s】发言：", displayNames[speaker])
		} else {
			fmt.Fprintf(&userPart, "\n现在续写接下来 %d 条群聊：\n", turns)
		}

		// 5. 流式返回
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

		if turns == 1 {
			// ── 单句：保持老行为 ──
			send(map[string]interface{}{
				"speaker":      speaker,
				"display_name": displayNames[speaker],
				"meta":         true,
			})
			sendChunk := func(chunk StreamChunk) {
				send(map[string]interface{}{
					"delta": chunk.Delta,
					"done":  chunk.Done,
					"error": chunk.Error,
				})
			}
			streamLLMCoreWithProfile(sendChunk, []LLMMessage{
				{Role: "system", Content: sb.String()},
				{Role: "user", Content: userPart.String()},
			}, prefs, body.ProfileID)
			return
		}

		// ── 多句：buffer delta 按行 parse，逐条 emit ──
		// name → username 反向映射（兼容 display_name 里有空格、特殊字符）
		nameToUser := make(map[string]string, len(displayNames))
		for u, n := range displayNames {
			nameToUser[n] = u
		}

		var buf strings.Builder
		emittedCount := 0

		emitLine := func(raw string) {
			raw = strings.TrimSpace(raw)
			if raw == "" || emittedCount >= turns {
				return
			}
			// 容忍常见格式：`名字：内容` / `[名字] 内容` / `名字: 内容`
			sep := -1
			for _, sepCh := range []string{"：", ": "} {
				if idx := strings.Index(raw, sepCh); idx != -1 {
					sep = idx
					raw = strings.Replace(raw, sepCh, "：", 1)
					break
				}
			}
			if sep == -1 {
				if idx := strings.Index(raw, ":"); idx != -1 {
					sep = idx
					raw = strings.Replace(raw, ":", "：", 1)
				}
			}
			idx := strings.Index(raw, "：")
			if idx == -1 {
				return // 无法解析，跳过
			}
			name := strings.TrimSpace(raw[:idx])
			name = strings.Trim(name, "[]【】")
			content := strings.TrimSpace(raw[idx+len("："):])
			if content == "" {
				return
			}
			uname, ok := nameToUser[name]
			if !ok {
				return // 名字不在名单里，跳过
			}
			send(map[string]interface{}{
				"speaker":      uname,
				"display_name": name,
				"meta":         true,
			})
			send(map[string]interface{}{"delta": content})
			send(map[string]interface{}{"turn_end": true})
			emittedCount++
		}

		bulkChunk := func(chunk StreamChunk) {
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
		}
		streamLLMCoreWithProfile(bulkChunk, []LLMMessage{
			{Role: "system", Content: sb.String()},
			{Role: "user", Content: userPart.String()},
		}, prefs, body.ProfileID)
	})
}

// pickNextSpeaker 简单轮转：找不是"最后一个发言人"的候选里随机一个，
// 避免同一个人连续两次发言；若只剩他自己（没人说过话），就挑列表第一个。
func pickNextSpeaker(members []string, history []struct {
	Speaker string `json:"speaker"`
	Content string `json:"content"`
}) string {
	last := ""
	if len(history) > 0 {
		last = history[len(history)-1].Speaker
	}
	candidates := make([]string, 0, len(members))
	for _, m := range members {
		if m != last {
			candidates = append(candidates, m)
		}
	}
	if len(candidates) == 0 {
		return members[0]
	}
	return candidates[rand.Intn(len(candidates))]
}

// buildMemberPersona 返回 (display_name, persona_text)
//   - 优先 clone_profiles.prompt（用户 explicitly trained 过）— sampleCount 无效，用完整训练产出
//   - fallback：从私聊最近 sampleCount 条文本样例拼成一段
func buildMemberPersona(svc *service.ContactService, username string, sampleCount int) (string, string) {
	if sampleCount <= 0 {
		sampleCount = 30
	}
	// display name
	name := username
	for _, s := range svc.GetCachedStats() {
		if s.Username == username {
			if s.Remark != "" {
				name = s.Remark
			} else if s.Nickname != "" {
				name = s.Nickname
			}
			break
		}
	}

	// 尝试 clone profile
	if p, err := GetCloneProfile(username); err == nil && p != nil && strings.TrimSpace(p.Prompt) != "" {
		return name, "（来自 AI 分身训练）\n" + truncateToRunes(p.Prompt, 1200)
	}

	// fallback：样例对话
	msgs := svc.ExportContactMessagesAll(username)
	samples := make([]string, 0, sampleCount)
	for i := len(msgs) - 1; i >= 0 && len(samples) < sampleCount; i-- {
		m := msgs[i]
		if m.Type != 1 || m.IsMine { // 只要对方的文本
			continue
		}
		c := strings.TrimSpace(m.Content)
		if c == "" {
			continue
		}
		if len([]rune(c)) > 80 {
			c = string([]rune(c)[:80]) + "…"
		}
		samples = append(samples, c)
	}
	if len(samples) == 0 {
		return name, "（无已学分身、也无私聊样例，仅按常识角色扮演）"
	}
	// 反转为正序，更贴"最近聊天节奏"
	for i, j := 0, len(samples)-1; i < j; i, j = i+1, j-1 {
		samples[i], samples[j] = samples[j], samples[i]
	}
	var b strings.Builder
	b.WriteString("（未训练分身，用以下最近 ")
	fmt.Fprintf(&b, "%d", len(samples))
	b.WriteString(" 条私聊消息作为说话风格参考）\n")
	for _, s := range samples {
		b.WriteString("- \"")
		b.WriteString(s)
		b.WriteString("\"\n")
	}
	return name, b.String()
}

func truncateToRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
