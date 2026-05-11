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
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// base64StdDecode 是标准库 base64.StdEncoding.DecodeString 的薄壳，
// 留一层抽象方便将来兼容 URL-safe 编码。
func base64StdDecode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}

// ─── 配置 ─────────────────────────────────────────────────────────────────────

// ImageConfig 是文生图 API 的运行时配置。
type ImageConfig struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

// imageProviderDefaults 从 imageProviders() 元数据里查 provider 的默认 base URL + model。
// 集中放在元数据表，避免 image.go / image_providers.go 两边写两份。
func imageProviderDefaults(provider string) (defaultURL, defaultModel string) {
	for _, p := range imageProviders() {
		if p.Value == provider {
			return p.DefaultBaseURL, p.DefaultModel
		}
	}
	return "", ""
}

// defaultImageConfig 从 Preferences 构造 ImageConfig 并填充默认值。
// 默认 provider 为 doubao（火山方舟，OpenAI 兼容的 /images/generations）。
//
// 若用户配置了 ImageProfiles，取第一条作为默认；否则回退到老的单字段。
func defaultImageConfig(prefs Preferences) ImageConfig {
	cfg := imageConfigFromProfile(prefs, "")
	return cfg
}

// imageConfigFromProfile 按 profile_id 查找配置；
//   - profileID 非空且能命中 → 用那条 profile
//   - profileID 为空 → 取 ImageProfiles[0]
//   - ImageProfiles 也为空 → 回退到老的单字段 ImageProvider/ImageAPIKey/...
func imageConfigFromProfile(prefs Preferences, profileID string) ImageConfig {
	if profileID != "" {
		for _, p := range prefs.ImageProfiles {
			if p.ID == profileID {
				return fillImageDefaults(ImageConfig{
					Provider: p.Provider, APIKey: p.APIKey, BaseURL: p.BaseURL, Model: p.Model,
				})
			}
		}
	}
	if len(prefs.ImageProfiles) > 0 {
		p := prefs.ImageProfiles[0]
		return fillImageDefaults(ImageConfig{
			Provider: p.Provider, APIKey: p.APIKey, BaseURL: p.BaseURL, Model: p.Model,
		})
	}
	// 老用户回退：用单字段（向后兼容；migration 也会把它同步到 profiles[0]）
	return fillImageDefaults(ImageConfig{
		Provider: prefs.ImageProvider,
		APIKey:   prefs.ImageAPIKey,
		BaseURL:  prefs.ImageBaseURL,
		Model:    prefs.ImageModel,
	})
}

