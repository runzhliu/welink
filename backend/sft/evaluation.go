package sft

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

func (c *Controller) createEvaluation(ctx *gin.Context) {
	var b struct {
		RunID string `json:"run_id"`
	}
	if !bind(ctx, &b) {
		return
	}
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	run, e := c.store.job(owner, b.RunID)
	if e != nil {
		fail(ctx, e)
		return
	}
	if run.Kind != "train" || run.State != "succeeded" {
		fail(ctx, fmt.Errorf("请选择训练成功的模型"))
		return
	}
	j, e := c.store.newJob(owner, run.ProjectID, "evaluate", run.WorkerID, ctx.GetHeader("Idempotency-Key"), TrainConfigWithParent(run), gin.H{"run_id": run.ID, "training_result": run.Result, "max_cases": 50, "seed": 42, "temperature": 0, "max_tokens": 256})
	respond(ctx, j, e)
}
func TrainConfigWithParent(j Job) TrainConfig { v := j.Config; v.ParentRun = j.ID; return v }

type EvalCase struct {
	ID            string    `json:"id"`
	Messages      []Message `json:"messages"`
	Reference     string    `json:"reference"`
	Baseline      string    `json:"baseline"`
	Tuned         string    `json:"tuned"`
	BaselineError string    `json:"baseline_error,omitempty"`
	TunedError    string    `json:"tuned_error,omitempty"`
	Leakage       []string  `json:"leakage,omitempty"`
}
type Vote struct {
	SampleID  string `json:"sample_id"`
	Choice    string `json:"choice"`
	Dimension string `json:"dimension"`
}

func (c *Controller) evaluation(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	j, e := c.store.job(owner, ctx.Param("id"))
	if e != nil || j.Kind != "evaluate" {
		fail(ctx, ErrNotFound)
		return
	}
	if j.State != "succeeded" {
		j.Fence = ""
		respond(ctx, gin.H{"job": j, "cases": []any{}}, nil)
		return
	}
	var result struct {
		Cases   []EvalCase      `json:"cases"`
		Summary json.RawMessage `json:"summary"`
	}
	if e = json.Unmarshal(j.Result, &result); e != nil {
		fail(ctx, e)
		return
	}
	out := []gin.H{}
	for _, item := range result.Cases {
		var vote Vote
		var b []byte
		e = c.store.db.QueryRow(`SELECT body FROM votes WHERE evaluation=? AND owner=? AND sample=?`, j.ID, owner, item.ID).Scan(&b)
		voted := e == nil
		if voted {
			json.Unmarshal(b, &vote)
		}
		swap := digest([]byte(j.ID + item.ID))[0]%2 == 0
		a, btext := item.Baseline, item.Tuned
		aname, bname := "基础模型", "微调模型"
		if swap {
			a, btext = btext, a
			aname, bname = bname, aname
		}
		row := gin.H{"id": item.ID, "messages": item.Messages, "a": a, "b": btext, "voted": voted, "errors": []string{item.BaselineError, item.TunedError}, "leakage": []string{}}
		if voted {
			row["a_name"] = aname
			row["b_name"] = bname
			row["vote"] = vote
			row["reference"] = item.Reference
			row["leakage"] = item.Leakage
		}
		out = append(out, row)
	}
	j.Fence = ""
	j.Result = nil
	respond(ctx, gin.H{"job": j, "cases": out, "summary": result.Summary, "sample_count": len(out)}, nil)
}
func (c *Controller) vote(ctx *gin.Context) {
	var v Vote
	if !bind(ctx, &v) {
		return
	}
	if (v.Choice != "a" && v.Choice != "b" && v.Choice != "tie") || (v.Dimension != "style" && v.Dimension != "helpful") {
		fail(ctx, fmt.Errorf("无效的评价"))
		return
	}
	owner := ctx.GetString("sft_owner")
	j, e := c.store.job(owner, ctx.Param("id"))
	if e != nil || j.Kind != "evaluate" || j.State != "succeeded" {
		fail(ctx, ErrNotFound)
		return
	}
	var result struct {
		Cases []EvalCase `json:"cases"`
	}
	json.Unmarshal(j.Result, &result)
	found := false
	for _, sample := range result.Cases {
		if sample.ID == v.SampleID {
			found = true
		}
	}
	if !found {
		fail(ctx, ErrNotFound)
		return
	}
	// A vote reveals the mapping and therefore cannot be changed into a new blind vote.
	_, e = c.store.db.Exec(`INSERT INTO votes VALUES(?,?,?,?) ON CONFLICT DO NOTHING`, j.ID, owner, v.SampleID, string(encode(v)))
	respond(ctx, gin.H{"ok": e == nil}, e)
}
func (c *Controller) models(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	jobs, e := c.store.jobs(owner, ctx.Query("project_id"))
	if e != nil {
		fail(ctx, e)
		return
	}
	out := []gin.H{}
	for _, j := range jobs {
		if j.Kind != "train" || j.State != "succeeded" {
			continue
		}
		as, _ := c.store.list(owner, "artifact", j.ID)
		out = append(out, gin.H{"id": j.ID, "config": j.Config, "result": j.Result, "created_at": j.CreatedAt, "artifacts": as})
	}
	deploys, e := c.store.list(owner, "deployment", ctx.Query("project_id"))
	public := []Deployment{}
	for _, b := range deploys {
		var d Deployment
		json.Unmarshal(b, &d)
		public = append(public, c.refreshDeployment(owner, d))
	}
	respond(ctx, gin.H{"models": out, "deployments": public}, e)
}

