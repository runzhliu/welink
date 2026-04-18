package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// ─── OAuth 2.0 ────────────────────────────────────────────────────────────────

const (
	gdriveAuthURL   = "https://accounts.google.com/o/oauth2/v2/auth"
	gdriveTokenURL  = "https://oauth2.googleapis.com/token"
	gdriveScope     = "https://www.googleapis.com/auth/drive.file"
	gdriveUploadURL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
	gdriveFilesURL  = "https://www.googleapis.com/drive/v3/files"
)

// gdriveOAuthStartHandler 跳转到 Google 授权页
// GET /api/export/oauth/gdrive/start
func gdriveOAuthStartHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		prefs := loadPreferences()
		if prefs.GDriveClientID == "" || prefs.GDriveClientSecret == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "先在设置里填 Google OAuth Client ID / Secret"})
			return
		}
		state, err := newOAuthState()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 state 失败：" + err.Error()})
			return
		}
		redirect := oauthRedirectURI(c, "/api/export/oauth/gdrive/callback")
		q := url.Values{}
		q.Set("client_id", prefs.GDriveClientID)
		q.Set("redirect_uri", redirect)
		q.Set("response_type", "code")
		q.Set("scope", gdriveScope)
		q.Set("access_type", "offline")
		q.Set("prompt", "consent")
		q.Set("state", state)
		c.Redirect(http.StatusFound, gdriveAuthURL+"?"+q.Encode())
	}
}

// gdriveOAuthCallbackHandler 授权码换 token
// GET /api/export/oauth/gdrive/callback?code=xxx&state=yyy
func gdriveOAuthCallbackHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateOAuthState(c.Query("state")) {
			c.String(http.StatusBadRequest, "state 校验失败：会话已过期或疑似 CSRF，请重新从设置页发起授权")
			return
		}
		code := c.Query("code")
		if code == "" {
			c.String(http.StatusBadRequest, "缺少 code 参数：%s", c.Query("error"))
			return
		}
		prefs := loadPreferences()
		redirect := oauthRedirectURI(c, "/api/export/oauth/gdrive/callback")
		data := url.Values{}
		data.Set("code", code)
		data.Set("client_id", prefs.GDriveClientID)
		data.Set("client_secret", prefs.GDriveClientSecret)
		data.Set("redirect_uri", redirect)
		data.Set("grant_type", "authorization_code")

		resp, err := http.PostForm(gdriveTokenURL, data)
		if err != nil {
			c.String(http.StatusInternalServerError, "token 换取失败：%v", err)
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			c.String(http.StatusInternalServerError, "token 换取失败 %d：%s", resp.StatusCode, string(body))
			return
		}
		var tok struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
		}
		json.Unmarshal(body, &tok)
		prefs.GDriveAccessToken = tok.AccessToken
		if tok.RefreshToken != "" {
			prefs.GDriveRefreshToken = tok.RefreshToken
		}
		prefs.GDriveTokenExpiry = time.Now().Unix() + int64(tok.ExpiresIn) - 60
		savePreferences(prefs)
		c.Data(http.StatusOK, "text/html; charset=utf-8",
			[]byte(`<!doctype html><meta charset="utf-8"><title>授权成功</title><body style="font-family:system-ui;text-align:center;padding:60px 20px;"><h1 style="color:#07c160;">✅ Google Drive 授权成功</h1><p>可以关闭此窗口，回到 WeLink 继续导出。</p></body>`))
	}
}

// gdriveValidToken 返回可用的 access token；过期时用 refresh token 刷新。
func gdriveValidToken() (string, error) {
	prefs := loadPreferences()
	if prefs.GDriveAccessToken != "" && time.Now().Unix() < prefs.GDriveTokenExpiry {
		return prefs.GDriveAccessToken, nil
	}
	if prefs.GDriveRefreshToken == "" {
		return "", errors.New("Google Drive 未授权，请先点「授权」")
	}
	data := url.Values{}
	data.Set("client_id", prefs.GDriveClientID)
	data.Set("client_secret", prefs.GDriveClientSecret)
	data.Set("refresh_token", prefs.GDriveRefreshToken)
	data.Set("grant_type", "refresh_token")
	resp, err := http.PostForm(gdriveTokenURL, data)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("刷新 token 失败 %d: %s", resp.StatusCode, string(body))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	json.Unmarshal(body, &tok)
	prefs.GDriveAccessToken = tok.AccessToken
	prefs.GDriveTokenExpiry = time.Now().Unix() + int64(tok.ExpiresIn) - 60
	savePreferences(prefs)
	return tok.AccessToken, nil
}

// ─── 上传 ────────────────────────────────────────────────────────────────────

// exportGDriveHandler 上传每个 doc 为独立 .md 到用户 Google Drive
func exportGDriveHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		token, err := gdriveValidToken()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		prefs := loadPreferences()
		folderID := strings.TrimSpace(prefs.GDriveFolderID)

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			fname := safeFilename(d.Filename) + ".md"
			fileID, webURL, err := gdriveMultipartUpload(token, fname, folderID, []byte(d.Markdown))
			r := ExportResult{Title: d.Title, OK: err == nil, Bytes: len(d.Markdown)}
			if err != nil {
				r.Error = err.Error()
			} else if webURL != "" {
				r.URL = webURL
			} else {
				r.URL = "https://drive.google.com/file/d/" + fileID + "/view"
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// gdriveMultipartUpload multipart 单次上传 Markdown 文本到 Drive。
func gdriveMultipartUpload(token, name, folderID string, data []byte) (string, string, error) {
	meta := map[string]interface{}{"name": name, "mimeType": "text/markdown"}
	if folderID != "" {
		meta["parents"] = []string{folderID}
	}
	metaJSON, _ := json.Marshal(meta)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Part 1: metadata
	metaHeader := textproto.MIMEHeader{}
	metaHeader.Set("Content-Type", "application/json; charset=UTF-8")
	metaPart, _ := writer.CreatePart(metaHeader)
	metaPart.Write(metaJSON)

	// Part 2: media
	fileHeader := textproto.MIMEHeader{}
	fileHeader.Set("Content-Type", "text/markdown")
	filePart, _ := writer.CreatePart(fileHeader)
	filePart.Write(data)
	writer.Close()

	req, err := http.NewRequest(http.MethodPost, gdriveUploadURL+"&fields=id,webViewLink", &buf)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "multipart/related; boundary="+writer.Boundary())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("GDrive upload %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var out struct {
		ID          string `json:"id"`
		WebViewLink string `json:"webViewLink"`
	}
	json.Unmarshal(respBody, &out)
	return out.ID, out.WebViewLink, nil
}
