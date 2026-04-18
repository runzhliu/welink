package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	notionAPIBase = "https://api.notion.com/v1"
	notionVersion = "2022-06-28"
	notionBlocksPerRequest = 90 // Notion 限制 100 children/请求；留点余量
)

// pushToNotion 把单个文档作为新 Page 推到 Notion。
//   token: integration token（secret_xxx）
//   parentPageID: 父 Page ID（32 位 UUID，含连字符或不含都行）
// 返回新 Page 的 URL。
func pushToNotion(token, parentPageID string, doc ExportDoc) (string, error) {
	parentID := normalizeNotionID(parentPageID)
	blocks := markdownToNotionBlocks(doc.Markdown)

	// 第一批：创建 Page，至多带 notionBlocksPerRequest 个 children；剩下的之后用 PATCH append。
	first, rest := splitBlocks(blocks, notionBlocksPerRequest)

	body := map[string]any{
		"parent": map[string]string{"page_id": parentID},
		"properties": map[string]any{
			"title": []map[string]any{
				{"type": "text", "text": map[string]string{"content": truncateRunes(doc.Title, 1900)}},
			},
		},
		"children": first,
	}

	resp, err := notionRequest(token, "POST", "/pages", body)
	if err != nil {
		return "", err
	}
	pageID, _ := resp["id"].(string)
	pageURL, _ := resp["url"].(string)
	if pageID == "" {
		return "", fmt.Errorf("Notion 返回缺少 page id")
	}

	// 续传剩余块
	for len(rest) > 0 {
		batch, more := splitBlocks(rest, notionBlocksPerRequest)
		_, err := notionRequest(token, "PATCH", fmt.Sprintf("/blocks/%s/children", pageID), map[string]any{
			"children": batch,
		})
		if err != nil {
			return pageURL, fmt.Errorf("已创建 Page 但追加内容失败：%w", err)
		}
		rest = more
	}
	return pageURL, nil
}

// notionRequest 发请求并解析 JSON 返回。
func notionRequest(token, method, path string, body any) (map[string]any, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, notionAPIBase+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Notion-Version", notionVersion)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		// Notion 错误体形如 {"object":"error","status":400,"code":"...","message":"..."}
		var errObj struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &errObj)
		if errObj.Message != "" {
			return nil, fmt.Errorf("Notion %d %s: %s", resp.StatusCode, errObj.Code, errObj.Message)
		}
		return nil, fmt.Errorf("Notion %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// normalizeNotionID 把 "abc123-..." 或 "abc123..." 都规范成 Notion 接受的形式。
// Notion 既接受带 dash 的 UUID 也接受无 dash 的 32 字符 hex。
func normalizeNotionID(s string) string {
	s = strings.TrimSpace(s)
	// 容忍用户粘贴整条 URL：https://www.notion.so/Workspace/Title-<32hex>?v=...
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	if i := strings.Index(s, "?"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, "-"); i >= 0 && len(s)-i-1 == 32 {
		s = s[i+1:]
	}
	return s
}

// splitBlocks 切出前 n 个块。
func splitBlocks(blocks []map[string]any, n int) ([]map[string]any, []map[string]any) {
	if len(blocks) <= n {
		return blocks, nil
	}
	return blocks[:n], blocks[n:]
}

// ─── Markdown → Notion blocks 解析器 ─────────────────────────────────────────

// markdownToNotionBlocks 极简的 MD → Notion blocks 转换。
// 仅处理我们的 collector 实际会产出的语法：
//   #/##/### 标题、段落、- 列表、> 引用、``` 代码块、| 表格。
// 不支持嵌套列表、链接等富文本（导出文本里基本不出现）。
func markdownToNotionBlocks(md string) []map[string]any {
	lines := strings.Split(md, "\n")
	var blocks []map[string]any
	i := 0
	for i < len(lines) {
		line := lines[i]
		trim := strings.TrimSpace(line)

		// 空行直接跳过
		if trim == "" {
			i++
			continue
		}

		// 代码块
		if strings.HasPrefix(trim, "```") {
			lang := strings.TrimSpace(strings.TrimPrefix(trim, "```"))
			i++
			var code []string
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), "```") {
				code = append(code, lines[i])
				i++
			}
			if i < len(lines) {
				i++
			}
			blocks = append(blocks, notionCodeBlock(strings.Join(code, "\n"), lang))
			continue
		}

		// 表格：连续两行以上 |...| 开头，第二行是分隔行 |---|---|
		if strings.HasPrefix(trim, "|") && i+1 < len(lines) {
			next := strings.TrimSpace(lines[i+1])
			if strings.HasPrefix(next, "|") && strings.Contains(next, "---") {
				header := parseTableRow(trim)
				rows := [][]string{header}
				i += 2
				for i < len(lines) {
					t := strings.TrimSpace(lines[i])
					if !strings.HasPrefix(t, "|") {
						break
					}
					rows = append(rows, parseTableRow(t))
					i++
				}
				blocks = append(blocks, notionTableBlock(rows))
				continue
			}
		}

		// 标题
		if strings.HasPrefix(trim, "### ") {
			blocks = append(blocks, notionHeading(3, strings.TrimPrefix(trim, "### ")))
			i++
			continue
		}
		if strings.HasPrefix(trim, "## ") {
			blocks = append(blocks, notionHeading(2, strings.TrimPrefix(trim, "## ")))
			i++
			continue
		}
		if strings.HasPrefix(trim, "# ") {
			blocks = append(blocks, notionHeading(1, strings.TrimPrefix(trim, "# ")))
			i++
			continue
		}

		// 引用
		if strings.HasPrefix(trim, "> ") {
			blocks = append(blocks, notionQuote(strings.TrimPrefix(trim, "> ")))
			i++
			continue
		}

		// 无序列表
		if strings.HasPrefix(trim, "- ") {
			blocks = append(blocks, notionBulleted(strings.TrimPrefix(trim, "- ")))
			i++
			continue
		}

		// 普通段落
		blocks = append(blocks, notionParagraph(trim))
		i++
	}
	return blocks
}

