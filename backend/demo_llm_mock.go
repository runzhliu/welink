package main

// demo_llm_mock.go — Demo 模式下 LLM / Embedding 的 canned 响应。
//
// 目的：DEMO_MODE=true + DemoAIDisabled()=true 时（默认），用户不能填 API Key，
// 真实 LLM 走不了；所以把 CompleteLLM/streamLLMCore/GetEmbeddingsBatch 拦下来，
// 根据 prompt 内容返回一个主题化（阿森纳）的 mock 结果，保持前端流程完整。
//
// 匹配靠 prompt 里的特征字符串（"播客" / "开场白" / "mem_facts" 等），
// 命中就回对应的结构化结果；没命中就回一段通用的中文回复。

import (
	"fmt"
	"math/rand"
	"os"
	"strings"
	"time"
)

// DemoMockActive 仅当 DEMO_MODE=true 且 AI 配置被锁死时才返回 true。
// 如果 demo 里把 DEMO_DISABLE_AI=false 显式打开（允许用户填自己 Key），
// 就不走 mock，按正常 LLM 路径请求。
func DemoMockActive() bool {
	return os.Getenv("DEMO_MODE") == "true" && DemoAIDisabled()
}

// demoLLMComplete 给定 prompt messages，返回 canned 响应。
// 调用方（CompleteLLM）在 DemoMockActive() 命中时直接返回这个字符串。
func demoLLMComplete(msgs []LLMMessage) string {
	joined := concatPrompts(msgs)

	switch {
	case strings.Contains(joined, "播客脚本") || strings.Contains(joined, "双人对话"):
		return demoMockPodcastScript(joined)
	case strings.Contains(joined, "开场白") || strings.Contains(joined, "破冰"):
		return demoMockIcebreaker(joined)
	case strings.Contains(joined, "提取关键事实") || strings.Contains(joined, "提炼事实"):
		return demoMockMemFacts()
	case strings.Contains(joined, "模拟") && strings.Contains(joined, "对话") && strings.Contains(joined, "TA："):
		return demoMockContinueDialog(joined)
	case strings.Contains(joined, "人物卡") || strings.Contains(joined, "人设档案"):
		return demoMockPersonaCard(joined)
	default:
		return demoMockGenericReply(joined)
	}
}

// demoLLMStream 给定 sendChunk，把 canned 响应切成块推送。
// 模拟真实 LLM 的流式输出节奏：每 30-60 字一个 chunk，50ms 间隔。
func demoLLMStream(sendChunk func(StreamChunk), msgs []LLMMessage) {
	full := demoLLMComplete(msgs)
	runes := []rune(full)
	// 按 ~40 rune 一块切分
	const chunkSize = 40
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		sendChunk(StreamChunk{Delta: string(runes[i:end])})
		time.Sleep(30 * time.Millisecond)
	}
	sendChunk(StreamChunk{Done: true})
}

func concatPrompts(msgs []LLMMessage) string {
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(m.Content)
		sb.WriteString("\n")
	}
	return sb.String()
}

// ─── 各功能的 canned 响应 ────────────────────────────────────────────────────

func demoMockPodcastScript(promptText string) string {
	title := "在酋长球场的某个普通傍晚"
	// 粗略从 prompt 里捞联系人名
	name := extractDemoContactName(promptText, "某位好友")
	return fmt.Sprintf(`{"title":"%s","lines":[
{"speaker":"A","text":"欢迎回到 WeLink 播客，我是 A，今天要讲一段你和 %s 的故事。"},
{"speaker":"B","text":"嗨大家好，我是 B。看聊天记录的时候我被一个数字打动了——你们互发了上千条消息，跨度超过两年。"},
{"speaker":"A","text":"两年，不短了。对方在对话里最常出现的词是战术板和压迫强度，非常 Arteta 风。"},
{"speaker":"B","text":"有意思的是你主动发起的比例稍高一点，大概 55 对 45。"},
{"speaker":"A","text":"凌晨时段也有不少消息——看来你俩都是 Arsenal 凌晨场的忠实观众。"},
{"speaker":"B","text":"节日、纪念日、生日，你们从来没漏过，这种默契很可贵。"},
{"speaker":"A","text":"红包和转账记录也挺多，队里分摊球衣、下注冠军杯，看来关系很实在。"},
{"speaker":"B","text":"那句最高频的"COYG"出现了几十次，每次都像小型庆祝。"},
{"speaker":"A","text":"如果你正在听这段，不如今晚就给对方发句"更衣室见"。"},
{"speaker":"B","text":"这就是今天的 WeLink Podcast。愿你们的北伦敦永远红色。晚安。"}
]}`, title, name)
}

