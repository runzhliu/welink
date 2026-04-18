package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"welink/backend/service"
)

// OneDrive 用 Microsoft Identity Platform v2 endpoint + Graph API /me/drive/root:/{path}:/content 上传。
// 作用域 Files.ReadWrite 需要在 Azure App Registration 里 delegated 授予。

func onedriveAuthURL(tenant string) string {
	if tenant == "" {
		tenant = "common"
	}
	return fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize", tenant)
}
func onedriveTokenURL(tenant string) string {
	if tenant == "" {
		tenant = "common"
	}
	return fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", tenant)
}

const onedriveScope = "Files.ReadWrite offline_access"

// onedriveOAuthStartHandler GET /api/export/oauth/onedrive/start
func onedriveOAuthStartHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		prefs := loadPreferences()
		if prefs.OneDriveClientID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "先在设置里填 OneDrive Client ID"})
			return
		}
		state, err := newOAuthState()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 state 失败：" + err.Error()})
			return
		}
		redirect := oauthRedirectURI(c, "/api/export/oauth/onedrive/callback")
		q := url.Values{}
		q.Set("client_id", prefs.OneDriveClientID)
		q.Set("redirect_uri", redirect)
		q.Set("response_type", "code")
		q.Set("scope", onedriveScope)
		q.Set("response_mode", "query")
		q.Set("state", state)
		c.Redirect(http.StatusFound, onedriveAuthURL(prefs.OneDriveTenant)+"?"+q.Encode())
	}
}

// onedriveOAuthCallbackHandler GET /api/export/oauth/onedrive/callback?code=xxx&state=yyy
func onedriveOAuthCallbackHandler() gin.HandlerFunc {
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
		redirect := oauthRedirectURI(c, "/api/export/oauth/onedrive/callback")
		data := url.Values{}
		data.Set("client_id", prefs.OneDriveClientID)
		data.Set("scope", onedriveScope)
		data.Set("code", code)
		data.Set("redirect_uri", redirect)
		data.Set("grant_type", "authorization_code")
		if prefs.OneDriveClientSecret != "" {
			data.Set("client_secret", prefs.OneDriveClientSecret)
		}
		resp, err := http.PostForm(onedriveTokenURL(prefs.OneDriveTenant), data)
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
		prefs.OneDriveAccessToken = tok.AccessToken
		if tok.RefreshToken != "" {
			prefs.OneDriveRefreshToken = tok.RefreshToken
		}
		prefs.OneDriveTokenExpiry = time.Now().Unix() + int64(tok.ExpiresIn) - 60
		savePreferences(prefs)
		c.Data(http.StatusOK, "text/html; charset=utf-8",
			[]byte(`<!doctype html><meta charset="utf-8"><title>授权成功</title><body style="font-family:system-ui;text-align:center;padding:60px 20px;"><h1 style="color:#07c160;">✅ OneDrive 授权成功</h1><p>可以关闭此窗口，回到 WeLink 继续导出。</p></body>`))
	}
}

// onedriveValidToken 返回可用 access token，过期时自动刷新。
func onedriveValidToken() (string, error) {
	prefs := loadPreferences()
	if prefs.OneDriveAccessToken != "" && time.Now().Unix() < prefs.OneDriveTokenExpiry {
		return prefs.OneDriveAccessToken, nil
	}
	if prefs.OneDriveRefreshToken == "" {
		return "", errors.New("OneDrive 未授权，请先点「授权」")
	}
	data := url.Values{}
	data.Set("client_id", prefs.OneDriveClientID)
	data.Set("scope", onedriveScope)
	data.Set("refresh_token", prefs.OneDriveRefreshToken)
	data.Set("grant_type", "refresh_token")
	if prefs.OneDriveClientSecret != "" {
		data.Set("client_secret", prefs.OneDriveClientSecret)
	}
	resp, err := http.PostForm(onedriveTokenURL(prefs.OneDriveTenant), data)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("刷新 token 失败 %d: %s", resp.StatusCode, string(body))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	json.Unmarshal(body, &tok)
	prefs.OneDriveAccessToken = tok.AccessToken
	if tok.RefreshToken != "" {
		prefs.OneDriveRefreshToken = tok.RefreshToken
	}
	prefs.OneDriveTokenExpiry = time.Now().Unix() + int64(tok.ExpiresIn) - 60
	savePreferences(prefs)
	return tok.AccessToken, nil
}

// ─── 上传 ────────────────────────────────────────────────────────────────────

func exportOneDriveHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		token, err := onedriveValidToken()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		prefs := loadPreferences()
		folder := strings.Trim(strings.TrimSpace(prefs.OneDriveFolderPath), "/")

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			fname := safeFilename(d.Filename) + ".md"
			fullPath := fname
			if folder != "" {
				fullPath = folder + "/" + fname
			}
			webURL, err := onedriveUpload(token, fullPath, []byte(d.Markdown))
			r := ExportResult{Title: d.Title, OK: err == nil, Bytes: len(d.Markdown)}
			if err != nil {
				r.Error = err.Error()
			} else {
				r.URL = webURL
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

// onedriveUpload PUT /me/drive/root:/{path}:/content；文件 ≤4MB 用简单模式。
// 对 Markdown 导出场景完全够用，超过用 createUploadSession 分块，这里不处理。
func onedriveUpload(token, relPath string, data []byte) (string, error) {
	// path 段逐级 escape，: 放在 path 外作分隔符
	parts := strings.Split(relPath, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	encoded := strings.Join(parts, "/")
	endpoint := fmt.Sprintf("https://graph.microsoft.com/v1.0/me/drive/root:/%s:/content", encoded)

	req, err := http.NewRequest(http.MethodPut, endpoint, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "text/markdown")
	req.ContentLength = int64(len(data))

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("OneDrive upload %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		WebURL string `json:"webUrl"`
	}
	json.Unmarshal(body, &out)
	return out.WebURL, nil
}