// parseTableRow 切 |a|b|c| → ["a","b","c"]
func parseTableRow(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.Trim(line, "|")
	parts := strings.Split(line, "|")
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = strings.TrimSpace(p)
	}
	return out
}

// ─── Notion Block 构造器 ─────────────────────────────────────────────────────

func notionRichText(s string) []map[string]any {
	// Notion 单个 rich_text 元素 content 上限 2000 字符
	if len([]rune(s)) > 1900 {
		s = string([]rune(s)[:1900]) + "…"
	}
	return []map[string]any{
		{"type": "text", "text": map[string]string{"content": s}},
	}
}

func notionHeading(level int, text string) map[string]any {
	key := fmt.Sprintf("heading_%d", level)
	return map[string]any{
		"object": "block",
		"type":   key,
		key: map[string]any{
			"rich_text": notionRichText(stripMDInline(text)),
		},
	}
}

func notionParagraph(text string) map[string]any {
	return map[string]any{
		"object": "block",
		"type":   "paragraph",
		"paragraph": map[string]any{
			"rich_text": notionRichText(stripMDInline(text)),
		},
	}
}

func notionBulleted(text string) map[string]any {
	return map[string]any{
		"object": "block",
		"type":   "bulleted_list_item",
		"bulleted_list_item": map[string]any{
			"rich_text": notionRichText(stripMDInline(text)),
		},
	}
}

func notionQuote(text string) map[string]any {
	return map[string]any{
		"object": "block",
		"type":   "quote",
		"quote": map[string]any{
			"rich_text": notionRichText(stripMDInline(text)),
		},
	}
}

func notionCodeBlock(code, lang string) map[string]any {
	if lang == "" {
		lang = "plain text"
	}
	return map[string]any{
		"object": "block",
		"type":   "code",
		"code": map[string]any{
			"rich_text": notionRichText(code),
			"language":  lang,
		},
	}
}

func notionTableBlock(rows [][]string) map[string]any {
	if len(rows) == 0 {
		return notionParagraph("")
	}
	width := len(rows[0])
	children := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		// 行宽对齐
		if len(r) < width {
			pad := make([]string, width-len(r))
			r = append(r, pad...)
		}
		if len(r) > width {
			r = r[:width]
		}
		cells := make([][]map[string]any, width)
		for i, cell := range r {
			cells[i] = notionRichText(stripMDInline(cell))
		}
		children = append(children, map[string]any{
			"object": "block",
			"type":   "table_row",
			"table_row": map[string]any{
				"cells": cells,
			},
		})
	}
	return map[string]any{
		"object": "block",
		"type":   "table",
		"table": map[string]any{
			"table_width":       width,
			"has_column_header": true,
			"has_row_header":    false,
			"children":          children,
		},
	}
}

// stripMDInline 去掉简单的 Markdown 行内标记（**、`、_），减少 Notion 里直接显示原始符号。
func stripMDInline(s string) string {
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "__", "")
	s = strings.ReplaceAll(s, "`", "")
	return s
}
