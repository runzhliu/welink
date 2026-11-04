package sft

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type inferenceChunk struct {
	Seq   int64  `json:"seq"`
	Data  string `json:"data"`
	Done  bool   `json:"done"`
	Error string `json:"error"`
}
type InferenceRequest struct {
	ID            string          `json:"id"`
	Deployment    string          `json:"deployment"`
	Body          json.RawMessage `json:"body"`
	owner, worker string
	claimed       bool
	seq           int64
	chunks        chan inferenceChunk
	done          chan struct{}
}

func (c *Controller) abortInference(owner, worker, message string) {
	c.tunnelMu.Lock()
	pending := []*InferenceRequest{}
	for _, q := range c.requests {
		if q.owner == owner && q.worker == worker {
			pending = append(pending, q)
		}
	}
	c.tunnelMu.Unlock()
	for _, q := range pending {
		go func(q *InferenceRequest) {
			select {
			case q.chunks <- inferenceChunk{Error: message}:
			case <-q.done:
			}
		}(q)
	}
}

func (c *Controller) tunnelRoutes(r *gin.RouterGroup) {
	r.GET("/inference-requests", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		c.tunnelMu.Lock()
		defer c.tunnelMu.Unlock()
		out := []*InferenceRequest{}
		for _, q := range c.requests {
			if q.owner == owner && q.worker == w.ID && !q.claimed {
				q.claimed = true
				out = append(out, q)
			}
		}
		ctx.JSON(200, out)
	})
	r.POST("/inference-requests/:id/chunks", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		var b inferenceChunk
		if !bind(ctx, &b) {
			return
		}
		if len(b.Data) > 256<<10 {
			ctx.AbortWithStatus(413)
			return
		}
		c.tunnelMu.Lock()
		q := c.requests[ctx.Param("id")]
		if q == nil || q.owner != owner || q.worker != w.ID {
			c.tunnelMu.Unlock()
			fail(ctx, ErrNotFound)
			return
		}
		if b.Seq <= q.seq {
			c.tunnelMu.Unlock()
			ctx.JSON(200, gin.H{"ok": true})
			return
		}
		if b.Seq != q.seq+1 {
			c.tunnelMu.Unlock()
			fail(ctx, ErrConflict)
			return
		}
		q.seq = b.Seq
		c.tunnelMu.Unlock()
		select {
		case q.chunks <- b:
			ctx.JSON(200, gin.H{"ok": true})
		case <-q.done:
			ctx.AbortWithStatus(410)
		case <-ctx.Request.Context().Done():
		case <-time.After(10 * time.Second):
			ctx.AbortWithStatus(504)
		}
	})
	r.POST("/deployments/:id/stopped", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		var d Deployment
		if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil || d.WorkerID != w.ID || d.ProjectID != w.ProjectID {
			fail(ctx, ErrNotFound)
			return
		}
		var b struct {
			Failed bool `json:"failed"`
		}
		if !bind(ctx, &b) {
			return
		}
		d.State = "stopped"
		if b.Failed {
			d.State = "failed"
		}
		d.Stop = true
		e := c.store.put(owner, "deployment", d.ProjectID, d.ID, d)
		respond(ctx, d, e)
	})
}

