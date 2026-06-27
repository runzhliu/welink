package service

// voice_call.go — 「语音 / 通话档案」 Lab 的服务层
//
// 扫描所有私聊里被其它分析忽略的两类消息：
//   - type 34（语音条）：从 message_content 的 <voicemsg voicelength="..."> 取时长（毫秒）
//   - type 50（音视频通话）：从 <msg><![CDATA[通话时长 MM:SS]]> 取接通时长
//
// 通话的 <duration> 标签实测恒为 0，真实时长只在 CDATA 文本里（"通话时长 MM:SS" /
// "通话中断 MM:SS" 表示接通过；"已取消 / 对方已拒绝 / 未应答 / 忙线" 表示未接通）。
//
// 方向沿用全代码库一致的判定：isMine = senderID != contactRowID（见 ContactMessageTimeline）。
//
// 零 LLM、纯解析。

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"welink/backend/pkg/db"
)

var (
	reVoiceLen = regexp.MustCompile(`voicelength="(\d+)"`)
	// 接通的通话：CDATA 里是「通话时长 X」或「通话中断 X」，X 形如 MM:SS 或 HH:MM:SS
	reCallDur = regexp.MustCompile(`(?:通话时长|通话中断)\s*([\d:]+)`)
)

// VCContactRow 单个联系人的语音/通话聚合
type VCContactRow struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`

	// 通话
	CallConnected  int   `json:"call_connected"`   // 接通次数
	CallMissed     int   `json:"call_missed"`      // 未接通次数（取消/拒绝/无应答/忙线）
	CallTotalSec   int64 `json:"call_total_sec"`   // 接通通话累计时长（秒）
	CallLongestSec int64 `json:"call_longest_sec"` // 单次最长（秒）

	// 语音条
	VoiceCount      int   `json:"voice_count"`       // 语音条总数
	VoiceTotalSec   int64 `json:"voice_total_sec"`   // 语音条累计时长（秒）
	VoiceLongestSec int64 `json:"voice_longest_sec"` // 单条最长（秒）
	MyVoiceCount    int   `json:"my_voice_count"`    // 我发的语音条数
	TheirVoiceCount int   `json:"their_voice_count"` // TA 发的语音条数
	TheirVoiceSec   int64 `json:"their_voice_sec"`   // TA 发的语音条累计时长（秒）
}

// VCProfile 完整响应
type VCProfile struct {
	ScannedContacts int `json:"scanned_contacts"`

	// 全局汇总（所有私聊累计）
	TotalCallSec       int64 `json:"total_call_sec"`       // 接通通话累计时长（秒）
	TotalCallConnected int   `json:"total_call_connected"` // 接通通话总次数
	TotalCallMissed    int   `json:"total_call_missed"`    // 未接通总次数
	TotalVoiceCount    int   `json:"total_voice_count"`    // 语音条总数
	TotalVoiceSec      int64 `json:"total_voice_sec"`      // 语音条累计时长（秒）

	// 三个榜（前端分 tab）
	CallDurationRank []VCContactRow `json:"call_duration_rank"` // 煲电话粥榜：接通通话总时长降序
	CallLongestRank  []VCContactRow `json:"call_longest_rank"`  // 最长一次通话：单次最长降序
	VoiceSenderRank  []VCContactRow `json:"voice_sender_rank"`  // 语音条之王：谁爱给我发语音（TA 发的时长降序）

	GeneratedAt int64 `json:"generated_at"`
}

const (
	vcMaxContacts = 300 // 最多扫前 N 个最常聊的私聊
	vcTopLimit    = 30  // 每个榜最多 30 条
)

// VoiceCallProfile 扫描所有私聊，聚合语音条 / 通话档案。零 LLM。
func (s *ContactService) VoiceCallProfile() *VCProfile {
	stats := s.GetCachedStats()

	type cand struct {
		username, displayName, avatar string
		total                         int64
	}
	picks := make([]cand, 0, 64)
	for _, st := range stats {
		if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
			continue
		}
		if st.TotalMessages <= 0 {
			continue
		}
		name := st.Remark
		if name == "" {
			name = st.Nickname
		}
		if name == "" {
			name = st.Username
		}
		avatar := st.SmallHeadURL
		if avatar == "" {
			avatar = st.BigHeadURL
		}
		picks = append(picks, cand{st.Username, name, avatar, st.TotalMessages})
	}
	// 按消息量降序，截断到前 N 个最常聊的私聊
	sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
	if len(picks) > vcMaxContacts {
		picks = picks[:vcMaxContacts]
	}

	resp := &VCProfile{
		ScannedContacts:  len(picks),
		CallDurationRank: []VCContactRow{},
		CallLongestRank:  []VCContactRow{},
		VoiceSenderRank:  []VCContactRow{},
	}

	var rows []VCContactRow
	for _, p := range picks {
		row := s.scanContactVoiceCall(p.username, p.displayName, p.avatar)
		if row == nil {
			continue
		}
		// 全局汇总
		resp.TotalCallSec += row.CallTotalSec
		resp.TotalCallConnected += row.CallConnected
		resp.TotalCallMissed += row.CallMissed
		resp.TotalVoiceCount += row.VoiceCount
		resp.TotalVoiceSec += row.VoiceTotalSec
		rows = append(rows, *row)
	}

	// 煲电话粥榜：接通通话总时长降序（至少接通过 1 次）
	callDur := vcFilter(rows, func(r VCContactRow) bool { return r.CallTotalSec > 0 })
	vcSort(callDur, func(a, b VCContactRow) bool { return a.CallTotalSec > b.CallTotalSec })
	resp.CallDurationRank = vcCap(callDur)

	// 最长一次通话：单次最长降序
	callLong := vcFilter(rows, func(r VCContactRow) bool { return r.CallLongestSec > 0 })
	vcSort(callLong, func(a, b VCContactRow) bool { return a.CallLongestSec > b.CallLongestSec })
	resp.CallLongestRank = vcCap(callLong)

	// 语音条之王：谁爱给我发语音（TA 发的语音时长降序）
	voiceRank := vcFilter(rows, func(r VCContactRow) bool { return r.TheirVoiceSec > 0 })
	vcSort(voiceRank, func(a, b VCContactRow) bool { return a.TheirVoiceSec > b.TheirVoiceSec })
	resp.VoiceSenderRank = vcCap(voiceRank)

	return resp
}

// scanContactVoiceCall 扫某个联系人在所有 MessageDB 里的 type 34/50 消息。
// 没有任何语音/通话则返回 nil。
func (s *ContactService) scanContactVoiceCall(username, displayName, avatar string) *VCContactRow {
	tableName := db.GetTableName(username)
	row := &VCContactRow{Username: username, DisplayName: displayName, AvatarURL: avatar}

	for _, mdb := range s.dbMgr.MessageDBs {
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT local_type, message_content, COALESCE(WCDB_CT_message_content,0), COALESCE(real_sender_id,0) "+
				"FROM [%s] WHERE (local_type & 65535) IN (34,50)", tableName))
		if err != nil {
			continue
		}
		for rows.Next() {
			var lt int
			var rawContent []byte
			var ct, senderID int64
			if err := rows.Scan(&lt, &rawContent, &ct, &senderID); err != nil {
				continue
			}
			content := decodeGroupContent(rawContent, ct)
			isMine := contactRowID < 0 || senderID != contactRowID

			switch lt & 0xFFFF {
			case 34: // 语音条
				secs := parseVoiceLenSec(content)
				if secs <= 0 {
					continue
				}
				row.VoiceCount++
				row.VoiceTotalSec += secs
				if secs > row.VoiceLongestSec {
					row.VoiceLongestSec = secs
				}
				if isMine {
					row.MyVoiceCount++
				} else {
					row.TheirVoiceCount++
					row.TheirVoiceSec += secs
				}
			case 50: // 通话
				secs, connected := parseCallSec(content)
				if connected {
					row.CallConnected++
					row.CallTotalSec += secs
					if secs > row.CallLongestSec {
						row.CallLongestSec = secs
					}
				} else {
					row.CallMissed++
				}
			}
		}
		rows.Close()
	}

	if row.VoiceCount == 0 && row.CallConnected == 0 && row.CallMissed == 0 {
		return nil
	}
	return row
}

// parseVoiceLenSec 从语音消息 XML 取时长（秒）。voicelength 单位为毫秒。
func parseVoiceLenSec(content string) int64 {
	m := reVoiceLen.FindStringSubmatch(content)
	if m == nil {
		return 0
	}
	ms, _ := strconv.ParseInt(m[1], 10, 64)
	if ms <= 0 {
		return 0
	}
	return (ms + 500) / 1000 // 四舍五入到秒，至少不丢失短语音
}

// parseCallSec 解析通话消息。返回（接通时长秒, 是否接通）。
// 接通的 CDATA 文本为「通话时长 MM:SS」或「通话中断 MM:SS」；否则为未接通。
func parseCallSec(content string) (int64, bool) {
	m := reCallDur.FindStringSubmatch(content)
	if m == nil {
		return 0, false
	}
	return parseHMS(m[1]), true
}

// parseHMS 把 "MM:SS" 或 "HH:MM:SS" 解析成秒
func parseHMS(s string) int64 {
	parts := strings.Split(strings.TrimSpace(s), ":")
	var total int64
	for _, p := range parts {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}

// ---- 排序/过滤小工具 ----

func vcFilter(rows []VCContactRow, keep func(VCContactRow) bool) []VCContactRow {
	out := make([]VCContactRow, 0, len(rows))
	for _, r := range rows {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

func vcSort(rows []VCContactRow, less func(a, b VCContactRow) bool) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && less(rows[j], rows[j-1]); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

func vcCap(rows []VCContactRow) []VCContactRow {
	if rows == nil {
		return []VCContactRow{}
	}
	if len(rows) > vcTopLimit {
		return rows[:vcTopLimit]
	}
	return rows
}
