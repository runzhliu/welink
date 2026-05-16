package main

// vn.go — 视觉小说（互动小说）主逻辑
//
// 入口：POST /api/vn/start → 同步建档（人设快照 + facts 抽样）
//      GET (SSE) /api/vn/stories/:id/next → 流式生成下一章
//      POST /api/vn/stories/:id/choose → 提交选项 + 合并 state
//      GET /api/vn/stories/:id → 加载存档（含全部章节）
//      GET /api/vn/stories?username= → 该联系人历史存档列表
//      POST /api/vn/stories/:id/rewind → 读档回滚
//      DELETE /api/vn/stories/:id → 删档
//      GET /api/vn/endings/:username → 该联系人已解锁结局
//
// 剧情生成模型：按需流式 + 滚动摘要。每章 LLM 输入：
//   人设（clone_profile.prompt）+ 事实素材（开局抽 8-12 条 mem_facts）+ 当前 state
//   + 前几章 narration 摘要（≤ 50 字/章）+ 上一回合玩家所选选项
// 输出严格 JSON：{narration, choices[], state_delta?, ending?}
//
// 章节数动态 5-8（默认 max=6）；玩家踩 dealbreaker 或 state 触发阈值可短路出 ending。

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

func registerVNRoutes(api *gin.RouterGroup, getSvc func() *service.ContactService) {
	api.POST("/vn/start", vnStartHandler(getSvc))
	api.GET("/vn/stories/:id/next", vnNextChapterHandler(getSvc))
	api.POST("/vn/stories/:id/choose", vnChooseHandler())
	api.GET("/vn/stories/:id", vnGetStoryHandler())
	api.GET("/vn/stories", vnListStoriesHandler())
	api.POST("/vn/stories/:id/rewind", vnRewindHandler())
	api.DELETE("/vn/stories/:id", vnDeleteHandler())
	api.GET("/vn/endings/:username", vnListEndingsHandler())
	api.POST("/vn/stories/:id/cover", vnCoverHandler())
}

// ── POST /vn/start ──────────────────────────────────────────────────────────

type vnStartRequest struct {
	Username    string `json:"username"`
	Mode        string `json:"mode,omitempty"`         // free / quest / memory；默认 free
	Quest       string `json:"quest,omitempty"`        // mode=quest 时玩家目标
	MemoryDate  string `json:"memory_date,omitempty"`  // mode=memory 时的起点日（YYYY-MM-DD）
	MaxChapters int    `json:"max_chapters,omitempty"` // 默认 6，范围 3-10
	ProfileID   string `json:"profile_id,omitempty"`
}

type vnStartResponse struct {
	StoryID     int64    `json:"story_id"`
	DisplayName string   `json:"display_name"`
	Mode        string   `json:"mode"`
	MaxChapters int      `json:"max_chapters"`
	Facts       []VNFact `json:"facts"` // 抽到的 mem_facts（前端可展示"已知线索"）
	HasPersona  bool     `json:"has_persona"`
}

func vnStartHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}
		var req vnStartRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Username) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}
		// 模式校验
		mode := req.Mode
		if mode == "" {
			mode = VNModeFree
		}
		if mode != VNModeFree && mode != VNModeQuest && mode != VNModeMemory {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未知模式：" + mode})
			return
		}
		if mode == VNModeQuest && strings.TrimSpace(req.Quest) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "quest 模式需要填写目标"})
			return
		}
		if mode == VNModeMemory && strings.TrimSpace(req.MemoryDate) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "memory 模式需要选一个日期作为起点"})
			return
		}
		maxCh := req.MaxChapters
		if maxCh <= 0 {
			maxCh = 6
		}
		if maxCh < 3 {
			maxCh = 3
		}
		if maxCh > 10 {
			maxCh = 10
		}

		// 联系人展示名（合法性校验）
		displayName := vnDisplayName(svc, req.Username)
		if displayName == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "联系人不存在"})
			return
		}

		// 人设快照（没训练分身时退化为兜底）
		persona, hasPersona := vnPersonaSnapshot(req.Username, displayName)

		// 事实素材抽样
		facts := vnSampleFacts(req.Username, 10)

		// memory 模式：把指定日期的真实对话片段也作为"事实"塞进去
		if mode == VNModeMemory {
			snippet := vnBuildMemorySnippet(svc, req.Username, req.MemoryDate, displayName)
			if snippet != "" {
				facts = append([]VNFact{{Fact: snippet}}, facts...)
			}
		}

		// LLM 配置预检：缺 provider 直接拦在前面
		prefs := loadPreferences()
		cfg := llmConfigForProfile(req.ProfileID, prefs)
		if cfg.provider == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请先在设置中配置 AI 接口"})
			return
		}

		// 落档
		story := &VNStory{
			Username:    req.Username,
			Mode:        mode,
			Quest:       req.Quest,
			PersonaSnap: persona,
			FactsSnap:   facts,
			State:       VNState{Affinity: 50, Tension: 0, Flags: []string{}},
			Status:      VNStoryRunning,
			MaxChapters: maxCh,
			ProfileID:   req.ProfileID,
		}
		id, err := InsertVNStory(story)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, vnStartResponse{
			StoryID:     id,
			DisplayName: displayName,
			Mode:        mode,
			MaxChapters: maxCh,
			Facts:       facts,
			HasPersona:  hasPersona,
		})
	}
}

// ── GET (SSE) /vn/stories/:id/next ───────────────────────────────────────────

