package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

// maxStreamParseFails 单次流式响应允许的 chunk 解析失败次数上限。
// 偶发一两条坏 chunk（网络分片/provider 杂讯）容忍并跳过；超过则说明流已损坏，
// 与其静默返回残缺结果（看起来"正常完成"），不如报错让用户重试（H3）。
const maxStreamParseFails = 5

// ─── 公共类型 ──────────────────────────────────────────────────────────────────

type LLMMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChunk 是 SSE 推给前端的单次增量
type StreamChunk struct {
	Delta    string   `json:"delta,omitempty"`
	Thinking string   `json:"thinking,omitempty"` // 思考型模型的推理过程增量（Ollama reasoning 字段）
	Done     bool     `json:"done,omitempty"`
	Error    string   `json:"error,omitempty"`
	RagMeta  *RagMeta `json:"rag_meta,omitempty"`
}

// RagMeta 携带 RAG 检索统计信息及命中消息（在 LLM 流式响应前发送）。
type RagMeta struct {
	Hits      int         `json:"hits"`                // FTS 直接命中数
	Retrieved int         `json:"retrieved"`           // 含窗口扩展后的消息数
	Total     int         `json:"total,omitempty"`     // 检索到的总数（截断前）
	Truncated bool        `json:"truncated,omitempty"` // 是否因 token 预算截断
	Messages  []RagSnipet `json:"messages,omitempty"`  // 命中消息片段
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
	provider        string
	apiKey          string
	baseURL         string
	model           string
	trustedLocal    bool   // 仅限 WeLink 自己固定在 loopback 启动的受管服务
	noThink         bool   // Ollama 思考型模型专用，开启后请求前加 /no_think 前缀
	reasoningEffort string // 空字符串/off = 模型默认；low / medium / high / xhigh / max
}

// reasoningBudgetTokens 把档位映射到 Claude thinking.budget_tokens
func reasoningBudgetTokens(effort string) int {
	switch effort {
	case "low":
		return 2048
	case "medium":
		return 8192
	case "high":
		return 16384
	default:
		return 0
	}
}

