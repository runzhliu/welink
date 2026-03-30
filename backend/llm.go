package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ─── 公共类型 ──────────────────────────────────────────────────────────────────

type LLMMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChunk 是 SSE 推给前端的单次增量
type StreamChunk struct {
	Delta   string   `json:"delta,omitempty"`
	Thinking string  `json:"thinking,omitempty"` // 思考型模型的推理过程增量（Ollama reasoning 字段）
	Done    bool     `json:"done,omitempty"`
	Error   string   `json:"error,omitempty"`
	RagMeta *RagMeta `json:"rag_meta,omitempty"`
}

// RagMeta 携带 RAG 检索统计信息及命中消息（在 LLM 流式响应前发送）。
type RagMeta struct {
	Hits      int         `json:"hits"`               // FTS 直接命中数
	Retrieved int         `json:"retrieved"`          // 含窗口扩展后的消息数
	Messages  []RagSnipet `json:"messages,omitempty"` // 命中消息片段
}

// RagSnipet 是返回给前端展示的单条检索结果。
type RagSnipet struct {
	Datetime string `json:"datetime"`
	Sender   string `json:"sender"`
	Content  string `json:"content"`
	IsHit    bool   `json:"is_hit"` // true = 直接命中，false = 上下文扩展
}

// CompleteResponse 是非流式调用的 JSON 响应
type CompleteResponse struct {
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
}

// ─── Provider 配置 ─────────────────────────────────────────────────────────────

type llmConfig struct {
	provider string
	apiKey   string
	baseURL  string
	model    string
	noThink  bool // Ollama 思考型模型专用，开启后请求前加 /no_think 前缀
}

// defaultsFor 为已知 provider 填充默认 baseURL 和 model（若用户未配置）
func defaultsFor(p *llmConfig) {
	switch p.provider {
	case "deepseek":
		if p.baseURL == "" {
			p.baseURL = "https://api.deepseek.com/v1"
		}
		if p.model == "" {
			p.model = "deepseek-chat"
		}
	case "kimi":
		if p.baseURL == "" {
			p.baseURL = "https://api.moonshot.cn/v1"
		}
		if p.model == "" {
			p.model = "moonshot-v1-8k"
		}
	case "gemini":
		if p.baseURL == "" {
			p.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
		}
		if p.model == "" {
			p.model = "gemini-2.0-flash"
		}
	case "glm":
		if p.baseURL == "" {
			p.baseURL = "https://open.bigmodel.cn/api/paas/v4"
		}
		if p.model == "" {
			p.model = "glm-4-flash"
		}
	case "grok":
		if p.baseURL == "" {
			p.baseURL = "https://api.x.ai/v1"
		}
		if p.model == "" {
			p.model = "grok-3-mini"
		}
	case "minimax":
		if p.baseURL == "" {
			p.baseURL = "https://api.minimax.io/v1"
		}
		if p.model == "" {
			p.model = "MiniMax-Text-01"
		}
	case "openai":
		if p.baseURL == "" {
			p.baseURL = "https://api.openai.com/v1"
		}
		if p.model == "" {
			p.model = "gpt-4o-mini"
		}
	case "ollama":
		if p.baseURL == "" {
			p.baseURL = "http://localhost:11434/v1"
		}
		if p.model == "" {
			p.model = "llama3"
		}
	case "claude":
		// Claude 使用原生 API，不需要 baseURL
		if p.model == "" {
			p.model = "claude-haiku-4-5-20251001"
		}
	}
}

// ─── Profile 辅助 ──────────────────────────────────────────────────────────────

// llmConfigForProfile 根据 profile_id 从 LLMProfiles 中查找配置；
// 找不到或 profileID 为空时回退到单配置字段（向后兼容）。
func llmConfigForProfile(profileID string, prefs Preferences) llmConfig {
	var cfg llmConfig
	if profileID != "" {
		for _, p := range prefs.LLMProfiles {
			if p.ID == profileID {
				cfg = llmConfig{provider: p.Provider, apiKey: p.APIKey, baseURL: p.BaseURL, model: p.Model, noThink: p.NoThink}
				goto applyGemini
			}
		}
	}
	cfg = llmConfig{provider: prefs.LLMProvider, apiKey: prefs.LLMAPIKey, baseURL: prefs.LLMBaseURL, model: prefs.LLMModel}
applyGemini:
	if cfg.provider == "gemini" && cfg.apiKey == "" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			cfg.apiKey = token
		}
	}
	defaultsFor(&cfg)
	return cfg
}

// ─── 流式调用入口 ──────────────────────────────────────────────────────────────

