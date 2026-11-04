package sft

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

func (s *Store) pair(owner, project string) (string, error) {
	var p Project
	if e := s.get(owner, "project", project, &p); e != nil {
		return "", e
	}
	code := ID("pair")
	_, e := s.db.Exec(`INSERT INTO pairings VALUES(?,?,?,?)`, digest([]byte(code)), owner, project, now()+600)
	return code, e
}
func (s *Store) enroll(code, name string, caps json.RawMessage) (Worker, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var owner, project string
	e := s.db.QueryRow(`SELECT owner,project FROM pairings WHERE code_hash=? AND expires>?`, digest([]byte(code)), now()).Scan(&owner, &project)
	if e != nil {
		return Worker{}, "", fmt.Errorf("配对码无效或已过期")
	}
	var capability struct {
		Protocol int    `json:"protocol"`
		OS       string `json:"os"`
	}
	if json.Unmarshal(caps, &capability) != nil || capability.Protocol != Protocol {
		return Worker{}, "", fmt.Errorf("worker 协议版本不兼容")
	}
	w := Worker{ID: ID("worker"), Name: name, ProjectID: project, Capabilities: caps, LastSeen: now(), Local: capability.OS == "Darwin"}
	token := ID("secret") + ID("key")
	tx, e := s.db.Begin()
	if e != nil {
		return w, "", e
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`DELETE FROM pairings WHERE code_hash=?`, digest([]byte(code))); e != nil {
		return w, "", e
	}
	if _, e = tx.Exec(`INSERT INTO workers VALUES(?,?,?,?,?)`, w.ID, owner, project, digest([]byte(token)), string(encode(w))); e != nil {
		return w, "", e
	}
	e = tx.Commit()
	return w, token, e
}
func (s *Store) worker(owner, id string) (Worker, error) {
	var w Worker
	var b []byte
	e := s.db.QueryRow(`SELECT body FROM workers WHERE id=? AND owner=?`, id, owner).Scan(&b)
	if e != nil {
		return w, ErrNotFound
	}
	e = json.Unmarshal(b, &w)
	return w, e
}
func (s *Store) authenticate(token string) (Worker, string, error) {
	var w Worker
	var owner string
	var b []byte
	e := s.db.QueryRow(`SELECT owner,body FROM workers WHERE token_hash=?`, digest([]byte(token))).Scan(&owner, &b)
	if e != nil {
		return w, "", ErrNotFound
	}
	if e = json.Unmarshal(b, &w); e != nil {
		return w, "", ErrNotFound
	}
	return w, owner, nil
}
func (s *Store) claim(owner string, w Worker) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, e := s.jobsRaw(owner, w.ProjectID)
	if e != nil {
		return nil, e
	}
	for _, j := range jobs {
		if j.WorkerID == w.ID && !terminal(j.State) && j.State != "queued" {
			return nil, nil
		}
	}
	// One memory/device domain. A live inference deployment holds the same lease.
	deploys, e := s.list(owner, "deployment", w.ProjectID)
	if e != nil {
		return nil, e
	}
	for _, b := range deploys {
		var d Deployment
		json.Unmarshal(b, &d)
		dj, _ := s.job(owner, d.ID)
		if d.WorkerID == w.ID && dj.State == "succeeded" && d.State != "stopped" && d.State != "failed" {
			return nil, nil
		}
	}
	for i := len(jobs) - 1; i >= 0; i-- {
		j := jobs[i]
		if j.WorkerID != w.ID || j.State != "queued" {
			continue
		}
		j.State = "preparing"
		j.Attempt = ID("attempt")
		j.Fence = ID("fence")
		if e = s.saveJob(owner, j); e != nil {
			if strings.Contains(e.Error(), "UNIQUE constraint") {
				return nil, nil
			}
			return nil, e
		}
		return &j, nil
	}
	return nil, nil
}
func (s *Store) event(owner string, w Worker, id, attempt, fence string, ev Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.job(owner, id)
	if e != nil {
		return e
	}
	if j.WorkerID != w.ID || j.ProjectID != w.ProjectID || j.Attempt != attempt || subtle.ConstantTimeCompare([]byte(j.Fence), []byte(fence)) != 1 {
		return ErrConflict
	}
	if ev.Seq <= j.LastSeq {
		var b []byte
		if e = s.db.QueryRow(`SELECT body FROM events WHERE job=? AND seq=?`, id, ev.Seq).Scan(&b); e != nil {
			return ErrConflict
		}
		var prev Event
		json.Unmarshal(b, &prev)
		var oldData, newData any
		json.Unmarshal(prev.Data, &oldData)
		json.Unmarshal(ev.Data, &newData)
		if prev.Type != ev.Type || !reflect.DeepEqual(oldData, newData) {
			return ErrConflict
		}
		return nil
	}
	if terminal(j.State) || ev.Seq != j.LastSeq+1 {
		return ErrConflict
	}
	expectedSeq, expectedCancel := j.LastSeq, j.Cancel
	switch ev.Type {
	case "stage":
		var v struct {
			Stage string `json:"stage"`
		}
		json.Unmarshal(ev.Data, &v)
		if v.Stage != "preparing" && v.Stage != "running" && v.Stage != "saving" {
			return fmt.Errorf("无效阶段")
		}
		if !j.Cancel {
			j.State = v.Stage
		}
	case "metric", "log", "checkpoint":
	case "error":
		j.State = "failed"
		var v struct {
			Message string `json:"message"`
		}
		json.Unmarshal(ev.Data, &v)
		j.Error = v.Message
		if len(j.Error) > 2000 {
			j.Error = j.Error[:2000]
		}
	case "canceled":
		var stop struct {
			Reason string `json:"stop_reason"`
		}
		json.Unmarshal(ev.Data, &stop)
		if !j.Cancel && stop.Reason != "worker_stop" {
			return ErrConflict
		}
		j.State = "canceled"
		j.Result = ev.Data
	case "completed":
		if e = s.validateResult(owner, j, ev.Data); e != nil {
			return e
		}
		j.State = "succeeded"
		j.Result = ev.Data
	default:
		return fmt.Errorf("未知事件类型")
	}
	j.LastSeq = ev.Seq
	j.UpdatedAt = now()
	ev.CreatedAt = now()
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`INSERT INTO events VALUES(?,?,?)`, id, ev.Seq, string(encode(ev))); e != nil {
		return e
	}
	updated, e := tx.Exec(`UPDATE jobs SET body=?,state=? WHERE id=? AND owner=? AND json_extract(body,'$.last_seq')=? AND json_extract(body,'$.cancel')=? AND state NOT IN ('succeeded','failed','canceled','paused')`, string(encode(j)), j.State, id, owner, expectedSeq, expectedCancel)
	if e != nil {
		return e
	}
	if n, _ := updated.RowsAffected(); n != 1 {
		return ErrConflict
	}
	return tx.Commit()
}
func (s *Store) validateResult(owner string, j Job, b json.RawMessage) error {
	var result struct {
		Compatible     bool              `json:"compatible"`
		ModelRevision  string            `json:"model_revision"`
		TokenizerHash  string            `json:"tokenizer_hash"`
		TemplateHash   string            `json:"template_hash"`
		LabelsVerified bool              `json:"labels_verified"`
		ArtifactID     string            `json:"artifact_id"`
		Cases          []json.RawMessage `json:"cases"`
		Healthy        bool              `json:"healthy"`
		Streaming      bool              `json:"streaming"`
	}
	if e := json.Unmarshal(b, &result); e != nil {
		return e
	}
	switch j.Kind {
	case "preflight":
		if !result.Compatible || !result.LabelsVerified || result.ModelRevision != j.Config.Revision || len(result.TokenizerHash) != 64 || len(result.TemplateHash) != 64 {
			return fmt.Errorf("预检缺少模型、模板或监督标签校验")
		}
	case "train":
		var a Artifact
		if e := s.get(owner, "artifact", result.ArtifactID, &a); e != nil || a.JobID != j.ID || a.Kind != "adapter" {
			return fmt.Errorf("训练尚未提交已校验的适配器产物")
		}
	case "evaluate":
		if len(result.Cases) == 0 || len(result.Cases) > 50 {
			return fmt.Errorf("评测样例数量不合法")
		}
	case "deploy":
		if !result.Healthy || !result.Streaming {
			return fmt.Errorf("推理服务尚未通过健康与流式检查")
		}
	default:
		return fmt.Errorf("不支持的任务")
	}
	return nil
}

