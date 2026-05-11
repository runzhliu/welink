package main

// image_gallery_api.go — 「AI 画廊」HTTP 路由
//
//   GET    /api/images              列表（含 q / scene / provider / starred / include_deleted 过滤）
//   GET    /api/images/:hash        单图详情
//   PATCH  /api/images/:hash        更新 star / tags
//   DELETE /api/images/:hash        软删（?hard=true 立即硬删）
//   POST   /api/images/:hash/regenerate  基于此图 prompt 微调再生（可改 prompt / size / profile_id）

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerImageGalleryRoutes(prot *gin.RouterGroup) {
	prot.GET("/images", imageListHandler)
	prot.GET("/images/:hash", imageDetailHandler)
	prot.PATCH("/images/:hash", imagePatchHandler)
	prot.DELETE("/images/:hash", imageDeleteHandler)
	prot.POST("/images/:hash/regenerate", imageRegenerateHandler)
}

func imageListHandler(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	f := ListImagesFilter{
		Q:              strings.TrimSpace(c.Query("q")),
		Scene:          c.Query("scene"),
		Provider:       c.Query("provider"),
		StarredOnly:    c.Query("starred") == "1",
		IncludeDeleted: c.Query("include_deleted") == "1",
		Limit:          limit,
		Offset:         offset,
	}
	images, err := ListImages(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if images == nil {
		images = []ImageRecord{}
	}
	total, _ := CountImages(f)
	c.JSON(http.StatusOK, gin.H{"images": images, "total": total})
}

func imageDetailHandler(c *gin.Context) {
	hash := c.Param("hash")
	if !isHexHash(hash) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 hash"})
		return
	}
	r, err := GetImageRecord(hash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图不存在"})
		return
	}
	c.JSON(http.StatusOK, r)
}

func imagePatchHandler(c *gin.Context) {
	hash := c.Param("hash")
	if !isHexHash(hash) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 hash"})
		return
	}
	var body struct {
		Starred *bool     `json:"starred,omitempty"`
		Tags    *[]string `json:"tags,omitempty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	if err := PatchImage(hash, ImagePatch{Starred: body.Starred, Tags: body.Tags}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func imageDeleteHandler(c *gin.Context) {
	hash := c.Param("hash")
	if !isHexHash(hash) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 hash"})
		return
	}
	hard := c.Query("hard") == "true"
	var err error
	if hard {
		err = HardDeleteImage(hash)
	} else {
		err = SoftDeleteImage(hash)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// imageRegenerateHandler 是 POST /image/tasks 的语法糖：
// 取源图当前 prompt / scene / size 作为默认值，允许 body 里覆盖。带上 parent_hash。
func imageRegenerateHandler(c *gin.Context) {
	hash := c.Param("hash")
	if !isHexHash(hash) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 hash"})
		return
	}
	src, err := GetImageRecord(hash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if src == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "源图不存在"})
		return
	}
	var body struct {
		Prompt    string `json:"prompt,omitempty"`
		Size      string `json:"size,omitempty"`
		ProfileID string `json:"profile_id,omitempty"`
	}
	_ = c.ShouldBindJSON(&body)
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		prompt = src.Prompt
	}
	size := body.Size
	if size == "" {
		size = src.Size
	}

	taskID, err := SubmitImageTask(SubmitImageOptions{
		Prompt:    prompt,
		Size:      size,
		Scene:     src.Scene,
		ProfileID: body.ProfileID,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 给新生成的任务记上 parent_hash —— 写在 image_tasks 里没字段，落画廊时由 worker 触发再补
	// 简化：先把源 hash 当 ref 写到 used_in，更直观
	_ = AppendImageUsedIn(hash, UsedInEntry{Kind: "regen_source", Ref: taskID})

	rec, _ := GetImageTask(taskID)
	c.JSON(http.StatusOK, gin.H{
		"id":          taskID,
		"task":        rec,
		"parent_hash": hash,
	})
}
