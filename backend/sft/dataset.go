package sft

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxSamples = 20000
const MaxImportBytes = 32 << 20

var phoneRE = regexp.MustCompile(`(?:\+?86[- ]?)?1[3-9][0-9]{9}|[0-9]{17}[0-9Xx]`)
var emailRE = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
var wxidRE = regexp.MustCompile(`wxid_[a-zA-Z0-9_]+`)
var urlRE = regexp.MustCompile(`https?://[^\s<>]+`)

func redact(v string) (string, bool) {
	u := phoneRE.ReplaceAllString(v, "[号码]")
	u = emailRE.ReplaceAllString(u, "[邮箱]")
	u = wxidRE.ReplaceAllString(u, "[账号]")
	u = urlRE.ReplaceAllString(u, "[链接]")
	return strings.TrimSpace(u), u != v
}
func canonical(ms []Message) string {
	var b strings.Builder
	for _, m := range ms {
		b.WriteString(m.Role)
		b.WriteByte(':')
		for _, r := range strings.ToLower(m.Content) {
			if !unicode.IsSpace(r) && !unicode.IsPunct(r) {
				b.WriteRune(r)
			}
		}
		b.WriteByte('\n')
	}
	return b.String()
}
func validateMessages(ms []Message) error {
	if len(ms) < 2 || len(ms) > 32 || ms[len(ms)-1].Role != "assistant" {
		return fmt.Errorf("样本必须以本人 assistant 回复结尾，最多 32 条消息")
	}
	last := ""
	hasUser := false
	for i, m := range ms {
		if strings.TrimSpace(m.Content) == "" || utf8.RuneCountInString(m.Content) > 16000 {
			return fmt.Errorf("消息为空或超长")
		}
		if m.Role == "system" && i == 0 {
			continue
		}
		if m.Role != "user" && m.Role != "assistant" {
			return fmt.Errorf("未知角色")
		}
		if m.Role == last {
			return fmt.Errorf("需要交替的 user / assistant 角色")
		}
		if last == "" && m.Role != "user" {
			return fmt.Errorf("上下文必须从 user 开始")
		}
		last = m.Role
		hasUser = hasUser || m.Role == "user"
	}
	if !hasUser {
		return fmt.Errorf("缺少 user 上下文")
	}
	return nil
}

type turn struct {
	role, text  string
	ids         []string
	first, last int64
}
type Builder struct {
	owner, contact string
	last           int64
	session        int
	turns          []turn
	Samples        []Sample
	Report         Report
	seen           map[string]bool
	quotas         map[string]int
	bytes          int
}

func NewBuilder(owner string) *Builder {
	return &Builder{owner: owner, Report: Report{Excluded: map[string]int{}, Contributions: map[string]int{}, Splits: map[string]int{}}, seen: map[string]bool{}, quotas: map[string]int{}}
}
func (b *Builder) exclude(reason string) { b.Report.Excluded[reason]++ }
func (b *Builder) flush() {
	if len(b.turns) == 0 {
		return
	}
	group := digest([]byte(fmt.Sprintf("%s:%s:%d:%d", b.owner, b.contact, b.session, b.turns[0].first)))
	for i, t := range b.turns {
		if t.role != "assistant" || i == 0 || b.turns[i-1].role != "user" {
			continue
		}
		b.Report.Candidates++
		if t.first-b.turns[i-1].last > 300 {
			b.exclude("超过回复窗口")
			continue
		}
		if utf8.RuneCountInString(strings.TrimSpace(t.text)) < 2 {
			b.exclude("目标回复过短")
			continue
		}
		start := i - 9
		if start < 0 {
			start = 0
		}
		if b.turns[start].role == "assistant" {
			start++
		}
		ms := []Message{}
		ids := []string{}
		issues := []string{}
		for _, v := range b.turns[start : i+1] {
			text, changed := redact(v.text)
			if changed && len(issues) == 0 {
				issues = append(issues, "已自动脱敏，请复核")
			}
			ms = append(ms, Message{Role: v.role, Content: text})
			ids = append(ids, v.ids...)
		}
		if e := validateMessages(ms); e != nil {
			b.exclude("格式或长度不符合要求")
			continue
		}
		h := digest([]byte(canonical(ms)))
		if b.seen[h] {
			b.exclude("重复或近重复")
			continue
		}
		if b.quotas[b.contact] >= 200 {
			b.exclude("联系人贡献上限")
			continue
		}
		if len(b.Samples) >= MaxSamples {
			b.exclude("数据集样本上限")
			continue
		}
		size := len(encode(struct {
			Messages []Message `json:"messages"`
		}{ms})) + 1
		if b.bytes+size > MaxImportBytes {
			b.exclude("数据集文本达到 32 MB 上限")
			continue
		}
		b.bytes += size
		b.seen[h] = true
		b.quotas[b.contact]++
		contact := digest([]byte(b.owner + ":" + b.contact))[:12]
		b.Samples = append(b.Samples, Sample{ID: ID("smp"), Messages: ms, Group: group, Cluster: h, Sources: ids, Contact: contact, Timestamp: t.last, Issues: issues, Review: "pending"})
	}
	b.turns = nil
	b.session++
}
func (b *Builder) Add(m SourceMessage) error {
	b.Report.Raw++
	if m.Contact != b.contact {
		b.flush()
		b.contact = m.Contact
		b.last = 0
	}
	if !m.Known || m.Timestamp <= 0 || (b.last > 0 && m.Timestamp < b.last) {
		b.flush()
		b.exclude("时间或角色不明")
		b.last = 0
		return nil
	}
	if !m.Text || strings.TrimSpace(m.Content) == "" {
		b.flush()
		b.exclude("非文本或空消息")
		b.last = m.Timestamp
		return nil
	}
	if b.last > 0 && m.Timestamp-b.last > 1800 {
		b.flush()
	}
	b.last = m.Timestamp
	role := "user"
	if m.Mine {
		role = "assistant"
	}
	if n := len(b.turns); n > 0 && b.turns[n-1].role == role {
		t := &b.turns[n-1]
		if m.Timestamp-t.last <= 60 && utf8.RuneCountInString(t.text)+utf8.RuneCountInString(m.Content) <= 4000 {
			t.text += "\n" + m.Content
			t.last = m.Timestamp
			t.ids = append(t.ids, m.ID)
			return nil
		}
		b.flush()
	}
	// Bound per-session memory without assigning overlapping context to another split.
	if len(b.turns) > 128 {
		b.flush()
	}
	b.turns = append(b.turns, turn{role: role, text: m.Content, ids: []string{m.ID}, first: m.Timestamp, last: m.Timestamp})
	return nil
}
func (b *Builder) Finish() ([]Sample, Report) {
	b.flush()
	return b.Samples, report(b.Samples, b.Report)
}

