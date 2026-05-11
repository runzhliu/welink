package main

// image_providers.go — 生图 provider 元数据 + GET /api/image/providers 路由。
//
// 设计目的：让前端不必把每个 provider 的 default URL / model / 支持尺寸写死，
// 后端这边加一个 case 就把入口、选项全部带出去。和 LLM 那边把 PROVIDERS 列表
// 写在前端 SettingsPage 的做法不同 —— 因为 image 加新 provider 的频率比 LLM
// 更低（每次都涉及 base64 vs url、aspect-ratio 命名等差异），由后端权威化更稳。

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ImageProviderMeta 描述前端渲染 provider 选项 / model 选项 / 尺寸下拉所需的全部信息。
type ImageProviderMeta struct {
	Value          string             `json:"value"`           // 配置文件里写的 provider 标识
	Label          string             `json:"label"`           // 前端显示名
	DefaultBaseURL string             `json:"default_base_url"`
	DefaultModel  string              `json:"default_model"`
	Models         []ImageModelOption `json:"models"`          // 推荐模型清单，前端做下拉选
	Sizes          []string           `json:"sizes"`           // 支持的尺寸（前端做下拉选）
	KeyURL         string             `json:"key_url,omitempty"`   // 控制台跳转链接
	AuthHint       string             `json:"auth_hint,omitempty"` // 一句话告诉用户去哪儿拿 key
	PriceHint      string             `json:"price_hint,omitempty"`
}

// ImageModelOption 单个推荐模型的最小描述。
type ImageModelOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// imageProviders 返回所有内置 provider 的元数据。
// 加新 provider = 在这里加一行 + 在 image.go 的 switch 加一个 case。
func imageProviders() []ImageProviderMeta {
	return []ImageProviderMeta{
		{
			Value:          "doubao",
			Label:          "豆包 / 即梦（火山方舟）",
			DefaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
			DefaultModel:   "doubao-seedream-3-0-t2i-250415",
			Models: []ImageModelOption{
				{Value: "doubao-seedream-3-0-t2i-250415", Label: "Seedream 3.0（即梦，推荐）"},
			},
			Sizes:     []string{"1024x1024", "1024x1792", "1792x1024"},
			KeyURL:    "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
			AuthHint:  "火山方舟控制台 → API Key 管理（与豆包文本 Key 通用）",
			PriceHint: "约 0.05-0.2 元/张",
		},
		{
			Value:          "openai",
			Label:          "OpenAI",
			DefaultBaseURL: "https://api.openai.com/v1",
			DefaultModel:   "gpt-image-1",
			Models: []ImageModelOption{
				{Value: "gpt-image-1", Label: "gpt-image-1（推荐）"},
				{Value: "dall-e-3", Label: "DALL·E 3"},
			},
			Sizes:     []string{"1024x1024", "1024x1536", "1536x1024"},
			KeyURL:    "https://platform.openai.com/api-keys",
			AuthHint:  "OpenAI 平台 → API Keys",
			PriceHint: "gpt-image-1 约 $0.04/张 起",
		},
		{
			Value:          "siliconflow",
			Label:          "硅基流动 SiliconFlow（Flux）",
			DefaultBaseURL: "https://api.siliconflow.cn/v1",
			DefaultModel:   "black-forest-labs/FLUX.1-schnell",
			Models: []ImageModelOption{
				{Value: "black-forest-labs/FLUX.1-schnell", Label: "FLUX.1 schnell（快，便宜）"},
				{Value: "black-forest-labs/FLUX.1-dev", Label: "FLUX.1 dev"},
				{Value: "stabilityai/stable-diffusion-3-5-large", Label: "SD 3.5 large"},
			},
			Sizes:     []string{"1024x1024", "1024x1792", "1792x1024"},
			KeyURL:    "https://cloud.siliconflow.cn/account/ak",
			AuthHint:  "SiliconFlow 控制台 → API Key",
			PriceHint: "FLUX schnell 约 0.05 元/张",
		},
		{
			Value:          "gemini",
			Label:          "Google Gemini（Imagen）",
			DefaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
			DefaultModel:   "imagen-3.0-generate-002",
			Models: []ImageModelOption{
				{Value: "imagen-3.0-generate-002", Label: "Imagen 3"},
			},
			Sizes:    []string{"1024x1024", "1024x1792", "1792x1024"},
			KeyURL:   "https://aistudio.google.com/app/apikey",
			AuthHint: "Google AI Studio → API Key（与 Gemini 文本 Key 通用）",
		},
	}
}

// registerImageProvidersRoute 由 image_api.go 的 registerImageRoutes 一并挂载。
func registerImageProvidersRoute(prot *gin.RouterGroup) {
	prot.GET("/image/providers", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"providers": imageProviders()})
	})
}
