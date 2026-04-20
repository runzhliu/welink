package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// validateTTSBaseURL 校验用户设置的 TTS base URL 安全可用。
// 要求：https://、带 host、host 不是 loopback / RFC1918 / link-local —— 否则后端
// 代理请求可被用来打内网或元数据服务（SSRF）。空串代表"使用默认 OpenAI"，放行。
func validateTTSBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("URL 解析失败：%v", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("只接受 https:// 开头的地址")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL 缺少 host")
	}
	// 如果是 IP 字面量直接拒私网
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("拒绝内网 / 回环 / 链路本地 IP")
		}
		return nil
	}
	// 域名字面量：拒绝 localhost 前缀（dns 解析到的 A 记录无法在写入时校验，
	// TOCTOU 层面有残余风险，但要兜到 http.Transport 的 DialContext 才能彻底防）
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") || strings.HasSuffix(lower, ".internal") {
		return fmt.Errorf("拒绝 localhost / .internal 域名")
	}
	return nil
}

// PodcastLine 是脚本里的一句对白
type PodcastLine struct {
	Speaker string `json:"speaker"` // "A" or "B"
	Text    string `json:"text"`
}

// PodcastScript 是 LLM 输出的完整脚本
type PodcastScript struct {
	Title string        `json:"title"`
	Lines []PodcastLine `json:"lines"`
}

