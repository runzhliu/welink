package service

// topics.go — 「话题图谱」Lab 的数据底座（纯本地词频抽取）。
//
// 目标：为 LLM 聚类提供"我这一年到底在聊什么"的原料——
// 一批跨联系人的高频词/短语，外加每个词「主要和谁聊」的归属信息。
//
// 设计：
//   - 只扫消息量 Top N 的私聊（群聊/公众号排除），避免 O(全部联系人 × 分词)
//   - 每个联系人复用词云分词逻辑取其 Top 高频词
//   - 全局聚合：word -> 总词频 + 贡献最多的联系人（用于 LLM 标注"和谁聊")
//   - 受全局时间范围 filterFrom/filterTo 影响（走 timeWhere），所以"今年/全部"由前端切时间范围即可
//
// 纯本地、零网络。LLM 聚类那一步在 main 包的 topic_map.go 里做。

import (
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

// TopicWord 一个高频词及其归属信息（喂给 LLM 聚类用）
type TopicWord struct {
	Word         string   `json:"word"`
	Count        int      `json:"count"`          // 全局总词频（参与统计的联系人合计）
	TopContacts  []string `json:"top_contacts"`   // 贡献该词最多的 1~3 位联系人显示名
}

// TopicCorpus 话题图谱原料
type TopicCorpus struct {
	Words           []TopicWord `json:"words"`            // 按全局词频降序的高频词
	ScannedContacts int         `json:"scanned_contacts"` // 实际参与统计的私聊数
	TotalContacts   int         `json:"total_contacts"`   // 有消息的私聊总数
}

// GetTopicCorpus 抽取话题图谱原料。
//
//	topContacts:  扫描消息量 Top N 的私聊（建议 60；0 走默认）
//	wordsPerUser: 每个联系人取其 Top 多少高频词参与全局聚合（建议 40；0 走默认）
//	maxWords:     全局最多返回多少个高频词（建议 150；0 走默认）
func (s *ContactService) GetTopicCorpus(topContacts, wordsPerUser, maxWords int) *TopicCorpus {
	if topContacts <= 0 {
		topContacts = 60
	}
	if wordsPerUser <= 0 {
		wordsPerUser = 40
	}
	if maxWords <= 0 {
		maxWords = 150
	}

	s.cacheMu.RLock()
	stats := s.cache
	s.cacheMu.RUnlock()

	// 挑出 Top N 私聊（排除群聊/公众号），按消息量降序
	type cand struct {
		username, name string
		total          int64
	}
	picks := make([]cand, 0, 128)
	for _, c := range stats {
		if strings.HasSuffix(c.Username, "@chatroom") || strings.HasPrefix(c.Username, "gh_") {
			continue
		}
		if c.TotalMessages <= 0 {
			continue
		}
		name := c.Remark
		if name == "" {
			name = c.Nickname
		}
		if name == "" {
			name = c.Username
		}
		picks = append(picks, cand{c.Username, name, c.TotalMessages})
	}
	totalContacts := len(picks)
	sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
	if len(picks) > topContacts {
		picks = picks[:topContacts]
	}

	// 并发取每个联系人的词云 Top 词
	type perWord struct {
		count        int
		contactCount map[string]int // contact name -> 该联系人贡献的词频
	}
	global := make(map[string]*perWord)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, p := range picks {
		wg.Add(1)
		go func(p cand) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			wc := s.GetWordCloud(p.username, true) // 含我方，话题是双向共聊出来的
			if len(wc) > wordsPerUser {
				wc = wc[:wordsPerUser]
			}
			mu.Lock()
			for _, w := range wc {
				if !utf8.ValidString(w.Word) {
					continue
				}
				pw := global[w.Word]
				if pw == nil {
					pw = &perWord{contactCount: make(map[string]int, 4)}
					global[w.Word] = pw
				}
				pw.count += w.Count
				pw.contactCount[p.name] += w.Count
			}
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	// 组装：按全局词频降序，每词带 Top 1~3 贡献联系人
	words := make([]TopicWord, 0, len(global))
	for word, pw := range global {
		// 取贡献最多的 1~3 位联系人
		type cc struct {
			name string
			n    int
		}
		ccs := make([]cc, 0, len(pw.contactCount))
		for n, cnt := range pw.contactCount {
			ccs = append(ccs, cc{n, cnt})
		}
		sort.Slice(ccs, func(i, j int) bool { return ccs[i].n > ccs[j].n })
		top := make([]string, 0, 3)
		for i := 0; i < len(ccs) && i < 3; i++ {
			top = append(top, ccs[i].name)
		}
		words = append(words, TopicWord{Word: word, Count: pw.count, TopContacts: top})
	}
	sort.Slice(words, func(i, j int) bool {
		if words[i].Count != words[j].Count {
			return words[i].Count > words[j].Count
		}
		return words[i].Word < words[j].Word
	})
	if len(words) > maxWords {
		words = words[:maxWords]
	}

	return &TopicCorpus{
		Words:           words,
		ScannedContacts: len(picks),
		TotalContacts:   totalContacts,
	}
}