func (c *Controller) WorkerRoutes(r *gin.RouterGroup) {
	// A distinct router intentionally avoids the mobile API credential. Remote
	// workers receive only their scoped SFT credential and require HTTPS.
	r.Use(func(ctx *gin.Context) {
		if ctx.Request.TLS == nil && !loopback(ctx.Request) && !trustedTLSProxy(ctx.Request) {
			ctx.AbortWithStatusJSON(426, gin.H{"error": "远程 worker 必须通过 TLS 连接"})
			return
		}
		ctx.Next()
	})
	r.POST("/enroll", func(ctx *gin.Context) {
		var body struct {
			Code         string          `json:"code"`
			Name         string          `json:"name"`
			Capabilities json.RawMessage `json:"capabilities"`
		}
		if !bind(ctx, &body) {
			return
		}
		w, t, e := c.store.enroll(body.Code, body.Name, body.Capabilities)
		respond(ctx, gin.H{"worker": w, "token": t}, e)
	})
	r.Use(func(ctx *gin.Context) {
		w, owner, e := c.store.authenticate(strings.TrimPrefix(ctx.GetHeader("Authorization"), "Bearer "))
		if e != nil {
			ctx.AbortWithStatusJSON(401, gin.H{"error": "worker 凭据无效或已撤销"})
			return
		}
		if w.Revoked {
			path := ctx.Request.URL.Path
			allowed := strings.HasSuffix(path, "/heartbeat") || strings.HasSuffix(path, "/events") || strings.Contains(path, "/artifacts/") && ctx.Request.Method == "PUT" || strings.HasSuffix(path, "/stopped")
			if !allowed {
				ctx.AbortWithStatusJSON(403, gin.H{"error": "环境授权已撤销"})
				return
			}
		}
		ctx.Set("sft_worker", w)
		ctx.Set("sft_owner", owner)
		ctx.Next()
	})
	r.POST("/heartbeat", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		var body struct {
			Capabilities json.RawMessage `json:"capabilities"`
		}
		if !bind(ctx, &body) {
			return
		}
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		current, e := c.store.worker(owner, w.ID)
		if e != nil {
			fail(ctx, e)
			return
		}
		w.Revoked = current.Revoked
		w.Local = current.Local
		w.LastSeen = now()
		if len(body.Capabilities) > 0 {
			w.Capabilities = body.Capabilities
		}
		_, e = c.store.db.Exec(`UPDATE workers SET body=json_set(?,'$.revoked',json(CASE WHEN json_extract(body,'$.revoked') THEN 'true' ELSE 'false' END)) WHERE id=? AND owner=?`, string(encode(w)), w.ID, owner)
		jobs, _ := c.store.jobsRaw(owner, w.ProjectID)
		active := []Job{}
		for _, j := range jobs {
			if j.WorkerID == w.ID && !terminal(j.State) && j.State != "queued" {
				if w.Revoked {
					j.Cancel = true
					j.State = "stopping"
					c.store.saveJob(owner, j)
				}
				active = append(active, j)
			}
		}
		deploys, _ := c.store.list(owner, "deployment", w.ProjectID)
		grace := 600
		if w.Local {
			grace = 30
		}
		respond(ctx, gin.H{"active": active, "deployments": deploys, "offline_grace_seconds": grace, "revoked": w.Revoked}, e)
	})
	r.POST("/claim", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		j, e := c.store.claim(owner, w)
		respond(ctx, gin.H{"job": j}, e)
	})
	r.POST("/jobs/:id/events", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		var body struct {
			Attempt string `json:"attempt"`
			Fence   string `json:"fence"`
			Event   Event  `json:"event"`
		}
		if !bind(ctx, &body) {
			return
		}
		e := c.store.event(owner, w, ctx.Param("id"), body.Attempt, body.Fence, body.Event)
		respond(ctx, gin.H{"ok": e == nil}, e)
	})
	r.GET("/jobs/:id/data/:split", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		j, e := c.store.job(owner, ctx.Param("id"))
		if e != nil || j.WorkerID != w.ID || j.ProjectID != w.ProjectID || j.State == "queued" || terminal(j.State) {
			fail(ctx, ErrNotFound)
			return
		}
		split := ctx.Param("split")
		if split != "train" && split != "valid" && split != "test" {
			fail(ctx, ErrNotFound)
			return
		}
		if split == "test" && (j.Kind == "train" || j.Kind == "preflight") {
			ctx.AbortWithStatus(403)
			return
		}
		var d Dataset
		if e := c.store.get(owner, "dataset", j.Config.DatasetID, &d); e != nil {
			fail(ctx, e)
			return
		}
		path, e := c.store.verifyDatasetFile(owner, d, split)
		if e != nil {
			fail(ctx, e)
			return
		}
		ctx.Header("X-SHA256", d.FileSHA256[split])
		ctx.File(path)
	})
	r.GET("/jobs/:id/parent-artifacts", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		j, e := c.store.job(owner, ctx.Param("id"))
		if e != nil || j.WorkerID != w.ID || j.ProjectID != w.ProjectID {
			fail(ctx, ErrNotFound)
			return
		}
		parent, e := c.store.job(owner, j.Config.ParentRun)
		if e != nil || parent.WorkerID != w.ID || parent.ProjectID != w.ProjectID {
			fail(ctx, ErrNotFound)
			return
		}
		as, e := c.store.list(owner, "artifact", j.Config.ParentRun)
		respond(ctx, as, e)
	})
	r.PUT("/jobs/:id/artifacts/:name", c.uploadArtifact)
	r.GET("/artifacts/:id", func(ctx *gin.Context) {
		w, owner := workerContext(ctx)
		var a Artifact
		if e := c.store.get(owner, "artifact", ctx.Param("id"), &a); e != nil {
			fail(ctx, e)
			return
		}
		j, e := c.store.job(owner, a.JobID)
		if e != nil || j.WorkerID != w.ID || j.ProjectID != w.ProjectID {
			fail(ctx, ErrNotFound)
			return
		}
		ctx.File(c.artifactFile(owner, a))
	})
	c.tunnelRoutes(r)
}
func workerContext(c *gin.Context) (Worker, string) {
	return c.MustGet("sft_worker").(Worker), c.GetString("sft_owner")
}
func (c *Controller) artifactFile(owner string, a Artifact) string {
	return filepath.Join(c.store.root, "profiles", digest([]byte(owner)), "artifacts", a.JobID, a.Name)
}
func (c *Controller) uploadArtifact(ctx *gin.Context) {
	w, owner := workerContext(ctx)
	value, _ := c.uploadLocks.LoadOrStore(ctx.Param("id")+":"+ctx.Param("name"), &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	j, e := c.store.job(owner, ctx.Param("id"))
	if e != nil || j.WorkerID != w.ID || j.ProjectID != w.ProjectID || terminal(j.State) || j.Attempt != ctx.GetHeader("X-Attempt") || subtle.ConstantTimeCompare([]byte(j.Fence), []byte(ctx.GetHeader("X-Fence"))) != 1 {
		fail(ctx, ErrConflict)
		return
	}
	name := ctx.Param("name")
	if name != "adapter.tar" && name != "checkpoint.tar" && name != "manifest.json" {
		fail(ctx, fmt.Errorf("无效产物名"))
		return
	}
	offset := int64(-1)
	fmt.Sscan(ctx.GetHeader("Upload-Offset"), &offset)
	if offset < 0 {
		fail(ctx, fmt.Errorf("缺少 Upload-Offset"))
		return
	}
	a := Artifact{ID: digest([]byte(j.ID + name)), JobID: j.ID, Name: name, Kind: strings.TrimSuffix(name, ".tar")}
	path := c.artifactFile(owner, a)
	var completed Artifact
	if c.store.get(owner, "artifact", a.ID, &completed) == nil {
		if ctx.GetHeader("X-SHA256") == completed.SHA256 {
			respond(ctx, gin.H{"offset": completed.Size, "artifact": completed}, nil)
		} else {
			ctx.JSON(409, gin.H{"error": "文件已完成", "offset": completed.Size})
		}
		return
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		fail(ctx, e)
		return
	}
	f, e := os.OpenFile(path+".part", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		fail(ctx, e)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	if st.Size() != offset {
		ctx.JSON(409, gin.H{"error": "上传偏移不一致", "offset": st.Size()})
		return
	}
	if offset > 64<<30 {
		fail(ctx, fmt.Errorf("产物超过 64 GB"))
		return
	}
	f.Seek(offset, io.SeekStart)
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, 8<<20)
	n, e := io.Copy(f, ctx.Request.Body)
	if e != nil {
		f.Truncate(offset)
		fail(ctx, fmt.Errorf("分块上传失败"))
		return
	}
	if offset+n > 64<<30 {
		f.Truncate(offset)
		fail(ctx, fmt.Errorf("产物超过 64 GB"))
		return
	}
	if e = f.Sync(); e != nil {
		fail(ctx, e)
		return
	}
	if hash := ctx.GetHeader("X-SHA256"); hash != "" {
		f.Seek(0, io.SeekStart)
		sum := newHash()
		io.Copy(sum, f)
		a.SHA256 = fmt.Sprintf("%x", sum.Sum(nil))
		if a.SHA256 != hash {
			f.Truncate(0)
			ctx.JSON(409, gin.H{"error": "产物校验失败，需重新传输", "offset": 0})
			return
		}
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		current, err := c.store.job(owner, j.ID)
		if err != nil || terminal(current.State) || current.Attempt != j.Attempt || current.Fence != j.Fence {
			fail(ctx, ErrConflict)
			return
		}
		a.Size = offset + n
		a.Resume = ctx.GetHeader("X-Resume-Mode")
		if a.Resume != "weights_only" && a.Resume != "full_state" {
			a.Resume = "none"
		}
		if e = f.Close(); e == nil {
			e = os.Rename(path+".part", path)
		}
		if e == nil {
			e = c.store.put(owner, "artifact", j.ID, a.ID, a)
		}
		respond(ctx, gin.H{"offset": offset + n, "artifact": a}, e)
		return
	}
	ctx.JSON(200, gin.H{"offset": offset + n})
}