// defaultsFor 为已知 provider 填充默认 baseURL 和 model（若用户未配置）。
// 默认型号核对日期：2026-10-20；来源及平台差异见 docs/ai-analysis.md。
func defaultsFor(p *llmConfig) {
	switch p.provider {
	case "deepseek":
		if p.baseURL == "" {
			p.baseURL = "https://api.deepseek.com/v1"
		}
		if p.model == "" {
			p.model = "deepseek-v4-pro"
		}
	case "doubao":
		// 豆包 = 字节火山方舟（Volcengine Ark），OpenAI 兼容
		if p.baseURL == "" {
			p.baseURL = "https://ark.cn-beijing.volces.com/api/v3"
		}
		if p.model == "" {
			p.model = "doubao-seed-2-1-pro-260915"
		}
	case "kimi":
		if p.baseURL == "" {
			p.baseURL = "https://api.moonshot.cn/v1"
		}
		if p.model == "" {
			p.model = "kimi-k3"
		}
	case "gemini":
		if p.baseURL == "" {
			p.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
		}
		if p.model == "" {
			// 使用当前稳定版 Flash，保留低延迟定位
			p.model = "gemini-3.8-flash"
		}
	case "glm":
		if p.baseURL == "" {
			p.baseURL = "https://open.bigmodel.cn/api/paas/v4"
		}
		if p.model == "" {
			p.model = "glm-5.3"
		}
	case "grok":
		if p.baseURL == "" {
			p.baseURL = "https://api.x.ai/v1"
		}
		if p.model == "" {
			p.model = "grok-4.7"
		}
	case "minimax":
		if p.baseURL == "" {
			p.baseURL = "https://api.minimax.io/v1"
		}
		if p.model == "" {
			p.model = "MiniMax-M3.1-Flash"
		}
	case "minimax-cn":
		if p.baseURL == "" {
			p.baseURL = "https://api.minimaxi.com/v1"
		}
		if p.model == "" {
			p.model = "MiniMax-M3.1-Flash"
		}
	case "chatgpt":
		// Never send a subscription bearer token to a user-configurable URL.
		p.baseURL = chatGPTResource
	case "openai":
		if p.baseURL == "" {
			p.baseURL = "https://api.openai.com/v1"
		}
		if p.model == "" {
			p.model = "gpt-6-astra"
		}
	case "ollama":
		if p.baseURL == "" {
			p.baseURL = "http://localhost:11434/v1"
		}
		if p.model == "" {
			// Ollama 是本地模型，需用户先 ollama pull；给个较新的常见默认
			p.model = "llama3.3"
		}
	case "claude":
		if p.baseURL == "" {
			p.baseURL = "https://api.anthropic.com"
		}
		// Claude 使用原生 Messages API
		if p.model == "" {
			// 当前通用旗舰，思考参数使用 adaptive + output_config.effort
			p.model = "claude-opus-5-5"
		}
	case "bedrock":
		if p.baseURL == "" {
			p.baseURL = "https://bedrock-mantle.us-east-1.api.aws/anthropic"
			// 显式指定旧 Runtime 模型时保留原端点。
			if p.model != "" && !usesBedrockMantleModel(p.model) {
				p.baseURL = "https://bedrock-runtime.us-east-1.amazonaws.com"
			}
		}
		if p.model == "" {
			p.model = "anthropic.claude-opus-5-5"
			if !isBedrockMantle(p.baseURL) {
				// Runtime 的 Model ID / inference profile 依区域而定，需用户指定。
				p.model = ""
			}
		}
	case "vertex":
		// BaseURL 由用户填写完整端点，model 给个默认
		if p.model == "" {
			// Vertex 使用带 google/ 前缀的 OpenAI 兼容模型名
			p.model = "google/gemini-3.8-flash"
		}
	case "qwen":
		// 阿里通义千问 / DashScope 兼容模式
		if p.baseURL == "" {
			p.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
		}
		if p.model == "" {
			p.model = "qwen3.8-max"
		}
	case "hunyuan":
		// 腾讯混元，OpenAI 兼容
		if p.baseURL == "" {
			p.baseURL = "https://api.hunyuan.cloud.tencent.com/v1"
		}
		if p.model == "" {
			p.model = "hunyuan-turbos-latest"
		}
	case "qianfan":
		// 百度千帆 / 文心一言，OpenAI 兼容端点
		if p.baseURL == "" {
			p.baseURL = "https://qianfan.baidubce.com/v2"
		}
		if p.model == "" {
			p.model = "ernie-5.1"
		}
	case "openrouter":
		if p.baseURL == "" {
			p.baseURL = "https://openrouter.ai/api/v1"
		}
		if p.model == "" {
			p.model = "openai/gpt-6-astra"
		}
	case "mistral":
		if p.baseURL == "" {
			p.baseURL = "https://api.mistral.ai/v1"
		}
		if p.model == "" {
			// mistral-large-latest 是滚动别名，已指向当前 Large 旗舰，自动跟新，保持不变
			p.model = "mistral-large-latest"
		}
	case "groq":
		if p.baseURL == "" {
			p.baseURL = "https://api.groq.com/openai/v1"
		}
		if p.model == "" {
			p.model = "openai/gpt-oss-120b"
		}
	case "together":
		if p.baseURL == "" {
			p.baseURL = "https://api.together.xyz/v1"
		}
		if p.model == "" {
			p.model = "deepseek-ai/DeepSeek-V4-Pro-0813"
		}
	case "fireworks":
		if p.baseURL == "" {
			p.baseURL = "https://api.fireworks.ai/inference/v1"
		}
		if p.model == "" {
			p.model = "accounts/fireworks/models/deepseek-v4-pro"
		}
	case "perplexity":
		if p.baseURL == "" {
			p.baseURL = "https://api.perplexity.ai"
		}
		if p.model == "" {
			p.model = "sonar-pro"
		}
	case "cohere":
		// Cohere v2 提供 OpenAI 兼容端点
		if p.baseURL == "" {
			p.baseURL = "https://api.cohere.ai/compatibility/v1"
		}
		if p.model == "" {
			p.model = "command-a-plus-05-2026"
		}
	case "siliconflow":
		// 硅基流动
		if p.baseURL == "" {
			p.baseURL = "https://api.siliconflow.cn/v1"
		}
		if p.model == "" {
			p.model = "deepseek-ai/DeepSeek-V4-Pro"
		}
	case "yi":
		// 零一万物
		if p.baseURL == "" {
			p.baseURL = "https://api.lingyiwanwu.com/v1"
		}
		if p.model == "" {
			p.model = "yi-lightning"
		}
	case "stepfun":
		// 阶跃星辰
		if p.baseURL == "" {
			p.baseURL = "https://api.stepfun.com/v1"
		}
		if p.model == "" {
			p.model = "step-3.7-flash"
		}
	case "azure":
		// Azure OpenAI：用户必须填写完整 BaseURL（含 deployment 路径）
		// 例：https://{resource}.openai.azure.com/openai/deployments/{deployment}
		// model 必须填写用户在 Azure 创建的部署名称。
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
				cfg = llmConfig{provider: p.Provider, apiKey: p.APIKey, baseURL: p.BaseURL, model: p.Model, noThink: p.NoThink, reasoningEffort: p.ReasoningEffort}
				if p.SFTDeploymentID != "" {
					cfg.baseURL = sftInferenceURL(p.SFTDeploymentID, cfg.baseURL)
				}
				goto applyGemini
			}
		}
	}
	cfg = llmConfig{provider: prefs.LLMProvider, apiKey: prefs.LLMAPIKey, baseURL: prefs.LLMBaseURL, model: prefs.LLMModel}
	if len(prefs.LLMProfiles) > 0 {
		p := prefs.LLMProfiles[0]
		if p.SFTDeploymentID != "" && p.Model == cfg.model {
			cfg.baseURL = sftInferenceURL(p.SFTDeploymentID, cfg.baseURL)
		}
	}
