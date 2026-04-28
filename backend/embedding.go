package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
)

// ─── 配置 ─────────────────────────────────────────────────────────────────────

// EmbeddingConfig 是向量化 API 的运行时配置。
type EmbeddingConfig struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
	Dims     int
}

// defaultEmbeddingConfig 从 Preferences 构造 EmbeddingConfig 并填充各 provider 默认值。
// 默认 provider 为 ollama（本地免费）。
func defaultEmbeddingConfig(prefs Preferences) EmbeddingConfig {
	cfg := EmbeddingConfig{
		Provider: prefs.EmbeddingProvider,
		APIKey:   prefs.EmbeddingAPIKey,
		BaseURL:  prefs.EmbeddingBaseURL,
		Model:    prefs.EmbeddingModel,
		Dims:     prefs.EmbeddingDims,
	}
	if cfg.Provider == "" {
		cfg.Provider = "ollama"
	}
	switch cfg.Provider {
	case "ollama":
		if cfg.BaseURL == "" {
			cfg.BaseURL = "http://localhost:11434"
		}
		if cfg.Model == "" {
			cfg.Model = "nomic-embed-text"
		}
		if cfg.Dims == 0 {
			cfg.Dims = 768
		}
	case "openai":
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
		if cfg.Model == "" {
			cfg.Model = "text-embedding-3-small"
		}
		if cfg.Dims == 0 {
			cfg.Dims = 1536
		}
	case "jina":
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.jina.ai/v1"
		}
		if cfg.Model == "" {
			cfg.Model = "jina-embeddings-v3"
		}
		if cfg.Dims == 0 {
			cfg.Dims = 1024
		}
	}
	return cfg
}

// ─── API 调用 ──────────────────────────────────────────────────────────────────

// GetEmbeddingsBatch 批量获取 texts 的向量。
// Ollama 使用 /api/embed（支持批量），其他 provider 使用 OpenAI 兼容的 /embeddings。
func GetEmbeddingsBatch(texts []string, cfg EmbeddingConfig) ([][]float32, error) {
	// Demo 模式：用确定性 mock 向量（和 demo_seed 存的一致，保证相似度能算）
	if DemoMockActive() {
		out := make([][]float32, len(texts))
		for i, t := range texts {
			out[i] = hashedMockEmbedding(t, 8)
		}
		return out, nil
	}
	t := startTimer("embed_batch")
	var (
		vecs [][]float32
		err  error
	)
	if cfg.Provider == "ollama" {
		vecs, err = ollamaEmbeddingsBatch(texts, cfg)
	} else {
		vecs, err = openAIEmbeddingsBatch(texts, cfg)
	}
	t.Done(err,
		"provider", cfg.Provider,
		"model", cfg.Model,
		"batch_size", len(texts),
		"dims", cfg.Dims,
	)
	return vecs, err
}

func openAIEmbeddingsBatch(texts []string, cfg EmbeddingConfig) ([][]float32, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("未配置 Embedding API Key")
	}
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("未配置 Embedding Base URL")
	}
	body, _ := json.Marshal(map[string]any{
		"model": cfg.Model,
		"input": texts,
	})
	req, err := http.NewRequest("POST", cfg.BaseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding 请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析 embedding 响应失败：%w", err)
	}

	embeddings := make([][]float32, len(texts))
	for _, d := range result.Data {
		if d.Index < len(embeddings) {
			embeddings[d.Index] = d.Embedding
		}
	}
	return embeddings, nil
}

func ollamaEmbeddingsBatch(texts []string, cfg EmbeddingConfig) ([][]float32, error) {
	// /api/embed 自 Ollama 0.1.31 起支持批量 input
	body, _ := json.Marshal(map[string]any{
		"model": cfg.Model,
		"input": texts,
	})
	req, err := http.NewRequest("POST", cfg.BaseURL+"/api/embed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Ollama embedding 请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Ollama embedding 错误 %d：%s", resp.StatusCode, truncate(string(raw), 200))
	}

	var result struct {
		Embeddings [][]float32 `json:"embeddings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析 Ollama embedding 响应失败：%w", err)
	}
	return result.Embeddings, nil
}

// ─── 向量运算 ──────────────────────────────────────────────────────────────────

// cosineSimilarity 计算两个 float32 向量的余弦相似度（纯 Go，无 CGO）。
func cosineSimilarity(a, b []float32) float32 {
	var dot, normA, normB float64
	for i := range a {
		ai, bi := float64(a[i]), float64(b[i])
		dot += ai * bi
		normA += ai * ai
		normB += bi * bi
	}
	denom := math.Sqrt(normA) * math.Sqrt(normB)
	if denom == 0 {
		return 0
	}
	return float32(dot / denom)
}

// truncateRunes 按 Unicode 码点数截断字符串，避免超出 embedding 模型上下文长度。
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes])
}

// encodeVec 将 float32 切片序列化为 little-endian 字节（存入 SQLite BLOB）。
func encodeVec(v []float32) []byte {
	buf := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

// decodeVec 将 little-endian 字节反序列化为 float32 切片。
func decodeVec(b []byte) []float32 {
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v
}
