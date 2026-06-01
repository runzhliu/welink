package main

import "testing"

// changePct 复刻 buildSocialFlow 里的算法，方便构造测试用例。
func sfChangePct(this, last int) int {
	if last > 0 {
		p := ((this - last) * 100) / last
		if p > 999 {
			return 999
		}
		return p
	}
	if this > 0 {
		return 999
	}
	return 0
}

func TestClassifySocialFlow(t *testing.T) {
	tests := []struct {
		name       string
		this, last int
		want       string
	}{
		// 去年几乎没聊（≤15）、今年起量（≥15）→ 新晋核心
		{"newcomer-from-zero", 200, 0, sfFlowNewcomer},
		{"newcomer-from-few", 120, 10, sfFlowNewcomer},
		// 去年常聊（≥30）、今年骤降 ≥60% → 悄然淡出
		{"faded-big-drop", 30, 300, sfFlowFaded},
		{"faded-to-zero", 0, 200, sfFlowFaded},
		// 去年有底子（≥15）、今年回暖且翻倍以上（≥100%）→ 逆袭回归
		{"revived-double", 400, 80, sfFlowRevived},
		// 两年都聊、今年涨 ≥50% 但不到翻倍 → 升温
		{"warming-moderate", 170, 110, sfFlowWarming},
		// 两年都聊、变化不大 → 稳定常驻
		{"steady-flat", 200, 190, sfFlowSteady},
		{"steady-small-drop", 180, 200, sfFlowSteady},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifySocialFlow(tt.this, tt.last, sfChangePct(tt.this, tt.last))
			if got != tt.want {
				t.Errorf("classifySocialFlow(this=%d, last=%d) = %q, want %q (changePct=%d)",
					tt.this, tt.last, got, tt.want, sfChangePct(tt.this, tt.last))
			}
		})
	}
}
