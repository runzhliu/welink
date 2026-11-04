package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"welink/backend/service"
)

func chat(date, clock, content string, mine bool) service.ChatMessage {
	return service.ChatMessage{Date: date, Time: clock, Content: content, IsMine: mine, Type: 1}
}

func TestBuildSFTCandidatesSelfAggregatesBursts(t *testing.T) {
	msgs := []service.ChatMessage{
		chat("2026-01-02", "10:00", "吃饭吗", false),
		chat("2026-01-02", "10:01", "去哪儿", false),
		chat("2026-01-02", "10:02", "老地方", true),
		chat("2026-01-02", "10:03", "走起", true),
	}
	candidates, stats := buildSFTCandidates(msgs, true, "c01")
	if stats.TextMessages != 4 || len(candidates) != 1 {
		t.Fatalf("stats=%+v candidates=%d; want 4 text messages and 1 example", stats, len(candidates))
	}
	messages := candidates[0].Example.Messages
	if len(messages) != 3 {
		t.Fatalf("messages=%d; want system+user+assistant", len(messages))
	}
	if messages[1].Role != "user" || messages[1].Content != "吃饭吗\n去哪儿" {
		t.Errorf("unexpected user turn: %+v", messages[1])
	}
	if messages[2].Role != "assistant" || messages[2].Content != "老地方\n走起" {
		t.Errorf("unexpected assistant turn: %+v", messages[2])
	}
}

func TestBuildSFTCandidatesContactReversesRoles(t *testing.T) {
	msgs := []service.ChatMessage{
		chat("2026-01-02", "10:00", "你到哪了", true),
		chat("2026-01-02", "10:01", "楼下", false),
	}
	candidates, _ := buildSFTCandidates(msgs, false, "c01")
	if len(candidates) != 1 {
		t.Fatalf("candidates=%d; want 1", len(candidates))
	}
	messages := candidates[0].Example.Messages
	if messages[1].Role != "user" || messages[1].Content != "你到哪了" {
		t.Errorf("current user's message should be user input: %+v", messages[1])
	}
	if messages[2].Role != "assistant" || messages[2].Content != "楼下" {
		t.Errorf("contact reply should be training target: %+v", messages[2])
	}
}

func TestBuildSFTCandidatesSessionBoundaryAndPrivacy(t *testing.T) {
	msgs := []service.ChatMessage{
		chat("2026-01-02", "10:00", "电话是 13800138000", false),
		chat("2026-01-02", "10:01", "收到", true),
		chat("2026-01-02", "10:20", "聊聊政治局", false),
		chat("2026-01-02", "10:21", "不聊", true),
		chat("2026-01-02", "10:40", "还在吗", false),
		chat("2026-01-02", "10:41", "在", true),
	}
	candidates, stats := buildSFTCandidates(msgs, true, "c01")
	if stats.DroppedSensitive != 1 {
		t.Fatalf("DroppedSensitive=%d; want 1", stats.DroppedSensitive)
	}
	if len(candidates) != 2 {
		t.Fatalf("candidates=%d; want 2 valid sessions", len(candidates))
	}
	if candidates[0].SessionID == candidates[1].SessionID {
		t.Fatal("examples across a 10+ minute gap must not share a session")
	}
	if got := candidates[0].Example.Messages[1].Content; !strings.Contains(got, "[手机号]") || strings.Contains(got, "13800138000") {
		t.Fatalf("mobile was not masked: %q", got)
	}
}

func TestSplitSFTCandidatesKeepsSessionsIsolated(t *testing.T) {
	var candidates []sftCandidate
	for session := 0; session < 20; session++ {
		for item := 0; item < 2; item++ {
			id := "s" + string(rune('a'+session))
			candidates = append(candidates, sftCandidate{
				SessionID: id,
				Timestamp: int64(session*10 + item + 1),
				Example: SFTExample{Messages: []SFTMessage{
					{Role: "system", Content: "system"},
					{Role: "user", Content: "hello"},
					{Role: "assistant", Content: id},
				}},
			})
		}
	}
	train, validation, test := splitSFTCandidates(candidates)
	if len(train) == 0 || len(validation) == 0 || len(test) == 0 {
		t.Fatalf("empty split: train=%d validation=%d test=%d", len(train), len(validation), len(test))
	}
	owners := make(map[string]string)
	for splitName, split := range map[string][]sftCandidate{"train": train, "validation": validation, "test": test} {
		for _, candidate := range split {
			if previous, ok := owners[candidate.SessionID]; ok && previous != splitName {
				t.Fatalf("session %s leaked from %s into %s", candidate.SessionID, previous, splitName)
			}
			owners[candidate.SessionID] = splitName
		}
	}
}

