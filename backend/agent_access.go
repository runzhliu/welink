package main

// Agent credentials are deliberately separate from the full mobile pairing
// credential. The on-disk policy contains only a SHA-256 digest.
import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

type agentAccessPolicy struct {
	TokenSHA256   string    `json:"token_sha256"`
	OwnerID       string    `json:"owner_id,omitempty"`
	Conversations []string  `json:"conversations"`
	Actions       []string  `json:"actions"`
	ExpiresAt     time.Time `json:"expires_at"`
}

const agentScopeKey = "welink.agent.scope"

func agentAccessPath() string {
	path := os.Getenv("WELINK_AGENT_ACCESS_PATH")
	if path == "" {
		path = filepath.Join(filepath.Dir(preferencesPath()), "agent-access.json")
	}
	return path
}

func loadAgentAccessPolicy() *agentAccessPolicy {
	path := agentAccessPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var policy agentAccessPolicy
	if json.Unmarshal(data, &policy) != nil || policy.TokenSHA256 == "" || policy.ExpiresAt.IsZero() || !time.Now().Before(policy.ExpiresAt) {
		return nil
	}
	return &policy
}

func requireAgentAccess(c *gin.Context) {
	policy := loadAgentAccessPolicy()
	if policy == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Agent 凭据未配置或已过期"})
		return
	}
	want, err := hex.DecodeString(policy.TokenSHA256)
	credential := extractToken(c.Request)
	got := sha256.Sum256([]byte(credential))
	if credential == "" || err != nil || len(want) != len(got) || subtle.ConstantTimeCompare(want, got[:]) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Agent 凭据无效"})
		return
	}
	c.Set(agentScopeKey, policy)
	c.Next()
}

func (p *agentAccessPolicy) allows(username, action string) bool {
	conversationOK, actionOK := false, false
	for _, v := range p.Conversations {
		if v == username {
			conversationOK = true
			break
		}
	}
	for _, v := range p.Actions {
		if v == action {
			actionOK = true
			break
		}
	}
	return conversationOK && actionOK
}