// fillImageDefaults 给 ImageConfig 补默认 provider / baseURL / model。
func fillImageDefaults(cfg ImageConfig) ImageConfig {
	if cfg.Provider == "" {
		cfg.Provider = "doubao"
	}
	defURL, defModel := imageProviderDefaults(cfg.Provider)
	if cfg.BaseURL == "" {
		cfg.BaseURL = defURL
	}
	if cfg.Model == "" {
		cfg.Model = defModel
	}
	return cfg
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

// GenerateImage 生成一张图，返回缓存 hash（前端用 GET /api/image/cache/:hash 取图）。
// size 推荐传 "1024x1024" / "1024x1792" / "1792x1024"，留空走 1024x1024。
//
// 命中本地缓存时跳过 API 调用，直接返回 hash。
//   - 先按 v2 公式找；找不到再按 v1 找老图（v1 留作历史缓存复用，新生成都走 v2）
func GenerateImage(prompt, size string, cfg ImageConfig) (string, error) {
	if size == "" {
		size = "1024x1024"
	}
	hashV2 := imageHashV2(cfg.Provider, cfg.Model, size, prompt)

	// 命中 v2 缓存
	if path, ok := imageCachePath(hashV2); ok {
		if _, err := os.Stat(path); err == nil {
			return hashV2, nil
		}
	}
	// 兼容老 v1 缓存：同样的 (provider, model, size, prompt) 老格式如果有图就复用，
	// 避免升级后已有图全部失效重出。但不再新生成 v1。
	if hashV1 := imageHashV1(cfg.Provider, cfg.Model, size, prompt); hashV1 != hashV2 {
		if path, ok := imageCachePath(hashV1); ok {
			if _, err := os.Stat(path); err == nil {
				return hashV1, nil
			}
		}
	}

	// Demo 模式：写一张 SVG 占位图，不调真 provider
	if DemoMockActive() {
		if err := writeDemoImage(hashV2, prompt); err != nil {
			return "", err
		}
		return hashV2, nil
	}

	t := startTimer("image_generate")
	var (
		bin []byte
		err error
	)
	switch cfg.Provider {
	case "doubao":
		bin, err = doubaoGenerateImage(prompt, size, cfg)
	case "openai":
		bin, err = openaiGenerateImage(prompt, size, cfg)
	case "siliconflow":
		bin, err = openaiCompatGenerateImage(prompt, size, cfg) // SiliconFlow 与 OpenAI 兼容
	case "gemini":
		bin, err = geminiGenerateImage(prompt, size, cfg)
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
	if err := writeImageCache(hashV2, bin); err != nil {
		return "", fmt.Errorf("写入缓存失败：%w", err)
	}
	return hashV2, nil
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
	return downloadImageBytes(parsed.Data[0].URL)
}

// ─── OpenAI gpt-image-1 / DALL·E ──────────────────────────────────────────────

type openaiImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	Size           string `json:"size"`
	N              int    `json:"n"`
	ResponseFormat string `json:"response_format,omitempty"` // url（默认）/ b64_json；gpt-image-1 仅返回 b64_json
}

type openaiImageResponse struct {
	Data []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json,omitempty"`
	} `json:"data"`
	Error struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

// openaiGenerateImage 走官方 OpenAI /v1/images/generations。
// gpt-image-1 默认只返回 b64_json；DALL·E 3 返回 url；两种都处理。
func openaiGenerateImage(prompt, size string, cfg ImageConfig) ([]byte, error) {
	return openaiLikeGenerateImage(prompt, size, cfg, true)
}

// openaiCompatGenerateImage 走"声称 OpenAI 兼容"的 provider（SiliconFlow / 其它聚合网关）。
// 与官方差别：不指定 response_format，让 provider 自己决定（多数返回 url）。
func openaiCompatGenerateImage(prompt, size string, cfg ImageConfig) ([]byte, error) {
	return openaiLikeGenerateImage(prompt, size, cfg, false)
}

// openaiLikeGenerateImage 复用 OpenAI 系（/images/generations）的公共逻辑。
// preferB64=true 时显式请求 b64_json，省一次外部下载；为 false 时让 provider 自定。
func openaiLikeGenerateImage(prompt, size string, cfg ImageConfig, preferB64 bool) ([]byte, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("未配置生图 API Key")
	}
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("未配置生图 Base URL")
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("未配置生图模型")
	}

	reqBody := openaiImageRequest{
		Model:  cfg.Model,
		Prompt: prompt,
		Size:   size,
		N:      1,
	}
	if preferB64 {
		reqBody.ResponseFormat = "b64_json"
	}
	body, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", cfg.BaseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := httpClientLLMSync.Do(req)
	if err != nil {
		return nil, fmt.Errorf("生图请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("生图 API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var parsed openaiImageResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("解析生图响应失败：%w", err)
	}
	if parsed.Error.Message != "" {
		return nil, fmt.Errorf("生图 API 错误：%s", parsed.Error.Message)
	}
	if len(parsed.Data) == 0 {
		return nil, fmt.Errorf("生图 API 返回空")
	}
	first := parsed.Data[0]
	if first.B64JSON != "" {
		return decodeBase64Image(first.B64JSON)
	}
	if first.URL != "" {
		return downloadImageBytes(first.URL)
	}
	return nil, fmt.Errorf("生图 API 返回空（无 url 也无 b64_json）")
}

// ─── Google Gemini Imagen ─────────────────────────────────────────────────────

type geminiImagenRequest struct {
	Instances  []geminiImagenInstance  `json:"instances"`
	Parameters geminiImagenParameters `json:"parameters"`
}

type geminiImagenInstance struct {
	Prompt string `json:"prompt"`
}

