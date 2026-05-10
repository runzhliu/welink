package main

// image.go — AI 文生图（Text-to-Image）。
//
// 设计参照 embedding.go：用 ImageConfig + switch 分发到各 provider，
// 不抽 interface（项目里只有 embedding/llm 是这种风格，保持一致）。
//
// 缓存策略：
//   sha256(provider|model|size|prompt) → ~/.welink/ai_images/<hash>.png
// 命中直接返回 hash，前端用 GET /api/image/cache/:hash 拿图。
// 必须缓存到本地的原因：
//   1. 火山方舟返回的 URL 24 小时过期，不能丢给前端长期持有
//   2. 前端导出分享卡（html-to-image）要求图片同源，否则 canvas 被污染

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// ─── 配置 ─────────────────────────────────────────────────────────────────────

// ImageConfig 是文生图 API 的运行时配置。
type ImageConfig struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

// defaultImageConfig 从 Preferences 构造 ImageConfig 并填充默认值。
// 默认 provider 为 doubao（火山方舟，OpenAI 兼容的 /images/generations）。
func defaultImageConfig(prefs Preferences) ImageConfig {
	cfg := ImageConfig{
		Provider: prefs.ImageProvider,
		APIKey:   prefs.ImageAPIKey,
		BaseURL:  prefs.ImageBaseURL,
		Model:    prefs.ImageModel,
	}
	if cfg.Provider == "" {
		cfg.Provider = "doubao"
	}
	switch cfg.Provider {
	case "doubao":
		// 火山方舟 Ark，OpenAI 兼容 /images/generations
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://ark.cn-beijing.volces.com/api/v3"
		}
		if cfg.Model == "" {
			cfg.Model = "doubao-seedream-3-0-t2i-250415"
		}
	}
	return cfg
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

// GenerateImage 生成一张图，返回缓存 hash（前端用 GET /api/image/cache/:hash 取图）。
// size 推荐传 "1024x1024" / "1024x1792" / "1792x1024"，留空走 1024x1024。
//
// 命中本地缓存时跳过 API 调用，直接返回 hash。
func GenerateImage(prompt, size string, cfg ImageConfig) (string, error) {
	if size == "" {
		size = "1024x1024"
	}
	hash := imageHash(cfg.Provider, cfg.Model, size, prompt)

	// 命中缓存
	if path, ok := imageCachePath(hash); ok {
		if _, err := os.Stat(path); err == nil {
			return hash, nil
		}
	}

	// Demo 模式：写一张 SVG 占位图，不调真 provider
	if DemoMockActive() {
		if err := writeDemoImage(hash, prompt); err != nil {
			return "", err
		}
		return hash, nil
	}

	t := startTimer("image_generate")
	var (
		bin []byte
		err error
	)
	switch cfg.Provider {
	case "doubao":
		bin, err = doubaoGenerateImage(prompt, size, cfg)
	default:
		err = fmt.Errorf("不支持的生图 provider：%s", cfg.Provider)
	}
	t.Done(err,
		"provider", cfg.Provider,
		"model", cfg.Model,
		"size", size,
		"prompt_chars", len(prompt),
		"bytes", len(bin),
	)
	if err != nil {
		return "", err
	}
	if err := writeImageCache(hash, bin); err != nil {
		return "", fmt.Errorf("写入缓存失败：%w", err)
	}
	return hash, nil
}

// ─── 火山方舟（豆包/即梦）实现 ─────────────────────────────────────────────────

type doubaoImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	Size           string `json:"size"`
	ResponseFormat string `json:"response_format,omitempty"` // url（默认）/ b64_json
}

type doubaoImageResponse struct {
	Data []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json,omitempty"`
	} `json:"data"`
	Error struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

