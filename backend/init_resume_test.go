package main

import (
	"path/filepath"
	"testing"
)

func TestSavedAllTimeRangeRestoresAfterRestart(t *testing.T) {
	t.Setenv("PREFERENCES_PATH", filepath.Join(t.TempDir(), "preferences.json"))
	prefs := defaultPreferences()
	if shouldRestoreIndex(prefs.DefaultInitFrom, prefs.DefaultInitTo, prefs.DefaultInitConfigured) {
		t.Fatal("fresh settings must not automatically select a time range")
	}
	prefs.DefaultInitFrom, prefs.DefaultInitTo, prefs.DefaultInitConfigured = 0, 0, true
	if err := savePreferences(prefs); err != nil {
		t.Fatal(err)
	}
	reloaded := loadPreferences()
	if !shouldRestoreIndex(reloaded.DefaultInitFrom, reloaded.DefaultInitTo, reloaded.DefaultInitConfigured) {
		t.Fatal("saved all-time range must restore after restart")
	}
	if !shouldRestoreIndex(123, 0, false) || !shouldRestoreIndex(0, 456, false) {
		t.Fatal("legacy bounded ranges must continue to restore")
	}
}