// InferenceRoutes is outside the user API/PIN group: each installed LLM profile
// authenticates with its own revocable deployment credential.
func (c *Controller) InferenceRoutes(r *gin.RouterGroup) {
	r.POST("/:id/v1/chat/completions", func(ctx *gin.Context) {
		id := ctx.Param("id")
		var owner string
		var body []byte
		e := c.store.db.QueryRow(`SELECT owner,body FROM objects WHERE kind='deployment_secret' AND id=?`, id).Scan(&owner, &body)
		var expected string
		json.Unmarshal(body, &expected)
		got := strings.TrimPrefix(ctx.GetHeader("Authorization"), "Bearer ")
		if e != nil || expected == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(got)) != 1 {
			ctx.AbortWithStatusJSON(401, gin.H{"error": "模型凭据无效"})
			return
		}
		current := c.cfg.Owner
		if c.cfg.InferenceOwner != nil {
			current = c.cfg.InferenceOwner
		}
		if current() != owner {
			ctx.AbortWithStatusJSON(403, gin.H{"error": "此训练模型属于另一个数据账号，请切换回原账号或选择其他模型"})
			return
		}
		ctx.Set("sft_owner", owner)
		c.chat(ctx)
	})
}
func (c *Controller) chat(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	var d Deployment
	if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	d = c.refreshDeployment(owner, d)
	if d.State != "online" {
		ctx.JSON(503, gin.H{"error": "训练模型的推理服务未在线，请返回 SFT 工作台检查环境"})
		return
	}
	var input struct {
		Messages    []Message `json:"messages"`
		Stream      bool      `json:"stream"`
		Temperature float64   `json:"temperature"`
		MaxTokens   int       `json:"max_tokens"`
	}
	if !bind(ctx, &input) {
		return
	}
	if len(input.Messages) == 0 || len(input.Messages) > 64 {
		fail(ctx, fmt.Errorf("消息数量不正确"))
		return
	}
	for _, m := range input.Messages {
		if (m.Role != "user" && m.Role != "assistant" && m.Role != "system") || len(m.Content) > 32000 {
			fail(ctx, fmt.Errorf("消息角色或长度不正确"))
			return
		}
	}
	if input.MaxTokens <= 0 || input.MaxTokens > 2048 {
		input.MaxTokens = 512
	}
	if input.Temperature < 0 || input.Temperature > 2 {
		fail(ctx, fmt.Errorf("temperature 超出范围"))
		return
	}
	wantStream := input.Stream
	input.Stream = true
	q := &InferenceRequest{ID: ID("request"), Deployment: d.ID, Body: encode(input), owner: owner, worker: d.WorkerID, chunks: make(chan inferenceChunk, 64), done: make(chan struct{})}
	c.tunnelMu.Lock()
	if len(c.requests) >= 16 {
		c.tunnelMu.Unlock()
		ctx.JSON(429, gin.H{"error": "试聊请求过多，请稍后再试"})
		return
	}
	c.requests[q.ID] = q
	c.tunnelMu.Unlock()
	defer func() { c.tunnelMu.Lock(); delete(c.requests, q.ID); close(q.done); c.tunnelMu.Unlock() }()
	if wantStream {
		ctx.Header("Content-Type", "text/event-stream")
		ctx.Header("Cache-Control", "no-cache")
		ctx.Header("X-Accel-Buffering", "no")
		ctx.Writer.Flush()
	}
	deadline := time.NewTimer(3 * time.Minute)
	defer deadline.Stop()
	ping := time.NewTicker(10 * time.Second)
	defer ping.Stop()
	var content strings.Builder
	for {
		select {
		case <-ctx.Request.Context().Done():
			return
		case <-deadline.C:
			if wantStream {
				fmt.Fprint(ctx.Writer, "data: {\"error\":\"推理超时\"}\n\n")
				ctx.Writer.Flush()
			} else {
				ctx.JSON(504, gin.H{"error": "推理超时"})
			}
			return
		case <-ping.C:
			if wantStream {
				fmt.Fprint(ctx.Writer, ": heartbeat\n\n")
				ctx.Writer.Flush()
			}
		case chunk := <-q.chunks:
			if chunk.Error != "" {
				if wantStream {
					fmt.Fprintf(ctx.Writer, "data: %s\n\n", encode(gin.H{"error": chunk.Error}))
					ctx.Writer.Flush()
				} else {
					ctx.JSON(502, gin.H{"error": chunk.Error})
				}
				return
			}
			if chunk.Data != "" {
				if wantStream {
					fmt.Fprintf(ctx.Writer, "data: %s\n\n", chunk.Data)
					ctx.Writer.Flush()
				} else {
					var delta struct {
						Choices []struct {
							Delta struct {
								Content string `json:"content"`
							} `json:"delta"`
						} `json:"choices"`
					}
					if json.Unmarshal([]byte(chunk.Data), &delta) == nil && len(delta.Choices) > 0 {
						content.WriteString(delta.Choices[0].Delta.Content)
					}
				}
			}
			if chunk.Done {
				if wantStream {
					fmt.Fprint(ctx.Writer, "data: [DONE]\n\n")
					ctx.Writer.Flush()
				} else {
					ctx.JSON(http.StatusOK, gin.H{"id": q.ID, "object": "chat.completion", "model": d.RunID, "choices": []gin.H{{"index": 0, "message": Message{Role: "assistant", Content: content.String()}, "finish_reason": "stop"}}})
				}
				return
			}
		}
	}
}
