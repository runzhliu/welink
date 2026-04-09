/*
 * Skill 炼化 — 把聊天记录导出为可移植的 AI 工具 Skill 文件包
 *
 * 支持三种 Skill 类型：
 *   - contact: 基于和某联系人的聊天，模拟 TA 的说话风格
 *   - self:    基于我发送的所有消息，捕捉自己的语气
 *   - group:   基于群聊的集体知识，回答"这个群会怎么说"
 *
 * 支持六种输出格式：
 *   - claude-skill: Claude Code 目录式 Skills (~/.claude/skills/<name>/)
 *   - claude-agent: Claude Code 单文件 Subagent (~/.claude/agents/<name>.md)
 *   - codex:        OpenAI Codex AGENTS.md
 *   - opencode:     OpenCode Agent (.opencode/agent/<name>.md)
 *   - cursor:       Cursor Rules (.cursor/rules/<name>.mdc)
 *   - generic:      通用 Markdown
 */

package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"welink/backend/pkg/db"
	"welink/backend/service"
)

// ─── 数据结构 ────────────────────────────────────────────────────────────────

// SkillPackage 炼化过程产出的中间数据（格式无关）
type SkillPackage struct {
	// 元数据
	SkillType    string    `json:"skill_type"`    // contact / self / group / group-member
	Name         string    `json:"name"`          // 短名（slug 化）
	DisplayName  string    `json:"display_name"`  // 人类可读名
	Description  string    `json:"description"`   // 一句话描述
	GeneratedAt  time.Time `json:"generated_at"`
	MessageCount int       `json:"message_count"` // 分析用的消息数

	// LLM 抽取的画像
	Personality        string   `json:"personality"`         // 性格特征
	Style              string   `json:"style"`               // 说话风格
	Vocabulary         []string `json:"vocabulary"`          // 高频词/独特用词
	Catchphrases       []string `json:"catchphrases"`        // 口头禅
	Topics             []string `json:"topics"`              // 常聊话题 / 知识领域
	Relationship       string   `json:"relationship"`        // 关系背景（contact 类型专有）
	DosAndDonts        string   `json:"dos_and_donts"`
	Samples            []string `json:"samples"`             // 代表性对话片段（已脱敏）
	SignatureBehaviors string   `json:"signature_behaviors"` // 标志性行为模式
	TypicalOpenings    []string `json:"typical_openings"`    // 典型开场白
	TypicalClosings    []string `json:"typical_closings"`    // 典型结尾
}

// ForgeOptions 炼化选项
type ForgeOptions struct {
	SkillType     string // contact / self / group / group-member
	Username      string // 联系人或群的 wxid（self 类型不需要）
	MemberSpeaker string // group-member 类型专用：目标成员的显示名
	Format        string // claude-skill / claude-agent / codex / opencode / cursor / generic
	ProfileID     string // LLM profile
	MsgLimit      int    // 使用最近 N 条消息（0 = 默认 300）
}

// skillCharBudget 送入 LLM 的消息采样字符上限。
// 现代大模型 (Claude 3.5+, GPT-4o, DeepSeek, Kimi 等) 都有 128k+ 上下文，
// 50000 字约等于 30k-50k token，安全且能保留足够的风格样本。
const skillCharBudget = 50000

// ─── LLM 结构化抽取 ──────────────────────────────────────────────────────────

// llmSkillExtract 调 LLM 返回的结构化 JSON
type llmSkillExtract struct {
	Personality        string   `json:"personality"`
	Style              string   `json:"style"`
	Vocabulary         []string `json:"vocabulary"`
	Catchphrases       []string `json:"catchphrases"`
	Topics             []string `json:"topics"`
	Relationship       string   `json:"relationship"`
	DosAndDonts        string   `json:"dos_and_donts"`
	Samples            []string `json:"samples"`
	SignatureBehaviors string   `json:"signature_behaviors"`
	TypicalOpenings    []string `json:"typical_openings"`
	TypicalClosings    []string `json:"typical_closings"`
}