// StreamLLM 向选定 provider 发起流式请求，将增量 chunk 写入 w（SSE 格式）。
// 调用方应在 goroutine 中执行此函数，并在完成后关闭连接。
func StreamLLM(w http.ResponseWriter, msgs []LLMMessage, prefs Preferences) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	sendChunk := func(chunk StreamChunk) {
		data, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	streamLLMCore(sendChunk, msgs, prefs)
}

// streamLLMCore 是流式调用的核心逻辑，接受一个已配置好的 sendChunk 函数。
// 适用于需要在 LLM 响应前先发送元数据事件的场景（如 RAG）。
func streamLLMCore(sendChunk func(StreamChunk), msgs []LLMMessage, prefs Preferences) {
	// Gemini OAuth：若已授权则用 OAuth token 替代 API Key
	if prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			prefs.LLMAPIKey = token
		}
	}
	cfg := llmConfig{
		provider: prefs.LLMProvider,
		apiKey:   prefs.LLMAPIKey,
		baseURL:  prefs.LLMBaseURL,
		model:    prefs.LLMModel,
	}
	defaultsFor(&cfg)

	var err error
	if cfg.provider == "claude" {
		err = streamClaude(sendChunk, msgs, cfg)
	} else {
		err = streamOpenAICompat(sendChunk, msgs, cfg)
	}

	if err != nil {
		sendChunk(StreamChunk{Error: err.Error()})
	}
	sendChunk(StreamChunk{Done: true})
}

// streamLLMCoreWithProfile 与 streamLLMCore 相同，但通过 profileID 解析配置。
func streamLLMCoreWithProfile(sendChunk func(StreamChunk), msgs []LLMMessage, prefs Preferences, profileID string) {
	cfg := llmConfigForProfile(profileID, prefs)
	var err error
	if cfg.provider == "claude" {
		err = streamClaude(sendChunk, msgs, cfg)
	} else {
		err = streamOpenAICompat(sendChunk, msgs, cfg)
	}
	if err != nil {
		sendChunk(StreamChunk{Error: err.Error()})
	}
	sendChunk(StreamChunk{Done: true})
}

// testLLMConnProfile 测试指定 profile 的连接可用性，返回实际使用的模型名。
func testLLMConnProfile(profileID string, prefs Preferences) (string, error) {
	cfg := llmConfigForProfile(profileID, prefs)
	if cfg.baseURL == "" || cfg.model == "" {
		return "", fmt.Errorf("未配置 Base URL 或模型")
	}
	// 复用 testLLMConn 逻辑：构造临时 Preferences 只填 LLM 字段
	tmp := Preferences{
		LLMProvider: cfg.provider,
		LLMAPIKey:   cfg.apiKey,
		LLMBaseURL:  cfg.baseURL,
		LLMModel:    cfg.model,
	}
	return testLLMConn(tmp)
}

// ─── OpenAI 兼容流式实现 ───────────────────────────────────────────────────────

type openAIRequest struct {
	Model    string       `json:"model"`
	Messages []LLMMessage `json:"messages"`
	Stream   bool         `json:"stream"`
	Think    *bool        `json:"think,omitempty"`    // Ollama 专用：false = 禁用思考模式
	Stop     []string     `json:"stop,omitempty"`     // 停止词，防止模型输出特殊 token
}

func streamOpenAICompat(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	if cfg.apiKey == "" && cfg.provider != "ollama" {
		return fmt.Errorf("未配置 API Key")
	}
	if cfg.baseURL == "" {
		return fmt.Errorf("未配置 Base URL")
	}
	if cfg.model == "" {
		return fmt.Errorf("未配置模型")
	}

	reqBody := openAIRequest{Model: cfg.model, Messages: msgs, Stream: true}
	if cfg.noThink {
		f := false
		reqBody.Think = &f
	}
	if cfg.provider == "ollama" {
		reqBody.Stop = []string{"<|endoftext|>", "<|im_end|>", "<|im_start|>"}
	}
	body, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", cfg.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					Reasoning string `json:"reasoning"` // Ollama 思考型模型的推理增量
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			d := chunk.Choices[0].Delta
			if d.Reasoning != "" {
				send(StreamChunk{Thinking: d.Reasoning})
			}
			if d.Content != "" {
				send(StreamChunk{Delta: d.Content})
			}
		}
	}
	return scanner.Err()
}

// ─── Claude 原生 API 流式实现 ─────────────────────────────────────────────────

type claudeRequest struct {
	Model     string       `json:"model"`
	MaxTokens int          `json:"max_tokens"`
	System    string       `json:"system,omitempty"`
	Messages  []LLMMessage `json:"messages"`
	Stream    bool         `json:"stream"`
}