func Import(r io.Reader, owner string) ([]Sample, Report, error) {
	b := NewBuilder(owner)
	scanner := bufio.NewScanner(io.LimitReader(r, MaxImportBytes+1))
	scanner.Buffer(make([]byte, 4096), 256<<10)
	total := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		total += len(line) + 1
		if total > MaxImportBytes {
			return nil, b.Report, fmt.Errorf("JSONL 超过 32 MB")
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		b.Report.Raw++
		var row struct {
			Messages    []Message `json:"messages"`
			Instruction string    `json:"instruction"`
			Input       string    `json:"input"`
			Output      string    `json:"output"`
		}
		if e := json.Unmarshal(line, &row); e != nil {
			return nil, b.Report, fmt.Errorf("第 %d 行不是有效 JSON", b.Report.Raw)
		}
		ms := row.Messages
		if len(ms) == 0 {
			input := row.Instruction
			if row.Input != "" {
				input += "\n" + row.Input
			}
			ms = []Message{{Role: "user", Content: input}, {Role: "assistant", Content: row.Output}}
		}
		if e := validateMessages(ms); e != nil {
			return nil, b.Report, fmt.Errorf("第 %d 行：%w", b.Report.Raw, e)
		}
		issues := []string{}
		for i := range ms {
			v, changed := redact(ms[i].Content)
			ms[i].Content = v
			if changed && len(issues) == 0 {
				issues = append(issues, "已自动脱敏，请复核")
			}
		}
		h := digest([]byte(canonical(ms)))
		b.Report.Candidates++
		if b.seen[h] {
			b.exclude("重复或近重复")
			continue
		}
		b.seen[h] = true
		if len(b.Samples) >= MaxSamples {
			return nil, b.Report, fmt.Errorf("最多导入 %d 条样本", MaxSamples)
		}
		// Imported rows have no trustworthy time/provenance. A shared prompt is a
		// single group, preventing the same input from becoming train and test.
		g := digest([]byte(canonical(ms[:len(ms)-1])))
		inferred := []string{"import-question:" + digest([]byte(canonical(ms[len(ms)-2:len(ms)-1])))}
		start := 0
		if ms[0].Role == "system" {
			start = 1
		}
		for i := start; i+1 < len(ms); i += 2 {
			inferred = append(inferred, "import-turn:"+digest([]byte(canonical(ms[i:i+2]))))
		}
		b.Samples = append(b.Samples, Sample{ID: ID("smp"), Messages: ms, Group: g, Cluster: h, Sources: inferred, Contact: "import", Timestamp: int64(b.Report.Raw), Issues: issues, Review: "pending"})
	}
	if e := scanner.Err(); e != nil {
		return nil, b.Report, fmt.Errorf("行超过 256 KB 或读取失败")
	}
	return b.Samples, report(b.Samples, b.Report), nil
}
func report(samples []Sample, base Report) Report {
	base.Kept = 0
	base.Unreviewed = 0
	base.Splits = map[string]int{}
	base.Contributions = map[string]int{}
	for _, v := range samples {
		if v.Review == "excluded" {
			continue
		}
		base.Kept++
		base.Contributions[v.Contact]++
		if v.Review == "pending" {
			base.Unreviewed++
		}
		if v.Split != "" {
			base.Splits[v.Split]++
		}
	}
	return base
}

