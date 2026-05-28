package service

// contact_dates.go — 某联系人"有聊天记录的日期"列表
//
// 给「微信视图」按天浏览用：前一天/后一天直接跳到有记录的那天，
// 而不是盲目 ±1 个自然日撞空。

import (
	"fmt"
	"sort"
	"time"

	"welink/backend/pkg/db"
)

// ContactActiveDates 返回某联系人所有有对话消息的日期（YYYY-MM-DD），升序去重。
//
// 只算真正的对话消息（文本/图片/语音/视频/表情/链接红包）。
// 扫全表但只回 distinct 日期，结果很小（最多几百条）。
func (s *ContactService) ContactActiveDates(username string) []string {
	tableName := db.GetTableName(username)

	seen := make(map[string]struct{}, 512)
	for _, mdb := range s.dbMgr.MessageDBs {
		rows, err := mdb.Query(fmt.Sprintf(
			"SELECT create_time FROM [%s] WHERE local_type IN (1,3,34,43,47,49)",
			tableName,
		))
		if err != nil {
			continue
		}
		for rows.Next() {
			var ts int64
			if err := rows.Scan(&ts); err != nil || ts <= 0 {
				continue
			}
			d := time.Unix(ts, 0).In(s.tz).Format("2006-01-02")
			seen[d] = struct{}{}
		}
		rows.Close()
	}

	dates := make([]string, 0, len(seen))
	for d := range seen {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	return dates
}
