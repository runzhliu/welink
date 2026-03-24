//go:build !app

package main

// appVersion 由 Makefile 通过 -ldflags "-X main.appVersion=x.y.z" 注入。
var appVersion = "dev"

func startApp()                    {}
func signalServerReady(_ string)   {}
func appDataDir() string           { return "" }
func openURL(_ string) error       { return nil }
func setupNativeMenu()             {}
func enableWindowFullScreen()      {}
