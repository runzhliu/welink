package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type llmTestTransport func(*http.Request) (*http.Response, error)

func (f llmTestTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func mockLLMHTTP(t *testing.T, respond func(*http.Request) string) {
	t.Helper()
	client := &http.Client{Transport: llmTestTransport(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(respond(req)))}, nil
	})}
	stream, sync, fast := httpClientLLMStream, httpClientLLMSync, httpClientFast
	httpClientLLMStream, httpClientLLMSync, httpClientFast = client, client, client
	t.Cleanup(func() { httpClientLLMStream, httpClientLLMSync, httpClientFast = stream, sync, fast })
}

func TestClaudeThinkingCompatibility(t *testing.T) {
	for _, model := range []string{"claude-opus-5-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929"} {
		for _, stream := range []bool{false, true} {
			cfg := llmConfig{model: model, reasoningEffort: "high"}
			body := newClaudeRequest([]LLMMessage{{Role: "system", Content: "system"}, {Role: "user", Content: "hello"}}, cfg, stream, 2048)
			if body.System != "system" || len(body.Messages) != 1 || body.Messages[0].Role != "user" || body.Stream != stream {
				t.Fatalf("incorrect message conversion: %+v", body)
			}
			raw, _ := json.Marshal(body)
			if model == "claude-sonnet-4-5-20250929" {
				if body.Thinking.Type != "enabled" || body.Thinking.BudgetTokens != 16384 || body.MaxTokens <= body.Thinking.BudgetTokens || body.OutputConfig != nil {
					t.Fatalf("legacy thinking lost compatibility: %s", raw)
				}
			} else if body.Thinking.Type != "adaptive" || body.OutputConfig.Effort != "high" || strings.Contains(string(raw), "budget_tokens") {
				t.Fatalf("new Claude received unsupported thinking parameters: %s", raw)
			}
		}
	}
	for _, effort := range []string{"", "off"} {
		body := newClaudeRequest(nil, llmConfig{model: "claude-opus-5-5", reasoningEffort: effort}, false, 2048)
		if body.Thinking != nil || body.OutputConfig != nil {
			t.Fatal("model defaults should be left to the provider")
		}
	}
}

func TestLLMProfileConnectionUsesActualConfiguration(t *testing.T) {
	for _, provider := range []string{"claude", "openai", "minimax", "ollama", "bedrock"} {
		t.Run(provider, func(t *testing.T) {
			prefs := Preferences{LLMProfiles: []LLMProfile{{ID: "active", Provider: provider, APIKey: "test-key", NoThink: true, ReasoningEffort: "high"}}}
			if provider == "bedrock" {
				prefs.LLMProfiles[0].APIKey = "test-access:test-secret"
			}
			cfg := llmConfigForProfile("active", prefs)
			called := false
			mockLLMHTTP(t, func(req *http.Request) string {
				called = true
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body["model"] != cfg.model || body["stream"] != true {
					t.Fatalf("incorrect resolved configuration: %+v", body)
				}
				if provider == "claude" || provider == "bedrock" {
					if !strings.HasSuffix(req.URL.Path, "/v1/messages") || body["output_config"].(map[string]any)["effort"] != "high" {
						t.Fatalf("native Messages API not used: %s %+v", req.URL, body)
					}
					if provider == "claude" && req.Header.Get("x-api-key") != "test-key" {
						t.Fatal("missing Anthropic API key")
					}
					if provider == "bedrock" && (!strings.Contains(req.Header.Get("Authorization"), "/us-east-1/bedrock-mantle/aws4_request") || req.Header.Get("x-api-key") != "") {
						t.Fatal("incorrect Mantle authentication")
					}
					return "data: {\"type\":\"message_start\",\"message\":{}}\n\n"
				}
				if !strings.HasSuffix(req.URL.Path, "/chat/completions") {
					t.Fatalf("incorrect OpenAI compatible endpoint: %s", req.URL)
				}
				if provider == "ollama" {
					if body["think"] != false || len(body["stop"].([]any)) == 0 {
						t.Fatal("Ollama test lost no_think or stop settings")
					}
				} else if body["reasoning_effort"] != "high" || body["think"] != nil {
					t.Fatalf("reasoning settings were lost or Ollama settings leaked: %+v", body)
				}
				return "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\n"
			})
			model, err := testLLMConnProfile("active", prefs)
			if err != nil || model != cfg.model || !called {
				t.Fatalf("model=%q err=%v called=%v", model, err, called)
			}
		})
	}
}