// 流式生成下一章。事件类型：
//   {meta: true, chapter_idx, total}
//   {delta: "..."}          narration 增量
//   {done: true, chapter}   收尾事件：完整 chapter（含 choices）+ updated state；若到结局还带 ending
//   {error: "..."}          失败
func vnNextChapterHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = getSvc // 现在不需要 svc，留参数防未来扩展（如 memory 模式从聊天里取片段）

		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 不合法"})
			return
		}
		story, err := GetVNStory(id)
		if err != nil || story == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
			return
		}
		if story.Status == VNStoryEnded {
			c.JSON(http.StatusBadRequest, gin.H{"error": "本剧已结束（请新开一档或读档回滚）"})
			return
		}

		// SSE 初始化
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式响应"})
			return
		}
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		send := func(obj map[string]interface{}) {
			b, _ := json.Marshal(obj)
			fmt.Fprintf(c.Writer, "data: %s\n\n", b)
			flusher.Flush()
		}

		// 当前已有几章？已存在的章节必须先 choose 完才能继续
		existing, _ := ListVNChapters(id)
		nextIdx := len(existing)
		if nextIdx > 0 {
			last := existing[len(existing)-1]
			if last.ChosenIdx < 0 {
				send(map[string]interface{}{"error": "上一章还没选选项，请先调 /choose"})
				return
			}
		}
		if nextIdx >= story.MaxChapters {
			send(map[string]interface{}{"error": "已到最大章节"})
			return
		}

		send(map[string]interface{}{
			"meta":        true,
			"chapter_idx": nextIdx,
			"total":       story.MaxChapters,
		})

		// 构造 prompts
		systemPrompt := vnBuildSystemPrompt(story, nextIdx)
		userPrompt := vnBuildUserPrompt(story, existing)

		// LLM 调用 —— 强制 JSON 输出，先用非流式调用兜稳；
		// 我们对 narration 做"逐字打字机"的体感降级：拿到完整 JSON 后按字符 emit delta。
		// 这避免了流式途中 JSON 不完整、无法解析的麻烦。
		prefs := loadPreferences()
		profPrefs := prefs
		if story.ProfileID != "" {
			cfg := llmConfigForProfile(story.ProfileID, prefs)
			profPrefs.LLMProvider = cfg.provider
			profPrefs.LLMAPIKey = cfg.apiKey
			profPrefs.LLMBaseURL = cfg.baseURL
			profPrefs.LLMModel = cfg.model
		}
		raw, err := CompleteLLM([]LLMMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		}, profPrefs)
		if err != nil {
			send(map[string]interface{}{"error": "LLM 调用失败：" + err.Error()})
			return
		}

		raw = stripCodeFence(strings.TrimSpace(raw))
		var parsed struct {
			Title         string                 `json:"title,omitempty"`
			Synopsis      string                 `json:"synopsis,omitempty"`
			Narration     string                 `json:"narration"`
			Choices       []VNChoice             `json:"choices"`
			StateDelta    map[string]interface{} `json:"state_delta,omitempty"`
			Ending        *VNEndingPayload       `json:"ending,omitempty"`
		}
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			// 失败重试一次：把 "请重新输出严格 JSON" 加到末尾
			retryUser := userPrompt + "\n\n注意：刚才你的输出不是严格 JSON，请重新输出，不要任何代码块围栏。"
			raw2, err2 := CompleteLLM([]LLMMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: retryUser},
			}, profPrefs)
			if err2 != nil {
				send(map[string]interface{}{"error": "LLM 第二次调用失败：" + err2.Error()})
				return
			}
			raw = stripCodeFence(strings.TrimSpace(raw2))
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				send(map[string]interface{}{"error": "LLM 返回格式异常：" + err.Error(), "raw": raw})
				return
			}
		}

		if strings.TrimSpace(parsed.Narration) == "" {
			send(map[string]interface{}{"error": "LLM 没返回 narration"})
			return
		}
		// 选项校验：结局章可以没 choices
		if parsed.Ending == nil && len(parsed.Choices) == 0 {
			send(map[string]interface{}{"error": "LLM 没返回 choices 也没给 ending"})
			return
		}

		// 打字机：按字符切片 emit delta（每 ~12 字一段，约 20-30 段）
		emitTypewriter(parsed.Narration, send)

		// 合并 state（state_delta 仅在玩家 choose 时再算，本步先不动 story.State）
		// 但若 LLM 给了 ending → 直接收尾
		stateAfter := story.State

		// 写章入库
		ch := &VNChapter{
			StoryID:     id,
			ChapterIdx:  nextIdx,
			Narration:   parsed.Narration,
			Choices:     parsed.Choices,
			ChosenIdx:   -1,
			StateAfter:  stateAfter,
			GeneratedAt: 0,
		}
		if _, err := InsertVNChapter(ch); err != nil {
			send(map[string]interface{}{"error": "章节入库失败：" + err.Error()})
			return
		}

		// 首章顺带回填 title / synopsis
		if nextIdx == 0 && (parsed.Title != "" || parsed.Synopsis != "") {
			_ = UpdateVNStoryTitle(id, parsed.Title, parsed.Synopsis)
			story.Title = parsed.Title
			story.Synopsis = parsed.Synopsis
		}

		// 结局：写存档 + 解锁徽章
		if parsed.Ending != nil && parsed.Ending.Type != "" {
			if err := EndVNStory(id, parsed.Ending.Type, *parsed.Ending); err != nil {
				send(map[string]interface{}{"error": "结局入库失败：" + err.Error()})
				return
			}
			_ = UnlockVNEnding(story.Username, parsed.Ending.Type, id)
		}

		// done 事件附完整 chapter + state + ending（若有）
		final := map[string]interface{}{
			"done":        true,
			"chapter":     ch,
			"state":       stateAfter,
			"chapter_idx": nextIdx,
		}
		if parsed.Ending != nil {
			final["ending"] = parsed.Ending
		}
		if parsed.Title != "" {
			final["title"] = parsed.Title
		}
		if parsed.Synopsis != "" {
			final["synopsis"] = parsed.Synopsis
		}
		send(final)
	}
}

// emitTypewriter 把 narration 按 ~12 个字一段 emit delta，模拟打字机效果。
func emitTypewriter(text string, send func(map[string]interface{})) {
	runes := []rune(text)
	step := 12
	for i := 0; i < len(runes); i += step {
		end := i + step
		if end > len(runes) {
			end = len(runes)
		}
		send(map[string]interface{}{"delta": string(runes[i:end])})
	}
}

// ── POST /vn/stories/:id/choose ─────────────────────────────────────────────

type vnChooseRequest struct {
	ChapterIdx int `json:"chapter_idx"`
	OptionIdx  int `json:"option_idx"`
}

