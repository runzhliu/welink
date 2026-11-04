package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeSFTTrainingOptionsDefaultsAndValidation(t *testing.T) {
	opts, err := normalizeSFTTrainingOptions(SubmitSFTTrainingOptions{SkillID: "skill-1"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Model != sftDefaultModel || opts.Epochs != 2 || opts.LearningRate != 1e-4 ||
		opts.LoRARank != 16 || opts.MaxLength != 1024 || opts.BatchSize != 1 ||
		opts.GradientAccumulation != 16 || opts.DType != "bfloat16" {
		t.Fatalf("unexpected defaults: %+v", opts)
	}

	invalid := []SubmitSFTTrainingOptions{
		{},
		{SkillID: "x", Model: "--output_dir"},
		{SkillID: "x", Epochs: 11},
		{SkillID: "x", LearningRate: 0.1},
		{SkillID: "x", LoRARank: 7},
		{SkillID: "x", MaxLength: 128},
		{SkillID: "x", BatchSize: 17},
		{SkillID: "x", GradientAccumulation: 300},
		{SkillID: "x", DType: "int8"},
	}
	for index, input := range invalid {
		if _, err := normalizeSFTTrainingOptions(input); err == nil {
			t.Errorf("case %d should fail: %+v", index, input)
		}
	}
}

func TestBuildSFTTrainingArgsUsesSeparateArguments(t *testing.T) {
	job := &SFTTrainingJob{
		Model: "Qwen/test model", Epochs: 1.5, LearningRate: 2e-4,
		LoRARank: 8, MaxLength: 2048, BatchSize: 2, GradientAccumulation: 4, DType: "float16",
	}
	args := buildSFTTrainingArgs(job, "/private dataset", "/private output")
	wantPrefix := []string{"sft", "--model", "Qwen/test model", "--dataset", "/private dataset/train.jsonl"}
	if !reflect.DeepEqual(args[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("unexpected args prefix: %#v", args[:len(wantPrefix)])
	}
	joined := strings.Join(args, "\n")
	for _, expected := range []string{"--lora_rank\n8", "--num_train_epochs\n1.5", "--torch_dtype\nfloat16", "--output_dir\n/private output"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("args missing %q: %#v", expected, args)
		}
	}
}

func TestExtractSFTDatasetAllowsOnlyExpectedFiles(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string]string{
		"train.jsonl":      "{\"messages\":[]}\n",
		"validation.jsonl": "{\"messages\":[]}\n",
		"test.jsonl":       "{\"messages\":[]}\n",
		"../escape.txt":    "must not escape",
		"train.sh":         "must not execute",
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	zipPath := filepath.Join(temp, "dataset.zip")
	if err := os.WriteFile(zipPath, buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(temp, "dataset")
	if err := os.MkdirAll(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := extractSFTDataset(zipPath, target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "train.jsonl")); err != nil {
		t.Fatal("train.jsonl missing")
	}
	if _, err := os.Stat(filepath.Join(temp, "escape.txt")); !os.IsNotExist(err) {
		t.Fatal("zip traversal entry escaped target directory")
	}
	if _, err := os.Stat(filepath.Join(target, "train.sh")); !os.IsNotExist(err) {
		t.Fatal("executable script should not be extracted")
	}
}

func TestFindSFTAdapterPathChoosesNewestAdapter(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "checkpoint-50")
	newPath := filepath.Join(root, "checkpoint-100")
	for _, path := range []string{oldPath, newPath} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "adapter_config.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().Add(-time.Hour)
	if err := os.Chtimes(filepath.Join(oldPath, "adapter_config.json"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if got := findSFTAdapterPath(root); got != newPath {
		t.Fatalf("got %q, want %q", got, newPath)
	}
}
