package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

// antigravityGatewayModels talks to a user-selected OpenAI-compatible gateway;
// the key is a gateway key, not a Google subscription token.
func antigravityGatewayModels(cfg llmConfig) ([]string, error) {
	if cfg.baseURL == "" || cfg.apiKey == "" {
		return nil, fmt.Errorf("请先填写网关地址和网关 API Key")
	}
	u, err := url.Parse(cfg.baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("网关地址无效，请填写完整的 HTTP 或 HTTPS Base URL")
	}
	if err := guardOutboundURL(cfg.baseURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(cfg.baseURL, "/")+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("网关地址无效")
	}
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	client := *httpClientFast
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接网关，请检查地址、网络和网关状态")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("获取网关模型失败（HTTP %d），请检查密钥和网关状态", resp.StatusCode)
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&result); err != nil {
		return nil, fmt.Errorf("网关返回的模型列表格式无效")
	}
	seen := map[string]bool{}
	models := make([]string, 0, len(result.Data))
	for _, item := range result.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" && len(id) <= 256 && !seen[id] {
			seen[id] = true
			models = append(models, id)
		}
	}
	sort.Strings(models)
	return models, nil
}
