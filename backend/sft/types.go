// Package sft owns the training control plane. Engine processes live in the
// separately installed worker; the web server never executes supplied commands.
package sft

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

const Protocol = 1
const Pipeline = "conversation-v1"

var ErrNotFound = errors.New("记录不存在或不属于当前账号")
var ErrConflict = errors.New("状态已变化，请刷新后重试")

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type SourceMessage struct {
	ID, Contact, Content string
	Timestamp            int64
	Mine, Known, Text    bool
}
type Scope struct {
	Contacts []string `json:"contacts"`
	From     int64    `json:"from"`
	To       int64    `json:"to"`
}
type Sample struct {
	ID        string    `json:"id"`
	Messages  []Message `json:"messages"`
	Group     string    `json:"group"`
	Cluster   string    `json:"cluster"`
	Sources   []string  `json:"sources,omitempty"`
	Contact   string    `json:"contact"`
	Timestamp int64     `json:"timestamp"`
	Issues    []string  `json:"issues"`
	Review    string    `json:"review"`
	Split     string    `json:"split"`
}
type Report struct {
	Raw           int            `json:"raw"`
	Candidates    int            `json:"candidates"`
	Excluded      map[string]int `json:"excluded"`
	Kept          int            `json:"kept"`
	Unreviewed    int            `json:"unreviewed"`
	Splits        map[string]int `json:"splits"`
	Contributions map[string]int `json:"contributions"`
}
type Dataset struct {
	ID                string            `json:"id"`
	ProjectID         string            `json:"project_id"`
	Name              string            `json:"name"`
	State             string            `json:"state"`
	Revision          int               `json:"revision"`
	Pipeline          string            `json:"pipeline"`
	Scope             Scope             `json:"scope"`
	Report            Report            `json:"report"`
	SHA256            string            `json:"sha256"`
	FileSHA256        map[string]string `json:"file_sha256"`
	SourceFingerprint string            `json:"source_fingerprint"`
	CreatedAt         int64             `json:"created_at"`
}
type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
}
type TrainConfig struct {
	DatasetID            string  `json:"dataset_id"`
	WorkerID             string  `json:"worker_id"`
	Engine               string  `json:"engine"`
	Model                string  `json:"model"`
	Revision             string  `json:"revision"`
	Template             string  `json:"template"`
	Preset               string  `json:"preset"`
	MaxSteps             int     `json:"max_steps"`
	MaxSeconds           int     `json:"max_seconds"`
	SequenceLength       int     `json:"sequence_length"`
	LearningRate         float64 `json:"learning_rate"`
	Rank                 int     `json:"rank"`
	Seed                 int     `json:"seed"`
	GradientAccumulation int     `json:"gradient_accumulation"`
	GPU                  string  `json:"gpu"`
	ParentRun            string  `json:"parent_run,omitempty"`
	ResumeMode           string  `json:"resume_mode,omitempty"`
	Checkpoint           string  `json:"checkpoint,omitempty"`
}
type Job struct {
	ID        string          `json:"id"`
	ProjectID string          `json:"project_id"`
	Kind      string          `json:"kind"`
	State     string          `json:"state"`
	WorkerID  string          `json:"worker_id"`
	Attempt   string          `json:"attempt"`
	Fence     string          `json:"fence,omitempty"`
	Cancel    bool            `json:"cancel"`
	Config    TrainConfig     `json:"config"`
	Input     json.RawMessage `json:"input,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
	LastSeq   int64           `json:"last_seq"`
	CreatedAt int64           `json:"created_at"`
	UpdatedAt int64           `json:"updated_at"`
}
type Worker struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	ProjectID    string          `json:"project_id"`
	Capabilities json.RawMessage `json:"capabilities"`
	LastSeen     int64           `json:"last_seen"`
	Revoked      bool            `json:"revoked"`
	Local        bool            `json:"local"`
}
type Event struct {
	Seq       int64           `json:"seq"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	CreatedAt int64           `json:"created_at"`
}
type Artifact struct {
	ID     string `json:"id"`
	JobID  string `json:"job_id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Resume string `json:"resume"`
}
type Config struct {
	Root  string
	Owner func() string
	// InferenceOwner must not acquire the service-switch RWMutex: a caller can
	// already hold that read lock while awaiting the internal inference request.
	InferenceOwner func() string
	// Source must hold the service's account-switch read lock until visit ends.
	Source        func(context.Context, string, Scope, func(SourceMessage) error) (string, error)
	Connect       func(deployment, name, secret string) (string, error)
	Default       func(profile string) (string, error)
	Rollback      func(current, previous string) error
	ProfileExists func(string) bool
}

func now() int64 { return time.Now().Unix() }
func terminal(s string) bool {
	return s == "succeeded" || s == "failed" || s == "canceled" || s == "paused"
}
