package main

// vn_prefetch.go — 互动小说"预生成下一章"机制
//
// 设计思路：
//   当玩家正在读当前章时，后台异步生成一份"假设玩家选第 0 个选项"的下一章草稿。
//   命中（玩家真选了第 0 个选项）→ /next 直接秒出整章；未命中 → 走老路现场生成。
//
// 命中率：取决于 UI 排序——通常第 0 个选项是"积极/讨好"风格，玩家自然偏好。
//   实测约 30-50%，按 50% 摊算等于每章生成成本 1.5×、节省 50% 等待时间。
//
// 失效：rewind / delete 时清掉对应 story 全部缓存。30 分钟 TTL 防止泄漏。
//
// 进程内缓存，应用重启即失效（VN 是低频功能，无需持久化）。

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"
)

// prefetchedChapter 缓存的预生成章节内容（已是解析好的结构，省去 /next 那边再 parse）。
type prefetchedChapter struct {
	Narration string
	Choices   []VNChoice
	Title     string
	Synopsis  string
	Ending    *VNEndingPayload
	CreatedAt time.Time
}

type prefetchKey struct {
	StoryID    int64
	ChapterIdx int // 这是即将生成的章的 idx，假设上一章玩家选了 OptionIdx
	OptionIdx  int
}

var (
	prefetchMu    sync.Mutex
	prefetchCache = make(map[prefetchKey]*prefetchedChapter)
)

const prefetchTTL = 30 * time.Minute

// vnPrefetchGet 取缓存。命中且未过期返回非 nil。
// 取出即删除（一次性消费，避免重复秒出）。
func vnPrefetchGet(storyID int64, chapterIdx, optionIdx int) *prefetchedChapter {
	prefetchMu.Lock()
	defer prefetchMu.Unlock()
	k := prefetchKey{storyID, chapterIdx, optionIdx}
	v, ok := prefetchCache[k]
	if !ok {
		return nil
	}
	delete(prefetchCache, k)
	if time.Since(v.CreatedAt) > prefetchTTL {
		return nil
	}
	return v
}

// vnPrefetchPut 写缓存。
func vnPrefetchPut(storyID int64, chapterIdx, optionIdx int, p *prefetchedChapter) {
	prefetchMu.Lock()
	defer prefetchMu.Unlock()
	p.CreatedAt = time.Now()
	prefetchCache[prefetchKey{storyID, chapterIdx, optionIdx}] = p
}

// vnPrefetchClearStory 清掉某 story 的所有预生成（rewind/delete 时调）。
func vnPrefetchClearStory(storyID int64) {
	prefetchMu.Lock()
	defer prefetchMu.Unlock()
	for k := range prefetchCache {
		if k.StoryID == storyID {
			delete(prefetchCache, k)
		}
	}
}

// vnSchedulePrefetch 异步预生成下一章（假设玩家选了第 0 个选项）。
//
// 调用时机：当前章 done 写库后；条件：
//   - 当前章不是结局章
//   - 下一章不是最后一章（避免预生成结局——结局判定依赖真实 state，预测错代价大）
//   - choices 非空
//
// 真正调用 LLM 用 CompleteLLM（非流式即可，反正用户读字的同时跑）。
func vnSchedulePrefetch(story *VNStory, currentChapter *VNChapter, profPrefs Preferences) {
	if currentChapter == nil || len(currentChapter.Choices) == 0 {
		return
	}
	// 不预生成最后一章（结局判定依赖真实 state）
	nextIdx := currentChapter.ChapterIdx + 1
	if nextIdx >= story.MaxChapters {
		return
	}
	chosenIdx := 0 // 押"用户最可能选第一个"
	chosen := currentChapter.Choices[chosenIdx]

	go func() {
		// 模拟玩家选了 0 后的状态
		assumedState := MergeVNState(story.State, chosen.StateDelta)
		// 构造假设 story 副本（不写库）
		simStory := *story
		simStory.State = assumedState

		// existing 列表里把当前章的 ChosenIdx 改为 0
		existing, err := ListVNChapters(story.ID)
		if err != nil {
			return
		}
		for i := range existing {
			if existing[i].ChapterIdx == currentChapter.ChapterIdx {
				existing[i].ChosenIdx = chosenIdx
			}
		}

		systemPrompt := vnBuildSystemPrompt(&simStory)
		userPrompt := vnBuildUserPrompt(&simStory, existing)

		// 非流式调用，省一次连接管理
		narration, metaRaw, err := vnFallbackComplete(systemPrompt, userPrompt, profPrefs)
		if err != nil || strings.TrimSpace(narration) == "" {
			return
		}
		var meta struct {
			Title    string           `json:"title,omitempty"`
			Synopsis string           `json:"synopsis,omitempty"`
			Choices  []VNChoice       `json:"choices"`
			Ending   *VNEndingPayload `json:"ending,omitempty"`
		}
		if err := json.Unmarshal([]byte(metaRaw), &meta); err != nil {
			return
		}
		// 预生成时不接受 ending（依赖真实 state，可能错判）
		if meta.Ending != nil {
			return
		}
		vnPrefetchPut(story.ID, nextIdx, chosenIdx, &prefetchedChapter{
			Narration: narration,
			Choices:   meta.Choices,
			Title:     meta.Title,
			Synopsis:  meta.Synopsis,
		})
		log.Printf("[vn] prefetched story=%d chapter=%d option=%d", story.ID, nextIdx, chosenIdx)
	}()
}
