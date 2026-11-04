package main

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestNormalizeSFTDeploymentOptions(t *testing.T) {
	opts, err := normalizeSFTDeploymentOptions(StartSFTDeploymentOptions{TrainingJobID: "job-1"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Port != 8000 || opts.Backend != "transformers" || opts.GPU != 0 {
		t.Fatalf("unexpected defaults: %+v", opts)
	}
	invalid := []StartSFTDeploymentOptions{
		{TrainingJobID: "../job"},
		{TrainingJobID: "job", Backend: "shell"},
		{TrainingJobID: "job", Port: 80},
		{TrainingJobID: "job", GPU: -1},
		{TrainingJobID: "job", ServedModel: "bad model; rm"},
	}
	for _, candidate := range invalid {
		if _, err := normalizeSFTDeploymentOptions(candidate); err == nil {
			t.Fatalf("expected rejection: %+v", candidate)
		}
	}
}

func TestBuildSFTDeploymentArgsKeepsValuesSeparate(t *testing.T) {
	deployment := &SFTDeployment{
		AdapterPath: "/tmp/adapter with spaces;touch nope", Backend: "transformers",
		Host: "127.0.0.1", Port: 8123, ServedModel: "welink-test",
	}
	args := buildSFTDeploymentArgs(deployment)
	joined := strings.Join(args, "|")
	if !strings.Contains(joined, "/tmp/adapter with spaces;touch nope") {
		t.Fatalf("adapter missing from args: %q", args)
	}
	if args[0] != "deploy" || args[1] != "--adapters" || args[2] != deployment.AdapterPath {
		t.Fatalf("unexpected command args: %q", args)
	}
}

func TestSFTCloneRoutingHeuristic(t *testing.T) {
	if shouldUseSFTCloneRAG(SFTCloneRouteStyle, "你还记得上次吗") {
		t.Fatal("style mode must never use RAG")
	}
	if !shouldUseSFTCloneRAG(SFTCloneRouteHybrid, "你好") {
		t.Fatal("hybrid mode must always use RAG")
	}
	if !shouldUseSFTCloneRAG(SFTCloneRouteAuto, "我们上次在哪里吃饭？") {
		t.Fatal("auto mode should detect factual recall")
	}
	if shouldUseSFTCloneRAG(SFTCloneRouteAuto, "哈哈哈哈") {
		t.Fatal("casual style chat should not use RAG")
	}
}

func TestReadAndSplitSFTEvaluationExamples(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jsonl")
	data := `{"messages":[{"role":"user","content":"在吗"},{"role":"assistant","content":"咋啦"}]}` + "\n" +
		`{"messages":[{"role":"system","content":"x"},{"role":"user","content":"吃饭没"},{"role":"assistant","content":"刚吃"}]}` + "\n"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	examples, err := readSFTEvaluationExamples(path, 1)
	if err != nil || len(examples) != 1 {
		t.Fatalf("read examples: count=%d err=%v", len(examples), err)
	}
	messages, expected, ok := splitSFTEvaluationExample(examples[0])
	if !ok || len(messages) != 1 || messages[0].Content != "在吗" || expected != "咋啦" {
		t.Fatalf("unexpected split: %+v %q %v", messages, expected, ok)
	}
}

func TestCompleteSFTDeployment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"本地回复"}}]}`)
	}))
	defer server.Close()
	hostPort := strings.TrimPrefix(server.URL, "http://")
	host, portText, err := net.SplitHostPort(hostPort)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(portText)
	deployment := &SFTDeployment{Host: host, Port: port, ServedModel: "welink-test"}
	got, err := completeSFTDeployment(deployment, []LLMMessage{{Role: "user", Content: "你好"}})
	if err != nil || got != "本地回复" {
		t.Fatalf("got %q err=%v", got, err)
	}
}

func TestCharBigramF1(t *testing.T) {
	if score := charBigramF1("你好呀", "你好呀"); score != 1 {
		t.Fatalf("identical score=%v", score)
	}
	if score := charBigramF1("完全不同", "你好呀"); score != 0 {
		t.Fatalf("different score=%v", score)
	}
	if ratio := textLengthRatio(strings.Repeat("长", 20), "短"); ratio != 4 {
		t.Fatalf("ratio should be capped, got %v", ratio)
	}
}