// buildForgePrompt 根据 skill 类型构造 LLM prompt
func buildForgePrompt(skillType, displayName, samplesBlock string, stats string) (string, string) {
	systemPrompt := `你是一个聊天记录分析助手。你的任务是深度阅读用户提供的聊天记录（可能有几千到上万条），抽取出这个人说话的"味道"——所有让 TA 区别于别人的独特特征——然后产出一份结构化的 JSON 描述。

这个 JSON 会被用作一个 AI Skill，让 Claude / GPT 等模型去模拟这个人说话。所以你抽取的特征越具体、越有辨识度、越可操作，最终的模拟效果就越好。

你必须严格按照以下 JSON 结构返回（不要任何多余文字，不要 markdown 代码块）：

{
  "personality": "性格特征描述：要具体生动，不要空话套话。举例说明 TA 的典型反应模式（100-200 字）",
  "style": "说话风格描述：非常具体地描述句长偏好、典型句式、语气助词、标点使用（尤其是感叹号、省略号、换行）、emoji/颜文字习惯、是否混用中英文/方言。举具体的例子（150-300 字）",
  "vocabulary": ["至少 15 个有强辨识度的词"],
  "catchphrases": ["至少 8 个真实出现过的口头禅/习惯性短语/开场白/结尾句，直接引用原话"],
  "topics": ["常聊的话题/领域/兴趣点，至少 8 个"],
  "relationship": "和用户的关系背景（如果是群聊整体或自画像，留空字符串）",
  "dos_and_donts": "使用注意：什么场景适合、什么场景不适合、需要警惕什么误用",
  "samples": ["至少 10 条最能代表其风格的原话，原样保留，不要改写。优先选那些能看出 TA 个性的句子"],
  "signature_behaviors": "TA 在对话里的几个标志性行为模式，比如'遇到技术讨论喜欢甩链接'、'被问到时间总是先说没空再答应'等（100-200 字）",
  "typical_openings": ["典型的开场白/打招呼方式，3-5 个真实原话"],
  "typical_closings": ["典型的结尾方式/告别语，3-5 个真实原话"]
}

抽取原则：
- 优先用**原文引用**，不要自己概括改写
- 关注那些**反复出现的细节**：某个词用得特别多、某个语气词带得特别频繁、某类话题反应特别激烈
- 如果发现 TA 有中英混用、粤语、方言、emoji 偏好等，一定要抓住
- 对于长句短句比例、换行习惯、标点偏好这些细节，越具体越好
- 所有内容用中文输出
- 所有描述要足够具体到可以"照着演出来"`

	var userPrompt string
	// group-member 共用 contact 的 prompt（单人风格）
	promptKind := skillType
	if promptKind == "group-member" {
		promptKind = "contact"
	}
	switch promptKind {
	case "contact":
		userPrompt = fmt.Sprintf(`以下是和联系人「%s」的聊天记录片段，请分析 TA（对方，不是"我"）的说话风格。

统计特征：
%s

代表性消息（标注 "他/她:" 的是对方发的，"我:" 的是用户发的）：
%s

请严格按照 system prompt 中的 JSON 结构返回「%s」的画像。relationship 字段填写对方和用户的关系推断（朋友/同事/家人/恋人等）。`, displayName, stats, samplesBlock, displayName)

	case "self":
		userPrompt = fmt.Sprintf(`以下是用户自己在微信里发过的消息汇总，请分析「我」的说话风格。

统计特征：
%s

消息样本：
%s

请严格按照 system prompt 中的 JSON 结构返回用户自己的画像。relationship 字段留空字符串。`, stats, samplesBlock)

	case "group":
		userPrompt = fmt.Sprintf(`以下是群聊「%s」的聊天记录片段，请提炼这个群的集体知识和氛围。

统计特征：
%s

消息样本：
%s

请严格按照 system prompt 中的 JSON 结构返回。注意：
- personality 描述群的整体氛围（严肃/活跃/技术导向等）
- style 描述这个群的讨论风格
- vocabulary 是群里的高频专业词/术语
- topics 是这个群经常讨论的主题/领域
- relationship 留空字符串
- samples 取几条最能体现群氛围的代表性对话`, displayName, stats, samplesBlock)
	}

	return systemPrompt, userPrompt
}