// splitGroups unions source-overlap and duplicate clusters before assigning
// chronological groups. A dataset with one conversation cannot fake a test set.
func splitGroups(samples []Sample) []Sample {
	out := []Sample{}
	for _, v := range samples {
		if v.Review != "excluded" {
			out = append(out, v)
		}
	}
	parent := make([]int, len(out))
	for i := range parent {
		parent[i] = i
	}
	var root func(int) int
	root = func(i int) int {
		if parent[i] != i {
			parent[i] = root(parent[i])
		}
		return parent[i]
	}
	seen := map[string]int{}
	for i, v := range out {
		keys := []string{"g:" + v.Group, "c:" + v.Cluster}
		for _, src := range v.Sources {
			keys = append(keys, "s:"+src)
		}
		for _, key := range keys {
			if prev, ok := seen[key]; ok {
				parent[root(i)] = root(prev)
			} else {
				seen[key] = i
			}
		}
	}
	type group struct {
		ids []int
		ts  int64
		key string
	}
	groups := map[int]*group{}
	for i, v := range out {
		r := root(i)
		g := groups[r]
		if g == nil {
			g = &group{ts: v.Timestamp, key: v.Group}
			groups[r] = g
		}
		g.ids = append(g.ids, i)
		if v.Timestamp < g.ts {
			g.ts = v.Timestamp
		}
		if v.Group < g.key {
			g.key = v.Group
		}
	}
	ordered := []*group{}
	for _, g := range groups {
		ordered = append(ordered, g)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].ts == ordered[j].ts {
			return ordered[i].key < ordered[j].key
		}
		return ordered[i].ts < ordered[j].ts
	})
	count := 0
	for _, g := range ordered {
		split := "train"
		if count >= len(out)*9/10 {
			split = "test"
		} else if count >= len(out)*8/10 {
			split = "valid"
		}
		for _, i := range g.ids {
			out[i].Split = split
		}
		count += len(g.ids)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Timestamp != b.Timestamp {
			return a.Timestamp < b.Timestamp
		}
		if a.Contact != b.Contact {
			return a.Contact < b.Contact
		}
		if a.Group != b.Group {
			return a.Group < b.Group
		}
		return a.Cluster < b.Cluster
	})
	return out
}
func (s *Store) freeze(owner, id string, revision int) (Dataset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var d Dataset
	if e := s.get(owner, "dataset", id, &d); e != nil {
		return d, e
	}
	if d.State == "frozen" {
		return d, nil
	}
	if d.State != "draft" || d.Revision != revision {
		return d, ErrConflict
	}
	samples, e := s.sampleList(owner, id)
	if e != nil {
		return d, e
	}
	for _, v := range samples {
		if v.Review == "pending" && len(v.Issues) > 0 {
			return d, fmt.Errorf("仍有自动脱敏样本未复核")
		}
	}
	kept := splitGroups(samples)
	if len(kept) == 0 {
		return d, fmt.Errorf("没有可冻结的样本")
	}
	chunks := map[string]*bytes.Buffer{"train": {}, "valid": {}, "test": {}}
	for _, v := range kept {
		chunks[v.Split].Write(encode(struct {
			Messages []Message `json:"messages"`
		}{v.Messages}))
		chunks[v.Split].WriteByte('\n')
	}
	// Manifest is committed last. A crash can leave unreachable files, never a
	// successful version pointing to half-written data.
	for split, b := range chunks {
		if e = atomicWrite(s.file(owner, id, split), b.Bytes()); e != nil {
			return d, e
		}
	}
	d.Report = report(kept, d.Report)
	d.State = "frozen"
	d.Revision++
	d.SHA256 = digest(append(append(chunks["train"].Bytes(), chunks["valid"].Bytes()...), chunks["test"].Bytes()...))
	d.FileSHA256 = map[string]string{}
	for split, b := range chunks {
		d.FileSHA256[split] = digest(b.Bytes())
	}
	if e = atomicWrite(s.file(owner, id, "manifest"), encode(d)); e != nil {
		return d, e
	}
	e = s.commitDataset(owner, d, kept)
	return d, e
}