type Deployment struct {
	ID              string `json:"id"`
	ProjectID       string `json:"project_id"`
	RunID           string `json:"run_id"`
	WorkerID        string `json:"worker_id"`
	State           string `json:"state"`
	Stop            bool   `json:"stop"`
	ProfileID       string `json:"profile_id"`
	PreviousProfile string `json:"previous_profile"`
	CreatedAt       int64  `json:"created_at"`
}

func (c *Controller) refreshDeployment(owner string, d Deployment) Deployment {
	if d.ProfileID != "" && c.cfg.ProfileExists != nil && !c.cfg.ProfileExists(d.ProfileID) {
		d.ProfileID = ""
	}
	j, e := c.store.job(owner, d.ID)
	if e != nil {
		return d
	}
	w, _ := c.store.worker(owner, d.WorkerID)
	if d.State == "stopped" || d.State == "failed" {
		return d
	}
	if j.State == "failed" || j.State == "canceled" {
		d.State = "failed"
	} else if j.State == "succeeded" {
		d.State = "online"
		if w.Revoked || now()-w.LastSeen > 45 {
			d.State = "offline"
		}
		if d.Stop {
			d.State = "stopping"
		}
	}
	return d
}
func (c *Controller) createDeployment(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	run, e := c.store.job(owner, ctx.Param("id"))
	if e != nil || run.Kind != "train" || run.State != "succeeded" {
		fail(ctx, ErrNotFound)
		return
	}
	w, e := c.store.worker(owner, run.WorkerID)
	if e != nil || w.Revoked || now()-w.LastSeen > 45 {
		fail(ctx, fmt.Errorf("训练环境未在线"))
		return
	}
	j, e := c.store.newJob(owner, run.ProjectID, "deploy", run.WorkerID, ctx.GetHeader("Idempotency-Key"), TrainConfigWithParent(run), gin.H{"training_result": run.Result})
	if e != nil {
		fail(ctx, e)
		return
	}
	var existing Deployment
	if c.store.get(owner, "deployment", j.ID, &existing) == nil {
		respond(ctx, existing, nil)
		return
	}
	d := Deployment{ID: j.ID, ProjectID: run.ProjectID, RunID: run.ID, WorkerID: run.WorkerID, State: "starting", CreatedAt: now()}
	e = c.store.put(owner, "deployment", run.ProjectID, d.ID, d)
	respond(ctx, d, e)
}
func (c *Controller) connect(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	var d Deployment
	if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	d = c.refreshDeployment(owner, d)
	if d.State != "online" {
		fail(ctx, fmt.Errorf("推理服务尚未就绪"))
		return
	}
	if d.ProfileID != "" && (c.cfg.ProfileExists == nil || c.cfg.ProfileExists(d.ProfileID)) {
		respond(ctx, d, nil)
		return
	}
	var secret string
	if c.store.get(owner, "deployment_secret", d.ID, &secret) != nil {
		secret = ID("inference") + ID("token")
	}
	if e := c.store.put(owner, "deployment_secret", d.ProjectID, d.ID, secret); e != nil {
		fail(ctx, e)
		return
	}
	if c.cfg.Connect == nil {
		fail(ctx, fmt.Errorf("模型配置接口不可用"))
		return
	}
	profile, e := c.cfg.Connect(d.ID, "我的风格 · "+strings.TrimPrefix(d.RunID, "job_")[:8], secret)
	if e == nil {
		d.ProfileID = profile
		e = c.store.put(owner, "deployment", d.ProjectID, d.ID, d)
	}
	respond(ctx, d, e)
}
func (c *Controller) makeDefault(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	var d Deployment
	if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	d = c.refreshDeployment(owner, d)
	if d.State != "online" || d.ProfileID == "" {
		fail(ctx, fmt.Errorf("请先接入在线模型"))
		return
	}
	if c.cfg.Default == nil {
		fail(ctx, fmt.Errorf("默认配置接口不可用"))
		return
	}
	previous, e := c.cfg.Default(d.ProfileID)
	if e == nil && previous != d.ProfileID {
		d.PreviousProfile = previous
		e = c.store.put(owner, "deployment", d.ProjectID, d.ID, d)
	}
	respond(ctx, d, e)
}
func (c *Controller) rollback(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	var d Deployment
	if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	if d.PreviousProfile == "" || c.cfg.Rollback == nil {
		fail(ctx, fmt.Errorf("没有可以回滚的默认配置"))
		return
	}
	e := c.cfg.Rollback(d.ProfileID, d.PreviousProfile)
	respond(ctx, d, e)
}
func (c *Controller) stopDeployment(ctx *gin.Context) {
	owner := ctx.GetString("sft_owner")
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	var d Deployment
	if e := c.store.get(owner, "deployment", ctx.Param("id"), &d); e != nil {
		fail(ctx, e)
		return
	}
	d.Stop = true
	d.State = "stopping"
	e := c.store.put(owner, "deployment", d.ProjectID, d.ID, d)
	respond(ctx, d, e)
}
