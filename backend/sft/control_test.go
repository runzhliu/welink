package sft

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func must[T any](t *testing.T, v T, e error) T {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestConversationRolesBoundariesRedactionAndSplit(t *testing.T) {
	b := NewBuilder("owner")
	ts := int64(10000)
	for session := 0; session < 20; session++ {
		base := ts + int64(session)*4000
		for i, m := range []SourceMessage{{Content: fmt.Sprintf("晚饭在哪吃 %d", session), Text: true, Known: true}, {Content: fmt.Sprintf("去楼下那家 %d", session), Text: true, Known: true, Mine: true}, {Content: "我先订位，电话 13800138000", Text: true, Known: true, Mine: true}, {Content: "[图片]", Known: true}, {Content: "未知角色", Text: true}} {
			m.Contact = "alice"
			m.ID = fmt.Sprintf("%d/%d", session, i)
			m.Timestamp = base + int64(i)*15
			if e := b.Add(m); e != nil {
				t.Fatal(e)
			}
		}
	}
	samples, r := b.Finish()
	if len(samples) != 20 {
		t.Fatalf("got %d samples: %+v", len(samples), r)
	}
	for _, v := range samples {
		if len(v.Messages) != 2 || v.Messages[1].Role != "assistant" || !strings.Contains(v.Messages[1].Content, "我先订位") || strings.Contains(v.Messages[1].Content, "13800138000") {
			t.Fatalf("incorrect merged role/redaction: %+v", v)
		}
		if len(v.Issues) != 1 || len(v.Sources) != 3 {
			t.Fatal("redaction review/source provenance missing")
		}
	}
	split := splitGroups(samples)
	seen := map[string]string{}
	counts := map[string]int{}
	for _, v := range split {
		counts[v.Split]++
		for _, src := range v.Sources {
			if prev := seen[src]; prev != "" && prev != v.Split {
				t.Fatal("source leakage")
			}
			seen[src] = v.Split
		}
	}
	if counts["train"] != 16 || counts["valid"] != 2 || counts["test"] != 2 {
		t.Fatal(counts)
	}
}
func TestOverlappingSourcesAndDuplicateClustersNeverCrossSplits(t *testing.T) {
	rows := []Sample{}
	for i := 0; i < 30; i++ {
		rows = append(rows, Sample{ID: fmt.Sprint(i), Group: fmt.Sprint(i), Cluster: fmt.Sprint(i), Sources: []string{fmt.Sprint(i)}, Timestamp: int64(i), Review: "kept"})
	}
	rows[28].Sources = []string{"1"}
	rows[29].Cluster = rows[0].Cluster
	grouped := splitGroups(rows)
	if grouped[28].Split != grouped[1].Split || grouped[29].Split != grouped[0].Split {
		t.Fatal("union leaked across partitions")
	}
	for i := range rows {
		rows[i].Group = "single-conversation"
	}
	for _, v := range splitGroups(rows) {
		if v.Split != "train" {
			t.Fatal("one conversation was split into artificial evaluation evidence")
		}
	}
}

func TestSplitIsStableRegardlessOfDatabaseInsertionOrder(t *testing.T) {
	rows := []Sample{}
	for i := 0; i < 40; i++ {
		rows = append(rows, Sample{ID: ID("random"), Timestamp: int64(i / 2), Group: fmt.Sprint(i), Cluster: fmt.Sprint(i), Contact: "a", Review: "kept", Messages: []Message{{Role: "user", Content: fmt.Sprintf("独立问题 %d", i)}, {Role: "assistant", Content: "回复"}}})
	}
	forward := splitGroups(rows)
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	backward := splitGroups(rows)
	if string(encode(forward)) != string(encode(backward)) {
		t.Fatal("random sample IDs / insertion order changed frozen ordering or splits")
	}
}
func TestImportRejectsInvalidTargetsAndDeduplicates(t *testing.T) {
	for _, line := range []string{`{"messages":[{"role":"user","content":"x"}]}`, `{"messages":[{"role":"user","content":"x"},{"role":"tool","content":"y"}]}`, `{"messages":[{"role":"assistant","content":"x"},{"role":"assistant","content":"y"}]}`, strings.Repeat("x", 300000)} {
		if _, _, e := Import(strings.NewReader(line), "a"); e == nil {
			t.Fatal("accepted invalid input")
		}
	}
	line := `{"instruction":"晚上吃什么？","output":"吃面条吧。"}`
	samples, r, e := Import(strings.NewReader(line+"\n"+line), "a")
	if e != nil || len(samples) != 1 || r.Excluded["重复或近重复"] != 1 {
		t.Fatal(r, e)
	}
}
func TestFreezeIsImmutableAndOwnerScoped(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	d := Dataset{ID: ID("ds"), ProjectID: "p", State: "draft", Revision: 1}
	if e = s.put("a", "dataset", "p", d.ID, d); e != nil {
		t.Fatal(e)
	}
	samples := []Sample{}
	for i := 0; i < 20; i++ {
		samples = append(samples, Sample{ID: fmt.Sprint(i), Group: fmt.Sprint(i), Cluster: fmt.Sprint(i), Review: "pending", Timestamp: int64(i), Messages: []Message{{Role: "user", Content: fmt.Sprintf("输入 %d", i)}, {Role: "assistant", Content: "我的回复"}}})
	}
	s.saveSamples("a", d.ID, samples)
	if _, e = s.freeze("b", d.ID, 1); e != ErrNotFound {
		t.Fatal("cross-account freeze")
	}
	if _, e = s.freeze("a", d.ID, 2); e != ErrConflict {
		t.Fatal("stale edit accepted")
	}
	frozen, e := s.freeze("a", d.ID, 1)
	if e != nil {
		t.Fatal(e)
	}
	before, e := os.ReadFile(s.file("a", d.ID, "train"))
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.freeze("a", d.ID, 1)
	if e != nil || again.SHA256 != frozen.SHA256 {
		t.Fatal("freeze retry changed content")
	}
	after, _ := os.ReadFile(s.file("a", d.ID, "train"))
	if !bytes.Equal(before, after) {
		t.Fatal("mutated frozen bytes")
	}
	if strings.Contains(string(before), "contact") || strings.Contains(string(before), "sources") {
		t.Fatal("provenance was exported to training engine")
	}
	if _, e = s.verifyDatasetFile("a", frozen, "train"); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(s.file("a", d.ID, "train"), append(before, '\n'), 0600)
	if _, e = s.verifyDatasetFile("a", frozen, "train"); e == nil {
		t.Fatal("mutated frozen file was allowed into a worker")
	}
}

type harness struct {
	t                             *testing.T
	c                             *Controller
	r                             *gin.Engine
	owner, token, worker, project string
}

func setup(t *testing.T) *harness {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := &harness{t: t, owner: "account-a"}
	c, e := New(Config{Root: t.TempDir(), Owner: func() string { return h.owner }, Source: func(context.Context, string, Scope, func(SourceMessage) error) (string, error) { return "", nil }})
	if e != nil {
		t.Fatal(e)
	}
	h.c = c
	t.Cleanup(func() { c.Close() })
	h.r = gin.New()
	c.Routes(h.r.Group("/api/sft"))
	c.WorkerRoutes(h.r.Group("/api/sft-worker"))
	c.InferenceRoutes(h.r.Group("/api/sft-inference"))
	return h
}
func (h *harness) call(method, path string, body any, token string, headers map[string]string) *httptest.ResponseRecorder {
	h.t.Helper()
	var data []byte
	if raw, ok := body.([]byte); ok {
		data = raw
	} else if body != nil {
		data = encode(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.r.ServeHTTP(w, req)
	return w
}
func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	if w.Code < 200 || w.Code >= 300 {
		t.Fatalf("HTTP %d: %s", w.Code, w.Body)
	}
	var v T
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func (h *harness) seed() {
	p := Project{ID: ID("project"), Name: "我的风格"}
	h.project = p.ID
	h.c.store.put(h.owner, "project", p.ID, p.ID, p)
	code, e := h.c.store.pair(h.owner, p.ID)
	if e != nil {
		h.t.Fatal(e)
	}
	result := decode[struct {
		Worker Worker `json:"worker"`
		Token  string `json:"token"`
	}](h.t, h.call("POST", "/api/sft-worker/enroll", gin.H{"code": code, "name": "contract test worker", "capabilities": gin.H{"protocol": 1, "engines": gin.H{"mlx": gin.H{"available": true}}}}, "", nil))
	h.token = result.Token
	h.worker = result.Worker.ID
}
func TestWorkerPairingScopeLeaseAndRestart(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	if _, _, e := s.enroll("expired", "x", encode(gin.H{"protocol": 1})); e == nil {
		t.Fatal("invalid pairing accepted")
	}
	j, e := s.newJob(h.owner, h.project, "preflight", h.worker, "one", TrainConfig{}, nil)
	if e != nil {
		t.Fatal(e)
	}
	same, e := s.newJob(h.owner, h.project, "preflight", h.worker, "one", TrainConfig{}, nil)
	if e != nil || same.ID != j.ID {
		t.Fatal("idempotency failed")
	}
	if _, e = s.newJob(h.owner, "other", "preflight", h.worker, "one", TrainConfig{}, nil); e != ErrConflict {
		t.Fatal("idempotency payload conflict accepted")
	}
	s.newJob(h.owner, h.project, "train", h.worker, "two", TrainConfig{}, nil)
	worker, _ := s.worker(h.owner, h.worker)
	var wg sync.WaitGroup
	claimed := make(chan *Job, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := s.claim(h.owner, worker)
			if e != nil {
				t.Error(e)
			}
			if v != nil {
				claimed <- v
			}
		}()
	}
	wg.Wait()
	close(claimed)
	if len(claimed) != 1 {
		t.Fatalf("%d simultaneous device claims", len(claimed))
	}
	active := <-claimed
	e = s.event(h.owner, worker, active.ID, active.Attempt, "stale", Event{Seq: 1, Type: "stage", Data: encode(gin.H{"stage": "running"})})
	if e != ErrConflict {
		t.Fatal("stale fence accepted")
	}
	ev := Event{Seq: 1, Type: "stage", Data: encode(gin.H{"stage": "running"})}
	if e = s.event(h.owner, worker, active.ID, active.Attempt, active.Fence, ev); e != nil {
		t.Fatal(e)
	}
	if e = s.event(h.owner, worker, active.ID, active.Attempt, active.Fence, ev); e != nil {
		t.Fatal("event retry rejected")
	}
	ev.Data = encode(gin.H{"stage": "saving"})
	if e = s.event(h.owner, worker, active.ID, active.Attempt, active.Fence, ev); e != ErrConflict {
		t.Fatal("sequence collision overwritten")
	}
	root := s.root
	s.Close()
	reopened, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	h.c.store = reopened
	preserved, e := reopened.job(h.owner, active.ID)
	if e != nil || preserved.Fence != active.Fence || preserved.State != "running" {
		t.Fatal("server restart lost process lease")
	}
	if v, e := reopened.claim(h.owner, worker); e != nil || v != nil {
		t.Fatal("restart duplicated work")
	}
	h.owner = "account-b"
	w := h.call("GET", "/api/sft/runs/"+active.ID, nil, "", nil)
	if w.Code != 404 {
		t.Fatal("cross-account read", w.Code)
	}
	w = h.call("GET", "/api/sft/runs/"+active.ID+"/checkpoints", nil, "", nil)
	if w.Code != 404 {
		t.Fatal("cross-account artifact list")
	}
}
func TestCancelDoesNotDeclareExitAndLateEventsCannotReopen(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	j, _ := s.newJob(h.owner, h.project, "train", h.worker, "a", TrainConfig{}, nil)
	w, _ := s.worker(h.owner, h.worker)
	active, _ := s.claim(h.owner, w)
	stop := decode[Job](t, h.call("POST", "/api/sft/jobs/"+j.ID+"/cancel", gin.H{}, "", nil))
	if stop.State != "stopping" {
		t.Fatal("cancel prematurely acknowledged")
	}
	if e := s.event(h.owner, w, j.ID, active.Attempt, active.Fence, Event{Seq: 1, Type: "canceled", Data: encode(gin.H{"stop_reason": "worker_stop"})}); e != nil {
		t.Fatal(e)
	}
	if e := s.event(h.owner, w, j.ID, active.Attempt, active.Fence, Event{Seq: 2, Type: "stage", Data: encode(gin.H{"stage": "running"})}); e != ErrConflict {
		t.Fatal("late callback reopened terminal state")
	}
}
func TestArtifactChunksChecksumsAndReplay(t *testing.T) {
	h := setup(t)
	h.seed()
	j, _ := h.c.store.newJob(h.owner, h.project, "train", h.worker, "a", TrainConfig{}, nil)
	w, _ := h.c.store.worker(h.owner, h.worker)
	active, _ := h.c.store.claim(h.owner, w)
	path := "/api/sft-worker/jobs/" + j.ID + "/artifacts/adapter.tar"
	headers := map[string]string{"X-Attempt": active.Attempt, "X-Fence": active.Fence, "Upload-Offset": "0"}
	decode[map[string]any](t, h.call("PUT", path, []byte("first"), h.token, headers))
	bad := h.call("PUT", path, []byte("duplicate"), h.token, headers)
	if bad.Code != 409 {
		t.Fatal("offset replay appended twice")
	}
	headers["Upload-Offset"] = "5"
	headers["X-SHA256"] = "incorrect"
	bad = h.call("PUT", path, []byte("last"), h.token, headers)
	if bad.Code != 409 {
		t.Fatal("checksum not checked")
	}
	headers["Upload-Offset"] = "0"
	headers["X-SHA256"] = digest([]byte("firstlast"))
	result := decode[struct {
		Artifact Artifact `json:"artifact"`
	}](t, h.call("PUT", path, []byte("firstlast"), h.token, headers))
	if result.Artifact.Size != 9 {
		t.Fatal(result)
	}
	headers["Upload-Offset"] = "9"
	again := decode[struct {
		Artifact Artifact `json:"artifact"`
	}](t, h.call("PUT", path, []byte{}, h.token, headers))
	if again.Artifact.ID != result.Artifact.ID {
		t.Fatal("lost final ack produced duplicate artifact")
	}
	h.owner = "b"
	bad = h.call("GET", "/api/sft/artifacts/"+result.Artifact.ID+"/download", nil, "", nil)
	if bad.Code != 404 {
		t.Fatal("cross-account download")
	}
}

func TestSlowArtifactTransferDoesNotBlockHeartbeat(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	j, _ := s.newJob(h.owner, h.project, "train", h.worker, "upload", TrainConfig{}, nil)
	w, _ := s.worker(h.owner, h.worker)
	active, _ := s.claim(h.owner, w)
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	request := httptest.NewRequest("PUT", "/api/sft-worker/jobs/"+j.ID+"/artifacts/adapter.tar", reader)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Authorization", "Bearer "+h.token)
	request.Header.Set("Upload-Offset", "0")
	request.Header.Set("X-Attempt", active.Attempt)
	request.Header.Set("X-Fence", active.Fence)
	uploadDone := make(chan struct{})
	go func() { h.r.ServeHTTP(httptest.NewRecorder(), request); close(uploadDone) }()
	heartbeatDone := make(chan *httptest.ResponseRecorder, 1)
	go func() { heartbeatDone <- h.call("POST", "/api/sft-worker/heartbeat", gin.H{}, h.token, nil) }()
	select {
	case result := <-heartbeatDone:
		if result.Code != 200 {
			t.Fatal(result.Body.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("metadata heartbeat was blocked by body/weight I/O")
	}
	writer.Write([]byte("chunk"))
	writer.Close()
	select {
	case <-uploadDone:
	case <-time.After(2 * time.Second):
		t.Fatal("upload did not finish")
	}
}
func TestBlindEvaluationCannotBeUnmaskedThroughJobOrEvents(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	j, _ := s.newJob(h.owner, h.project, "evaluate", h.worker, "eval", TrainConfig{}, nil)
	w, _ := s.worker(h.owner, h.worker)
	active, _ := s.claim(h.owner, w)
	result := gin.H{"cases": []EvalCase{{ID: "sample-1", Messages: []Message{{Role: "user", Content: "问题"}}, Reference: "test target", Baseline: "baseline-only-secret", Tuned: "tuned-only-secret"}}}
	if e := s.event(h.owner, w, j.ID, active.Attempt, active.Fence, Event{Seq: 1, Type: "completed", Data: encode(result)}); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"/api/sft/runs", "/api/sft/runs/" + j.ID, "/api/sft/jobs/" + j.ID + "/events"} {
		r := h.call("GET", path, nil, "", nil)
		if strings.Contains(r.Body.String(), "baseline-only-secret") || strings.Contains(r.Body.String(), "test target") {
			t.Fatalf("unmasked via %s", path)
		}
	}
	view := h.call("GET", "/api/sft/evaluations/"+j.ID, nil, "", nil)
	if strings.Contains(view.Body.String(), "a_name") || strings.Contains(view.Body.String(), "test target") {
		t.Fatal("blind view revealed mapping/reference")
	}
	decode[map[string]any](t, h.call("POST", "/api/sft/evaluations/"+j.ID+"/votes", Vote{SampleID: "sample-1", Choice: "a", Dimension: "style"}, "", nil))
	view = h.call("GET", "/api/sft/evaluations/"+j.ID, nil, "", nil)
	if !strings.Contains(view.Body.String(), "a_name") || !strings.Contains(view.Body.String(), "test target") {
		t.Fatal("vote failed to reveal mapping")
	}
}
func TestDeploymentAndSecretNamespaceAndResourceReservation(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	deploy, _ := s.newJob(h.owner, h.project, "deploy", h.worker, "deploy", TrainConfig{}, nil)
	worker, _ := s.worker(h.owner, h.worker)
	active, _ := s.claim(h.owner, worker)
	d := Deployment{ID: deploy.ID, ProjectID: h.project, WorkerID: h.worker, State: "starting"}
	s.put(h.owner, "deployment", h.project, d.ID, d)
	s.put(h.owner, "deployment_secret", h.project, d.ID, "private-key")
	var secret string
	if e := s.get(h.owner, "deployment_secret", d.ID, &secret); e != nil || secret != "private-key" {
		t.Fatal("secret collided with deployment record")
	}
	if e := s.event(h.owner, worker, deploy.ID, active.Attempt, active.Fence, Event{Seq: 1, Type: "completed", Data: encode(gin.H{"healthy": true, "streaming": true})}); e != nil {
		t.Fatal(e)
	}
	s.newJob(h.owner, h.project, "train", h.worker, "train", TrainConfig{}, nil)
	if claimed, e := s.claim(h.owner, worker); e != nil || claimed != nil {
		t.Fatal("training stole inference device lease")
	}
	bad := h.call("POST", "/api/sft-inference/"+d.ID+"/v1/chat/completions", gin.H{}, "wrong", nil)
	if bad.Code != 401 {
		t.Fatal("inference credential not enforced")
	}
	h.owner = "another-account"
	bad = h.call("POST", "/api/sft-inference/"+d.ID+"/v1/chat/completions", gin.H{}, "private-key", nil)
	if bad.Code != 403 {
		t.Fatal("global LLM profile bypassed data-account isolation")
	}
	h.owner = "account-a"
	d.Stop = true
	d.State = "stopped"
	s.put(h.owner, "deployment", h.project, d.ID, d)
	if claimed, e := s.claim(h.owner, worker); e != nil || claimed == nil {
		t.Fatal("acknowledged exit did not release lease")
	}
}
func TestRemoteWorkerTLSCannotBeForged(t *testing.T) {
	h := setup(t)
	req := httptest.NewRequest(http.MethodPost, "/api/sft-worker/enroll", strings.NewReader(`{}`))
	req.RemoteAddr = "203.0.113.5:8765"
	req.Header.Set("X-Forwarded-Proto", "https")
	w := httptest.NewRecorder()
	h.r.ServeHTTP(w, req)
	if w.Code != 426 {
		t.Fatal("untrusted forwarded TLS header accepted")
	}
}

func TestInferenceGatewayStreamsThroughScopedWorker(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	job, _ := s.newJob(h.owner, h.project, "deploy", h.worker, "deployment", TrainConfig{}, nil)
	job.State = "succeeded"
	s.saveJob(h.owner, job)
	d := Deployment{ID: job.ID, ProjectID: h.project, WorkerID: h.worker, State: "online"}
	s.put(h.owner, "deployment", h.project, d.ID, d)
	s.put(h.owner, "deployment_secret", h.project, d.ID, "profile-secret")
	request := httptest.NewRequest("POST", "/api/sft-inference/"+d.ID+"/v1/chat/completions", strings.NewReader(`{"messages":[{"role":"user","content":"你好"}],"stream":true}`))
	request.Header.Set("Authorization", "Bearer profile-secret")
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() { h.r.ServeHTTP(response, request); close(finished) }()
	var requests []InferenceRequest
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		requests = decode[[]InferenceRequest](t, h.call("GET", "/api/sft-worker/inference-requests", nil, h.token, nil))
		if len(requests) > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(requests) != 1 {
		t.Fatal("request did not enter authenticated tunnel")
	}
	id := requests[0].ID
	for _, chunk := range []inferenceChunk{{Seq: 1, Data: `{"choices":[{"delta":{"content":"你好，真实转发"}}]}`}, {Seq: 2, Done: true}} {
		decode[map[string]any](t, h.call("POST", "/api/sft-worker/inference-requests/"+id+"/chunks", chunk, h.token, nil))
	}
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("stream never completed")
	}
	if !strings.Contains(response.Body.String(), "真实转发") || !strings.Contains(response.Body.String(), "[DONE]") {
		t.Fatal(response.Body.String())
	}
	if response.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatal("stream buffered as JSON")
	}
}

func TestPreflightPinsRunSnapshotAndTrainingCannotDownloadTestAnswers(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	d := Dataset{ID: ID("ds"), ProjectID: h.project, State: "frozen", SHA256: strings.Repeat("d", 64), FileSHA256: map[string]string{"train": digest([]byte("training")), "test": digest([]byte("private target"))}, Report: Report{Splits: map[string]int{"train": 800, "valid": 100, "test": 100}}}
	s.put(h.owner, "dataset", h.project, d.ID, d)
	atomicWrite(s.file(h.owner, d.ID, "train"), []byte("training"))
	atomicWrite(s.file(h.owner, d.ID, "test"), []byte("private target"))
	config := TrainConfig{DatasetID: d.ID, WorkerID: h.worker, Engine: "mlx", Model: "org/model", Revision: strings.Repeat("a", 40), Preset: "validation"}
	invalid := config
	invalid.ParentRun = "unvalidated-checkpoint"
	if result := h.call("POST", "/api/sft/preflights", invalid, "", map[string]string{"Idempotency-Key": "invalid"}); result.Code != 422 {
		t.Fatal("preflight accepted injected resume state")
	}
	pf := decode[Job](t, h.call("POST", "/api/sft/preflights", config, "", map[string]string{"Idempotency-Key": "pf"}))
	worker, _ := s.worker(h.owner, h.worker)
	active, _ := s.claim(h.owner, worker)
	result := gin.H{"compatible": true, "labels_verified": true, "model_revision": config.Revision, "tokenizer_hash": strings.Repeat("b", 64), "template_hash": strings.Repeat("c", 64)}
	if e := s.event(h.owner, worker, pf.ID, active.Attempt, active.Fence, Event{Seq: 1, Type: "completed", Data: encode(result)}); e != nil {
		t.Fatal(e)
	}
	run := decode[Job](t, h.call("POST", "/api/sft/runs", gin.H{"preflight_id": pf.ID, "model": "attacker/override", "max_steps": 99999}, "", map[string]string{"Idempotency-Key": "train"}))
	if run.Config.Model != "org/model" || run.Config.MaxSteps != 100 {
		t.Fatal("browser overrode preflight snapshot")
	}
	active, _ = s.claim(h.owner, worker)
	if active.ID != run.ID {
		t.Fatal("wrong job claimed")
	}
	if got := h.call("GET", "/api/sft-worker/jobs/"+run.ID+"/data/test", nil, h.token, nil); got.Code != 403 {
		t.Fatal("test targets exposed to training")
	}
	if got := h.call("GET", "/api/sft-worker/jobs/"+run.ID+"/data/train", nil, h.token, nil); got.Code != 200 || got.Header().Get("X-SHA256") == "" {
		t.Fatal("scoped transfer missing checksum")
	}
}
func TestShutdownAndRevocationAreDurableAndKeepExitUnacknowledged(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	w, _ := s.worker(h.owner, h.worker)
	w.Local = true
	s.db.Exec(`UPDATE workers SET body=? WHERE id=?`, string(encode(w)), w.ID)
	j, _ := s.newJob(h.owner, h.project, "train", h.worker, "stop", TrainConfig{}, nil)
	s.claim(h.owner, w)
	if e := h.c.ShutdownLocal(); e != nil {
		t.Fatal(e)
	}
	stopping, _ := s.job(h.owner, j.ID)
	if !stopping.Cancel || stopping.State != "stopping" {
		t.Fatal("app exit did not persist cooperative stop")
	}
	decode[map[string]any](t, h.call("DELETE", "/api/sft/workers/"+h.worker+"/binding", nil, "", nil))
	heartbeat := decode[map[string]any](t, h.call("POST", "/api/sft-worker/heartbeat", gin.H{}, h.token, nil))
	if heartbeat["revoked"] != true {
		t.Fatal("heartbeat revived a revoked worker")
	}
	if r := h.call("POST", "/api/sft-worker/claim", gin.H{}, h.token, nil); r.Code != 403 {
		t.Fatal("revoked credential claimed new work")
	}
}
func TestCleanupOnlyRemovesConfirmedUnreferencedFailedArtifacts(t *testing.T) {
	h := setup(t)
	h.seed()
	s := h.c.store
	failed, _ := s.newJob(h.owner, h.project, "train", h.worker, "failed", TrainConfig{}, nil)
	failed.State = "failed"
	s.saveJob(h.owner, failed)
	a := Artifact{ID: "failed-artifact", JobID: failed.ID, Name: "adapter.tar", Size: 6}
	path := h.c.artifactFile(h.owner, a)
	atomicWrite(path, []byte("failed"))
	s.put(h.owner, "artifact", failed.ID, a.ID, a)
	preview, e := h.c.cleanupPreview(h.owner, h.project)
	if e != nil || len(preview.Items) != 1 {
		t.Fatal(preview, e)
	}
	child, _ := s.newJob(h.owner, h.project, "train", h.worker, "child", TrainConfig{ParentRun: failed.ID}, nil)
	if r := h.call("POST", "/api/sft/projects/"+h.project+"/cleanup", gin.H{"hash": preview.Hash}, "", nil); r.Code != 409 {
		t.Fatal("stale preview deleted a newly referenced checkpoint")
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("referenced file removed")
	}
	s.db.Exec(`DELETE FROM jobs WHERE id=?`, child.ID)
	fresh, e := h.c.cleanupPreview(h.owner, h.project)
	if e != nil {
		t.Fatal(e)
	}
	decode[map[string]any](t, h.call("POST", "/api/sft/projects/"+h.project+"/cleanup", gin.H{"hash": fresh.Hash}, "", nil))
	if _, e = os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("confirmed cleanup did not remove eligible file")
	}
}
