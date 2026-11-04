package sft

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type Controller struct {
	store       *Store
	cfg         Config
	buildSlots  chan struct{}
	tunnelMu    sync.Mutex
	requests    map[string]*InferenceRequest
	uploadLocks sync.Map // per artifact: slow transfers never hold the metadata mutex
}

func New(cfg Config) (*Controller, error) {
	s, e := Open(cfg.Root)
	if e != nil {
		return nil, e
	}
	return &Controller{store: s, cfg: cfg, buildSlots: make(chan struct{}, 1), requests: map[string]*InferenceRequest{}}, nil
}
func (c *Controller) Close() error { return c.store.Close() }
func newHash() hash.Hash           { return sha256.New() }
func loopback(r *http.Request) bool {
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// Proxy TLS is trusted only from an explicitly configured TCP peer, never from
// a forwarded header supplied directly by an external client.
func trustedTLSProxy(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	trusted := net.ParseIP(os.Getenv("WELINK_SFT_TLS_PROXY"))
	return ip != nil && trusted != nil && ip.Equal(trusted) && r.Header.Get("X-Forwarded-Proto") == "https"
}
func fail(c *gin.Context, e error) {
	status := 422
	code := "validation_failed"
	if errors.Is(e, ErrNotFound) {
		status = 404
		code = "not_found"
	}
	if errors.Is(e, ErrConflict) {
		status = 409
		code = "state_conflict"
	}
	c.AbortWithStatusJSON(status, gin.H{"error": e.Error(), "reason_code": code})
}
func respond(c *gin.Context, v any, e error) {
	if e != nil {
		fail(c, e)
		return
	}
	c.JSON(200, v)
}
func bind(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*MaxImportBytes+(1<<20))
	if e := c.ShouldBindJSON(v); e != nil {
		c.AbortWithStatusJSON(400, gin.H{"error": "请求格式错误或超过大小限制"})
		return false
	}
	return true
}

