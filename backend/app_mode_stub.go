//go:build !app

package main

func startApp()                    {}
func signalServerReady(_ string)   {}
func appDataDir() string           { return "" }
func openURL(_ string) error       { return nil }
func setupNativeMenu()             {}
func enableWindowFullScreen()      {}