type vnChooseResponse struct {
	State        VNState `json:"state"`
	CanContinue  bool    `json:"can_continue"`
	Ended        bool    `json:"ended"`
	EndingType   string  `json:"ending_type,omitempty"`
}

func vnChooseHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 不合法"})
			return
		}
		var req vnChooseRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		story, err := GetVNStory(id)
		if err != nil || story == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
			return
		}
		if story.Status == VNStoryEnded {
			c.JSON(http.StatusBadRequest, gin.H{"error": "本剧已结束"})
			return
		}

		chapters, _ := ListVNChapters(id)
		var targetCh *VNChapter
		for i := range chapters {
			if chapters[i].ChapterIdx == req.ChapterIdx {
				targetCh = &chapters[i]
				break
			}
		}
		if targetCh == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "章节不存在"})
			return
		}
		if targetCh.ChosenIdx >= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该章已选过"})
			return
		}
		if req.OptionIdx < 0 || req.OptionIdx >= len(targetCh.Choices) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "option_idx 越界"})
			return
		}

		// 合并 state_delta
		chosen := targetCh.Choices[req.OptionIdx]
		newState := MergeVNState(story.State, chosen.StateDelta)

		// 写章 + 写存档 state
		if err := UpdateVNChapterChosen(id, req.ChapterIdx, req.OptionIdx, newState); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := UpdateVNStoryState(id, newState); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 是否触发提前结局？dealbreaker 命中直接终结，给下一章生成时 prompt 提示要写 bad ending
		canContinue := req.ChapterIdx+1 < story.MaxChapters && !newState.Dealbreaker

		c.JSON(http.StatusOK, vnChooseResponse{
			State:       newState,
			CanContinue: canContinue,
			Ended:       false, // 真结局由下一章 LLM 写 ending 时确认
		})
	}
}

// ── GET /vn/stories/:id ──────────────────────────────────────────────────────

func vnGetStoryHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		story, err := GetVNStory(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if story == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
			return
		}
		chs, _ := ListVNChapters(id)
		c.JSON(http.StatusOK, gin.H{
			"story":    story,
			"chapters": chs,
		})
	}
}

// ── GET /vn/stories?username= ────────────────────────────────────────────────

func vnListStoriesHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := strings.TrimSpace(c.Query("username"))
		if username == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username 必填"})
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		list, err := ListVNStoriesByUsername(username, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if list == nil {
			list = []VNStory{}
		}
		c.JSON(http.StatusOK, gin.H{"stories": list})
	}
}

// ── POST /vn/stories/:id/rewind ──────────────────────────────────────────────

func vnRewindHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var req struct {
			ToChapter int `json:"to_chapter"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.ToChapter < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to_chapter 必填且 >= 0"})
			return
		}
		story, _ := GetVNStory(id)
		if story == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
			return
		}
		chs, _ := ListVNChapters(id)
		// 找到目标章节，把 story.state 重置为它的 state_after（若未选则 state_after 是 zero，回退到开局态）
		var newState VNState = VNState{Affinity: 50, Flags: []string{}}
		for _, ch := range chs {
			if ch.ChapterIdx == req.ToChapter {
				if ch.ChosenIdx >= 0 {
					newState = ch.StateAfter
				}
				// 同时把该章 chosen 清空（便于重选）
				_ = UpdateVNChapterChosen(id, req.ToChapter, -1, VNState{})
				break
			}
		}
		_ = UpdateVNStoryState(id, newState)
		removed, err := RewindVNChapters(id, req.ToChapter)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"removed": removed, "state": newState})
	}
}

// ── DELETE /vn/stories/:id ───────────────────────────────────────────────────

func vnDeleteHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		if err := DeleteVNStory(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// ── GET /vn/endings/:username ────────────────────────────────────────────────

func vnListEndingsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := c.Param("username")
		list, err := ListVNEndingsUnlocked(username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 算 progress：已解锁 N / 总 5
		total := 5
		c.JSON(http.StatusOK, gin.H{
			"unlocked": list,
			"total":    total,
		})
	}
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

// vnDisplayName 返回联系人的显示名（备注 > 昵称 > username）。空字符串表示联系人不存在。
func vnDisplayName(svc *service.ContactService, username string) string {
	for _, st := range svc.GetCachedStats() {
		if st.Username == username {
			if st.Remark != "" {
				return st.Remark
			}
			if st.Nickname != "" {
				return st.Nickname
			}
			return st.Username
		}
	}
	return ""
}

// vnPersonaSnapshot 取该联系人已训练的分身 prompt；没有则给个兜底人设。
// 返回 (persona, hasRealPersona)。
func vnPersonaSnapshot(username, displayName string) (string, bool) {
	p, _ := GetCloneProfile(username)
	if p != nil && strings.TrimSpace(p.Prompt) != "" {
		return p.Prompt, true
	}
	fallback := fmt.Sprintf(
		`【人设兜底】你将扮演用户的联系人「%s」。由于该联系人尚未训练过 AI 分身，`+
			`你只能用通用礼貌、温和、有点距离感的方式说话。说话风格保持简短自然、避免冗长抒情。`,
		displayName)
	return fallback, false
}

// vnBuildMemorySnippet 把某一天的真实聊天截成一段引文作为 memory 模式的剧情起点素材。
// 最多取该日中段 20 条，每条 ≤ 70 字。失败时返回空字符串（剧情会退化为人设+facts）。
func vnBuildMemorySnippet(svc *service.ContactService, username, date, displayName string) string {
	day := svc.GetDayMessages(username, date)
	if len(day) < 3 {
		return ""
	}
	const maxLines = 20
	const maxRunes = 70
	start := 0
	if len(day) > maxLines {
		start = (len(day) - maxLines) / 2
	}
	end := start + maxLines
	if end > len(day) {
		end = len(day)
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "【回忆素材 · 起点：%s】这是当天真实发生过的对话片段，剧情应以此为基础展开「假如那天换种回应」的平行剧情：\n", date)
	for i := start; i < end; i++ {
		m := day[i]
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		if rs := []rune(content); len(rs) > maxRunes {
			content = string(rs[:maxRunes]) + "…"
		}
		speaker := "我"
		if !m.IsMine {
			speaker = displayName
		}
		fmt.Fprintf(&sb, "  [%s] %s: %s\n", m.Time, speaker, content)
	}
	return sb.String()
}

// vnSampleFacts 从 mem_facts 抽 n 条作为"世界设定"素材。
//   - 不足 n 条则全取
//   - 优先返回 pinned 标记的
func vnSampleFacts(username string, n int) []VNFact {
	facts, _ := GetMemFacts("contact:" + username)
	if len(facts) == 0 {
		return []VNFact{}
	}
	if len(facts) <= n {
		out := make([]VNFact, 0, len(facts))
		for _, f := range facts {
			out = append(out, VNFact{Fact: f.Fact})
		}
		return out
	}
	// pinned 优先，剩余随机
	out := make([]VNFact, 0, n)
	rest := make([]MemFact, 0, len(facts))
	for _, f := range facts {
		if f.Pinned && len(out) < n {
			out = append(out, VNFact{Fact: f.Fact})
		} else {
			rest = append(rest, f)
		}
	}
	rand.Shuffle(len(rest), func(i, j int) { rest[i], rest[j] = rest[j], rest[i] })
	for _, f := range rest {
		if len(out) >= n {
			break
		}
		out = append(out, VNFact{Fact: f.Fact})
	}
	return out
}

// vnBuildSystemPrompt 拼 system prompt（人设 + 模式 + 输出规范）。
func vnBuildSystemPrompt(story *VNStory, chapterIdx int) string {
	var sb strings.Builder
	sb.WriteString("你是一个视觉小说（互动小说）编剧。你正在按章节生成一段沉浸式剧情，由玩家扮演\"我\"，与一位 NPC 互动。\n\n")
	sb.WriteString("【NPC 人设】\n")
	sb.WriteString(story.PersonaSnap)
	sb.WriteString("\n\n")

	if len(story.FactsSnap) > 0 {
		sb.WriteString("【NPC 的世界事实，你可以借用作为剧情素材】\n")
		for _, f := range story.FactsSnap {
			fmt.Fprintf(&sb, "- %s\n", f.Fact)
		}
		sb.WriteString("\n")
	}

	switch story.Mode {
	case VNModeQuest:
		fmt.Fprintf(&sb, "【模式：quest】玩家暗中追求的目标是：「%s」。剧情应朝该目标推进或制造障碍，最终结局判定参考是否达成。\n\n", story.Quest)
	case VNModeMemory:
		sb.WriteString("【模式：memory】剧情起点应改编自玩家与 NPC 真实聊天里的某个场景（你可以从世界事实里挑一条作为引子）。\n\n")
	default:
		sb.WriteString("【模式：free】自由探索剧情，无固定目标。\n\n")
	}

	fmt.Fprintf(&sb, "【章节进度】当前正在写第 %d 章（从 0 计），共 %d 章。\n", chapterIdx, story.MaxChapters)
	fmt.Fprintf(&sb, "【当前关系状态】affinity=%d/100, tension=%d/100, flags=%v, dealbreaker=%v\n\n",
		story.State.Affinity, story.State.Tension, story.State.Flags, story.State.Dealbreaker)

	sb.WriteString("【输出规则】严格输出一段 JSON，不要任何代码块围栏，不要解释，结构如下：\n")
	sb.WriteString("{\n")
	if chapterIdx == 0 {
		sb.WriteString(`  "title": "为本次剧情起一个 8-16 字的标题",` + "\n")
		sb.WriteString(`  "synopsis": "30-60 字的剧情简介",` + "\n")
	}
	sb.WriteString(`  "narration": "200-400 字的本章叙述，第二人称代入（\"你看见 TA…\"），不要把选项剧透出去",` + "\n")
	sb.WriteString(`  "choices": [` + "\n")
	sb.WriteString(`    {"text": "8-18 字的玩家选项", "tone": "soft|firm|silent|playful|...", "state_delta": {"affinity": 5, "flags": ["mentioned_japan"]}}` + "\n")
	sb.WriteString(`  ],` + "\n")
	sb.WriteString(`  "ending": null` + "\n")
	sb.WriteString("}\n\n")

	sb.WriteString("【choices 规则】\n")
	sb.WriteString("- 2-4 个选项，每个选项 8-18 字\n")
	sb.WriteString("- 每个选项必须带 tone 和 state_delta（state_delta 可为空对象）\n")
	sb.WriteString("- state_delta.affinity 范围 -15 到 +15，剧烈情节才用大数\n")
	sb.WriteString("- state_delta.flags 是触发的标签数组，命名小写下划线\n")
	sb.WriteString("- state_delta.critical_hits=1 表示这是关键关系节点（命中过多次的存档容易进 true 结局）\n")
	sb.WriteString("- state_delta.dealbreaker=true 表示这是雷区选项，会推向 bad 结局\n\n")

	if chapterIdx+1 >= story.MaxChapters {
		sb.WriteString("【收束】本章是最后一章，必须给 ending 字段，不要再出 choices（choices 设为空数组）。\n")
		sb.WriteString("ending 结构：{\"type\":\"true|happy|normal|bad|secret\",\"title\":\"...\",\"epilogue\":\"60-100 字结语\",\"turning_points\":[\"每章一句话回顾\", ...]}\n")
		sb.WriteString("结局判定参考：affinity >= 80 且 critical_hits >= 1 → true；>=60 → happy；30-59 → normal；<30 或 dealbreaker → bad；命中 secret_route 等隐藏 flag → secret\n\n")
	} else if chapterIdx >= 3 && (story.State.Affinity < 20 || story.State.Dealbreaker) {
		sb.WriteString("【提前收束】当前 state 已经触发坏结局条件（affinity 过低或 dealbreaker=true），请在本章给 ending 字段（type=bad）短路结束，不要再出 choices。\n\n")
	}

	sb.WriteString("【创作约束】\n")
	sb.WriteString("- 用 NPC 人设里描述的语气词、平均句长、emoji 习惯写对话和心理描写\n")
	sb.WriteString("- 避免任何性、暴力、自伤、毒品相关内容\n")
	sb.WriteString("- 不要发明跟人设矛盾的设定（如人设说 TA 是程序员，剧情里就别写 TA 是医生）\n")
	sb.WriteString("- 不要使用第一人称（\"我\"），用第二人称（\"你\"）代入玩家视角\n")

	return sb.String()
}

// vnBuildUserPrompt 拼 user prompt（历史摘要 + 上次选项）。
func vnBuildUserPrompt(story *VNStory, existing []VNChapter) string {
	var sb strings.Builder
	if len(existing) == 0 {
		sb.WriteString("现在写开篇第 1 章，请创建一个有钩子的场景作为起点。")
		return sb.String()
	}
	sb.WriteString("【前情提要】\n")
	for _, ch := range existing {
		// 前几章用摘要（截前 80 字），避免 token 失控
		runes := []rune(ch.Narration)
		summary := string(runes)
		if len(runes) > 80 {
			summary = string(runes[:80]) + "…"
		}
		fmt.Fprintf(&sb, "第 %d 章：%s\n", ch.ChapterIdx, summary)
		if ch.ChosenIdx >= 0 && ch.ChosenIdx < len(ch.Choices) {
			fmt.Fprintf(&sb, "  → 玩家选了：%s\n", ch.Choices[ch.ChosenIdx].Text)
		}
	}
	sb.WriteString("\n请继续写下一章。")
	return sb.String()
}

// ── POST /vn/stories/:id/cover ───────────────────────────────────────────────
//
// 为某一章生成封面图（同步包装：返回时图已经生成完毕）。复用现有 image_queue。
// 默认场景图风格：抽象、不画人脸、电影感（同高光插画约束）。
// 完成后把 hash 回填到 vn_chapters.image_hash 方便下次读档时直接看到。

func vnCoverHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		storyID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		if storyID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id 不合法"})
			return
		}
		var body struct {
			ChapterIdx int    `json:"chapter_idx"` // 0 = 开局封面
			ProfileID  string `json:"profile_id,omitempty"`
		}
		_ = c.ShouldBindJSON(&body)
		if body.ChapterIdx < 0 {
			body.ChapterIdx = 0
		}

		story, err := GetVNStory(storyID)
		if err != nil || story == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
			return
		}
		chapters, _ := ListVNChapters(storyID)
		var targetCh *VNChapter
		for i := range chapters {
			if chapters[i].ChapterIdx == body.ChapterIdx {
				targetCh = &chapters[i]
				break
			}
		}
		if targetCh == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "章节不存在（请先生成该章再生图）"})
			return
		}

		prompt := vnBuildCoverPrompt(story, targetCh)
		hash, err := GenerateImageSync(SubmitImageOptions{
			Prompt:    prompt,
			Size:      "1792x1024", // 横版，适合作为剧情封面
			Scene:     "vn_cover",
			ProfileID: body.ProfileID,
			RefUser:   story.Username,
			RefKind:   fmt.Sprintf("vn_chapter_%d", body.ChapterIdx),
		})
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		_ = UpdateVNChapterImage(storyID, body.ChapterIdx, hash)
		c.JSON(http.StatusOK, gin.H{
			"hash": hash,
			"url":  "/api/image/cache/" + hash,
		})
	}
}

// vnBuildCoverPrompt 拼章节封面 prompt：抽象、不画人脸、保留剧情氛围。
func vnBuildCoverPrompt(story *VNStory, ch *VNChapter) string {
	// 截 narration 前 200 字作为氛围素材
	runes := []rune(ch.Narration)
	if len(runes) > 200 {
		runes = runes[:200]
	}
	moodHint := string(runes)
	titleHint := story.Title
	if titleHint == "" {
		titleHint = "互动小说"
	}
	return fmt.Sprintf(
		`视觉小说封面插画。剧名：「%s」。本章氛围：%s。`+
			`风格：电影感构图、柔和光影、色调温暖偏复古、像 70-80 年代日系动画或 visual novel 立绘背景。`+
			`严格要求：不出现具体人物面孔、不出现五官、不出现可识别人物、不出现文字、不出现品牌 logo。`+
			`只用场景、光影、色彩、剪影、留白来表达氛围。`,
		titleHint, moodHint,
	)
}
