package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// exportWebDAVHandler 把每个 doc 当作独立 .md 文件 PUT 到用户 WebDAV 根/前缀下
// 兼容坚果云 / Nextcloud / ownCloud / 群晖等。
func exportWebDAVHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		base := strings.TrimSpace(prefs.WebDAVURL)
		user := strings.TrimSpace(prefs.WebDAVUsername)
		pass := prefs.WebDAVPassword
		if base == "" || user == "" || pass == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 WebDAV URL / 用户名 / 密码"})
			return
		}
		if !strings.HasSuffix(base, "/") {
			base += "/"
		}
		prefix := strings.Trim(prefs.WebDAVPath, "/")

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 先 MKCOL 创建前缀目录（如已存在服务器返回 405，忽略）
		if prefix != "" {
			_ = webdavMkcolRecursive(base, prefix, user, pass)
		}

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			fname := safeFilename(d.Filename) + ".md"
			relPath := fname
			if prefix != "" {
				relPath = prefix + "/" + fname
			}
			fullURL := base + pathEscapePreservingSlash(relPath)
			err := webdavPut(fullURL, []byte(d.Markdown), user, pass)
			r := ExportResult{Title: d.Title, OK: err == nil, Bytes: len(d.Markdown)}
			if err != nil {
				r.Error = err.Error()
			} else {
				r.URL = fullURL
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// webdavPut 向 WebDAV 服务器 PUT 一个文件。
func webdavPut(fullURL string, body []byte, user, pass string) error {
	req, err := http.NewRequest(http.MethodPut, fullURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.SetBasicAuth(user, pass)
	req.Header.Set("Content-Type", "text/markdown; charset=utf-8")
	req.ContentLength = int64(len(body))

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("WebDAV PUT %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return nil
}

// webdavMkcolRecursive 按路径片段逐级 MKCOL，已存在（405/409/301）时忽略。
func webdavMkcolRecursive(base, prefix, user, pass string) error {
	parts := strings.Split(strings.Trim(prefix, "/"), "/")
	cur := ""
	client := &http.Client{Timeout: 30 * time.Second}
	for _, p := range parts {
		if p == "" {
			continue
		}
		cur = path.Join(cur, p)
		u := base + pathEscapePreservingSlash(cur) + "/"
		req, err := http.NewRequest("MKCOL", u, nil)
		if err != nil {
			return err
		}
		req.SetBasicAuth(user, pass)
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		// 201 Created = 新建成功；405/301/409 = 已存在或方法不被允许（已存在），继续下一级
	}
	return nil
}

// pathEscapePreservingSlash URL-encode 每一段，但保留 / 分隔
func pathEscapePreservingSlash(s string) string {
	parts := strings.Split(s, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}