// doubaoGenerateImage 走火山方舟 Ark 的 OpenAI 兼容生图端点。
// 返回 PNG 字节流；URL 24 小时过期，必须立即下载。
func doubaoGenerateImage(prompt, size string, cfg ImageConfig) ([]byte, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("未配置生图 API Key")
	}
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("未配置生图 Base URL")
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("未配置生图模型")
	}

	body, _ := json.Marshal(doubaoImageRequest{
		Model:  cfg.Model,
		Prompt: prompt,
		Size:   size,
	})
	req, err := http.NewRequest("POST", cfg.BaseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	// 生图比 embedding 慢，复用 LLMSync 的 5 分钟超时
	resp, err := httpClientLLMSync.Do(req)
	if err != nil {
		return nil, fmt.Errorf("生图请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("生图 API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var parsed doubaoImageResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("解析生图响应失败：%w", err)
	}
	if parsed.Error.Message != "" {
		return nil, fmt.Errorf("生图 API 错误：%s", parsed.Error.Message)
	}
	if len(parsed.Data) == 0 || parsed.Data[0].URL == "" {
		return nil, fmt.Errorf("生图 API 返回空")
	}

	// 下载图片字节
	imgURL := parsed.Data[0].URL
	imgReq, err := http.NewRequest("GET", imgURL, nil) // #nosec G107 — URL 来自受信 LLM provider
	if err != nil {
		return nil, err
	}
	imgResp, err := httpClientFast.Do(imgReq)
	if err != nil {
		return nil, fmt.Errorf("下载生图结果失败：%w", err)
	}
	defer imgResp.Body.Close()
	if imgResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载生图结果状态码 %d", imgResp.StatusCode)
	}
	bin, err := io.ReadAll(imgResp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取生图字节失败：%w", err)
	}
	return bin, nil
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

// imageHash 把 provider+model+size+prompt 哈希成稳定的缓存 key。
func imageHash(provider, model, size, prompt string) string {
	h := sha256.New()
	h.Write([]byte(provider))
	h.Write([]byte{0})
	h.Write([]byte(model))
	h.Write([]byte{0})
	h.Write([]byte(size))
	h.Write([]byte{0})
	h.Write([]byte(prompt))
	return hex.EncodeToString(h.Sum(nil))
}

// imageCacheDir 返回缓存目录 ~/.welink/ai_images。失败时返回 ""。
func imageCacheDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".welink", "ai_images")
}

// imageCachePath 返回 hash 对应的本地路径，第二个返回值表示路径是否可用。
// hash 必须是 64 字符的十六进制（防止路径穿越）。
func imageCachePath(hash string) (string, bool) {
	if !isHexHash(hash) {
		return "", false
	}
	dir := imageCacheDir()
	if dir == "" {
		return "", false
	}
	return filepath.Join(dir, hash+".png"), true
}

func isHexHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// writeImageCache 把字节落盘到 ~/.welink/ai_images/<hash>.png。
func writeImageCache(hash string, data []byte) error {
	path, ok := imageCachePath(hash)
	if !ok {
		return fmt.Errorf("无效缓存路径")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// writeDemoImage 在 Demo 模式生成一张占位 SVG（伪装成 .png 也能被 <img> 渲染，
// 浏览器靠 Content-Type 识别，cache handler 会用 DetectContentType 兜底）。
func writeDemoImage(hash, prompt string) error {
	short := prompt
	if len([]rune(short)) > 24 {
		short = string([]rune(short)[:24]) + "…"
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0%%" y1="0%%" x2="100%%" y2="100%%">
      <stop offset="0%%" stop-color="#a78bfa"/>
      <stop offset="100%%" stop-color="#fbcfe8"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <text x="512" y="500" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="48" font-weight="600">Demo Image</text>
  <text x="512" y="560" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="28" opacity="0.85">%s</text>
</svg>`, htmlEscape(short))
	return writeImageCache(hash, []byte(svg))
}

// htmlEscape 防止 prompt 内有特殊字符破坏 SVG。
func htmlEscape(s string) string {
	out := make([]byte, 0, len(s))
	for _, r := range s {
		switch r {
		case '<':
			out = append(out, "&lt;"...)
		case '>':
			out = append(out, "&gt;"...)
		case '&':
			out = append(out, "&amp;"...)
		case '"':
			out = append(out, "&quot;"...)
		default:
			out = append(out, string(r)...)
		}
	}
	return string(out)
}