func TestLLMConnectionRejectsInvalidStreams(t *testing.T) {
	for _, response := range []string{"", "data: [DONE]\n\n", "data: {\"error\":{\"message\":\"model unavailable\"}}\n\n"} {
		t.Run(response, func(t *testing.T) {
			mockLLMHTTP(t, func(*http.Request) string { return response })
			if _, err := testLLMConn(Preferences{LLMProvider: "openai", LLMAPIKey: "test"}); err == nil {
				t.Fatal("empty/error stream must not report connection success")
			}
		})
	}
}

func TestBedrockMantleStreamAndSync(t *testing.T) {
	cfg := llmConfig{provider: "bedrock", apiKey: "test-access:test-secret", reasoningEffort: "medium"}
	defaultsFor(&cfg)
	requests := 0
	mockLLMHTTP(t, func(req *http.Request) string {
		requests++
		if req.URL.Path != "/anthropic/v1/messages" || req.URL.Hostname() != "bedrock-mantle.us-east-1.api.aws" {
			t.Fatalf("incorrect Mantle URL: %s", req.URL)
		}
		if !strings.Contains(req.Header.Get("Authorization"), "/bedrock-mantle/aws4_request") {
			t.Fatal("missing Mantle SigV4 signature")
		}
		var body claudeRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Stream {
			return "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n"
		}
		return `{"content":[{"type":"text","text":"hello"}]}`
	})
	var text string
	if err := streamBedrock(func(chunk StreamChunk) { text += chunk.Delta }, []LLMMessage{{Role: "user", Content: "Hi"}}, cfg); err != nil || text != "hello" {
		t.Fatalf("stream text=%q err=%v", text, err)
	}
	if text, err := completBedrockSync([]LLMMessage{{Role: "user", Content: "Hi"}}, cfg); err != nil || text != "hello" || requests != 2 {
		t.Fatalf("sync text=%q err=%v requests=%d", text, err, requests)
	}
	legacy := llmConfig{provider: "bedrock", model: "us.anthropic.claude-sonnet-4-6"}
	defaultsFor(&legacy)
	if isBedrockMantle(legacy.baseURL) || legacy.model != "us.anthropic.claude-sonnet-4-6" {
		t.Fatal("explicit legacy models must retain their Runtime configuration")
	}
	legacy = llmConfig{provider: "bedrock", baseURL: "https://bedrock-runtime.eu-west-1.amazonaws.com"}
	defaultsFor(&legacy)
	if legacy.baseURL != "https://bedrock-runtime.eu-west-1.amazonaws.com" || legacy.model != "" {
		t.Fatal("an explicit Runtime endpoint must not receive a Mantle-only default model")
	}
}

func TestOpenAIReasoningContentStream(t *testing.T) {
	mockLLMHTTP(t, func(*http.Request) string {
		return "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\",\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n"
	})
	cfg := llmConfig{provider: "minimax", apiKey: "test"}
	defaultsFor(&cfg)
	var thinking, answer string
	err := streamOpenAICompat(func(chunk StreamChunk) { thinking += chunk.Thinking; answer += chunk.Delta }, nil, cfg)
	if err != nil || thinking != "thinking" || answer != "answer" {
		t.Fatalf("thinking=%q answer=%q err=%v", thinking, answer, err)
	}
}
