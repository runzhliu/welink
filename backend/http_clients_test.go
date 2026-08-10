package main

import (
	"net"
	"testing"
)

func TestIsBlockedOutboundIP(t *testing.T) {
	tests := []struct {
		ip      string
		blocked bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"169.254.169.254", true},
		{"100.64.0.1", true},
		{"::1", true},
		{"fc00::1", true},
		{"8.8.8.8", false},
		{"2606:4700:4700::1111", false},
	}
	for _, tt := range tests {
		t.Run(tt.ip, func(t *testing.T) {
			if got := isBlockedOutboundIP(net.ParseIP(tt.ip)); got != tt.blocked {
				t.Fatalf("isBlockedOutboundIP(%s) = %v, want %v", tt.ip, got, tt.blocked)
			}
		})
	}
}

func TestIsHTTPURL(t *testing.T) {
	for _, raw := range []string{"https://example.com/a.png", "http://example.com"} {
		if !isHTTPURL(raw) {
			t.Fatalf("expected valid HTTP URL: %s", raw)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "javascript:alert(1)", "/relative", "https:///missing-host"} {
		if isHTTPURL(raw) {
			t.Fatalf("expected invalid HTTP URL: %s", raw)
		}
	}
}
