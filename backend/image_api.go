package main

// image_api.go — AI 文生图 HTTP 路由。
//
//   POST /api/image/generate     生成一张图，返回 hash（同步阻塞）
//   GET  /api/image/cache/:hash  按 hash 提供缓存图（同源，给前端 <img> 用）
//   POST /api/image/test         测试生图配置是否可用

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerImageRoutes(prot *gin.RouterGroup) {
	prot.POST("/image/generate", imageGenerateHandler)
	prot.GET("/image/cache/:hash", imageCacheHandler)
	prot.POST("/image/test", imageTestHandler)
}

type imageGenerateRequest struct {
	Prompt string `json:"prompt"`
	Size   string `json:"size,omitempty"` // 1024x1024 / 1024x1792 / 1792x1024
	Scene  string `json:"scene,omitempty"` // 仅用于埋点区分（year_review / highlight / avatar）
}

type imageGenerateResponse struct {
	Hash string `json:"hash"`
	URL  string `json:"url"`           // 前端可直接用作 <img src=>
	Cached bool `json:"cached,omitempty"`
}

func imageGenerateHandler(c *gin.Context) {
	var req imageGenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prompt 不能为空"})
		return
	}
	if len(prompt) > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prompt 过长（>2000 字符）"})
		return
	}

	prefs := loadPreferences()
	if !prefs.ImageEnabled && !DemoMockActive() {
		c.JSON(http.StatusForbidden, gin.H{"error": "AI 生图未启用，请前往设置开启"})
		return
	}

	cfg := defaultImageConfig(prefs)
	hash, err := GenerateImage(prompt, req.Size, cfg)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, imageGenerateResponse{
		Hash: hash,
		URL:  "/api/image/cache/" + hash,
	})
}

func imageCacheHandler(c *gin.Context) {
	hash := c.Param("hash")
	path, ok := imageCachePath(hash)
	if !ok {
		c.Status(http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	// SVG（demo 模式）/ PNG / JPEG 都靠 content sniff 自动识别
	ct := http.DetectContentType(data)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, ct, data)
}

func imageTestHandler(c *gin.Context) {
	prefs := loadPreferences()
	cfg := defaultImageConfig(prefs)
	if cfg.APIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置生图 API Key"})
		return
	}
	// 用一个极短的 prompt 验证连通；命中缓存时秒返
	hash, err := GenerateImage("一只橘猫", "1024x1024", cfg)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":    true,
		"hash":  hash,
		"url":   "/api/image/cache/" + hash,
		"model": cfg.Model,
	})
}
