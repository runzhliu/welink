package db

import (
	"strings"
	"testing"
)

func TestGetTableName(t *testing.T) {
	tests := []struct {
		username string
		wantPfx  string // 结果必须以 "Msg_" 开头
		wantLen  int    // "Msg_" + 32 hex chars = 36
	}{
		{"wxid_abc123", "Msg_", 36},
		{"12345678@chatroom", "Msg_", 36},
		{"", "Msg_", 36},
	}

	for _, tc := range tests {
		got := GetTableName(tc.username)
		if !strings.HasPrefix(got, tc.wantPfx) {
			t.Errorf("GetTableName(%q) = %q, want prefix %q", tc.username, got, tc.wantPfx)
		}
		if len(got) != tc.wantLen {
			t.Errorf("GetTableName(%q) len = %d, want %d", tc.username, len(got), tc.wantLen)
		}
	}
}

func TestGetTableNameDeterministic(t *testing.T) {
	// 同一 username 多次调用结果必须相同
	username := "wxid_test123"
	a := GetTableName(username)
	b := GetTableName(username)
	if a != b {
		t.Errorf("GetTableName not deterministic: %q != %q", a, b)
	}
}

func TestGetTableNameUnique(t *testing.T) {
	// 不同 username 的表名必须不同
	a := GetTableName("wxid_alice")
	b := GetTableName("wxid_bob")
	if a == b {
		t.Errorf("different usernames produced same table name: %q", a)
	}
}
