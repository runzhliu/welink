package service

import (
	"testing"
)

func TestScoreSentence_positive(t *testing.T) {
	cases := []struct {
		text string
	}{
		{"今天好开心"},
		{"哈哈哈太棒了"},
		{"感谢你的帮助"},
		{"真的太棒了喜欢"},
	}
	for _, tc := range cases {
		score, ok := scoreSentence(tc.text)
		if !ok {
			t.Errorf("scoreSentence(%q): expected ok=true", tc.text)
		}
		if score <= 0.5 {
			t.Errorf("scoreSentence(%q) = %.3f, want > 0.5 (positive)", tc.text, score)
		}
	}
}

func TestScoreSentence_negative(t *testing.T) {
	cases := []struct {
		text string
	}{
		{"真的很难过"},
		{"太烦恼了"},
		{"感觉很失望"},
		{"累死了头疼"},
	}
	for _, tc := range cases {
		score, ok := scoreSentence(tc.text)
		if !ok {
			t.Errorf("scoreSentence(%q): expected ok=true", tc.text)
		}
		if score >= 0.5 {
			t.Errorf("scoreSentence(%q) = %.3f, want < 0.5 (negative)", tc.text, score)
		}
	}
}

func TestScoreSentence_neutral(t *testing.T) {
	cases := []string{
		"今天天气",
		"我",  // 太短，应该返回 ok=false
		"明天见",
	}
	// 单字符返回 ok=false
	_, ok := scoreSentence("我")
	if ok {
		t.Error("scoreSentence(single rune): expected ok=false")
	}

	// 无情感词的句子 score 应接近 0.5
	score, _ := scoreSentence(cases[0])
	if score != 0.5 {
		// 无情感词时固定返回 0.5
		t.Errorf("scoreSentence(%q) = %.3f, want 0.5 (neutral/no keywords)", cases[0], score)
	}
}

func TestScoreSentence_negation(t *testing.T) {
	// "不开心" 应该是负向
	score, ok := scoreSentence("今天不开心")
	if !ok {
		t.Error("scoreSentence('今天不开心'): expected ok=true")
	}
	if score >= 0.5 {
		t.Errorf("scoreSentence('今天不开心') = %.3f, want < 0.5", score)
	}

	// "不难过" 应该比纯负向得分高（否定后接负面词 → 偏正向）
	scoreNeg, _ := scoreSentence("真的很难过")
	scoreNegNeg, _ := scoreSentence("不难过")
	if scoreNegNeg <= scoreNeg {
		t.Errorf("'不难过'(%.3f) should score higher than '真的很难过'(%.3f)", scoreNegNeg, scoreNeg)
	}
}

func TestScoreSentence_intensifier(t *testing.T) {
	// 程度副词应该让正向/负向分数更极端
	base, _ := scoreSentence("开心")
	intense, _ := scoreSentence("非常开心")
	if intense < base {
		t.Errorf("'非常开心'(%.3f) should score >= '开心'(%.3f)", intense, base)
	}

	baseNeg, _ := scoreSentence("难过")
	intenseNeg, _ := scoreSentence("特别难过")
	if intenseNeg > baseNeg {
		t.Errorf("'特别难过'(%.3f) should score <= '难过'(%.3f)", intenseNeg, baseNeg)
	}
}

func TestScoreSentence_range(t *testing.T) {
	sentences := []string{
		"哈哈哈太棒了开心",
		"难过伤心哭了",
		"没问题可以的",
		"不行不对不好",
	}
	for _, s := range sentences {
		score, _ := scoreSentence(s)
		if score < 0.0 || score > 1.0 {
			t.Errorf("scoreSentence(%q) = %.3f out of [0, 1]", s, score)
		}
	}
}

// ─── Phase 1 新增能力：表情 / 疑问句 / 感叹号 / 网络用语 ────────────────────

func TestScoreSentence_wechatEmoji(t *testing.T) {
	// 纯微信文字表情（以前 strip 后会被当成 invalid）
	score, ok := scoreSentence("好的[玫瑰][爱心]")
	if !ok {
		t.Error("纯表情句子应该能被打分")
	}
	if score <= 0.5 {
		t.Errorf("[玫瑰][爱心] 应该是积极，实际 %.3f", score)
	}

	scoreNeg, ok := scoreSentence("唉[流泪][难过]")
	if !ok {
		t.Error("纯负面表情句子应该能被打分")
	}
	if scoreNeg >= 0.5 {
		t.Errorf("[流泪][难过] 应该是消极，实际 %.3f", scoreNeg)
	}
}

func TestScoreSentence_unicodeEmoji(t *testing.T) {
	s1, ok := scoreSentence("今天真的😭😭")
	if !ok {
		t.Error("带 unicode emoji 的句子应该能被打分")
	}
	if s1 >= 0.5 {
		t.Errorf("😭😭 应是消极，实际 %.3f", s1)
	}

	s2, ok := scoreSentence("太好啦🎉🥰")
	if !ok {
		t.Error("带 unicode emoji 的句子应该能被打分")
	}
	if s2 <= 0.5 {
		t.Errorf("🎉🥰 应是积极，实际 %.3f", s2)
	}
}

func TestScoreSentence_questionSkipped(t *testing.T) {
	// 疑问句不应被当成陈述句来算情感（避免 "你开心吗？" 被打成积极）
	cases := []string{
		"你开心吗？",
		"真的开心吗",
		"你不难过吗？",
		"你难过?",
	}
	for _, c := range cases {
		_, ok := scoreSentence(c)
		if ok {
			t.Errorf("疑问句 %q 不应参与打分", c)
		}
	}
}

func TestScoreSentence_exclamation(t *testing.T) {
	// 纯单极性词的情感已经饱和到 0.9/0.1，感叹号再加权也看不出差别。
	// 所以用混合句：「开心但很累」—— 很累带程度副词权重 1.2，整体略偏消极。
	base, _ := scoreSentence("开心但很累")
	boosted, _ := scoreSentence("开心但很累！")
	if boosted >= base {
		t.Errorf("'开心但很累！'(%.3f) 应比 '开心但很累'(%.3f) 更消极", boosted, base)
	}
}

func TestScoreSentence_netSlang(t *testing.T) {
	// 网络用语应被识别（2020+）
	posCases := []string{"yyds", "绝绝子", "笑死", "真香", "起飞"}
	for _, c := range posCases {
		score, ok := scoreSentence(c + "啊")
		if !ok {
			t.Errorf("%q 应该能被打分", c)
			continue
		}
		if score <= 0.5 {
			t.Errorf("%q 应为积极，实际 %.3f", c, score)
		}
	}

	negCases := []string{"裂开", "摆烂", "emo", "社死", "心态崩"}
	for _, c := range negCases {
		score, ok := scoreSentence(c + "了")
		if !ok {
			t.Errorf("%q 应该能被打分", c)
			continue
		}
		if score >= 0.5 {
			t.Errorf("%q 应为消极，实际 %.3f", c, score)
		}
	}
}