// extractSkillPackage 从采样消息 + 统计调用 LLM 产出 SkillPackage
func extractSkillPackage(
	skillType, displayName, username string,
	samples []string,
	statsText string,
	prefs Preferences,
	profileID string,
) (*SkillPackage, error) {
	samplesBlock := strings.Join(samples, "\n")
	// smartSample 已经做了字符预算裁剪，这里只做兜底（防止极端情况）
	if len([]rune(samplesBlock)) > skillCharBudget {
		runes := []rune(samplesBlock)
		samplesBlock = string(runes[:skillCharBudget]) + "\n[...]"
	}

	systemPrompt, userPrompt := buildForgePrompt(skillType, displayName, samplesBlock, statsText)

	msgs := []LLMMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}

	// 复用 CompleteLLM
	profPrefs := prefs
	if profileID != "" {
		cfg := llmConfigForProfile(profileID, prefs)
		profPrefs.LLMProvider = cfg.provider
		profPrefs.LLMAPIKey = cfg.apiKey
		profPrefs.LLMBaseURL = cfg.baseURL
		profPrefs.LLMModel = cfg.model
	}

	raw, err := CompleteLLM(msgs, profPrefs)
	if err != nil {
		return nil, fmt.Errorf("LLM 调用失败: %w", err)
	}

	// 从响应中提取 JSON（兼容带 markdown code fence 的情况）
	jsonStr := extractJSONBlock(raw)
	var extract llmSkillExtract
	if err := json.Unmarshal([]byte(jsonStr), &extract); err != nil {
		return nil, fmt.Errorf("LLM 返回的 JSON 无法解析: %w\n原文: %s", err, raw)
	}

	pkg := &SkillPackage{
		SkillType:          skillType,
		Name:               slugify(displayName),
		DisplayName:        displayName,
		GeneratedAt:        time.Now(),
		MessageCount:       len(samples),
		Personality:        extract.Personality,
		Style:              extract.Style,
		Vocabulary:         extract.Vocabulary,
		Catchphrases:       extract.Catchphrases,
		Topics:             extract.Topics,
		Relationship:       extract.Relationship,
		DosAndDonts:        extract.DosAndDonts,
		Samples:            extract.Samples,
		SignatureBehaviors: extract.SignatureBehaviors,
		TypicalOpenings:    extract.TypicalOpenings,
		TypicalClosings:    extract.TypicalClosings,
	}

	// 生成 description
	switch skillType {
	case "contact":
		pkg.Description = fmt.Sprintf("以「%s」的说话风格回应 — 基于真实聊天记录提炼", displayName)
	case "self":
		pkg.Description = "以用户自己的口吻写作 — 匹配本人语气、用词和表达习惯"
	case "group":
		pkg.Description = fmt.Sprintf("「%s」群的集体知识与氛围 — 群聊智囊", displayName)
	case "group-member":
		pkg.Description = fmt.Sprintf("以「%s」的说话风格回应 — 基于群聊消息提炼", displayName)
	}

	return pkg, nil
}

// extractJSONBlock 从 LLM 响应中提取首个 JSON 对象
func extractJSONBlock(s string) string {
	s = strings.TrimSpace(s)
	// 去掉 markdown code fence
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	}
	// 找第一个 { 到最后一个 }
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return s[start : end+1]
	}
	return s
}

// slugify 把中文/符号名转成文件系统安全的 slug
var slugRe = regexp.MustCompile(`[^\p{L}\p{N}_-]+`)

func slugify(name string) string {
	s := strings.ReplaceAll(name, " ", "-")
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "unnamed"
	}
	if len([]rune(s)) > 40 {
		s = string([]rune(s)[:40])
	}
	return s
}

// ─── 数据收集：联系人 / 自己 / 群聊 ──────────────────────────────────────────

// smartSample 从 all 中按字符预算做采样：
//   1. 先取最近 targetCount 条
//   2. 如果字符数仍超预算，均匀下采样至预算内
func smartSample(all []string, targetCount int) []string {
	if targetCount <= 0 {
		targetCount = 300
	}
	// 先取最近 targetCount 条
	var picked []string
	if len(all) > targetCount {
		picked = all[len(all)-targetCount:]
	} else {
		picked = all
	}
	// 统计字符数
	total := 0
	for _, s := range picked {
		total += len([]rune(s))
	}
	if total <= skillCharBudget {
		return picked
	}
	// 超预算：均匀下采样
	targetLen := skillCharBudget
	// 估算每条平均字符数
	avgLen := total / len(picked)
	if avgLen < 1 {
		avgLen = 1
	}
	keepN := targetLen / avgLen
	if keepN < 30 {
		keepN = 30
	}
	if keepN >= len(picked) {
		return picked
	}
	// 均匀间隔挑选
	result := make([]string, 0, keepN)
	step := float64(len(picked)) / float64(keepN)
	for i := 0; i < keepN; i++ {
		idx := int(float64(i) * step)
		if idx >= len(picked) {
			idx = len(picked) - 1
		}
		result = append(result, picked[idx])
	}
	return result
}