applyGemini:
	if cfg.provider == "chatgpt" {
		cfg.apiKey, _ = chatGPTValidToken()
	}
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
	if DemoMockActive() {
		demoLLMStream(sendChunk, msgs)
		return
	}
	// Gemini OAuth：若已授权则用 OAuth token 替代 API Key
	if prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			prefs.LLMAPIKey = token
		}
	}
	cfg := llmConfigForProfile("", prefs)

	err := dispatchLLMStream(sendChunk, msgs, cfg)
	if err != nil {
		sendChunk(StreamChunk{Error: err.Error()})
	}
	sendChunk(StreamChunk{Done: true})
}

// streamLLMCoreWithProfile 与 streamLLMCore 相同，但通过 profileID 解析配置。
func streamLLMCoreWithProfile(sendChunk func(StreamChunk), msgs []LLMMessage, prefs Preferences, profileID string) {
	if DemoMockActive() {
		demoLLMStream(sendChunk, msgs)
		return
	}
	cfg := llmConfigForProfile(profileID, prefs)
	err := dispatchLLMStream(sendChunk, msgs, cfg)
	if err != nil {
		sendChunk(StreamChunk{Error: err.Error()})
	}
	sendChunk(StreamChunk{Done: true})
}

// streamLLMCoreWithConfig streams through an already validated configuration.
// It is used by managed local SFT deployments, which are not persisted as
// user-editable LLM profiles and therefore cannot be resolved by profile ID.
func streamLLMCoreWithConfig(sendChunk func(StreamChunk), msgs []LLMMessage, cfg llmConfig) {
	err := dispatchLLMStream(sendChunk, msgs, cfg)
	if err != nil {
		sendChunk(StreamChunk{Error: err.Error()})
	}
	sendChunk(StreamChunk{Done: true})
}

