package main

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

// agentskills.io spec 校验正则：
//   - 必须只含小写 a-z, 0-9, hyphen
//   - 不能 lead/trail hyphen
//   - 不能连续 hyphen
//   - 1-64 字符
var validAgentSkillName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func TestSlugifyAgentSkill(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		fallbackSrc string
		wantPrefix  string // "" 表示直接相等比较 want；非空表示用 HasPrefix 校验
		want        string
	}{
		// 普通英文：保持
		{"alice", "alice", "", "", "alice"},
		{"with-hyphen", "my-skill", "", "", "my-skill"},
		// 大小写归一
		{"uppercase", "Alice", "", "", "alice"},
		{"mixed-case", "MyAwesome-Skill", "", "", "myawesome-skill"},
		// 空格
		{"with-space", "hello world", "", "", "hello-world"},
		// 下划线（spec 不允许）→ 转 hyphen
		{"underscore", "old_skill_name", "", "", "old-skill-name"},
		// 连续 hyphen 折叠
		{"double-hyphen", "foo--bar", "", "", "foo-bar"},
		{"triple-hyphen", "foo---bar---baz", "", "", "foo-bar-baz"},
		// 头尾 hyphen 剥掉
		{"trim-hyphen", "-foo-bar-", "", "", "foo-bar"},
		// 中文 fallback：剥光 → hash
		{"chinese-only", "老王", "Wang Lao", "skill-", ""},
		{"chinese-only-no-fallback", "工作群", "", "skill-", ""},
		{"chinese-mixed", "老王's profile", "", "", "s-profile"},
		// 超长截断
		{"too-long", strings.Repeat("a", 100), "", "", strings.Repeat("a", 64)},
		// fallback 稳定性：同 fallbackSrc → 同 slug
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := slugifyAgentSkill(tt.input, tt.fallbackSrc)
			if tt.wantPrefix != "" {
				if !strings.HasPrefix(got, tt.wantPrefix) {
					t.Errorf("slugifyAgentSkill(%q) = %q; want prefix %q", tt.input, got, tt.wantPrefix)
				}
			} else if got != tt.want {
				t.Errorf("slugifyAgentSkill(%q) = %q; want %q", tt.input, got, tt.want)
			}
			// 所有输出必须 spec 合规
			if !validAgentSkillName.MatchString(got) {
				t.Errorf("slugifyAgentSkill(%q) = %q; 不符合 agentskills.io spec 正则", tt.input, got)
			}
			if len(got) > 64 {
				t.Errorf("slugifyAgentSkill(%q) = %q; 超过 64 字符（实际 %d）", tt.input, got, len(got))
			}
			if got == "" {
				t.Errorf("slugifyAgentSkill(%q) 返回空串", tt.input)
			}
		})
	}
}

func TestSlugifyAgentSkill_FallbackStable(t *testing.T) {
	// 同样的 fallbackSrc 应该产出同样的 hash slug —— 避免重新生成 skill 时 dir 改名
	a := slugifyAgentSkill("老王", "wang-lao")
	b := slugifyAgentSkill("老王", "wang-lao")
	if a != b {
		t.Errorf("同 fallbackSrc 应稳定：a=%q b=%q", a, b)
	}
	// 不同 fallbackSrc 应产出不同 slug —— 避免一批中文名集中塌成同一个 slug
	c := slugifyAgentSkill("老王", "lao-wang")
	if a == c {
		t.Errorf("不同 fallbackSrc 应差异化：均为 %q", a)
	}
}

func TestFormatClaudeSkill_AgentSkillsSpec(t *testing.T) {
	pkg := &SkillPackage{
		SkillType:    "contact",
		Name:         "老王", // 旧 slug 还允许中文
		DisplayName:  "老王",
		Description:  "A test skill for the wang user",
		GeneratedAt:  time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC),
		MessageCount: 100,
		Personality:  "测试性格",
	}
	files, archiveName := formatClaudeSkill(pkg)

	// dir 名（archive 名去掉 .zip）必须 spec 合规
	dirName := strings.TrimSuffix(archiveName, ".zip")
	if !validAgentSkillName.MatchString(dirName) {
		t.Errorf("dir name %q 不符合 agentskills.io spec 正则", dirName)
	}

	// SKILL.md 必须以 dir name 为前缀
	skillKey := dirName + "/SKILL.md"
	skillBody, ok := files[skillKey]
	if !ok {
		t.Fatalf("找不到 %s；files 里有：%v", skillKey, keysOf(files))
	}

	// frontmatter 里 name 必须 == dir name（spec 硬性要求）
	bodyStr := string(skillBody)
	wantNameLine := "name: " + dirName + "\n"
	if !strings.Contains(bodyStr, wantNameLine) {
		t.Errorf("SKILL.md 没找到 %q；前 300 字符：%s", wantNameLine, bodyStr[:min(300, len(bodyStr))])
	}

	// metadata.source: welink 必须存在（用于回溯）
	if !strings.Contains(bodyStr, "source: welink") {
		t.Errorf("SKILL.md 缺 metadata.source: welink")
	}
	if !strings.Contains(bodyStr, "skill_type: contact") {
		t.Errorf("SKILL.md 缺 metadata.skill_type: contact")
	}

	// README.md 也应该在同一 dir 下
	if _, ok := files[dirName+"/README.md"]; !ok {
		t.Errorf("缺 %s/README.md", dirName)
	}
}

func TestFormatClaudeSkill_EnglishName(t *testing.T) {
	pkg := &SkillPackage{
		SkillType:   "self",
		Name:        "my-style",
		DisplayName: "My Writing Style",
		Description: "Mimics the user's writing tone",
		GeneratedAt: time.Now().UTC(),
	}
	files, archiveName := formatClaudeSkill(pkg)
	dirName := strings.TrimSuffix(archiveName, ".zip")
	if dirName != "my-style" {
		t.Errorf("dir name = %q; want %q（应该保留输入 slug）", dirName, "my-style")
	}
	body := string(files[dirName+"/SKILL.md"])
	if !strings.Contains(body, "name: my-style\n") {
		t.Errorf("frontmatter name 应等于 dir name")
	}
}

func keysOf(m map[string][]byte) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