// collectContactData 收集单个联系人的统计 + 代表性消息样本
func collectContactData(svc *service.ContactService, username string, msgLimit int) (displayName, statsText string, samples []string, err error) {
	// 从缓存拿 stats
	allStats := svc.GetCachedStats()
	var stats *service.ContactStatsExtended
	for i := range allStats {
		if allStats[i].Username == username {
			stats = &allStats[i]
			break
		}
	}
	if stats == nil {
		return "", "", nil, fmt.Errorf("联系人不存在或未建索引")
	}
	displayName = stats.Remark
	if displayName == "" {
		displayName = stats.Nickname
	}
	if displayName == "" {
		displayName = username
	}

	// 基础统计文本
	var sb strings.Builder
	fmt.Fprintf(&sb, "- 总消息数: %d\n", stats.TotalMessages)
	fmt.Fprintf(&sb, "- 对方发送: %d 条\n", stats.TheirMessages)
	fmt.Fprintf(&sb, "- 我发送: %d 条\n", stats.MyMessages)
	if stats.AvgMsgLen > 0 {
		fmt.Fprintf(&sb, "- 平均消息长度: %.1f 字\n", stats.AvgMsgLen)
	}
	if stats.FirstMessage != "" && stats.FirstMessage != "-" {
		fmt.Fprintf(&sb, "- 首次聊天: %s\n", stats.FirstMessage)
	}
	if stats.LastMessage != "" && stats.LastMessage != "-" {
		fmt.Fprintf(&sb, "- 最近聊天: %s\n", stats.LastMessage)
	}
	if stats.PeakPeriod != "" {
		fmt.Fprintf(&sb, "- 聊天高峰月份: %s (%d 条)\n", stats.PeakPeriod, stats.PeakMonthly)
	}
	if len(stats.TypeCnt) > 0 {
		var typeList []string
		for k, v := range stats.TypeCnt {
			typeList = append(typeList, fmt.Sprintf("%s:%d", k, v))
		}
		sort.Strings(typeList)
		fmt.Fprintf(&sb, "- 消息类型分布: %s\n", strings.Join(typeList, ", "))
	}
	// 高频词
	wc := svc.GetWordCloud(username, false)
	if len(wc) > 0 {
		var words []string
		for i := 0; i < len(wc) && i < 15; i++ {
			words = append(words, wc[i].Word)
		}
		fmt.Fprintf(&sb, "- 对方高频词: %s\n", strings.Join(words, ", "))
	}
	statsText = sb.String()

	// 采样消息：取所有文本消息，然后按 msgLimit 和字符预算智能采样
	msgs := svc.ExportContactMessages(username, 0, 0)
	var textMsgs []string
	for _, m := range msgs {
		if m.Type != 1 || strings.TrimSpace(m.Content) == "" {
			continue
		}
		content := maskSensitive(m.Content)
		speaker := "他/她"
		if m.IsMine {
			speaker = "我"
		}
		textMsgs = append(textMsgs, fmt.Sprintf("%s: %s", speaker, content))
	}
	samples = smartSample(textMsgs, msgLimit)
	return displayName, statsText, samples, nil
}

// collectSelfData 收集"我"发给所有联系人的消息汇总
func collectSelfData(svc *service.ContactService, msgLimit int) (statsText string, samples []string, err error) {
	// 自画像数据
	portrait := svc.GetSelfPortrait()
	if portrait == nil || portrait.TotalSent == 0 {
		return "", nil, fmt.Errorf("暂无数据")
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "- 我发送的总消息数: %d\n", portrait.TotalSent)
	fmt.Fprintf(&sb, "- 总字数: %d\n", portrait.TotalChars)
	fmt.Fprintf(&sb, "- 平均消息长度: %.1f 字\n", portrait.AvgMsgLen)
	fmt.Fprintf(&sb, "- 最活跃时段: %d 点\n", portrait.TopActiveHour)
	fmt.Fprintf(&sb, "- 联系过的人数: %d\n", portrait.TotalContacts)
	statsText = sb.String()

	// 采样：取消息量 Top 20 的联系人各 5 条我的消息
	allStats := svc.GetCachedStats()
	// 按 MyMessages 排序
	type pair struct {
		username string
		count    int64
	}
	var pairs []pair
	for _, s := range allStats {
		if s.MyMessages > 0 {
			pairs = append(pairs, pair{s.Username, s.MyMessages})
		}
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].count > pairs[j].count })
	if len(pairs) > 20 {
		pairs = pairs[:20]
	}

	// 从每个联系人取一些最近的 我 消息
	perContactQuota := 10
	if msgLimit > 0 {
		perContactQuota = msgLimit/len(pairs) + 1
		if perContactQuota < 3 {
			perContactQuota = 3
		}
		if perContactQuota > 20 {
			perContactQuota = 20
		}
	}
	for _, p := range pairs {
		msgs := svc.ExportContactMessages(p.username, 0, 0)
		added := 0
		for i := len(msgs) - 1; i >= 0 && added < perContactQuota; i-- {
			m := msgs[i]
			if m.Type != 1 || !m.IsMine || strings.TrimSpace(m.Content) == "" {
				continue
			}
			samples = append(samples, maskSensitive(m.Content))
			added++
		}
	}

	samples = smartSample(samples, msgLimit)
	return statsText, samples, nil
}