// testLLMConnProfile 测试指定 profile 的连接可用性，返回实际使用的模型名。
func testLLMConnProfile(profileID string, prefs Preferences) (string, error) {
	cfg := llmConfigForProfile(profileID, prefs)
	return testLLMConfig(cfg)
}

// dispatchLLMStream 统一流式分发
func dispatchLLMStream(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	// Demo 模式下拒绝指向内网的 baseURL，防 SSRF（M2/L4）；本地部署不限制（Ollama 等走 localhost）
	if !cfg.trustedLocal {
		if err := guardOutboundURL(cfg.baseURL); err != nil {
			return err
		}
	}
	t := startTimer("llm_stream")
	var err error
	switch cfg.provider {
	case "chatgpt":
		err = streamChatGPT(send, msgs, cfg)
	case "claude":
		err = streamClaude(send, msgs, cfg)
	case "bedrock":
		err = streamBedrock(send, msgs, cfg)
	case "vertex":
		err = streamVertex(send, msgs, cfg)
	default:
		err = streamOpenAICompat(send, msgs, cfg)
	}
	t.Done(err,
		"provider", cfg.provider,
		"model", cfg.model,
		"msg_count", len(msgs),
		"prompt_chars", llmPromptChars(msgs),
		"reasoning", cfg.reasoningEffort,
	)
	return err
}

// llmPromptChars 累加所有消息正文长度，用于埋点。
func llmPromptChars(msgs []LLMMessage) int {
	n := 0
	for _, m := range msgs {
		n += len(m.Content)
	}
	return n
}

// ─── OpenAI 兼容流式实现 ───────────────────────────────────────────────────────

type openAIRequest struct {
	Model           string       `json:"model"`
	Messages        []LLMMessage `json:"messages"`
	Stream          bool         `json:"stream"`
	Think           *bool        `json:"think,omitempty"` // Ollama 专用：false = 禁用思考模式
	Stop            []string     `json:"stop,omitempty"`  // 停止词，防止模型输出特殊 token
	ReasoningEffort string       `json:"reasoning_effort,omitempty"`
}

