package service

// reply_speed.go — 回复速度榜的数据支撑
//
// 提供 ContactMessageTimeline：返回某联系人全部对话消息的
// (unix 时间戳, 是否我发) 序列，按时间升序。比 ExportContactMessagesAll
// 更轻（不解码内容），且保留秒级时间戳用于精确算回复延迟。

import (
	"fmt"
	"sort"

	"welink/backend/pkg/db"
)

// MsgTimePoint 一条消息的最小时序信息
type MsgTimePoint struct {
	Ts     int64 // create_time（unix 秒）
	IsMine bool  // true = 我发的
}

// ContactMessageTimeline 返回某联系人全部对话消息的时序点，按时间升序。
//
// 只取真正的"对话消息"：文本(1)/图片(3)/语音(34)/视频(43)/表情(47)/
// 链接红包(49)。系统消息、撤回提示等不算"一次发言"，排除。
//
// 不应用全局时间过滤 —— 回复速度看的是全历史习惯。
func (s *ContactService) ContactMessageTimeline(username string) []MsgTimePoint {
	tableName := db.GetTableName(username)

	var points []MsgTimePoint
	for _, mdb := range s.dbMgr.MessageDBs {
		// 每个 DB 单独查联系人 rowid（不同 DB 里 rowid 不同）
		var contactRowID int64 = -1
		mdb.QueryRow(fmt.Sprintf("SELECT rowid FROM Name2Id WHERE user_name = %q", username)).Scan(&contactRowID)

		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time, COALESCE(real_sender_id,0) FROM [%s] "+
				"WHERE local_type IN (1,3,34,43,47,49) ORDER BY create_time ASC",
			tableName,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts, senderID int64
			if err := rows.Scan(&ts, &senderID); err != nil {
				continue
			}
			if ts <= 0 {
				continue
			}
			// isMine：sender 不是联系人本人 → 我发的（与 exportContactMessages 一致）
			isMine := contactRowID < 0 || senderID != contactRowID
			points = append(points, MsgTimePoint{Ts: ts, IsMine: isMine})
		}
		rows.Close()
	}

	// 多 DB 合并后整体重排
	sort.Slice(points, func(i, j int) bool { return points[i].Ts < points[j].Ts })
	return points
}