// collectGroupData 收集群聊的统计 + 代表性消息
//   - 如果 memberSpeaker 非空，只保留该成员的发言，并把 displayName 改为成员名
func collectGroupData(svc *service.ContactService, username, memberSpeaker string, msgLimit int) (displayName, statsText string, samples []string, err error) {
	detail := svc.GetGroupDetail(username)
	// GetGroupDetail 可能异步，轮询一小段
	for i := 0; i < 50 && detail == nil; i++ {
		time.Sleep(100 * time.Millisecond)
		detail = svc.GetGroupDetail(username)
	}
	if detail == nil {
		return "", "", nil, fmt.Errorf("群聊详情未就绪，请稍后再试")
	}

	// 从群列表拿群名
	groupName := ""
	for _, g := range svc.GetGroups() {
		if g.Username == username {
			groupName = g.Name
			break
		}
	}
	if groupName == "" {
		groupName = username
	}
	// 如果指定了成员，displayName 改为 "成员名 @ 群名"；否则用群名
	if memberSpeaker != "" {
		displayName = fmt.Sprintf("%s（来自「%s」群）", memberSpeaker, groupName)
	} else {
		displayName = groupName
	}

	var sb strings.Builder

	if memberSpeaker != "" {
		// 只针对某个成员
		var memberCount int64
		var memberLast, memberFirst string
		for _, m := range detail.MemberRank {
			if m.Speaker == memberSpeaker {
				memberCount = m.Count
				memberLast = m.LastMessageTime
				memberFirst = m.FirstMessageTime
				break
			}
		}
		if memberCount == 0 {
			return "", "", nil, fmt.Errorf("成员「%s」在「%s」群里没有发言记录", memberSpeaker, groupName)
		}
		fmt.Fprintf(&sb, "- 成员: %s\n", memberSpeaker)
		fmt.Fprintf(&sb, "- 所在群: %s\n", groupName)
		fmt.Fprintf(&sb, "- 该成员发言数: %d\n", memberCount)
		if memberFirst != "" {
			fmt.Fprintf(&sb, "- 首次发言: %s\n", memberFirst)
		}
		if memberLast != "" {
			fmt.Fprintf(&sb, "- 最近发言: %s\n", memberLast)
		}
	} else {
		// 整个群
		totalMsgs := 0
		for _, c := range detail.DailyHeatmap {
			totalMsgs += c
		}
		fmt.Fprintf(&sb, "- 群总消息数: %d\n", totalMsgs)
		fmt.Fprintf(&sb, "- 活跃成员数: %d\n", len(detail.MemberRank))
		if len(detail.MemberRank) > 0 {
			top := detail.MemberRank
			if len(top) > 10 {
				top = top[:10]
			}
			var members []string
			for _, m := range top {
				members = append(members, fmt.Sprintf("%s(%d条)", m.Speaker, m.Count))
			}
			fmt.Fprintf(&sb, "- 发言排行 Top 10: %s\n", strings.Join(members, ", "))
		}
		if len(detail.TopWords) > 0 {
			var words []string
			for i := 0; i < len(detail.TopWords) && i < 20; i++ {
				words = append(words, detail.TopWords[i].Word)
			}
			fmt.Fprintf(&sb, "- 高频词: %s\n", strings.Join(words, ", "))
		}
	}
	statsText = sb.String()

	// 群消息采样
	msgs := svc.ExportGroupMessages(username, 0, 0)
	var textMsgs []string
	for _, m := range msgs {
		if m.Type != 1 || strings.TrimSpace(m.Content) == "" {
			continue
		}
		speaker := m.Speaker
		if speaker == "" {
			speaker = "成员"
		}
		// 如果指定了成员，只保留该成员的消息
		if memberSpeaker != "" && speaker != memberSpeaker {
			continue
		}
		content := maskSensitive(m.Content)
		if memberSpeaker != "" {
			// 单成员模式下，不用重复前缀 speaker 名
			textMsgs = append(textMsgs, content)
		} else {
			textMsgs = append(textMsgs, fmt.Sprintf("%s: %s", speaker, content))
		}
	}
	samples = smartSample(textMsgs, msgLimit)
	return displayName, statsText, samples, nil
}

