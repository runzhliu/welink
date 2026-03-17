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
