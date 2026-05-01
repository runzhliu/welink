//go:build app

package main

// app_exit.go — 桌面 App 模式的"尽量优雅退出"。
//
// webview 退出路径有两条：
//   1. 用户关窗口 → w.Run() 返回
//   2. Cmd+Q / Ctrl+Q → __welinkQuit binding 直接触发
// 两条路径都需要在 os.Exit 之前把 ai_analysis.db 的 WAL flush 到主库，
// 否则下次启动 SQLite 需要 replay WAL，启动慢且偶尔会让用户看到
// "数据库锁定" 错误。
//
// 微信原始数据库（contact.db / message_*.db）是只读访问，不需要主动 close。
// 后续如果给 ContactService 加了 Close()，可以一起在这里调用。

import (
	"log"
	"os"
)

// gracefulExit 在退出前 flush AI 数据库，再调 os.Exit(code)。
// 任何关闭错误只 log 不阻塞退出（用户已经按了 Cmd+Q，不能因为 close 失败卡住）。
func gracefulExit(code int) {
	if err := CloseAIDB(); err != nil {
		log.Printf("graceful exit: CloseAIDB failed: %v", err)
	}
	os.Exit(code)
}