// maskSensitive 简单脱敏：手机号、邮箱、身份证
var (
	reMobile = regexp.MustCompile(`1[3-9]\d{9}`)
	reEmail  = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)
	reIDCard = regexp.MustCompile(`[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]`)
)

func maskSensitive(s string) string {
	s = reIDCard.ReplaceAllString(s, "***身份证***")
	s = reMobile.ReplaceAllString(s, "***手机号***")
	s = reEmail.ReplaceAllString(s, "***邮箱***")
	return s
}

// ─── 格式化：6 种输出 ────────────────────────────────────────────────────────

// formatSkillFiles 根据 format 把 SkillPackage 转成 文件名 → 内容
func formatSkillFiles(pkg *SkillPackage, format string) (map[string][]byte, string) {
	switch format {
	case "claude-skill":
		return formatClaudeSkill(pkg)
	case "claude-agent":
		return formatClaudeAgent(pkg)
	case "codex":
		return formatCodex(pkg)
	case "opencode":
		return formatOpenCode(pkg)
	case "cursor":
		return formatCursor(pkg)
	case "generic":
		fallthrough
	default:
		return formatGeneric(pkg)
	}
}

// buildMainBody 构造 skill 主体 markdown（所有格式共享）
func buildMainBody(pkg *SkillPackage) string {
	var sb strings.Builder
	sb.WriteString("# " + pkg.DisplayName + "\n\n")
	sb.WriteString(pkg.Description + "\n\n")
	sb.WriteString("---\n\n")

	sb.WriteString("## 使用场景\n\n")
	sb.WriteString(whenToUse(pkg) + "\n\n")

	sb.WriteString("## 性格特征\n\n")
	sb.WriteString(pkg.Personality + "\n\n")

	sb.WriteString("## 说话风格\n\n")
	sb.WriteString(pkg.Style + "\n\n")

	if pkg.SignatureBehaviors != "" {
		sb.WriteString("## 标志性行为\n\n")
		sb.WriteString(pkg.SignatureBehaviors + "\n\n")
	}

	if len(pkg.Vocabulary) > 0 {
		sb.WriteString("## 高频词 / 独特用词\n\n")
		for _, v := range pkg.Vocabulary {
			sb.WriteString("- " + v + "\n")
		}
		sb.WriteString("\n")
	}

	if len(pkg.Catchphrases) > 0 {
		sb.WriteString("## 口头禅\n\n")
		for _, c := range pkg.Catchphrases {
			sb.WriteString("- `" + c + "`\n")
		}
		sb.WriteString("\n")
	}

	if len(pkg.TypicalOpenings) > 0 {
		sb.WriteString("## 典型开场白\n\n")
		for _, o := range pkg.TypicalOpenings {
			sb.WriteString("- `" + o + "`\n")
		}
		sb.WriteString("\n")
	}

	if len(pkg.TypicalClosings) > 0 {
		sb.WriteString("## 典型结尾方式\n\n")
		for _, c := range pkg.TypicalClosings {
			sb.WriteString("- `" + c + "`\n")
		}
		sb.WriteString("\n")
	}

	if len(pkg.Topics) > 0 {
		sb.WriteString("## 常聊话题 / 知识领域\n\n")
		for _, t := range pkg.Topics {
			sb.WriteString("- " + t + "\n")
		}
		sb.WriteString("\n")
	}

	if pkg.Relationship != "" {
		sb.WriteString("## 关系背景\n\n")
		sb.WriteString(pkg.Relationship + "\n\n")
	}

	if len(pkg.Samples) > 0 {
		sb.WriteString("## 代表性原话\n\n")
		for _, s := range pkg.Samples {
			sb.WriteString("> " + strings.ReplaceAll(s, "\n", " ") + "\n\n")
		}
	}

	if pkg.DosAndDonts != "" {
		sb.WriteString("## 使用注意事项\n\n")
		sb.WriteString(pkg.DosAndDonts + "\n\n")
	}

	sb.WriteString("---\n\n")
	sb.WriteString(fmt.Sprintf("_由 WeLink 基于 %d 条聊天记录自动生成 · %s_\n",
		pkg.MessageCount, pkg.GeneratedAt.Format("2006-01-02 15:04")))
	return sb.String()
}

