package main

// image_api.go — AI 文生图 HTTP 路由。
//
//   异步任务（推荐）：
//     POST   /api/image/tasks       提交任务，立即返回 task_id
//     GET    /api/image/tasks/:id   查询单任务状态（轮询）
//     GET    /api/image/tasks       任务列表（按 status / scene 过滤）
//     DELETE /api/image/tasks/:id   取消任务
//
//   同步包装（兼容老调用方）：
//     POST /api/image/generate      内部 = 提交任务 + 同步等到 done，返回 hash
//     POST /api/image/test          走同步包装跑一张测试图
//
//   静态资源：
//     GET  /api/image/cache/:hash   按 hash 提供缓存图（同源，给前端 <img> 用）
//     GET  /api/image/providers     provider 元数据（image_providers.go 注册）

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerImageRoutes(prot *gin.RouterGroup) {
	prot.POST("/image/generate", imageGenerateHandler)
	prot.GET("/image/cache/:hash", imageCacheHandler)
	prot.POST("/image/test", imageTestHandler)

	// 异步任务
	prot.POST("/image/tasks", imageSubmitTaskHandler)
	prot.GET("/image/tasks", imageListTasksHandler)
	prot.GET("/image/tasks/:id", imageGetTaskHandler)
	prot.DELETE("/image/tasks/:id", imageCancelTaskHandler)

	registerImageProvidersRoute(prot)
}

// ─── 同步包装（老接口）────────────────────────────────────────────────────────

type imageGenerateRequest struct {
	Prompt    string `json:"prompt"`
	Size      string `json:"size,omitempty"`       // 1024x1024 / 1024x1792 / 1792x1024
	Scene     string `json:"scene,omitempty"`      // 仅用于埋点区分（year_review / highlight / avatar）
	ProfileID string `json:"profile_id,omitempty"` // 空 = 默认 profile
}

type imageGenerateResponse struct {
	Hash   string `json:"hash"`
	URL    string `json:"url"` // 前端可直接用作 <img src=>
	Cached bool   `json:"cached,omitempty"`
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

	hash, err := GenerateImageSync(SubmitImageOptions{
		Prompt:    prompt,
		Size:      req.Size,
		Scene:     orDefault(req.Scene, "generate"),
		ProfileID: req.ProfileID,
	})
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
	var body struct {
		ProfileID string `json:"profile_id"`
	}
	// 测试 endpoint 允许无 body（兼容老调用方式）
	_ = c.ShouldBindJSON(&body)

	prefs := loadPreferences()
	cfg := imageConfigFromProfile(prefs, body.ProfileID)
	if cfg.APIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置生图 API Key"})
		return
	}
	hash, err := GenerateImageSync(SubmitImageOptions{
		Prompt:    "一只橘猫",
		Size:      "1024x1024",
		Scene:     "test",
		ProfileID: body.ProfileID,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":       true,
		"hash":     hash,
		"url":      "/api/image/cache/" + hash,
		"provider": cfg.Provider,
		"model":    cfg.Model,
	})
}

// ─── 异步任务系列 ────────────────────────────────────────────────────────────

type imageSubmitTaskRequest struct {
	Prompt    string `json:"prompt"`
	Size      string `json:"size,omitempty"`
	Scene     string `json:"scene,omitempty"`
	ProfileID string `json:"profile_id,omitempty"`
	RefUser   string `json:"ref_user,omitempty"`
	RefKind   string `json:"ref_kind,omitempty"`
}

// imageSubmitTaskHandler 提交一个异步生图任务。
// 立即返回 task_id；前端轮询 GET /api/image/tasks/:id 拿状态。
// 同 hash 已缓存的会直接落 done 短路（status=done + result_hash 已填）。
func imageSubmitTaskHandler(c *gin.Context) {
	var req imageSubmitTaskRequest
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

	taskID, err := SubmitImageTask(SubmitImageOptions{
		Prompt:    prompt,
		Size:      req.Size,
		Scene:     req.Scene,
		ProfileID: req.ProfileID,
		RefUser:   req.RefUser,
		RefKind:   req.RefKind,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, _ := GetImageTask(taskID)
	c.JSON(http.StatusOK, gin.H{
		"id":   taskID,
		"task": rec,
	})
}

func imageGetTaskHandler(c *gin.Context) {
	rec, err := GetImageTask(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func imageListTasksHandler(c *gin.Context) {
	status := c.Query("status")
	scene := c.Query("scene")
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	tasks, err := ListImageTasks(status, scene, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tasks == nil {
		tasks = []ImageTaskRecord{}
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

func imageCancelTaskHandler(c *gin.Context) {
	if err := CancelImageTask(c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// orDefault 返回 s（非空时）或 fallback。
func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}
