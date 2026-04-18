package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	feishuAPIBase = "https://open.feishu.cn/open-apis"
)

// ─── tenant_access_token 缓存 ────────────────────────────────────────────────

type feishuTokenEntry struct {
	token   string
	expires time.Time
}

var (
	feishuTokenMu    sync.Mutex
	feishuTokenCache = map[string]feishuTokenEntry{}
)

// getFeishuTenantToken 获取（带缓存）租户 access token。
// 默认有效期 7200s，提前 5 分钟过期以避开边界。
func getFeishuTenantToken(appID, appSecret string) (string, error) {
	cacheKey := appID + ":" + appSecret
	feishuTokenMu.Lock()
	if e, ok := feishuTokenCache[cacheKey]; ok && time.Now().Before(e.expires) {
		feishuTokenMu.Unlock()
		return e.token, nil
	}
	feishuTokenMu.Unlock()

	body, _ := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})
	req, err := http.NewRequest("POST", feishuAPIBase+"/auth/v3/tenant_access_token/internal", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("解析 token 响应失败：%w (raw=%s)", err, truncate(string(raw), 200))
	}
	if out.Code != 0 || out.TenantAccessToken == "" {
		return "", fmt.Errorf("飞书 %d: %s", out.Code, out.Msg)
	}
	expires := time.Now().Add(time.Duration(out.Expire-300) * time.Second)
	feishuTokenMu.Lock()
	feishuTokenCache[cacheKey] = feishuTokenEntry{token: out.TenantAccessToken, expires: expires}
	feishuTokenMu.Unlock()
	return out.TenantAccessToken, nil
}

// ─── 单文档导入流程 ──────────────────────────────────────────────────────────

// pushToFeishu 把单个 ExportDoc 上传成飞书文档（docx）。
// folderToken 为空时落在「我的空间」根目录。
// 流程：upload_all → import_tasks → poll → 拿到 docx_token + url。
func pushToFeishu(token, folderToken string, doc ExportDoc) (string, error) {
	mdBytes := []byte(doc.Markdown)
	fileName := safeFilename(doc.Filename) + ".md"

	fileToken, err := feishuUploadFile(token, fileName, folderToken, mdBytes)
	if err != nil {
		return "", fmt.Errorf("上传文件失败：%w", err)
	}

	ticket, err := feishuCreateImportTask(token, fileName, fileToken, folderToken, doc.Title)
	if err != nil {
		return "", fmt.Errorf("创建导入任务失败：%w", err)
	}

	url, err := feishuPollImportTask(token, ticket)
	if err != nil {
		return "", fmt.Errorf("等待导入完成失败：%w", err)
	}
	return url, nil
}

// feishuUploadFile 用 upload_all 一次性上传，返回 file_token。
// parent_type=ccm_import_open（专为 import 任务上传的临时文件类型）。
func feishuUploadFile(token, fileName, folderToken string, content []byte) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("file_name", fileName)
	w.WriteField("parent_type", "ccm_import_open")
	if folderToken != "" {
		w.WriteField("parent_node", folderToken)
	}
	w.WriteField("size", strconv.Itoa(len(content)))
	fw, err := w.CreateFormFile("file", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(content); err != nil {
		return "", err
	}
	w.Close()

	req, err := http.NewRequest("POST", feishuAPIBase+"/drive/v1/medias/upload_all", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			FileToken string `json:"file_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("解析上传响应失败：%w (raw=%s)", err, truncate(string(raw), 200))
	}
	if out.Code != 0 || out.Data.FileToken == "" {
		return "", fmt.Errorf("飞书 %d: %s", out.Code, out.Msg)
	}
	return out.Data.FileToken, nil
}

// feishuCreateImportTask 创建 markdown → docx 的导入任务，返回 ticket。
func feishuCreateImportTask(token, fileName, fileToken, folderToken, displayTitle string) (string, error) {
	// 飞书 API 要求 file_name 不带扩展名
	titleNoExt := strings.TrimSuffix(fileName, ".md")
	if displayTitle != "" {
		titleNoExt = displayTitle
		if r := []rune(titleNoExt); len(r) > 80 {
			titleNoExt = string(r[:80])
		}
	}
	body := map[string]any{
		"file_extension": "md",
		"file_token":     fileToken,
		"type":           "docx",
		"file_name":      titleNoExt,
		"point": map[string]any{
			"mount_type": 1, // 1 = 我的空间 / 文件夹
			"mount_key":  folderToken,
		},
	}
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", feishuAPIBase+"/drive/v1/import_tasks", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	var out struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Ticket string `json:"ticket"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("解析响应失败：%w (raw=%s)", err, truncate(string(respBody), 200))
	}
	if out.Code != 0 || out.Data.Ticket == "" {
		return "", fmt.Errorf("飞书 %d: %s", out.Code, out.Msg)
	}
	return out.Data.Ticket, nil
}

// feishuPollImportTask 轮询任务状态直到完成或失败，返回新文档 URL。
// 每 1 秒查一次，最多等 60 秒。
func feishuPollImportTask(token, ticket string) (string, error) {
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest("GET", feishuAPIBase+"/drive/v1/import_tasks/"+ticket, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
		if err != nil {
			return "", err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var out struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data struct {
				Result struct {
					JobStatus int    `json:"job_status"` // 0=未开始 1=进行中 2=失败 3=成功（飞书文档版本不同含义）
					JobErrorMsg string `json:"job_error_msg"`
					Token     string `json:"token"`
					URL       string `json:"url"`
					Type      string `json:"type"`
				} `json:"result"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			return "", fmt.Errorf("解析轮询响应失败：%w", err)
		}
		if out.Code != 0 {
			return "", fmt.Errorf("飞书 %d: %s", out.Code, out.Msg)
		}
		switch out.Data.Result.JobStatus {
		case 0: // success（部分版本）
			if out.Data.Result.URL != "" {
				return out.Data.Result.URL, nil
			}
		case 3: // failed
			return "", fmt.Errorf("导入失败：%s", out.Data.Result.JobErrorMsg)
		}
		// success 的 token 已就绪也可以提前返回
		if out.Data.Result.Token != "" {
			if out.Data.Result.URL != "" {
				return out.Data.Result.URL, nil
			}
			return fmt.Sprintf("https://feishu.cn/docx/%s", out.Data.Result.Token), nil
		}
		time.Sleep(time.Second)
	}
	return "", fmt.Errorf("等待超时")
}