func demoMockIcebreaker(promptText string) string {
	name := extractDemoContactName(promptText, "老朋友")
	return fmt.Sprintf(`{"drafts":[
{"tone":"关心近况","text":"哎 %s，最近训练量还行吧？上次说的腰还疼不"},
{"tone":"回忆话题","text":"刚翻到我们之前聊三冠王那段，现在看还是挺热血的"},
{"tone":"轻松调侃","text":"你上回发的那个内切视频我又看了三遍，不腻"},
{"tone":"约见","text":"周末去球场看一场？酋长还是附近草场，你挑"}
]}`, name)
}

func demoMockMemFacts() string {
	return `["对方是阿森纳一线队成员，聊天围绕训练和比赛","对方训练勤奋，经常早到","对方对战术细节有研究"]`
}

func demoMockContinueDialog(promptText string) string {
	me := "我"
	if strings.Contains(promptText, "「我」") {
		me = "我"
	}
	return fmt.Sprintf(`%s：今晚的战术复盘你看了吗
TA：看完了，Arteta 把第二点抓得死死的
%s：对啊，边路那个 trigger 特别关键
TA：下一场还得把这个保留下来
%s：周末有空一起去酋长吗
TA：可以，带上常坐的那几个兄弟`, me, me, me)
}

func demoMockPersonaCard(promptText string) string {
	name := extractDemoContactName(promptText, "对方")
	return fmt.Sprintf(`### %s 人设档案

- 身份：阿森纳一线队成员
- 性格：自信、热血、有团队意识
- 兴趣：战术复盘、游戏、健身
- 说话风格：简洁直接，英式俚语偶尔出现
- 标志性口头禅：COYG、北伦敦是红色的

近况关键词：训练强度、更衣室氛围、冠军杯备战`, name)
}

func demoMockGenericReply(promptText string) string {
	// 取 prompt 最后一段话做简单关键词回应
	lines := strings.Split(strings.TrimSpace(promptText), "\n")
	tail := lines[len(lines)-1]
	if len([]rune(tail)) > 40 {
		tail = string([]rune(tail)[:40]) + "…"
	}
	pool := []string{
		"明白了——" + tail + " 我来想想怎么接上。",
		"COYG 兄弟，你说的这个我最近也在琢磨。",
		"收到，晚点训练场见面再聊细节。",
		"这个点子不错，我们周会提一下。",
		"北伦敦是红色的——你这个想法我站你。",
	}
	rng := rand.New(rand.NewSource(int64(len(promptText))))
	return pool[rng.Intn(len(pool))] + "\n\n（Demo 模式：AI 回复为预置模拟，要接真实模型请设置 DEMO_DISABLE_AI=false 并配置 API Key）"
}

// extractDemoContactName 从 prompt 里抠出"联系人：XXX"之后的名字，抠不到就用 fallback。
func extractDemoContactName(promptText, fallback string) string {
	for _, marker := range []string{"联系人：", "contact：", "某位联系人", "和这位联系人"} {
		if idx := strings.Index(promptText, marker); idx >= 0 {
			rest := promptText[idx+len(marker):]
			// 截到第一个换行或 40 rune 内
			cut := rest
			if nl := strings.IndexAny(rest, "\n\r"); nl >= 0 {
				cut = rest[:nl]
			}
			cut = strings.TrimSpace(cut)
			if runes := []rune(cut); len(runes) > 0 && len(runes) < 40 {
				return string(runes)
			}
		}
	}
	return fallback
}
