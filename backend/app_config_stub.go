//go:build !app

package main

func appPreferencesDir() string     { return "" }
func demoDataDir() string           { return "" }

func loadAppConfig() (*Preferences, bool)  { return nil, false }
func saveAppConfig(_ *Preferences) error   { return nil }
func setupLogFile(_ string)                {}
func browseFolder(_ string) (string, error) { return "", nil }
func restartApp()                          {}