func (c *Controller) Routes(r *gin.RouterGroup) {
	// The integration mounts this group behind the application's auth and SFT PIN gate.
	r.Use(func(ctx *gin.Context) {
		owner := c.cfg.Owner()
		if owner == "" {
			ctx.AbortWithStatusJSON(503, gin.H{"error": "请先配置当前数据账号"})
			return
		}
		if expected := ctx.GetHeader("X-SFT-Owner"); expected != "" && expected != owner && !strings.HasSuffix(ctx.Request.URL.Path, "/capabilities") {
			fail(ctx, ErrConflict)
			return
		}
		ctx.Set("sft_owner", owner)
		ctx.Next()
	})
	owner := func(ctx *gin.Context) string { return ctx.GetString("sft_owner") }
	r.GET("/capabilities", func(ctx *gin.Context) {
		ctx.JSON(200, gin.H{"protocol": Protocol, "pipeline": Pipeline, "owner": owner(ctx), "minimums": gin.H{"standard": []int{500, 50, 50}, "validation": []int{100, 10, 10}}, "engines": []string{"mlx", "llamafactory"}})
	})
	r.GET("/projects", func(ctx *gin.Context) { v, e := c.store.list(owner(ctx), "project", ""); respond(ctx, v, e) })
	r.POST("/projects", func(ctx *gin.Context) {
		key := ctx.GetHeader("Idempotency-Key")
		if key == "" || len(key) > 128 {
			fail(ctx, fmt.Errorf("需要 Idempotency-Key"))
			return
		}
		var b struct {
			Name string `json:"name"`
		}
		if !bind(ctx, &b) {
			return
		}
		b.Name = strings.TrimSpace(b.Name)
		if b.Name == "" || len([]rune(b.Name)) > 60 {
			fail(ctx, fmt.Errorf("项目名称需要 1–60 个字"))
			return
		}
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		id := "project_" + digest([]byte(owner(ctx) + ":" + key))[:32]
		var previous Project
		if c.store.get(owner(ctx), "project", id, &previous) == nil {
			if previous.Name != b.Name {
				fail(ctx, ErrConflict)
				return
			}
			respond(ctx, previous, nil)
			return
		}
		p := Project{ID: id, Name: b.Name, CreatedAt: now()}
		e := c.store.put(owner(ctx), "project", p.ID, p.ID, p)
		respond(ctx, p, e)
	})
	r.GET("/projects/:id", func(ctx *gin.Context) {
		var p Project
		e := c.store.get(owner(ctx), "project", ctx.Param("id"), &p)
		respond(ctx, p, e)
	})
	r.GET("/datasets", func(ctx *gin.Context) {
		v, e := c.store.list(owner(ctx), "dataset", ctx.Query("project_id"))
		respond(ctx, v, e)
	})
	r.POST("/projects/:id/datasets", c.createDataset)
	r.POST("/datasets/:id/fork", c.forkDataset)
	r.GET("/datasets/:id/report", func(ctx *gin.Context) {
		var d Dataset
		e := c.store.get(owner(ctx), "dataset", ctx.Param("id"), &d)
		respond(ctx, d, e)
	})
	r.GET("/datasets/:id/samples", c.samples)
	r.PATCH("/datasets/:id/reviews", c.review)
	r.POST("/datasets/:id/freeze", func(ctx *gin.Context) {
		var b struct {
			Revision int `json:"revision"`
		}
		if !bind(ctx, &b) {
			return
		}
		d, e := c.store.freeze(owner(ctx), ctx.Param("id"), b.Revision)
		respond(ctx, d, e)
	})
	r.GET("/dataset-versions/:id/export", c.exportDataset)
	r.GET("/workers", func(ctx *gin.Context) {
		rows, e := c.store.db.Query(`SELECT body FROM workers WHERE owner=? ORDER BY id`, owner(ctx))
		if e != nil {
			fail(ctx, e)
			return
		}
		defer rows.Close()
		out := []json.RawMessage{}
		for rows.Next() {
			var b []byte
			rows.Scan(&b)
			out = append(out, b)
		}
		respond(ctx, out, rows.Err())
	})
	r.POST("/workers/pairings", func(ctx *gin.Context) {
		var b struct {
			ProjectID string `json:"project_id"`
		}
		if !bind(ctx, &b) {
			return
		}
		code, e := c.store.pair(owner(ctx), b.ProjectID)
		respond(ctx, gin.H{"code": code, "expires_at": now() + 600}, e)
	})
	r.DELETE("/workers/:id/binding", func(ctx *gin.Context) {
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		w, e := c.store.worker(owner(ctx), ctx.Param("id"))
		if e != nil {
			fail(ctx, e)
			return
		}
		w.Revoked = true
		deploys, _ := c.store.list(owner(ctx), "deployment", w.ProjectID)
		for _, b := range deploys {
			var d Deployment
			json.Unmarshal(b, &d)
			if d.WorkerID == w.ID && d.State != "stopped" {
				d.Stop = true
				d.State = "stopping"
				c.store.put(owner(ctx), "deployment", d.ProjectID, d.ID, d)
			}
		}
		_, e = c.store.db.Exec(`UPDATE workers SET body=? WHERE id=? AND owner=?`, string(encode(w)), w.ID, owner(ctx))
		c.abortInference(owner(ctx), w.ID, "训练环境授权已撤销")
		respond(ctx, gin.H{"ok": e == nil}, e)
	})
	r.POST("/preflights", c.createPreflight)
	r.POST("/runs", c.createRun)
	r.GET("/runs", func(ctx *gin.Context) { v, e := c.store.jobs(owner(ctx), ctx.Query("project_id")); respond(ctx, v, e) })
	r.GET("/runs/:id", func(ctx *gin.Context) {
		j, e := c.store.job(owner(ctx), ctx.Param("id"))
		j.Fence = ""
		if j.Kind == "evaluate" {
			j.Result = nil
		}
		respond(ctx, j, e)
	})
	r.GET("/jobs/:id/events", c.events)
	r.POST("/jobs/:id/cancel", func(ctx *gin.Context) {
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		j, e := c.store.job(owner(ctx), ctx.Param("id"))
		if e != nil {
			fail(ctx, e)
			return
		}
		if !terminal(j.State) {
			j.Cancel = true
			if j.State == "queued" {
				j.State = "canceled"
			} else {
				j.State = "stopping"
			}
			e = c.store.saveJob(owner(ctx), j)
		}
		j.Fence = ""
		if j.Kind == "evaluate" {
			j.Result = nil
		}
		respond(ctx, j, e)
	})
	r.GET("/runs/:id/checkpoints", func(ctx *gin.Context) {
		if _, e := c.store.job(owner(ctx), ctx.Param("id")); e != nil {
			fail(ctx, e)
			return
		}
		v, e := c.store.list(owner(ctx), "artifact", ctx.Param("id"))
		respond(ctx, v, e)
	})
	r.POST("/runs/:id/resume", c.resume)
	r.GET("/artifacts/:id/download", func(ctx *gin.Context) {
		var a Artifact
		if e := c.store.get(owner(ctx), "artifact", ctx.Param("id"), &a); e != nil {
			fail(ctx, e)
			return
		}
		ctx.FileAttachment(c.artifactFile(owner(ctx), a), a.Name)
	})
	r.POST("/evaluations", c.createEvaluation)
	r.GET("/evaluations/:id", c.evaluation)
	r.POST("/evaluations/:id/votes", c.vote)
	r.GET("/models", c.models)
	r.POST("/models/:id/deployments", c.createDeployment)
	r.POST("/deployments/:id/connect", c.connect)
	r.POST("/deployments/:id/default", c.makeDefault)
	r.POST("/deployments/:id/rollback", c.rollback)
	r.POST("/deployments/:id/stop", c.stopDeployment)
	r.POST("/deployments/:id/chat", c.chat)
	c.cleanupRoutes(r)
}
func (c *Controller) createDataset(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	project := ctx.Param("id")
	var p Project
	if e := c.store.get(owner, "project", project, &p); e != nil {
		fail(ctx, e)
		return
	}
	var b struct {
		Name  string `json:"name"`
		Scope Scope  `json:"scope"`
		JSONL string `json:"jsonl"`
	}
	if !bind(ctx, &b) {
		return
	}
	if len(b.Scope.Contacts) > 500 || b.Scope.From < 0 || b.Scope.To < 0 || (b.Scope.To > 0 && b.Scope.From > b.Scope.To) {
		fail(ctx, fmt.Errorf("数据范围不正确"))
		return
	}
	requestedName := b.Name
	if b.Name == "" {
		b.Name = time.Now().Format("2006-01-02 15:04")
	}
	if len([]rune(b.Name)) > 80 {
		fail(ctx, fmt.Errorf("数据名称过长"))
		return
	}
	// Acquire a bounded source-build slot before allocating durable state.
	select {
	case c.buildSlots <- struct{}{}:
	default:
		ctx.JSON(409, gin.H{"error": "正在准备另一份数据，请稍后重试"})
		return
	}
	c.store.mu.Lock()
	j, e := c.store.newJob(owner, project, "dataset", "", ctx.GetHeader("Idempotency-Key"), TrainConfig{}, gin.H{"name": requestedName, "scope": b.Scope, "import_hash": digest([]byte(b.JSONL))})
	if e != nil || j.State != "queued" {
		c.store.mu.Unlock()
		<-c.buildSlots
		respond(ctx, j, e)
		return
	}
	d := Dataset{ID: ID("ds"), ProjectID: project, Name: b.Name, Scope: b.Scope, State: "building", Revision: 1, Pipeline: Pipeline, CreatedAt: now()}
	j.State = "running"
	j.Result = encode(gin.H{"dataset_id": d.ID})
	e = c.store.put(owner, "dataset", project, d.ID, d)
	if e == nil {
		e = c.store.saveJob(owner, j)
	}
	c.store.mu.Unlock()
	if e != nil {
		<-c.buildSlots
		fail(ctx, e)
		return
	}
	go func() {
		defer func() { <-c.buildSlots }()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() {
			ticker := time.NewTicker(500 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					current, err := c.store.job(owner, j.ID)
					if err != nil || current.Cancel {
						cancel()
						return
					}
				}
			}
		}()
		var samples []Sample
		var report Report
		var fingerprint string
		var err error
		if b.JSONL != "" {
			samples, report, err = Import(strings.NewReader(b.JSONL), owner)
			fingerprint = digest([]byte(b.JSONL))
		} else {
			builder := NewBuilder(owner)
			if c.cfg.Source == nil {
				err = fmt.Errorf("未配置消息来源")
			} else {
				fingerprint, err = c.cfg.Source(ctx, owner, b.Scope, builder.Add)
			}
			if err == nil {
				samples, report = builder.Finish()
			}
		}
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		current, _ := c.store.job(owner, j.ID)
		if current.Cancel {
			d.State = "canceled"
			current.State = "canceled"
		} else if err != nil {
			d.State = "failed"
			current.State = "failed"
			current.Error = err.Error()
		} else {
			d.State = "draft"
			d.Report = report
			d.SourceFingerprint = fingerprint
			err = c.store.saveSamples(owner, d.ID, samples)
			if err == nil {
				current.State = "succeeded"
			} else {
				d.State = "failed"
				current.State = "failed"
				current.Error = "保存数据失败"
			}
		}
		c.store.put(owner, "dataset", project, d.ID, d)
		c.store.saveJob(owner, current)
	}()
	ctx.JSON(202, gin.H{"job": j, "dataset": d})
}
func (c *Controller) samples(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	var d Dataset
	if e := c.store.get(owner, "dataset", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	all, e := c.store.sampleList(owner, d.ID)
	if e != nil {
		fail(ctx, e)
		return
	}
	filtered := []Sample{}
	for _, v := range all {
		if ctx.Query("review") != "" && v.Review != ctx.Query("review") {
			continue
		}
		if ctx.Query("issues") == "true" && len(v.Issues) == 0 {
			continue
		}
		if ctx.Query("contact") != "" && v.Contact != ctx.Query("contact") {
			continue
		}
		v.Sources = nil
		filtered = append(filtered, v)
	}
	offset, _ := strconv.Atoi(ctx.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	if offset > len(filtered) {
		offset = len(filtered)
	}
	end := offset + 20
	if end > len(filtered) {
		end = len(filtered)
	}
	ctx.JSON(200, gin.H{"samples": filtered[offset:end], "total": len(filtered), "revision": d.Revision})
}
func (c *Controller) review(ctx *gin.Context) {
	var b struct {
		Revision int       `json:"revision"`
		IDs      []string  `json:"ids"`
		Action   string    `json:"action"`
		Messages []Message `json:"messages"`
	}
	if !bind(ctx, &b) {
		return
	}
	if len(b.IDs) == 0 || len(b.IDs) > 200 || (b.Action != "keep" && b.Action != "exclude" && b.Action != "reset") {
		fail(ctx, fmt.Errorf("审核操作不正确"))
		return
	}
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	owner := ctx.GetString("sft_owner")
	var d Dataset
	if e := c.store.get(owner, "dataset", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	if d.State != "draft" || d.Revision != b.Revision {
		fail(ctx, ErrConflict)
		return
	}
	samples, e := c.store.sampleList(owner, d.ID)
	if e != nil {
		fail(ctx, e)
		return
	}
	wanted := map[string]bool{}
	for _, id := range b.IDs {
		wanted[id] = true
	}
	changed := []Sample{}
	for i := range samples {
		v := &samples[i]
		if !wanted[v.ID] {
			continue
		}
		if len(b.Messages) > 0 {
			if len(b.IDs) != 1 {
				fail(ctx, fmt.Errorf("编辑每次只支持一条样本"))
				return
			}
			if e = validateMessages(b.Messages); e != nil {
				fail(ctx, e)
				return
			}
			v.Messages = b.Messages
			for k := range v.Messages {
				v.Messages[k].Content, _ = redact(v.Messages[k].Content)
			}
			v.Cluster = digest([]byte(canonical(v.Messages)))
		}
		switch b.Action {
		case "keep":
			v.Review = "kept"
		case "exclude":
			v.Review = "excluded"
		case "reset":
			v.Review = "pending"
		}
		changed = append(changed, *v)
	}
	if len(changed) != len(wanted) {
		fail(ctx, ErrNotFound)
		return
	}
	totalBytes := 0
	for _, sample := range samples {
		size := len(encode(struct {
			Messages []Message `json:"messages"`
		}{sample.Messages})) + 1
		if size > 256<<10 {
			fail(ctx, fmt.Errorf("单条样本超过 256 KB，请减少上下文"))
			return
		}
		totalBytes += size
	}
	if totalBytes > MaxImportBytes {
		fail(ctx, fmt.Errorf("草稿文本超过 32 MB，请减少上下文或数据范围"))
		return
	}
	d.Revision++
	d.Report = report(samples, d.Report)
	e = c.store.commitDataset(owner, d, changed)
	respond(ctx, d, e)
}
func (c *Controller) exportDataset(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	var d Dataset
	if e := c.store.get(owner, "dataset", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	if d.State != "frozen" {
		fail(ctx, ErrConflict)
		return
	}
	for _, split := range []string{"train", "valid", "test"} {
		if _, e := c.store.verifyDatasetFile(owner, d, split); e != nil {
			fail(ctx, e)
			return
		}
	}
	ctx.Header("Content-Type", "application/zip")
	ctx.Header("Content-Disposition", `attachment; filename="welink-sft-dataset.zip"`)
	z := zip.NewWriter(ctx.Writer)
	defer z.Close()
	for _, split := range []string{"train", "valid", "test", "manifest"} {
		f, e := os.Open(c.store.file(owner, d.ID, split))
		if e != nil {
			return
		}
		name := split + ".jsonl"
		if split == "manifest" {
			name = "manifest.json"
		}
		w, e := z.Create(name)
		if e == nil {
			_, e = io.Copy(w, f)
		}
		f.Close()
		if e != nil {
			return
		}
	}
	info := map[string]any{}
	for _, split := range []string{"train", "valid", "test"} {
		info[split] = gin.H{"file_name": split + ".jsonl", "formatting": "sharegpt", "columns": gin.H{"messages": "messages"}, "tags": gin.H{"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}}
	}
	if w, e := z.Create("dataset_info.json"); e == nil {
		w.Write(encode(info))
	}
}

func (c *Controller) forkDataset(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	key := ctx.GetHeader("Idempotency-Key")
	if key == "" || len(key) > 128 {
		fail(ctx, fmt.Errorf("需要 Idempotency-Key"))
		return
	}
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	var original Dataset
	if e := c.store.get(owner, "dataset", ctx.Param("id"), &original); e != nil {
		fail(ctx, e)
		return
	}
	if original.State != "frozen" {
		fail(ctx, ErrConflict)
		return
	}
	id := "ds_" + digest([]byte(owner + original.ID + key))[:32]
	var previous Dataset
	if c.store.get(owner, "dataset", id, &previous) == nil {
		respond(ctx, previous, nil)
		return
	}
	samples, e := c.store.sampleList(owner, original.ID)
	if e != nil {
		fail(ctx, e)
		return
	}
	for i := range samples {
		samples[i].Split = ""
	}
	d := original
	d.ID = id
	d.Name = original.Name + " · 新草稿"
	d.State = "draft"
	d.Revision = 1
	d.SHA256 = ""
	d.FileSHA256 = nil
	d.CreatedAt = now()
	d.Report = report(samples, d.Report)
	e = c.store.commitDataset(owner, d, samples)
	respond(ctx, d, e)
}

var revisionRE = regexp.MustCompile(`^[a-fA-F0-9]{40,64}$`)
var modelRE = regexp.MustCompile(`^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`)
var gpuIDRE = regexp.MustCompile(`^[0-9]{1,2}$`)

func normalize(c *TrainConfig) error {
	c.Revision = strings.ToLower(c.Revision)
	if c.Preset == "" {
		c.Preset = "validation"
	}
	if c.Preset != "validation" && c.Preset != "standard" {
		return fmt.Errorf("未知训练预设")
	}
	if c.Engine != "mlx" && c.Engine != "llamafactory" {
		return fmt.Errorf("未知执行器")
	}
	if !modelRE.MatchString(c.Model) || !revisionRE.MatchString(c.Revision) {
		return fmt.Errorf("请选择 Hugging Face 模型 ID 和精确 commit revision，不能使用 main")
	}
	if c.MaxSteps == 0 {
		if c.Preset == "validation" {
			c.MaxSteps = 100
		} else {
			c.MaxSteps = 1000
		}
	}
	if c.MaxSeconds == 0 {
		c.MaxSeconds = 7200
	}
	if c.SequenceLength == 0 {
		c.SequenceLength = 2048
	}
	if c.LearningRate == 0 {
		c.LearningRate = 1e-4
	}
	if c.Rank == 0 {
		c.Rank = 16
	}
	if c.GradientAccumulation == 0 {
		c.GradientAccumulation = 8
	}
	if c.Seed == 0 {
		c.Seed = 42
	}
	if c.MaxSteps < 1 || c.MaxSteps > 100000 || c.MaxSeconds < 60 || c.MaxSeconds > 86400 || c.SequenceLength < 128 || c.SequenceLength > 8192 || c.LearningRate < 1e-7 || c.LearningRate > 0.01 || c.Rank < 1 || c.Rank > 128 || c.GradientAccumulation < 1 || c.GradientAccumulation > 64 {
		return fmt.Errorf("训练参数超过允许范围")
	}
	if c.Engine == "llamafactory" && (c.Template == "" || len(c.Template) > 80) {
		return fmt.Errorf("GPU 训练需要指定与模型匹配的 LLaMA-Factory template")
	}
	if c.GPU == "" {
		c.GPU = "0"
	}
	if !gpuIDRE.MatchString(c.GPU) {
		return fmt.Errorf("首版只支持单张指定 GPU（数字编号）")
	}
	return nil
}
func (c *Controller) validateConfig(owner string, config *TrainConfig) (Dataset, Worker, error) {
	var d Dataset
	var w Worker
	if e := normalize(config); e != nil {
		return d, w, e
	}
	if e := c.store.get(owner, "dataset", config.DatasetID, &d); e != nil {
		return d, w, e
	}
	if d.State != "frozen" {
		return d, w, fmt.Errorf("请先冻结数据版本")
	}
	minimum := []int{500, 50, 50}
	if config.Preset == "validation" {
		minimum = []int{100, 10, 10}
	}
	for i, split := range []string{"train", "valid", "test"} {
		if d.Report.Splits[split] < minimum[i] {
			return d, w, fmt.Errorf("%s 集不足 %d 条；请增加独立会话数据", split, minimum[i])
		}
	}
	w, e := c.store.worker(owner, config.WorkerID)
	if e != nil {
		return d, w, e
	}
	if w.Revoked || now()-w.LastSeen > 45 || w.ProjectID != d.ProjectID {
		return d, w, fmt.Errorf("环境离线、已撤销或未授权此项目")
	}
	var caps struct {
		Devices []struct {
			ID string `json:"id"`
		} `json:"devices"`
		Engines map[string]struct {
			Available bool `json:"available"`
		} `json:"engines"`
	}
	json.Unmarshal(w.Capabilities, &caps)
	if !caps.Engines[config.Engine].Available {
		return d, w, fmt.Errorf("所选环境尚未安装可用的训练执行器")
	}
	if config.Engine == "llamafactory" {
		found := false
		for _, device := range caps.Devices {
			found = found || device.ID == config.GPU
		}
		if !found {
			return d, w, fmt.Errorf("指定 GPU 未在该 worker 的可用设备列表中")
		}
	}
	return d, w, nil
}
func (c *Controller) createPreflight(ctx *gin.Context) {
	var config TrainConfig
	if !bind(ctx, &config) {
		return
	}
	if config.ParentRun != "" || config.ResumeMode != "" || config.Checkpoint != "" {
		fail(ctx, fmt.Errorf("预检只接受基础配置，继续训练请使用已校验的恢复入口"))
		return
	}
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	d, w, e := c.validateConfig(owner, &config)
	if e != nil {
		fail(ctx, e)
		return
	}
	j, e := c.store.newJob(owner, d.ProjectID, "preflight", w.ID, ctx.GetHeader("Idempotency-Key"), config, gin.H{"dataset_sha256": d.SHA256})
	respond(ctx, j, e)
}
func (c *Controller) createRun(ctx *gin.Context) {
	var b struct {
		PreflightID string `json:"preflight_id"`
	}
	if !bind(ctx, &b) {
		return
	}
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	pre, e := c.store.job(owner, b.PreflightID)
	if e != nil {
		fail(ctx, e)
		return
	}
	if pre.Kind != "preflight" || pre.State != "succeeded" || now()-pre.UpdatedAt > 86400 {
		fail(ctx, fmt.Errorf("需要 24 小时内通过的预检"))
		return
	}
	d, w, e := c.validateConfig(owner, &pre.Config)
	if e != nil {
		fail(ctx, e)
		return
	}
	j, e := c.store.newJob(owner, d.ProjectID, "train", w.ID, ctx.GetHeader("Idempotency-Key"), pre.Config, gin.H{"preflight_id": pre.ID, "preflight_result": json.RawMessage(pre.Result), "dataset_sha256": d.SHA256})
	respond(ctx, j, e)
}
func (c *Controller) resume(ctx *gin.Context) {
	var b struct {
		Mode       string `json:"mode"`
		ArtifactID string `json:"artifact_id"`
	}
	if !bind(ctx, &b) {
		return
	}
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	j, e := c.store.job(owner, ctx.Param("id"))
	if e != nil {
		fail(ctx, e)
		return
	}
	if j.Kind != "train" || !terminal(j.State) {
		fail(ctx, ErrConflict)
		return
	}
	var a Artifact
	if e = c.store.get(owner, "artifact", b.ArtifactID, &a); e != nil {
		fail(ctx, e)
		return
	}
	if a.JobID != j.ID || a.Resume != b.Mode || (b.Mode != "full_state" && b.Mode != "weights_only") {
		fail(ctx, fmt.Errorf("检查点不支持所选恢复方式"))
		return
	}
	config := j.Config
	config.ParentRun = j.ID
	config.ResumeMode = b.Mode
	config.Checkpoint = a.ID
	if _, _, e = c.validateConfig(owner, &config); e != nil {
		fail(ctx, e)
		return
	}
	v, e := c.store.newJob(owner, j.ProjectID, "train", j.WorkerID, ctx.GetHeader("Idempotency-Key"), config, gin.H{"parent": j.ID, "artifact": a, "original_input": j.Input})
	respond(ctx, v, e)
}
func (c *Controller) events(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	id := ctx.Param("id")
	if _, e := c.store.job(owner, id); e != nil {
		fail(ctx, e)
		return
	}
	after, _ := strconv.ParseInt(ctx.Query("after"), 10, 64)
	if v := ctx.GetHeader("Last-Event-ID"); v != "" {
		after, _ = strconv.ParseInt(v, 10, 64)
	}
	sse := strings.Contains(ctx.GetHeader("Accept"), "text/event-stream")
	if sse {
		ctx.Header("Content-Type", "text/event-stream")
		ctx.Header("Cache-Control", "no-cache")
		ctx.Header("X-Accel-Buffering", "no")
	}
	deadline := time.After(25 * time.Second)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		rows, e := c.store.db.Query(`SELECT body FROM events WHERE job=? AND seq>? ORDER BY seq LIMIT 500`, id, after)
		if e != nil {
			return
		}
		events := []Event{}
		for rows.Next() {
			var b []byte
			var ev Event
			rows.Scan(&b)
			json.Unmarshal(b, &ev)
			if ev.Type == "completed" {
				var value map[string]json.RawMessage
				if json.Unmarshal(ev.Data, &value) == nil {
					if _, ok := value["cases"]; ok {
						ev.Data = encode(gin.H{"state": "succeeded"})
					}
				}
			}
			events = append(events, ev)
		}
		rows.Close()
		if !sse {
			ctx.JSON(200, events)
			return
		}
		for _, ev := range events {
			fmt.Fprintf(ctx.Writer, "id: %d\ndata: %s\n\n", ev.Seq, encode(ev))
			after = ev.Seq
		}
		if len(events) == 0 {
			fmt.Fprint(ctx.Writer, ": heartbeat\n\n")
		}
		ctx.Writer.Flush()
		select {
		case <-ctx.Request.Context().Done():
			return
		case <-deadline:
			return
		case <-ticker.C:
		}
	}
}
