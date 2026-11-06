package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ChatGPT plan usage requires the Responses API, a full input history and a
// terminal response.completed event even for calls that appear synchronous.
func streamChatGPT(send func(StreamChunk), msgs []LLMMessage, cfg llmConfig) error {
	if cfg.apiKey == "" {
		return fmt.Errorf("请先完成 ChatGPT 订阅授权")
	}
	if cfg.model == "" {
		return fmt.Errorf("请选择 ChatGPT 模型")
	}
	input := make([]LLMMessage, 0, len(msgs))
	var instructions []string
	for _, m := range msgs {
		if m.Role == "system" || m.Role == "developer" {
			instructions = append(instructions, m.Content)
		} else if m.Role == "user" || m.Role == "assistant" {
			input = append(input, m)
		}
	}
	if len(input) == 0 {
		return fmt.Errorf("消息内容为空")
	}
	body, err := json.Marshal(struct {
		Model        string       `json:"model"`
		Input        []LLMMessage `json:"input"`
		Instructions string       `json:"instructions,omitempty"`
		Store        bool         `json:"store"`
		Stream       bool         `json:"stream"`
	}{cfg.model, input, strings.Join(instructions, "\n\n"), false, true})
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", chatGPTResource+"/responses", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClientLLMStream.Do(req)
	if err != nil {
		return fmt.Errorf("连接 OpenAI 失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("ChatGPT 请求失败（HTTP %d），请检查授权、模型或订阅额度", resp.StatusCode)
	}
	s := bufio.NewScanner(resp.Body)
	s.Buffer(make([]byte, 4096), 2<<20)
	completed := false
	for s.Scan() {
		line := s.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var e struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
			Error *struct {
				Code string `json:"code"`
			} `json:"error"`
			Response struct {
				Error *struct {
					Code string `json:"code"`
				} `json:"error"`
			} `json:"response"`
		}
		if json.Unmarshal([]byte(payload), &e) != nil {
			return fmt.Errorf("ChatGPT 返回的数据无法解析")
		}
		switch e.Type {
		case "response.output_text.delta":
			if e.Delta != "" {
				send(StreamChunk{Delta: e.Delta})
			}
		case "response.completed":
			completed = true
		case "response.failed", "response.incomplete", "error":
			code := ""
			if e.Error != nil {
				code = e.Error.Code
			}
			if e.Response.Error != nil {
				code = e.Response.Error.Code
			}
			if code == "subscription_sharing_usage_limit_exceeded" || code == "subscription_sharing_usage_unavailable" {
				return fmt.Errorf("ChatGPT 订阅额度已用完或暂不可用，请查看 ChatGPT 用量")
			}
			return fmt.Errorf("ChatGPT 未完成请求，请检查模型和授权")
		}
	}
	if err := s.Err(); err != nil {
		return fmt.Errorf("ChatGPT 响应中断：%w", err)
	}
	if !completed {
		return fmt.Errorf("ChatGPT 响应中断，未收到完成事件")
	}
	return nil
}

func completeChatGPT(msgs []LLMMessage, cfg llmConfig) (string, error) {
	var text strings.Builder
	err := streamChatGPT(func(c StreamChunk) { text.WriteString(c.Delta) }, msgs, cfg)
	if err != nil {
		return "", err
	}
	if text.Len() == 0 {
		return "", fmt.Errorf("ChatGPT 返回内容为空")
	}
	return text.String(), nil
}

func registerChatGPTModelsRoute(api *gin.RouterGroup) {
	api.GET("/auth/chatgpt/models", func(c *gin.Context) {
		if !chatGPTLocalOrigin(c) {
			c.Status(403)
			return
		}
		token, err := chatGPTValidToken()
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		req, _ := http.NewRequest("GET", chatGPTResource+"/models", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := httpClientFast.Do(req)
		if err != nil {
			c.JSON(502, gin.H{"error": "无法连接 OpenAI 模型列表"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			c.JSON(502, gin.H{"error": fmt.Sprintf("无法获取模型列表（HTTP %d）", resp.StatusCode)})
			return
		}
		var data struct {
			Models []struct {
				Slug       string `json:"slug"`
				Name       string `json:"display_name"`
				Visibility string `json:"visibility"`
			} `json:"models"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&data) != nil {
			c.JSON(502, gin.H{"error": "模型列表格式无效"})
			return
		}
		models := make([]gin.H, 0)
		for _, m := range data.Models {
			if m.Visibility == "list" && m.Slug != "" {
				models = append(models, gin.H{"slug": m.Slug, "name": m.Name})
			}
		}
		c.JSON(200, gin.H{"models": models})
	})
}
