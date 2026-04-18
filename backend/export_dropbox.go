package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// exportDropboxHandler 上传每个 doc 作为 .md 到用户 Dropbox 的指定路径。
// 使用从 Dropbox App Console 签发的长期 access token（不走 OAuth 回调）。
func exportDropboxHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		token := strings.TrimSpace(prefs.DropboxToken)
		if token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 Dropbox Access Token"})
			return
		}
		prefix := strings.TrimRight(strings.TrimSpace(prefs.DropboxPath), "/")
		if prefix != "" && !strings.HasPrefix(prefix, "/") {
			prefix = "/" + prefix
		}

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			fname := safeFilename(d.Filename) + ".md"
			dbxPath := prefix + "/" + fname
			if prefix == "" {
				dbxPath = "/" + fname
			}
			url, err := dropboxUpload(token, dbxPath, []byte(d.Markdown))
			r := ExportResult{Title: d.Title, OK: err == nil, Bytes: len(d.Markdown)}
			if err != nil {
				r.Error = err.Error()
			} else {
				r.URL = url
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// dropboxUpload 上传单个文件到 Dropbox（files/upload API）；返回 path_display 当 URL 展示。
func dropboxUpload(token, dbxPath string, data []byte) (string, error) {
	arg := map[string]interface{}{
		"path":            dbxPath,
		"mode":            "overwrite",
		"autorename":      false,
		"mute":            false,
		"strict_conflict": false,
	}
	argJSON, _ := json.Marshal(arg)

	req, err := http.NewRequest(http.MethodPost, "https://content.dropboxapi.com/2/files/upload", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Dropbox-API-Arg", string(argJSON))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = int64(len(data))

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Dropbox upload %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		PathDisplay string `json:"path_display"`
	}
	json.Unmarshal(body, &out)
	if out.PathDisplay == "" {
		out.PathDisplay = dbxPath
	}
	return "https://www.dropbox.com/home" + out.PathDisplay, nil
}
