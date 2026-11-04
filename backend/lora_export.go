// LoRA/SFT export compatibility helpers.
//
// v0.4 datasets are implemented in sft_export.go using ms-swift's messages
// format. The lora-jsonl format key and BuildLoRAExportZip name remain stable so
// existing clients can upgrade without an API migration.
package main

import (
	"strings"
	"time"

	"welink/backend/service"
)

// BuildLoRAExportZip keeps the v0.3 entry-point name while producing the v0.4
// ms-swift dataset bundle. New callers should pass SFTExportOptions explicitly.
func BuildLoRAExportZip(svc *service.ContactService, options ...SFTExportOptions) ([]byte, string, error) {
	opts := SFTExportOptions{TargetType: "self", MaxExamples: sftDefaultMaxSamples}
	if len(options) > 0 {
		opts = options[0]
	}
	return BuildSFTExportZip(svc, opts)
}

func parseChatMsgTs(message service.ChatMessage) int64 {
	if message.Date == "" || message.Time == "" {
		return 0
	}
	timestamp, err := time.ParseInLocation("2006-01-02 15:04", message.Date+" "+message.Time, time.Local)
	if err != nil {
		return 0
	}
	return timestamp.Unix()
}

// cleanForLoRA removes content that is unsuitable for local SFT and applies
// rule-based PII masking. The generated bundle still requires human review.
func cleanForLoRA(content string) string {
	content = strings.TrimSpace(content)
	if content == "" || containsSensitive(content) {
		return ""
	}
	// Remove WeChat [emoji] placeholders before PII masking. Otherwise values
	// such as [手机号] and [邮箱] would be removed by the same bracket regex.
	content = reWxEmoji.ReplaceAllString(content, "")
	content = maskSensitive(content)
	content = reURL.ReplaceAllString(content, "[链接]")
	content = reLongNonText.ReplaceAllString(content, "[数据]")
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	for _, r := range content {
		if (r >= 0x4E00 && r <= 0x9FFF) || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			return content
		}
	}
	return ""
}

func rangeOK(content string, minRunes, maxRunes int) bool {
	count := 0
	for range content {
		count++
		if count > maxRunes {
			return false
		}
	}
	return count >= minRunes
}

func runeLen(content string) int {
	count := 0
	for range content {
		count++
	}
	return count
}

func roundTo1(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}
