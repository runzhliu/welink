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

func TestAntigravityGatewayProfile(t *testing.T) {
	requests := 0
	mockLLMHTTP(t, func(req *http.Request) string {
		requests++
		if req.URL.String() != "http://localhost:8045/v1/chat/completions" {
			t.Fatalf("unexpected gateway URL: %s", req.URL)
		}
		if req.Header.Get("Authorization") != "Bearer gateway-test-key" {
			t.Fatal("gateway key was not sent")
		}
		var body openAIRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gateway-model" || len(body.Messages) == 0 {
			t.Fatalf("wrong model or messages: %+v", body)
		}
		if body.Stream {
			return "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n"
		}
		return `{"choices":[{"message":{"content":"hello"}}]}`
	})
	prefs := Preferences{LLMProfiles: []LLMProfile{{ID: "gateway", Provider: "antigravity", APIKey: "gateway-test-key", BaseURL: " http://localhost:8045/v1/ ", Model: "gateway-model"}}}
	cfg := llmConfigForProfile("gateway", prefs)
	if _, err := testLLMConfig(cfg); err != nil {
		t.Fatalf("connection test: %v", err)
	}
	var streamed string
	if err := dispatchLLMStream(func(c StreamChunk) { streamed += c.Delta }, []LLMMessage{{Role: "user", Content: "synthetic"}}, cfg); err != nil || streamed != "hello" {
		t.Fatalf("stream: %q, %v", streamed, err)
	}
	if got, err := CompleteLLMWithProfile([]LLMMessage{{Role: "user", Content: "synthetic"}}, prefs, "gateway"); err != nil || got != "hello" {
		t.Fatalf("completion: %q, %v", got, err)
	}
	if requests != 3 {
		t.Fatalf("expected 3 requests, got %d", requests)
	}
}

func TestAntigravityGatewayModelDiscovery(t *testing.T) {
	requests := 0
	mockLLMHTTP(t, func(req *http.Request) string {
		requests++
		if req.URL.String() != "http://localhost:8045/v1/models" || req.Header.Get("Authorization") != "Bearer gateway-test-key" {
			t.Fatal("incorrect gateway request")
		}
		return `{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"},{"id":""}]}`
	})
	cfg := llmConfig{provider: "antigravity", baseURL: "http://localhost:8045/v1", apiKey: "gateway-test-key"}
	models, err := antigravityGatewayModels(cfg)
	if err != nil || strings.Join(models, ",") != "model-a,model-b" || requests != 1 {
		t.Fatalf("models=%v requests=%d err=%v", models, requests, err)
	}
	cfg.baseURL = "http://user:secret@localhost:8045/v1"
	if _, err := antigravityGatewayModels(cfg); err == nil || requests != 1 {
		t.Fatal("embedded credentials must be rejected before request")
	}
	cfg.baseURL = "http://localhost:8045/v1"
	httpClientFast.Transport = llmTestTransport(func(req *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://untrusted.example/models"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})
	if _, err := antigravityGatewayModels(cfg); err == nil || requests != 2 {
		t.Fatal("gateway redirects must not be followed")
	}
}

func TestPreviewRejectsChangedOrRemovedProfile(t *testing.T) {
	prefs := Preferences{LLMProvider: "openai", LLMModel: "legacy", LLMProfiles: []LLMProfile{{ID: "one", Provider: "custom", Model: "example", BaseURL: "http://example.test/v1"}}}
	expected := llmExpectedProfile{Provider: "custom", Model: "example", BaseURL: "http://example.test/v1"}
	if !llmProfileMatches(prefs, "one", expected) {
		t.Fatal("unchanged profile rejected")
	}
	if llmProfileMatches(prefs, "removed", expected) {
		t.Fatal("removed profile must not fall back")
	}
	expected.BaseURL = "http://other.test/v1"
	if llmProfileMatches(prefs, "one", expected) {
		t.Fatal("changed endpoint accepted")
	}
	if !llmProfileMatches(prefs, "", llmExpectedProfile{Provider: "openai", Model: "legacy"}) {
		t.Fatal("legacy profile rejected")
	}
}
