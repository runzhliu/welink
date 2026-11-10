package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"
	"welink/backend/service"
	"welink/backend/sft"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// The existing screen lock is client-only. SFT additionally gates every user
// data/control request on a short-lived backend session when a PIN is enabled.
func sftPINGate(api *gin.RouterGroup) gin.HandlerFunc {
	var mu sync.Mutex
	type session struct {
		expires time.Time
		pinHash string
	}
	sessions := map[string]session{}
	attempts := map[string][]time.Time{}
	api.POST("/sft/unlock", func(c *gin.Context) {
		if !sftUserOriginAllowed(c) {
			c.AbortWithStatusJSON(401, gin.H{"error": "请从 WeLink 或已配对客户端解锁"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		p := loadPreferences()
		if p.LockPinHash == "" {
			c.JSON(200, gin.H{"session": ""})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		key, _, _ := net.SplitHostPort(c.Request.RemoteAddr)
		recent := []time.Time{}
		for _, t := range attempts[key] {
			if time.Since(t) < time.Minute {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 5 {
			c.JSON(429, gin.H{"error": "尝试过于频繁，请一分钟后再试"})
			return
		}
		attempts[key] = append(recent, time.Now())
		var body struct {
			Pin string `json:"pin"`
		}
		if c.ShouldBindJSON(&body) != nil || bcrypt.CompareHashAndPassword([]byte(p.LockPinHash), []byte(body.Pin)) != nil {
			c.JSON(401, gin.H{"error": "PIN 不正确"})
			return
		}
		token := sft.ID("session")
		sessions[token] = session{time.Now().Add(30 * time.Minute), p.LockPinHash}
		c.JSON(200, gin.H{"session": token})
	})
	return func(c *gin.Context) {
		if !sftUserOriginAllowed(c) {
			c.AbortWithStatusJSON(401, gin.H{"error": "远程 SFT 工作台需要先启用 WeLink 配对鉴权"})
			return
		}
		if loadPreferences().LockPinHash != "" {
			mu.Lock()
			expires, ok := sessions[c.GetHeader("X-SFT-Session")]
			for k, v := range sessions {
				if v.expires.Before(time.Now()) {
					delete(sessions, k)
				}
			}
			mu.Unlock()
			if !ok || expires.expires.Before(time.Now()) || expires.pinHash != loadPreferences().LockPinHash {
				c.AbortWithStatusJSON(423, gin.H{"error": "请验证 PIN 后进入模型训练", "reason_code": "sft_locked"})
				return
			}
		}
		c.Next()
	}
}

func registerSFTRoutes(r *gin.Engine, api, prot *gin.RouterGroup, acquire func() (*service.ContactService, func()), active func() *service.ContactService, port func() string) {
	gate := sftPINGate(api)
	owner := func() string {
		svc, release := acquire()
		if svc == nil {
			return ""
		}
		defer release()
		return svc.SFTIdentity()
	}
	registerAgentManagementRoutes(api, gate, owner)
	cfg := sft.Config{Root: filepath.Join(filepath.Dir(preferencesPath()), "sft-data"), Owner: owner}
	cfg.InferenceOwner = func() string {
		svc := active()
		if svc == nil {
			return ""
		}
		return svc.SFTIdentity()
	}
	cfg.Source = func(ctx context.Context, expected string, scope sft.Scope, visit func(sft.SourceMessage) error) (string, error) {
		svc, release := acquire()
		if svc == nil {
			return "", fmt.Errorf("当前数据账号尚未就绪")
		}
		defer release()
		if svc.SFTIdentity() != expected {
			return "", sft.ErrConflict
		}
		prefs := loadPreferences()
		blocked := map[string]bool{}
		for _, u := range prefs.BlockedUsers {
			blocked[u] = true
		}
		selected := map[string]bool{}
		for _, u := range scope.Contacts {
			selected[u] = true
		}
		stats := append([]service.ContactStatsExtended(nil), svc.GetCachedStats()...)
		sort.Slice(stats, func(i, j int) bool { return stats[i].Username < stats[j].Username })
		h := sha256.New()
		for _, contact := range stats {
			u := contact.Username
			if blocked[u] || contact.MyMessages == 0 || (len(selected) > 0 && !selected[u]) {
				continue
			}
			if e := svc.WalkSFTMessages(ctx, u, scope.From, scope.To, func(m sft.SourceMessage) error {
				fmt.Fprintf(h, "%s:%d:%t:%s\n", m.ID, m.Timestamp, m.Mine, m.Content)
				return visit(m)
			}); e != nil {
				return "", e
			}
		}
		return fmt.Sprintf("%x", h.Sum(nil)), nil
	}
	configureSFTProfiles(&cfg, port)
	controller, e := sft.New(cfg)
	if e != nil {
		log.Printf("[SFT] 初始化失败: %v", e)
		return
	}
	sftShutdownHook.Store(func() {
		if e := controller.ShutdownLocal(); e != nil {
			log.Printf("[SFT] 本机停止请求写入失败: %v", e)
		}
	})
	group := api.Group("/sft")
	group.Use(gate)
	controller.Routes(group)
	// Independent, narrowly scoped worker and inference credentials. Neither
	// endpoint grants access to general WeLink APIs or a shell.
	controller.WorkerRoutes(r.Group("/api/sft-worker"))
	controller.InferenceRoutes(r.Group("/api/sft-inference"))
}
func syncSFTDefault(p *Preferences) {
	if len(p.LLMProfiles) == 0 {
		return
	}
	v := p.LLMProfiles[0]
	p.LLMProvider = v.Provider
	p.LLMAPIKey = v.APIKey
	p.LLMBaseURL = v.BaseURL
	p.LLMModel = v.Model
}

func configureSFTProfiles(cfg *sft.Config, port func() string) {
	cfg.ProfileExists = func(id string) bool {
		for _, p := range loadPreferences().LLMProfiles {
			if p.ID == id {
				return true
			}
		}
		return false
	}
	sftPortResolver.Store(port)
	cfg.Connect = func(deployment, name, secret string) (string, error) {
		id := "sft-" + deployment
		_, e := updatePreferences(func(p *Preferences) {
			for i, prof := range p.LLMProfiles {
				if prof.ID == id {
					p.LLMProfiles[i].APIKey = secret
					p.LLMProfiles[i].BaseURL = sftInferenceURL(deployment, p.LLMProfiles[i].BaseURL)
					return
				}
			}
			if len(p.LLMProfiles) == 0 {
				p.LLMProfiles = append(p.LLMProfiles, LLMProfile{ID: "sft-previous-default", Name: "原默认配置", Provider: p.LLMProvider, APIKey: p.LLMAPIKey, BaseURL: p.LLMBaseURL, Model: p.LLMModel})
			}
			p.LLMProfiles = append(p.LLMProfiles, LLMProfile{ID: id, Name: name, Provider: "custom", BaseURL: "http://127.0.0.1:" + port() + "/api/sft-inference/" + deployment + "/v1", Model: deployment, APIKey: secret, SFTDeploymentID: deployment})
		})
		return id, e
	}
	cfg.Default = func(profile string) (string, error) {
		previous := ""
		found := false
		_, e := updatePreferences(func(p *Preferences) {
			if len(p.LLMProfiles) == 0 {
				return
			}
			previous = p.LLMProfiles[0].ID
			for i, v := range p.LLMProfiles {
				if v.ID == profile {
					found = true
					p.LLMProfiles = append([]LLMProfile{v}, append(p.LLMProfiles[:i], p.LLMProfiles[i+1:]...)...)
					syncSFTDefault(p)
					return
				}
			}
		})
		if e == nil && !found {
			e = fmt.Errorf("模型配置已被删除")
		}
		return previous, e
	}
	cfg.Rollback = func(current, previous string) error {
		conflict := false
		found := false
		_, e := updatePreferences(func(p *Preferences) {
			if len(p.LLMProfiles) == 0 || p.LLMProfiles[0].ID != current {
				conflict = true
				return
			}
			for i, v := range p.LLMProfiles {
				if v.ID == previous {
					found = true
					p.LLMProfiles = append([]LLMProfile{v}, append(p.LLMProfiles[:i], p.LLMProfiles[i+1:]...)...)
					syncSFTDefault(p)
					return
				}
			}
		})
		if conflict {
			return fmt.Errorf("默认模型已修改，未覆盖你的新选择")
		}
		if !found {
			return fmt.Errorf("原默认配置已删除，请在设置中选择")
		}
		return e
	}
}

var sftPortResolver atomic.Value

func sftInferenceURL(deployment, fallback string) string {
	if value := sftPortResolver.Load(); value != nil {
		return "http://127.0.0.1:" + value.(func() string)() + "/api/sft-inference/" + deployment + "/v1"
	}
	return fallback
}
func sftUserOriginAllowed(c *gin.Context) bool {
	if hasValidPairingToken(c.Request) {
		return true
	}
	if !isLoopbackRequest(c.Request) {
		return false
	}
	if origin := c.GetHeader("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
			return false
		}
	}
	return true
}

var sftShutdownHook atomic.Value

func shutdownSFTRuntime() {
	if hook := sftShutdownHook.Load(); hook != nil {
		hook.(func())()
		time.Sleep(2 * time.Second)
	}
}