func whenToUse(pkg *SkillPackage) string {
	switch pkg.SkillType {
	case "contact", "group-member":
		return fmt.Sprintf("- 需要用「%s」的风格起草文字、回复、邮件时\n- 回忆或模拟和 TA 的对话时\n- 在做决定前想听听 TA 可能的反应时\n\n**不适合**：涉及真实决策的场景（如代 TA 回复他人、冒充身份）。AI 分身只是对风格的近似，不代表真人想法。", pkg.DisplayName)
	case "self":
		return "- 用 AI 写公众号、朋友圈、邮件时，希望保持自己的口吻\n- 避免 AI 生成过于正式或机械的文字\n- 让 AI 续写、改写时匹配原有语气"
	case "group":
		return fmt.Sprintf("- 需要了解「%s」群通常讨论什么、持什么观点时\n- 想模拟群里的风格展开讨论时\n- 基于群的集体知识回答某领域问题时", pkg.DisplayName)
	}
	return ""
}

// formatClaudeSkill — Claude Code Skills 目录式
func formatClaudeSkill(pkg *SkillPackage) (map[string][]byte, string) {
	dir := "skill-" + pkg.Name
	files := make(map[string][]byte)

	// SKILL.md 主入口，带 frontmatter
	frontmatter := fmt.Sprintf(`---
name: %s
description: %s
---

`, pkg.Name, escapeYAML(pkg.Description))
	files[dir+"/SKILL.md"] = []byte(frontmatter + buildMainBody(pkg))

	// 附加信息
	files[dir+"/README.md"] = []byte(fmt.Sprintf(`# %s (Claude Code Skill)

这是一个由 WeLink 生成的 Claude Code Skill。

## 安装

把整个 `+"`%s`"+` 目录复制到：

- 用户级：`+"`~/.claude/skills/`"+`
- 项目级：`+"`.claude/skills/`"+`

然后重启 Claude Code，这个 skill 就会在相关对话中被自动引用。

## 文件结构

- `+"`SKILL.md`"+` — skill 主入口（含 frontmatter）
- `+"`README.md`"+` — 本文件
`, pkg.DisplayName, dir))

	return files, dir + ".zip"
}

// formatClaudeAgent — Claude Code 单文件 Subagent
func formatClaudeAgent(pkg *SkillPackage) (map[string][]byte, string) {
	name := pkg.Name + "-voice"
	frontmatter := fmt.Sprintf(`---
name: %s
description: %s
model: inherit
---

`, name, escapeYAML(pkg.Description))

	body := buildMainBody(pkg)
	body += "\n---\n\n## 作为 Subagent 的行为\n\n当被调用时，你应该：\n1. 完全代入上文描述的说话风格和用词习惯\n2. 直接用该风格回答用户的问题或执行任务\n3. 保持自然，不要主动提到你在「模仿」某人\n4. 遇到原风格涉及不到的话题，基于已知的个性特征推测合理反应\n"

	files := map[string][]byte{
		name + ".md": []byte(frontmatter + body),
		"README.md": []byte(fmt.Sprintf(`# Claude Code Subagent

安装：
复制 `+"`%s.md`"+` 到 `+"`~/.claude/agents/`"+` (用户级) 或 `+"`.claude/agents/`"+` (项目级)。

使用：
在 Claude Code 里 `+"`/agents`"+` 可以看到该 agent，或在对话中 `+"`@%s`"+` 调用。
`, name, name)),
	}
	return files, name + ".zip"
}

// formatCodex — OpenAI Codex AGENTS.md
func formatCodex(pkg *SkillPackage) (map[string][]byte, string) {
	name := "codex-" + pkg.Name
	body := "# AGENTS.md — " + pkg.DisplayName + "\n\n"
	body += "> 本文件定义了 Codex Agent 的行为准则。把它放到项目根目录，Codex 会自动读取。\n\n"
	body += "## Agent Persona\n\n"
	body += pkg.Description + "\n\n"
	body += buildMainBody(pkg)

	files := map[string][]byte{
		"AGENTS.md": []byte(body),
		"README.md": []byte(fmt.Sprintf(`# Codex AGENTS.md

安装：
把 `+"`AGENTS.md`"+` 放到你希望 Codex 应用此 persona 的项目根目录。

详见 OpenAI Codex CLI 文档中关于 AGENTS.md 的说明。

用途：%s
`, pkg.Description)),
	}
	return files, name + ".zip"
}

// formatOpenCode — OpenCode agent 单文件
func formatOpenCode(pkg *SkillPackage) (map[string][]byte, string) {
	name := pkg.Name
	frontmatter := fmt.Sprintf(`---
description: %s
mode: subagent
---

`, escapeYAML(pkg.Description))

	files := map[string][]byte{
		".opencode/agent/" + name + ".md": []byte(frontmatter + buildMainBody(pkg)),
		"README.md": []byte(fmt.Sprintf(`# OpenCode Agent

安装：
把 `+"`.opencode/agent/%s.md`"+` 放到项目根目录（保持相对路径），或复制到全局 `+"`~/.config/opencode/agent/`"+`。

用途：%s
`, name, pkg.Description)),
	}
	return files, "opencode-" + name + ".zip"
}

