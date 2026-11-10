package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// dataPreflight only reads directory entries and SQLite schema, never chat rows.
// Passing these checks is not a guarantee that every WeChat version is supported.
type dataPreflightCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type dataPreflightResult struct {
	OK     bool                 `json:"ok"`
	Checks []dataPreflightCheck `json:"checks"`
}

type missingSchemaTable struct{ table string }

func (e *missingSchemaTable) Error() string {
	return fmt.Sprintf("缺少 %s 表，可能与当前版本不兼容", e.table)
}

func inspectDataDirectory(dataDir string) dataPreflightResult {
	r := dataPreflightResult{OK: true, Checks: []dataPreflightCheck{}}
	add := func(name, status, message string) {
		r.Checks = append(r.Checks, dataPreflightCheck{Name: name, Status: status, Message: message})
		if status == "error" {
			r.OK = false
		}
	}
	if strings.TrimSpace(dataDir) == "" {
		add("数据目录", "error", "请选择已解密的数据库目录。")
		return r
	}
	contact := filepath.Join(dataDir, "contact", "contact.db")
	if st, err := os.Stat(contact); err != nil || !st.Mode().IsRegular() {
		add("联系人数据库", "error", "未找到可读取的 contact/contact.db，请检查目录结构和访问权限。")
	} else if err := inspectSQLiteSchema(contact, "contact", []string{"username", "nick_name", "remark", "alias", "flag", "verify_flag", "big_head_url", "small_head_url"}); err != nil {
		add("联系人数据库", "error", "无法读取联系人数据库结构："+err.Error())
	} else {
		add("联系人数据库", "ok", "已识别联系人表及分析所需字段。")
	}

	messageDir := filepath.Join(dataDir, "message")
	entries, err := os.ReadDir(messageDir)
	if err != nil {
		add("消息数据库", "error", "无法读取 message 目录，请检查目录结构和访问权限。")
		return r
	}
	var paths []string
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && strings.HasPrefix(name, "message_") && strings.HasSuffix(name, ".db") && !strings.Contains(name, "fts") && !strings.Contains(name, "resource") {
			paths = append(paths, filepath.Join(messageDir, name))
		}
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		add("消息数据库", "error", "未找到 message/message_*.db，请确认已导出消息数据库。")
		return r
	}
	var legacy []string
	for _, path := range paths {
		if err := inspectSQLiteSchema(path, "Name2Id", []string{"user_name"}); err != nil {
			var missing *missingSchemaTable
			if errors.As(err, &missing) {
				legacy = append(legacy, filepath.Base(path))
				continue
			}
			add("消息数据库", "error", fmt.Sprintf("%s 的结构无法识别：%s", filepath.Base(path), err))
			return r
		}
	}
	if len(legacy) > 0 {
		add("消息数据库", "warning", "部分数据库缺少发送者映射，可能影响部分分析和训练；仍可尝试读取："+strings.Join(legacy, "、"))
	} else {
		add("消息数据库", "ok", fmt.Sprintf("已识别 %d 个消息数据库及发送者映射。", len(paths)))
	}
	var readOnly []string
	for _, path := range append([]string{contact}, paths...) {
		f, err := os.OpenFile(path, os.O_WRONLY, 0)
		if err != nil {
			readOnly = append(readOnly, filepath.Base(path))
			continue
		}
		_ = f.Close()
	}
	if len(readOnly) > 0 {
		add("写入权限", "warning", "部分数据库不可写，分析仍可尝试，但可能无法创建加速索引："+strings.Join(readOnly, "、"))
	} else {
		add("写入权限", "ok", "数据库可写，可用于创建查询加速索引。")
	}
	add("兼容性", "warning", "这里只检查必要的数据库结构，不读取聊天正文；通过检查不代表已验证所有微信版本或全部功能。")
	return r
}

func inspectSQLiteSchema(path, table string, columns []string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("路径无效")
	}
	u := &url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}
	query := u.Query()
	query.Set("mode", "ro")
	u.RawQuery = query.Encode()
	database, err := sql.Open("sqlite", u.String())
	if err != nil {
		return fmt.Errorf("无法以只读方式打开数据库")
	}
	defer database.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Identifiers here are fixed by the caller, not supplied by the user.
	rows, err := database.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return fmt.Errorf("无法读取 SQLite 结构，文件可能未解密、损坏或正在使用")
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("无法读取数据库字段")
		}
		found[strings.ToLower(name)] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("无法读取 SQLite 结构，文件可能未解密、损坏或正在使用")
	}
	if len(found) == 0 {
		return &missingSchemaTable{table: table}
	}
	var missing []string
	for _, column := range columns {
		if !found[strings.ToLower(column)] {
			missing = append(missing, column)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("%s 表缺少字段 %s，可能与当前版本不兼容", table, strings.Join(missing, ", "))
	}
	return nil
}

func registerDataPreflight(api *gin.RouterGroup, desktop bool) {
	api.POST("/app/data-preflight", func(c *gin.Context) {
		// The endpoint inspects arbitrary local paths. Do not expose it to a
		// public demo or an unauthenticated remote client.
		if demoModeEnabled() || !sftUserOriginAllowed(c) || (!desktop && !hasValidPairingToken(c.Request)) || (!isLoopbackRequest(c.Request) && !hasValidPairingToken(c.Request)) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "仅本机桌面或已配对设备可检查数据目录"})
			return
		}
		var request struct {
			DataDir string `json:"data_dir"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		c.JSON(http.StatusOK, inspectDataDirectory(request.DataDir))
	})
}
