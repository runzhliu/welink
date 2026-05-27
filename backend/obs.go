package main

import (
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
	"time"
)

// ─── 可观测性：slog 初始化 + std log 桥接 ────────────────────────────────────
//
// WeLink 是单进程桌面/自托管应用，不需要 OTEL 那一套分布式追踪。
// 这里用标准库 log/slog 提供结构化日志 + 三个热点函数手动 timing：
//   1. LLM 调用（streamOpenAICompat / streamClaude / streamBedrock / streamVertex）
//   2. Embedding 调用（GetEmbeddingsBatch）
//   3. RAG 检索（SearchFTS / SearchVec）
//
// 老代码继续用 log.Printf —— 这里把 std log 的输出桥接进 slog，不动 97 处旧调用。

// InitObs 初始化全局 slog logger 并桥接 stdlib log。
//
//   - out: 日志落地的 writer（nil → os.Stderr）。App 模式会传 welink.log 文件
//   - debug: 强制开启 DEBUG 级别；非 debug 模式下读环境变量决定
//
// 环境变量（debug=false 时生效）：
//
//   - WELINK_LOG_LEVEL=debug|info|warn|error  默认 info
//   - WELINK_LOG_FORMAT=json|text             默认 text（人类可读）
//
// 旧的 100+ log.Printf 调用会通过 stdLogBridge 进入 slog（INFO 级别 +
// source=stdlog 字段），不需要逐个改写。新代码请直接用 slog 以获得结构化字段。
func InitObs(out io.Writer, debug bool) {
	if out == nil {
		out = os.Stderr
	}
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	} else {
		switch strings.ToLower(os.Getenv("WELINK_LOG_LEVEL")) {
		case "debug":
			level = slog.LevelDebug
		case "warn", "warning":
			level = slog.LevelWarn
		case "error":
			level = slog.LevelError
		}
	}

	opts := &slog.HandlerOptions{Level: level}
	// 默认格式按输出位置选：
	//   - stderr / stdout（容器日志 / 终端 / go run）→ text，人类可读
	//   - 其他 writer（如 welink.log 文件）→ json，方便 jq / 日志收集器解析
	// WELINK_LOG_FORMAT=json|text 显式覆盖
	useJSON := out != os.Stderr && out != os.Stdout
	switch strings.ToLower(os.Getenv("WELINK_LOG_FORMAT")) {
	case "json":
		useJSON = true
	case "text":
		useJSON = false
	}
	var h slog.Handler
	if useJSON {
		h = slog.NewJSONHandler(out, opts)
	} else {
		h = slog.NewTextHandler(out, opts)
	}
	slog.SetDefault(slog.New(h))

	// 把 std log 的输出桥接到 slog —— 老 log.Printf 调用现在会变成
	// slog 的 INFO 级别记录，带 source=stdlog 字段。
	log.SetFlags(0)
	log.SetOutput(stdLogBridge{})
}

// stdLogBridge 把 std log 的字节流转成 slog.Info 调用。
type stdLogBridge struct{}

func (stdLogBridge) Write(p []byte) (int, error) {
	msg := strings.TrimRight(string(p), "\n")
	if msg == "" {
		return len(p), nil
	}
	slog.Info(msg, "source", "stdlog")
	return len(p), nil
}

// ─── 热点函数 timing 助手 ─────────────────────────────────────────────────

// obsTimer 在热点函数入口创建，defer .Done(...) 时记录 duration_ms。
type obsTimer struct {
	op    string
	start time.Time
}

func startTimer(op string) obsTimer {
	return obsTimer{op: op, start: time.Now()}
}

// Done 记录一次调用的耗时和上下文字段。
// err 非 nil 时记 ERROR 级别，否则 INFO。
func (t obsTimer) Done(err error, attrs ...any) {
	ms := time.Since(t.start).Milliseconds()
	args := append([]any{"op", t.op, "ms", ms}, attrs...)
	if err != nil {
		args = append(args, "err", err.Error())
		slog.Error("op_done", args...)
		return
	}
	slog.Info("op_done", args...)
}