type geminiImagenParameters struct {
	SampleCount int    `json:"sampleCount"`
	AspectRatio string `json:"aspectRatio,omitempty"` // 1:1 / 9:16 / 16:9 / 3:4 / 4:3
}

type geminiImagenResponse struct {
	Predictions []struct {
		BytesBase64Encoded string `json:"bytesBase64Encoded"`
		MimeType           string `json:"mimeType"`
	} `json:"predictions"`
	Error struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// sizeToAspectRatio 把 "WxH" 转成 Imagen 的 aspectRatio 字符串。
// Imagen 3 只支持 1:1 / 9:16 / 16:9 / 3:4 / 4:3 几个固定比例，做最近邻映射。
func sizeToAspectRatio(size string) string {
	switch size {
	case "1024x1024":
		return "1:1"
	case "1024x1792", "9x16":
		return "9:16"
	case "1792x1024", "16x9":
		return "16:9"
	case "1024x1536", "3x4":
		return "3:4"
	case "1536x1024", "4x3":
		return "4:3"
	}
	return "1:1"
}

// geminiGenerateImage 走 Generative Language API 的 :predict 端点。
// 走 ?key= 鉴权（与 LLM 那边 Gemini OAuth 走的端点不同，走 OAuth 时需要单独适配）。
func geminiGenerateImage(prompt, size string, cfg ImageConfig) ([]byte, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("未配置生图 API Key")
	}
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("未配置生图 Base URL")
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("未配置生图模型")
	}

	body, _ := json.Marshal(geminiImagenRequest{
		Instances:  []geminiImagenInstance{{Prompt: prompt}},
		Parameters: geminiImagenParameters{SampleCount: 1, AspectRatio: sizeToAspectRatio(size)},
	})
	url := fmt.Sprintf("%s/models/%s:predict?key=%s", cfg.BaseURL, cfg.Model, cfg.APIKey)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClientLLMSync.Do(req)
	if err != nil {
		return nil, fmt.Errorf("生图请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("生图 API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var parsed geminiImagenResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("解析生图响应失败：%w", err)
	}
	if parsed.Error.Message != "" {
		return nil, fmt.Errorf("生图 API 错误：%s", parsed.Error.Message)
	}
	if len(parsed.Predictions) == 0 || parsed.Predictions[0].BytesBase64Encoded == "" {
		return nil, fmt.Errorf("生图 API 返回空（无 predictions）")
	}
	return decodeBase64Image(parsed.Predictions[0].BytesBase64Encoded)
}

// ─── 公共下载 / base64 解码 ───────────────────────────────────────────────────

// downloadImageBytes 拉取一个公网图片 URL，返回字节流。
// 用于 doubao 这种返回临时 URL 的 provider。
func downloadImageBytes(imgURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", imgURL, nil) // #nosec G107 — URL 来自受信 LLM provider
	if err != nil {
		return nil, err
	}
	resp, err := httpClientFast.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载生图结果失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载生图结果状态码 %d", resp.StatusCode)
	}
	bin, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取生图字节失败：%w", err)
	}
	return bin, nil
}

// decodeBase64Image 解码 OpenAI / Gemini 返回的 b64_json。
func decodeBase64Image(b64 string) ([]byte, error) {
	bin, err := base64StdDecode(b64)
	if err != nil {
		return nil, fmt.Errorf("解码 base64 图片失败：%w", err)
	}
	return bin, nil
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

// imageHashV1 是历史 hash 公式（不带版本号前缀），保留只为兼容老图。
// 新生成的图都走 imageHashV2。等大约 90 天后所有用户的老图被新 v2 取代，可以删掉。
func imageHashV1(provider, model, size, prompt string) string {
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

// imageHashV2 是新公式：在 v1 基础上加版本前缀。
// 后续 Phase 2/3 若要把 negative_prompt / seed 等纳入 key，
// 升到 v3 时只要再加一个 imageHashV3，老 v2 图继续命中。
func imageHashV2(provider, model, size, prompt string) string {
	h := sha256.New()
	h.Write([]byte("v2"))
	h.Write([]byte{0})
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