func TestSplitSFTCandidatesNeverSplitsASingleSession(t *testing.T) {
	candidates := []sftCandidate{
		{SessionID: "only", Timestamp: 1},
		{SessionID: "only", Timestamp: 2},
		{SessionID: "only", Timestamp: 3},
	}
	train, validation, test := splitSFTCandidates(candidates)
	if len(train) != len(candidates) || len(validation) != 0 || len(test) != 0 {
		t.Fatalf("single session was split: train=%d validation=%d test=%d", len(train), len(validation), len(test))
	}
}

func TestSplitSFTCandidatesKeepsAllSplitsWithOneLargeSession(t *testing.T) {
	candidates := make([]sftCandidate, 0, 502)
	for i := 0; i < 500; i++ {
		candidates = append(candidates, sftCandidate{SessionID: "large", Timestamp: int64(i + 1)})
	}
	candidates = append(candidates,
		sftCandidate{SessionID: "validation", Timestamp: 1000},
		sftCandidate{SessionID: "test", Timestamp: 2000},
	)
	train, validation, test := splitSFTCandidates(candidates)
	if len(train) != 500 || len(validation) != 1 || len(test) != 1 {
		t.Fatalf("unexpected split: train=%d validation=%d test=%d", len(train), len(validation), len(test))
	}
}

func TestRoundRobinSFTCandidatesBalancesAndFills(t *testing.T) {
	makeBucket := func(prefix string, size int) []sftCandidate {
		bucket := make([]sftCandidate, 0, size)
		for i := 0; i < size; i++ {
			bucket = append(bucket, sftCandidate{SessionID: prefix})
		}
		return bucket
	}
	out := roundRobinSFTCandidates([][]sftCandidate{
		makeBucket("large", 10),
		makeBucket("small", 2),
	}, 8)
	if len(out) != 8 {
		t.Fatalf("len=%d; want 8", len(out))
	}
	if out[0].SessionID != "large" || out[1].SessionID != "small" || out[2].SessionID != "large" || out[3].SessionID != "small" {
		t.Fatalf("initial samples are not balanced: %+v", out[:4])
	}
	if out[7].SessionID != "large" {
		t.Fatal("larger bucket should fill the remaining quota after smaller buckets are exhausted")
	}
}

func TestBuildSFTFilesProducesMSMessagesJSONL(t *testing.T) {
	candidate := sftCandidate{
		SessionID: "c01-s000001",
		Timestamp: 1,
		Example: SFTExample{
			Messages: []SFTMessage{
				{Role: "system", Content: "system"},
				{Role: "user", Content: "你好"},
				{Role: "assistant", Content: "在的"},
			},
			Meta: SFTMeta{ContactID: "c01", SessionID: "c01-s000001", Date: "2026-01-02"},
		},
	}
	files, err := buildSFTFiles([]sftCandidate{candidate}, []sftCandidate{candidate}, nil, nil, 1, sftSourceStats{}, "self")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"data.jsonl", "train.jsonl", "validation.jsonl", "test.jsonl", "manifest.json", "data.stats.json", "README.md", "train.sh", "deploy.sh"} {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %s", name)
		}
	}
	scanner := bufio.NewScanner(bytes.NewReader(files["train.jsonl"]))
	if !scanner.Scan() {
		t.Fatal("train.jsonl is empty")
	}
	var decoded SFTExample
	if err := json.Unmarshal(scanner.Bytes(), &decoded); err != nil {
		t.Fatalf("invalid jsonl: %v", err)
	}
	if len(decoded.Messages) != 3 || decoded.Messages[2].Role != "assistant" {
		t.Fatalf("unexpected messages payload: %+v", decoded.Messages)
	}
	if !strings.Contains(string(files["train.sh"]), "swift sft") {
		t.Fatal("train.sh does not invoke ms-swift")
	}
}