func streamClaude(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	if cfg.apiKey == "" {
		return fmt.Errorf("未配置 API Key")
	}
	if cfg.model == "" {
		return fmt.Errorf("未配置模型")
	}

	// 分离 system 消息
	var system string
	var userMsgs []LLMMessage
	for _, m := range msgs {
		if m.Role == "system" {
			system = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	body, _ := json.Marshal(claudeRequest{
		Model:     cfg.model,
		MaxTokens: 8192,
		System:    system,
		Messages:  userMsgs,
		Stream:    true,
	})

	baseURL := "https://api.anthropic.com"
	if cfg.baseURL != "" {
		baseURL = cfg.baseURL
	}
	req, err := http.NewRequest("POST", baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		if event.Type == "content_block_delta" && event.Delta.Text != "" {
			send(StreamChunk{Delta: event.Delta.Text})
		}
	}
	return scanner.Err()
}

// ─── 非流式调用 ───────────────────────────────────────────────────────────────

// CompleteLLM 发起非流式请求，返回完整响应文本（用于分段摘要）
func CompleteLLM(msgs []LLMMessage, prefs Preferences) (string, error) {
	// Gemini OAuth：若已授权则用 OAuth token 替代 API Key
	if prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			prefs.LLMAPIKey = token
		}
	}
	cfg := llmConfig{
		provider: prefs.LLMProvider,
		apiKey:   prefs.LLMAPIKey,
		baseURL:  prefs.LLMBaseURL,
		model:    prefs.LLMModel,
	}
	defaultsFor(&cfg)
	if cfg.provider == "claude" {
		return completeClaudeSync(msgs, cfg)
	}
	return completeOpenAICompatSync(msgs, cfg)
}

func completeOpenAICompatSync(msgs []LLMMessage, cfg llmConfig) (string, error) {
	if cfg.apiKey == "" && cfg.provider != "ollama" {
		return "", fmt.Errorf("未配置 API Key")
	}
	if cfg.baseURL == "" {
		return "", fmt.Errorf("未配置 Base URL")
	}
	if cfg.model == "" {
		return "", fmt.Errorf("未配置模型")
	}

	reqBody := openAIRequest{Model: cfg.model, Messages: msgs, Stream: false}
	if cfg.noThink {
		f := false
		reqBody.Think = &f
	}
	if cfg.provider == "ollama" {
		reqBody.Stop = []string{"<|endoftext|>", "<|im_end|>", "<|im_start|>"}
	}
	body, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", cfg.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析响应失败：%w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("响应为空")
	}
	return result.Choices[0].Message.Content, nil
}

func completeClaudeSync(msgs []LLMMessage, cfg llmConfig) (string, error) {
	if cfg.apiKey == "" {
		return "", fmt.Errorf("未配置 API Key")
	}
	if cfg.model == "" {
		return "", fmt.Errorf("未配置模型")
	}

	var system string
	var userMsgs []LLMMessage
	for _, m := range msgs {
		if m.Role == "system" {
			system = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	body, _ := json.Marshal(claudeRequest{
		Model: cfg.model, MaxTokens: 2048,
		System: system, Messages: userMsgs, Stream: false,
	})
	baseURL := "https://api.anthropic.com"
	if cfg.baseURL != "" {
		baseURL = cfg.baseURL
	}
	req, err := http.NewRequest("POST", baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析响应失败：%w", err)
	}
	for _, block := range result.Content {
		if block.Type == "text" && block.Text != "" {
			return block.Text, nil
		}
	}
	return "", fmt.Errorf("响应为空")
}

// ─── 连接测试 ──────────────────────────────────────────────────────────────────

// testLLMConn 发起流式请求，收到第一个非空 delta 即中止并返回成功。
// 相比 CompleteLLM，不等待完整响应，对思考型模型（Qwen3+）特别友好。
func testLLMConn(prefs Preferences) (string, error) {
	if prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			prefs.LLMAPIKey = token
		}
	}
	cfg := llmConfig{
		provider: prefs.LLMProvider,
		apiKey:   prefs.LLMAPIKey,
		baseURL:  prefs.LLMBaseURL,
		model:    prefs.LLMModel,
	}
	defaultsFor(&cfg)

	if cfg.baseURL == "" || cfg.model == "" {
		return "", fmt.Errorf("未配置 Base URL 或模型")
	}
	if cfg.apiKey == "" && cfg.provider != "ollama" {
		return "", fmt.Errorf("未配置 API Key")
	}

	body, _ := json.Marshal(openAIRequest{Model: cfg.model, Messages: []LLMMessage{{Role: "user", Content: "Hi"}}, Stream: true})
	req, err := http.NewRequest("POST", cfg.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return cfg.model, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return cfg.model, fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return cfg.model, fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	// 读到第一个有内容的 delta 就认为连接成功，立即返回
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			break
		}
		var event struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		if len(event.Choices) > 0 {
			// 收到第一个 chunk（不管内容是否为空），即表示模型在响应，连接正常
			return cfg.model, nil
		}
	}
	return cfg.model, nil
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────────

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
