package seed

import (
	"strings"
	"testing"
)

func TestPlayerAvatarURL(t *testing.T) {
	url := playerAvatarURL("odegaard_martin", "Ødegaard", false)
	if strings.HasPrefix(url, "data:") {
		t.Error("expected HTTP URL, got data URI")
	}
	if !strings.HasPrefix(url, "https://") {
		t.Errorf("expected https URL, got: %s", url)
	}
}

func TestPlayerAvatarURLFallback(t *testing.T) {
	uri := playerAvatarURL("unknown_player", "Unknown", false)
	if !strings.HasPrefix(uri, "data:image/svg") {
		t.Errorf("expected SVG fallback for unknown player, got: %s", uri[:min(40, len(uri))])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