// 流式、非流式和连接测试使用相同参数，防止保存后的设置仅在部分调用中生效。
func newOpenAIRequest(msgs []LLMMessage, cfg llmConfig, stream bool) openAIRequest {
	reqBody := openAIRequest{Model: cfg.model, Messages: msgs, Stream: stream}
	if cfg.noThink && cfg.provider == "ollama" {
		f := false
		reqBody.Think = &f
	}
	if cfg.provider == "ollama" {
		reqBody.Stop = []string{"<|endoftext|>", "<|im_end|>", "<|im_start|>"}
	}
	if cfg.reasoningEffort != "" && cfg.reasoningEffort != "off" &&
		(cfg.provider == "openai" || ((cfg.provider == "minimax" || cfg.provider == "minimax-cn") && cfg.model == "MiniMax-M3.1-Flash")) {
		reqBody.ReasoningEffort = cfg.reasoningEffort
	}
	return reqBody
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
	body, _ := json.Marshal(newOpenAIRequest(msgs, cfg, true))

	req, err := http.NewRequest("POST", cfg.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := httpClientLLMStream.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	scanner := bufio.NewScanner(resp.Body)
	// 用于检测 <think>...</think> 标签（MiniMax / DeepSeek-R1 等思考模型）
	inThinkTag := false
	thinkBuf := ""
	parseFails := 0 // 累计 chunk 解析失败数，超阈值即中止，避免静默丢数据（H3）

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
					Content          string `json:"content"`
					Reasoning        string `json:"reasoning"`         // Ollama 思考型模型的推理增量
					ReasoningContent string `json:"reasoning_content"` // DeepSeek / Kimi / MiniMax
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			parseFails++
			log.Printf("[llm] OpenAI 兼容流 chunk 解析失败(%d)：%v；payload=%q", parseFails, err, truncate(payload, 200))
			if parseFails > maxStreamParseFails {
				return fmt.Errorf("响应流多次解析失败（%d 次），结果可能不完整，请重试", parseFails)
			}
			continue
		}
		if len(chunk.Choices) > 0 {
			d := chunk.Choices[0].Delta
			// Ollama 专用 reasoning 字段
			if d.Reasoning != "" {
				send(StreamChunk{Thinking: d.Reasoning})
			}
			if d.ReasoningContent != "" {
				send(StreamChunk{Thinking: d.ReasoningContent})
			}
			if d.Content != "" {
				// 解析 <think>...</think> 标签（流式逐 chunk 拼接）
				text := d.Content
				for len(text) > 0 {
					if inThinkTag {
						// 在思考标签内，寻找 </think>
						endIdx := strings.Index(text, "</think>")
						if endIdx >= 0 {
							// 思考结束
							thinkBuf += text[:endIdx]
							if thinkBuf != "" {
								send(StreamChunk{Thinking: thinkBuf})
								thinkBuf = ""
							}
							inThinkTag = false
							text = strings.TrimLeft(text[endIdx+8:], "\n\r ") // 去掉 </think> 后的换行空白
						} else {
							// 还没结束，继续积累
							thinkBuf += text
							// 定期 flush 思考内容（避免长思考时前端无反馈）
							if len(thinkBuf) > 50 {
								send(StreamChunk{Thinking: thinkBuf})
								thinkBuf = ""
							}
							text = ""
						}
					} else {
						// 不在思考标签内，寻找 <think>
						startIdx := strings.Index(text, "<think>")
						if startIdx >= 0 {
							// <think> 之前的内容是正文
							if startIdx > 0 {
								send(StreamChunk{Delta: text[:startIdx]})
							}
							inThinkTag = true
							thinkBuf = ""
							text = text[startIdx+7:] // len("<think>") = 7
						} else {
							// 没有 <think>，全部是正文
							send(StreamChunk{Delta: text})
							text = ""
						}
					}
				}
			}
		}
	}
	// 如果流结束时还有未 flush 的思考内容
	if thinkBuf != "" {
		send(StreamChunk{Thinking: thinkBuf})
	}
	return scanner.Err()
}

// ─── Claude 原生 API 流式实现 ─────────────────────────────────────────────────

type claudeRequest struct {
	Model        string              `json:"model"`
	MaxTokens    int                 `json:"max_tokens"`
	System       string              `json:"system,omitempty"`
	Messages     []LLMMessage        `json:"messages"`
	Stream       bool                `json:"stream"`
	Thinking     *claudeThinking     `json:"thinking,omitempty"`
	OutputConfig *claudeOutputConfig `json:"output_config,omitempty"`
}

type claudeThinking struct {
	Type         string `json:"type"` // adaptive 或旧模型的 enabled
	BudgetTokens int    `json:"budget_tokens,omitempty"`
	Display      string `json:"display,omitempty"`
}

type claudeOutputConfig struct {
	Effort string `json:"effort"`
}

func usesClaudeAdaptiveThinking(model string) bool {
	for _, name := range []string{"claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6", "claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5", "claude-mythos"} {
		if strings.Contains(model, name) {
			return true
		}
	}
	return false
}

