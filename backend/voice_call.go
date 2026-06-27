package main

// voice_call.go — 「语音 / 通话档案」 Lab 的 HTTP 入口
//
// 把私聊里被其它分析忽略的语音条（type 34）和音视频通话（type 50）聚合成三个榜：
//   - 煲电话粥榜：和谁接通通话累计时长最长
//   - 最长一次通话：单次最长
//   - 语音条之王：谁最爱给你发语音
// 外加全局汇总（你这些年总共通话多久 / 收了多少条语音）。零 LLM、纯解析。
//
// API:
//   GET  /api/labs/voice-call[?refresh=1]
//   POST /api/labs/voice-call

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const vcCacheTTL = 30 * time.Minute

var (
	vcCacheMu  sync.Mutex
	vcCacheVal *service.VCProfile
	vcCacheAt  time.Time
)

func registerVoiceCallRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/labs/voice-call", voiceCallHandler(getSvc))
	prot.POST("/labs/voice-call", voiceCallHandler(getSvc))
}

func voiceCallHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		refresh := c.Query("refresh") == "1"

		vcCacheMu.Lock()
		if !refresh && vcCacheVal != nil && time.Since(vcCacheAt) < vcCacheTTL {
			cached := *vcCacheVal
			vcCacheMu.Unlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		vcCacheMu.Unlock()

		t := startTimer("voice_call_build")
		resp := svc.VoiceCallProfile()
		resp.GeneratedAt = time.Now().Unix()
		t.Done(nil,
			"scanned_contacts", resp.ScannedContacts,
			"total_call_sec", resp.TotalCallSec,
			"total_voice_count", resp.TotalVoiceCount,
		)

		vcCacheMu.Lock()
		vcCacheVal = resp
		vcCacheAt = time.Now()
		vcCacheMu.Unlock()

		c.JSON(http.StatusOK, resp)
	}
}