// registerPodcastRoutes 挂载播客相关端点。
// NotebookLM 风格：把联系人数据 → 双主持人对话 → TTS 播报。
func registerPodcastRoutes(api *gin.RouterGroup, getSvc func() *service.ContactService) {
	// 读取 TTS 配置
	api.GET("/podcast/config", func(c *gin.Context) {
		p := loadPreferences()
		hasKey := strings.TrimSpace(p.PodcastTTSAPIKey) != ""
		c.JSON(http.StatusOK, gin.H{
			"base_url": p.PodcastTTSBaseURL,
			"has_key":  hasKey,
			"model":    p.PodcastTTSModel,
			"voice_a":  p.PodcastTTSVoiceA,
			"voice_b":  p.PodcastTTSVoiceB,
		})
	})

	// 更新 TTS 配置
	api.PUT("/podcast/config", func(c *gin.Context) {
		var body struct {
			BaseURL string `json:"base_url"`
			APIKey  string `json:"api_key"` // 空串 / "__HAS_KEY__" / "****" 都视为"保持原值"
			Model   string `json:"model"`
			VoiceA  string `json:"voice_a"`
			VoiceB  string `json:"voice_b"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		if err := validateTTSBaseURL(body.BaseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "base_url 不合法：" + err.Error()})
			return
		}
		p := loadPreferences()
		p.PodcastTTSBaseURL = strings.TrimSpace(body.BaseURL)
		p.PodcastTTSModel = strings.TrimSpace(body.Model)
		p.PodcastTTSVoiceA = strings.TrimSpace(body.VoiceA)
		p.PodcastTTSVoiceB = strings.TrimSpace(body.VoiceB)
		// API Key 保护逻辑同 LLM
		incoming := strings.TrimSpace(body.APIKey)
		if incoming != "" && incoming != hasKeyPlaceholder && !strings.Contains(incoming, "****") {
			p.PodcastTTSAPIKey = incoming
		}
		if err := savePreferences(p); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败：" + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 生成脚本：聚合数据 + LLM 写双人对话 JSON
	api.POST("/podcast/generate-script", func(c *gin.Context) {
		var body struct {
			ContactKey      string `json:"contact_key"`
			DurationMinutes int    `json:"duration_minutes"` // 3 / 5 / 10
			ProfileID       string `json:"profile_id,omitempty"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.ContactKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "contact_key 必传"})
			return
		}
		if body.DurationMinutes != 3 && body.DurationMinutes != 5 && body.DurationMinutes != 10 {
			body.DurationMinutes = 5
		}
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "数据索引未就绪"})
			return
		}
		detail := svc.GetContactDetail(body.ContactKey)
		if detail == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "找不到联系人或无数据"})
			return
		}
		// 拿到基础 stats（从缓存里捞）
		var basics *service.ContactStatsExtended
		for _, s := range svc.GetCachedStats() {
			if s.Username == body.ContactKey {
				cp := s
				basics = &cp
				break
			}
		}
		if basics == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "找不到联系人"})
			return
		}

		// 聚合 summary（给 LLM 一个紧凑的事实清单）
		summary := buildPodcastSummary(basics, detail, body.DurationMinutes)

		// 构造 LLM 请求
		prefs := loadPreferences()
		cfg := llmConfigForProfile(body.ProfileID, prefs)
		if cfg.apiKey == "" && cfg.provider != "ollama" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 LLM API Key"})
			return
		}

		sys := `你是一个播客脚本写手。请把下面用户与某位联系人的聊天数据写成一段双人对话的播客脚本，风格温暖、有洞察、偶尔带一点幽默。

严格要求：
- 两位主持人：A（男声，主持旁白风格）和 B（女声，情感解读风格）
- 开头 A 开场白，结尾 B 收尾
- 每句对白控制在 1-3 句话，避免长段落（TTS 播放友好）
- 使用聊天中的具体数字 / 事件 / 特征（增强真实感）
- 不要捏造没在数据里的事实
- 最后一句要留一个温暖的提醒 / 思考

输出严格 JSON（不要 markdown 代码块），格式：
{"title": "播客标题", "lines": [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}, ...]}`

		user := fmt.Sprintf("请写一段约 %d 分钟（%d 句左右）的播客，关于用户和这位联系人的关系。\n\n数据：\n%s",
			body.DurationMinutes, body.DurationMinutes*15, summary)

		msgs := []LLMMessage{
			{Role: "system", Content: sys},
			{Role: "user", Content: user},
		}

		raw, err := CompleteLLM(msgs, prefs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 生成失败：" + err.Error()})
			return
		}

		// 容错：有时 LLM 会带 ```json 包裹
		raw = strings.TrimSpace(raw)
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(raw, "```")
		raw = strings.TrimSpace(raw)

		var script PodcastScript
		if err := json.Unmarshal([]byte(raw), &script); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "解析脚本失败：" + err.Error(),
				"raw":   truncate(raw, 400),
			})
			return
		}
		if len(script.Lines) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 未产出对白"})
			return
		}
		// 规范化 speaker 值
		for i := range script.Lines {
			s := strings.ToUpper(strings.TrimSpace(script.Lines[i].Speaker))
			if s != "A" && s != "B" {
				if i%2 == 0 {
					s = "A"
				} else {
					s = "B"
				}
			}
			script.Lines[i].Speaker = s
		}
		c.JSON(http.StatusOK, script)
	})

	// TTS 代理：前端按句调用，后端用户自己的 key 合成 MP3 返回
	api.POST("/podcast/tts", func(c *gin.Context) {
		var body struct {
			Text    string `json:"text"`
			Speaker string `json:"speaker"` // A / B
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Text) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "text 必传"})
			return
		}
		if len(body.Text) > 2000 {
			body.Text = body.Text[:2000]
		}
		prefs := loadPreferences()
		key := strings.TrimSpace(prefs.PodcastTTSAPIKey)
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 TTS API Key — 去 设置 → 播客 TTS 配置"})
			return
		}
		base := strings.TrimSpace(prefs.PodcastTTSBaseURL)
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		// 调用点再校一次——直接改 preferences.json 能绕过 PUT config 的校验
		if err := validateTTSBaseURL(base); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "TTS base_url 不安全：" + err.Error() + "（去设置页重新填写）"})
			return
		}
		model := strings.TrimSpace(prefs.PodcastTTSModel)
		if model == "" {
			model = "tts-1"
		}
		voice := strings.TrimSpace(prefs.PodcastTTSVoiceA)
		if voice == "" {
			voice = "alloy"
		}
		if strings.ToUpper(body.Speaker) == "B" {
			voice = strings.TrimSpace(prefs.PodcastTTSVoiceB)
			if voice == "" {
				voice = "nova"
			}
		}

		reqBody, _ := json.Marshal(map[string]interface{}{
			"model":  model,
			"input":  body.Text,
			"voice":  voice,
			"format": "mp3",
		})
		req, err := http.NewRequest("POST", base+"/audio/speech", bytes.NewReader(reqBody))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+key)

		// TTS 可能较慢（~几秒），给 60s
		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "TTS 请求失败：" + err.Error()})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			raw, _ := io.ReadAll(resp.Body)
			c.JSON(resp.StatusCode, gin.H{"error": "TTS API 错误：" + truncate(string(raw), 200)})
			return
		}
		c.Header("Content-Type", "audio/mpeg")
		c.Header("Cache-Control", "no-store")
		io.Copy(c.Writer, resp.Body)
	})
}