func newClaudeRequest(msgs []LLMMessage, cfg llmConfig, stream bool, maxTokens int) claudeRequest {
	var system string
	var userMsgs []LLMMessage
	for _, m := range msgs {
		if m.Role == "system" {
			system = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	reqObj := claudeRequest{
		Model:     cfg.model,
		MaxTokens: maxTokens,
		System:    system,
		Messages:  userMsgs,
		Stream:    stream,
	}
	// 新模型的输出额度也包含思考，给同步摘要留出足够空间。
	if usesClaudeAdaptiveThinking(cfg.model) && reqObj.MaxTokens < 8192 {
		reqObj.MaxTokens = 8192
	}
	if cfg.reasoningEffort != "" && cfg.reasoningEffort != "off" && usesClaudeAdaptiveThinking(cfg.model) {
		reqObj.Thinking = &claudeThinking{Type: "adaptive", Display: "summarized"}
		reqObj.OutputConfig = &claudeOutputConfig{Effort: cfg.reasoningEffort}
	} else if budget := reasoningBudgetTokens(cfg.reasoningEffort); budget > 0 {
		reqObj.Thinking = &claudeThinking{Type: "enabled", BudgetTokens: budget}
		// Extended Thinking 要求 max_tokens > budget_tokens
		reqObj.MaxTokens = budget + maxTokens
	}
	return reqObj
}

func newClaudeHTTPRequest(msgs []LLMMessage, cfg llmConfig, stream bool, maxTokens int) (*http.Request, error) {
	body, _ := json.Marshal(newClaudeRequest(msgs, cfg, stream, maxTokens))
	baseURL := "https://api.anthropic.com"
	if cfg.baseURL != "" {
		baseURL = cfg.baseURL
	}
	req, err := http.NewRequest("POST", strings.TrimRight(baseURL, "/")+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	if cfg.provider == "bedrock" {
		if err := signBedrockMantleRequest(req, body, cfg.apiKey); err != nil {
			return nil, err
		}
	} else {
		req.Header.Set("x-api-key", cfg.apiKey)
	}
	return req, nil
}

func streamClaude(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	if cfg.apiKey == "" {
		return fmt.Errorf("未配置 API Key")
	}
	if cfg.model == "" {
		return fmt.Errorf("未配置模型")
	}
	req, err := newClaudeHTTPRequest(msgs, cfg, true, 8192)
	if err != nil {
		return err
	}

	resp, err := httpClientLLMStream.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	scanner := bufio.NewScanner(resp.Body)
	parseFails := 0 // 累计解析失败数，超阈值即中止（H3）
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type     string `json:"type"`     // "text_delta" / "thinking_delta"
				Text     string `json:"text"`     // text_delta
				Thinking string `json:"thinking"` // thinking_delta
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			parseFails++
			log.Printf("[llm] Claude 流事件解析失败(%d)：%v；payload=%q", parseFails, err, truncate(payload, 200))
			if parseFails > maxStreamParseFails {
				return fmt.Errorf("响应流多次解析失败（%d 次），结果可能不完整，请重试", parseFails)
			}
			continue
		}
		if event.Type != "content_block_delta" {
			continue
		}
		switch event.Delta.Type {
		case "thinking_delta":
			if event.Delta.Thinking != "" {
				send(StreamChunk{Thinking: event.Delta.Thinking})
			}
		case "text_delta", "":
			if event.Delta.Text != "" {
				send(StreamChunk{Delta: event.Delta.Text})
			}
		}
	}
	return scanner.Err()
}

// ─── 非流式调用 ───────────────────────────────────────────────────────────────

// CompleteLLM 发起非流式请求，返回完整响应文本（用于分段摘要）
func CompleteLLM(msgs []LLMMessage, prefs Preferences) (string, error) {
	return CompleteLLMWithProfile(msgs, prefs, "")
}

func CompleteLLMWithProfile(msgs []LLMMessage, prefs Preferences, profileID string) (string, error) {
	// Demo 模式：AI 被锁死时直接返回 canned 响应，不走真实 provider
	if DemoMockActive() {
		return demoLLMComplete(msgs), nil
	}
	// Gemini OAuth：若已授权则用 OAuth token 替代 API Key
	if prefs.LLMProvider == "gemini" && prefs.GeminiAccessToken != "" {
		if token, err := geminiValidToken(&prefs); err == nil {
			prefs.LLMAPIKey = token
		}
	}
	cfg := llmConfigForProfile(profileID, prefs)
	// Demo 模式下拒绝内网 baseURL，防 SSRF（M2/L4）
	if err := guardOutboundURL(cfg.baseURL); err != nil {
		return "", err
	}
	t := startTimer("llm_complete")
	var (
		out string
		err error
	)
	switch cfg.provider {
	case "chatgpt":
		out, err = completeChatGPT(msgs, cfg)
	case "claude":
		out, err = completeClaudeSync(msgs, cfg)
	case "bedrock":
		out, err = completBedrockSync(msgs, cfg)
	case "vertex":
		out, err = completVertexSync(msgs, cfg)
	default:
		out, err = completeOpenAICompatSync(msgs, cfg)
	}
	t.Done(err,
		"provider", cfg.provider,
		"model", cfg.model,
		"msg_count", len(msgs),
		"prompt_chars", llmPromptChars(msgs),
		"resp_chars", len(out),
	)
	return out, err
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

	body, _ := json.Marshal(newOpenAIRequest(msgs, cfg, false))
	req, err := http.NewRequest("POST", cfg.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := httpClientLLMSync.Do(req)
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

	req, err := newClaudeHTTPRequest(msgs, cfg, false, 2048)
	if err != nil {
		return "", err
	}

	resp, err := httpClientLLMSync.Do(req)
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
	cfg := llmConfigForProfile("", prefs)

	return testLLMConfig(cfg)
}

func testLLMConfig(cfg llmConfig) (string, error) {
	if err := guardOutboundURL(cfg.baseURL); err != nil {
		return cfg.model, err
	}
	if cfg.baseURL == "" || cfg.model == "" {
		return "", fmt.Errorf("未配置 Base URL 或模型")
	}
	if cfg.apiKey == "" && cfg.provider != "ollama" {
		if cfg.provider == "chatgpt" {
			return cfg.model, fmt.Errorf("请先完成 ChatGPT 订阅授权")
		}
		return "", fmt.Errorf("未配置 API Key")
	}
	if cfg.provider == "chatgpt" {
		_, err := completeChatGPT([]LLMMessage{{Role: "user", Content: "Hi"}}, cfg)
		return cfg.model, err
	}

	// Bedrock / Vertex 走专用测试路径
	if cfg.provider == "bedrock" && !isBedrockMantle(cfg.baseURL) {
		result, err := completBedrockSync([]LLMMessage{{Role: "user", Content: "Hi"}}, cfg)
		if err != nil {
			return cfg.model, err
		}
		if result != "" {
			return cfg.model, nil
		}
		return cfg.model, fmt.Errorf("响应为空")
	}
	if cfg.provider == "vertex" {
		return testVertexConn(cfg)
	}

	var req *http.Request
	var err error
	if cfg.provider == "claude" || (cfg.provider == "bedrock" && isBedrockMantle(cfg.baseURL)) {
		req, err = newClaudeHTTPRequest([]LLMMessage{{Role: "user", Content: "Hi"}}, cfg, true, 2048)
	} else {
		body, _ := json.Marshal(newOpenAIRequest([]LLMMessage{{Role: "user", Content: "Hi"}}, cfg, true))
		req, err = http.NewRequest("POST", strings.TrimRight(cfg.baseURL, "/")+"/chat/completions", bytes.NewReader(body))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
		}
	}
	if err != nil {
		return cfg.model, err
	}

	resp, err := httpClientFast.Do(req)
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
			Type  string `json:"type"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		if event.Error != nil {
			return cfg.model, fmt.Errorf("模型响应错误：%s", event.Error.Message)
		}
		if event.Type == "message_start" || len(event.Choices) > 0 {
			// 收到第一个 chunk（不管内容是否为空），即表示模型在响应，连接正常
			return cfg.model, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return cfg.model, fmt.Errorf("读取响应失败：%w", err)
	}
	return cfg.model, fmt.Errorf("响应为空，未收到有效的模型数据")
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────────

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