// formatCursor — Cursor Rules .mdc
func formatCursor(pkg *SkillPackage) (map[string][]byte, string) {
	name := pkg.Name
	frontmatter := fmt.Sprintf(`---
description: %s
globs:
  - "**/*"
alwaysApply: false
---

`, escapeYAML(pkg.Description))

	files := map[string][]byte{
		".cursor/rules/" + name + ".mdc": []byte(frontmatter + buildMainBody(pkg)),
		"README.md": []byte(fmt.Sprintf(`# Cursor Rule

安装：
把 `+"`.cursor/rules/%s.mdc`"+` 放到项目根目录（保持相对路径）。

Cursor 会在匹配 globs 的文件上自动应用此规则。你也可以在对话里手动 `+"`@%s`"+` 引用。

用途：%s
`, name, name, pkg.Description)),
	}
	return files, "cursor-" + name + ".zip"
}

// formatGeneric — 纯 markdown，不依赖任何工具
func formatGeneric(pkg *SkillPackage) (map[string][]byte, string) {
	name := pkg.Name
	files := map[string][]byte{
		name + ".md": []byte(buildMainBody(pkg)),
		"README.md": []byte(fmt.Sprintf(`# %s (通用 Skill)

这是一个工具无关的 Markdown 格式 skill 文件。你可以：

1. **直接粘贴到任何 AI 对话框**作为 system prompt
2. **手动转换**为 Claude Code / Cursor / OpenCode 等工具的专用格式
3. **作为文档**保留记录

用途：%s
`, pkg.DisplayName, pkg.Description)),
	}
	return files, name + ".zip"
}

// escapeYAML 简单转义 YAML 字符串中的双引号和换行
func escapeYAML(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

// ─── Zip 打包 ────────────────────────────────────────────────────────────────

func makeSkillZip(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// 确保文件顺序稳定
	var names []string
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		f, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write(files[name]); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

// ForgeSkillZip 执行炼化，返回 zip 字节 + 建议文件名
func ForgeSkillZip(svc *service.ContactService, opts ForgeOptions, prefs Preferences) ([]byte, string, error) {
	if prefs.LLMProvider == "" && opts.ProfileID == "" {
		return nil, "", fmt.Errorf("请先在设置中配置 AI 接口")
	}

	var (
		displayName string
		statsText   string
		samples     []string
		err         error
	)

	switch opts.SkillType {
	case "contact":
		if opts.Username == "" {
			return nil, "", fmt.Errorf("缺少 username 参数")
		}
		displayName, statsText, samples, err = collectContactData(svc, opts.Username, opts.MsgLimit)
	case "self":
		displayName = "我"
		statsText, samples, err = collectSelfData(svc, opts.MsgLimit)
	case "group":
		if opts.Username == "" {
			return nil, "", fmt.Errorf("缺少 username 参数")
		}
		displayName, statsText, samples, err = collectGroupData(svc, opts.Username, "", opts.MsgLimit)
	case "group-member":
		if opts.Username == "" || opts.MemberSpeaker == "" {
			return nil, "", fmt.Errorf("缺少 username 或 member_speaker 参数")
		}
		displayName, statsText, samples, err = collectGroupData(svc, opts.Username, opts.MemberSpeaker, opts.MsgLimit)
	default:
		return nil, "", fmt.Errorf("未知的 skill 类型: %s", opts.SkillType)
	}
	if err != nil {
		return nil, "", err
	}

	if len(samples) < 10 {
		return nil, "", fmt.Errorf("可用的文本消息太少（%d 条），无法生成有意义的 skill", len(samples))
	}

	// LLM 抽取
	pkg, err := extractSkillPackage(opts.SkillType, displayName, opts.Username, samples, statsText, prefs, opts.ProfileID)
	if err != nil {
		return nil, "", err
	}
	pkg.MessageCount = len(samples)

	// 格式化 + 打包
	files, filename := formatSkillFiles(pkg, opts.Format)
	// 注入一个 skill-metadata.json 方便调试
	metaBytes, _ := json.MarshalIndent(pkg, "", "  ")
	files["skill-metadata.json"] = metaBytes

	zipBytes, err := makeSkillZip(files)
	if err != nil {
		return nil, "", err
	}
	return zipBytes, filename, nil
}

// 确保 db 包被引用（避免 unused import 在少量场景下）
var _ = db.GetTableName
