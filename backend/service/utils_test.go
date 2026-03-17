package service

import (
	"testing"
	"time"
)

func TestIsNumeric(t *testing.T) {
	cases := []struct {
		s    string
		want bool
	}{
		{"123", true},
		{"3.14", true},
		{"0", true},
		{"abc", false},
		{"12a", false},
		{"", true}, // 空字符串：循环不执行，返回 true（边界）
		{"１２３", false}, // 全角数字
	}
	for _, tc := range cases {
		got := isNumeric(tc.s)
		if got != tc.want {
			t.Errorf("isNumeric(%q) = %v, want %v", tc.s, got, tc.want)
		}
	}
}

func TestHasWordChar(t *testing.T) {
	cases := []struct {
		s    string
		want bool
	}{
		{"你好", true},
		{"hello", true},
		{"123", false},
		{"!@#", false},
		{"", false},
		{"abc123", true},
		{"好123", true},
	}
	for _, tc := range cases {
		got := hasWordChar(tc.s)
		if got != tc.want {
			t.Errorf("hasWordChar(%q) = %v, want %v", tc.s, got, tc.want)
		}
	}
}

func TestContainsEmoji(t *testing.T) {
	cases := []struct {
		s    string
		want bool
	}{
		{"😀", true},
		{"⭐", true},  // 0x2B50, in Misc Symbols
		{"hello", false},
		{"你好", false},
		{"hello😊world", true},
		{"", false},
	}
	for _, tc := range cases {
		got := containsEmoji(tc.s)
		if got != tc.want {
			t.Errorf("containsEmoji(%q) = %v, want %v", tc.s, got, tc.want)
		}
	}
}

func TestFormatTime(t *testing.T) {
	svc := &ContactService{tz: time.FixedZone("CST", 8*3600)}
	cases := []struct {
		ts   int64
		want string
	}{
		{0, "-"},
		{-1, "-"},
		{2000000001, "-"}, // 超出范围
		{1700000000, "2023-11-15"}, // 1700000000 UTC = 2023-11-14 22:13 UTC = 2023-11-15 06:13 CST
	}
	for _, tc := range cases {
		got := svc.formatTime(tc.ts)
		if got != tc.want {
			t.Errorf("formatTime(%d) = %q, want %q", tc.ts, got, tc.want)
		}
	}
}
