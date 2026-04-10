package main

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─── AWS Signature V4 ────────────────────────────────────────────────────────

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// signAWSRequest signs an HTTP request with AWS Signature V4.
func signAWSRequest(req *http.Request, body []byte, region, service, accessKey, secretKey string) {
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")

	req.Header.Set("x-amz-date", amzDate)

	payloadHash := sha256Hex(body)
	req.Header.Set("x-amz-content-sha256", payloadHash)

	// Canonical request
	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
		req.Header.Get("Content-Type"), req.Host, payloadHash, amzDate)
	signedHeaders := "content-type;host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		req.Method, req.URL.Path, req.URL.RawQuery,
		canonicalHeaders, signedHeaders, payloadHash)

	// String to sign
	credentialScope := fmt.Sprintf("%s/%s/%s/aws4_request", dateStamp, region, service)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s",
		amzDate, credentialScope, sha256Hex([]byte(canonicalRequest)))

	// Signing key
	kDate := hmacSHA256([]byte("AWS4"+secretKey), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	kSigning := hmacSHA256(kService, "aws4_request")

	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature))
}

// ─── Bedrock Streaming ───────────────────────────────────────────────────────

// bedrockRequest matches the Anthropic Messages API format used by Bedrock's invoke-model.
type bedrockRequest struct {
	AnthropicVersion string       `json:"anthropic_version"`
	MaxTokens        int          `json:"max_tokens"`
	System           string       `json:"system,omitempty"`
	Messages         []LLMMessage `json:"messages"`
}

func streamBedrock(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	if cfg.apiKey == "" {
		return fmt.Errorf("未配置 AWS Access Key（格式：accessKeyId:secretAccessKey）")
	}

	// Parse apiKey as "accessKeyId:secretAccessKey"
	parts := strings.SplitN(cfg.apiKey, ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("AWS 凭证格式错误，请使用 accessKeyId:secretAccessKey 格式")
	}
	accessKey, secretKey := parts[0], parts[1]

	if cfg.model == "" {
		return fmt.Errorf("未配置模型")
	}

	// Extract region from baseURL or default to us-east-1
	region := "us-east-1"
	if cfg.baseURL != "" {
		// Parse region from URL like "https://bedrock-runtime.us-east-1.amazonaws.com"
		if idx := strings.Index(cfg.baseURL, "bedrock-runtime."); idx >= 0 {
			rest := cfg.baseURL[idx+len("bedrock-runtime."):]
			if dotIdx := strings.Index(rest, "."); dotIdx > 0 {
				region = rest[:dotIdx]
			}
		}
	}

	// Separate system message
	var system string
	var userMsgs []LLMMessage
	for _, m := range msgs {
		if m.Role == "system" {
			system = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	body, _ := json.Marshal(bedrockRequest{
		AnthropicVersion: "bedrock-2023-05-31",
		MaxTokens:        8192,
		System:           system,
		Messages:         userMsgs,
	})

	baseURL := fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com", region)
	if cfg.baseURL != "" {
		baseURL = strings.TrimRight(cfg.baseURL, "/")
	}
	url := fmt.Sprintf("%s/model/%s/invoke-with-response-stream", baseURL, cfg.model)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/vnd.amazon.eventstream")

	signAWSRequest(req, body, region, "bedrock", accessKey, secretKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	// Bedrock invoke-with-response-stream returns AWS event stream format.
	// Each event contains a JSON chunk with type and delta fields similar to Claude's API.
	// We parse line by line looking for content_block_delta events.
	scanner := bufio.NewScanner(resp.Body)
	// Increase buffer size for large chunks
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()

		// The event stream format embeds JSON in binary frames.
		// Look for JSON objects containing content_block_delta.
		// Bedrock wraps Claude responses - we need to find the bytes payload.
		if !strings.Contains(line, "content_block_delta") && !strings.Contains(line, "text_delta") {
			continue
		}

		// Try to extract JSON from the line
		startIdx := strings.Index(line, "{")
		if startIdx < 0 {
			continue
		}

		jsonStr := line[startIdx:]
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Bytes string `json:"bytes"` // base64-encoded event payload
		}
		if err := json.Unmarshal([]byte(jsonStr), &event); err != nil {
			continue
		}
		if event.Delta.Text != "" {
			send(StreamChunk{Delta: event.Delta.Text})
		}
	}
	return scanner.Err()
}

func completBedrockSync(msgs []LLMMessage, cfg llmConfig) (string, error) {
	if cfg.apiKey == "" {
		return "", fmt.Errorf("未配置 AWS Access Key（格式：accessKeyId:secretAccessKey）")
	}
	parts := strings.SplitN(cfg.apiKey, ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", fmt.Errorf("AWS 凭证格式错误，请使用 accessKeyId:secretAccessKey 格式")
	}
	accessKey, secretKey := parts[0], parts[1]

	if cfg.model == "" {
		return "", fmt.Errorf("未配置模型")
	}

	region := "us-east-1"
	if cfg.baseURL != "" {
		if idx := strings.Index(cfg.baseURL, "bedrock-runtime."); idx >= 0 {
			rest := cfg.baseURL[idx+len("bedrock-runtime."):]
			if dotIdx := strings.Index(rest, "."); dotIdx > 0 {
				region = rest[:dotIdx]
			}
		}
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

	body, _ := json.Marshal(bedrockRequest{
		AnthropicVersion: "bedrock-2023-05-31",
		MaxTokens:        2048,
		System:           system,
		Messages:         userMsgs,
	})

	baseURL := fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com", region)
	if cfg.baseURL != "" {
		baseURL = strings.TrimRight(cfg.baseURL, "/")
	}
	url := fmt.Sprintf("%s/model/%s/invoke", baseURL, cfg.model)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	signAWSRequest(req, body, region, "bedrock", accessKey, secretKey)

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