// buildPodcastSummary 把联系人的聚合数据拼成紧凑文本（~1000 字以内），喂给 LLM。
func buildPodcastSummary(basics interface{}, detail interface{}, durationMin int) string {
	// 为了避免 circular import（service 包的 ContactStatsExtended / ContactDetail），
	// 这里用 JSON 往返 + map 取值。虽然绕，但隔离了包依赖。
	basicsJSON, _ := json.Marshal(basics)
	detailJSON, _ := json.Marshal(detail)
	var b, d map[string]interface{}
	_ = json.Unmarshal(basicsJSON, &b)
	_ = json.Unmarshal(detailJSON, &d)

	get := func(m map[string]interface{}, k string) interface{} { return m[k] }

	var sb strings.Builder
	sb.WriteString("—— 对话对象基本信息 ——\n")
	if v := get(b, "nickname"); v != nil {
		fmt.Fprintf(&sb, "昵称：%v\n", v)
	}
	if v := get(b, "remark"); v != nil && v != "" {
		fmt.Fprintf(&sb, "备注：%v\n", v)
	}
	if v := get(b, "total_messages"); v != nil {
		fmt.Fprintf(&sb, "累计消息：%v 条\n", v)
	}
	if v := get(b, "first_msg"); v != nil && v != "" {
		fmt.Fprintf(&sb, "第一条消息：%v\n", v)
	}
	if v := get(b, "last_message_time"); v != nil {
		fmt.Fprintf(&sb, "最近一次聊天：%v\n", v)
	}
	if v := get(b, "avg_msg_len"); v != nil {
		fmt.Fprintf(&sb, "平均单条消息长度：%.1f 字\n", toFloat(v))
	}

	sb.WriteString("\n—— 聊天节奏 ——\n")
	if hourly, ok := d["hourly_dist"].([]interface{}); ok && len(hourly) == 24 {
		// 找高峰时段
		type hh struct{ h int; n int }
		hs := make([]hh, 24)
		for i, v := range hourly {
			hs[i] = hh{i, int(toFloat(v))}
		}
		sort.Slice(hs, func(i, j int) bool { return hs[i].n > hs[j].n })
		if hs[0].n > 0 {
			fmt.Fprintf(&sb, "高峰时段：%02d 时（%d 条）、%02d 时（%d 条）、%02d 时（%d 条）\n",
				hs[0].h, hs[0].n, hs[1].h, hs[1].n, hs[2].h, hs[2].n)
		}
	}
	if v := get(d, "late_night_count"); v != nil && toFloat(v) > 0 {
		fmt.Fprintf(&sb, "深夜 (00:00-05:00) 聊天数：%v 条\n", int64(toFloat(v)))
	}
	if v := get(d, "initiation_count"); v != nil {
		if total := get(d, "total_sessions"); total != nil && toFloat(total) > 0 {
			pct := toFloat(v) * 100 / toFloat(total)
			fmt.Fprintf(&sb, "你主动发起对话占比：%.0f%%（%v / %v）\n", pct, int64(toFloat(v)), int64(toFloat(total)))
		}
	}

	sb.WriteString("\n—— 金钱互动 ——\n")
	if v := get(d, "red_packet_count"); v != nil {
		fmt.Fprintf(&sb, "红包次数：%v\n", int64(toFloat(v)))
	}
	if v := get(d, "transfer_count"); v != nil {
		fmt.Fprintf(&sb, "转账次数：%v\n", int64(toFloat(v)))
	}

	// 最近月度趋势（最近 6 个月）
	sb.WriteString("\n—— 最近 6 个月消息趋势 ——\n")
	if their, ok := d["their_monthly_trend"].(map[string]interface{}); ok {
		if mine, ok := d["my_monthly_trend"].(map[string]interface{}); ok {
			keys := make([]string, 0, len(their))
			for k := range their {
				keys = append(keys, k)
			}
			for k := range mine {
				if _, seen := their[k]; !seen {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			if len(keys) > 6 {
				keys = keys[len(keys)-6:]
			}
			for _, k := range keys {
				fmt.Fprintf(&sb, "  %s：TA %d 条 / 我 %d 条\n", k, int(toFloat(their[k])), int(toFloat(mine[k])))
			}
		}
	}

	sb.WriteString(fmt.Sprintf("\n—— 目标 ——\n请基于以上事实，写一段约 %d 分钟的双人播客脚本。\n", durationMin))
	return sb.String()
}

func toFloat(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	}
	return 0
}
