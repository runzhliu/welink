package service

import (
	"container/heap"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"welink/backend/pkg/db"
	"welink/backend/sft"
)

func (s *ContactService) SFTIdentity() string {
	s.cacheMu.RLock()
	cached := s.sftIdentity
	s.cacheMu.RUnlock()
	if cached != "" {
		return cached
	}
	info := s.GetSelfInfo()
	if info == nil || info.Wxid == "" {
		return ""
	}
	path, _ := filepath.Abs(s.dbMgr.DataRoot())
	if real, e := filepath.EvalSymlinks(path); e == nil {
		path = real
	}
	identity := fmt.Sprintf("%x", sha256.Sum256([]byte(path+"\x00"+info.Wxid)))
	s.cacheMu.Lock()
	if s.sftIdentity == "" {
		s.sftIdentity = identity
	}
	identity = s.sftIdentity
	s.cacheMu.Unlock()
	return identity
}

type sftCursor struct {
	rows          *sql.Rows
	contact, self int64
	index         int
	msg           sft.SourceMessage
}
type sftHeap []*sftCursor

func (h sftHeap) Len() int { return len(h) }
func (h sftHeap) Less(i, j int) bool {
	if h[i].msg.Timestamp == h[j].msg.Timestamp {
		return h[i].msg.ID < h[j].msg.ID
	}
	return h[i].msg.Timestamp < h[j].msg.Timestamp
}
func (h sftHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *sftHeap) Push(v any)   { *h = append(*h, v.(*sftCursor)) }
func (h *sftHeap) Pop() any     { old := *h; v := old[len(old)-1]; *h = old[:len(old)-1]; return v }
func (c *sftCursor) next(username string) bool {
	if !c.rows.Next() {
		return false
	}
	var rowid, serverID, ts, sender, ct int64
	var kind int
	var raw []byte
	if e := c.rows.Scan(&rowid, &serverID, &ts, &kind, &raw, &ct, &sender); e != nil {
		c.msg = sft.SourceMessage{Contact: username}
		return true
	}
	content := strings.TrimSpace(decodeGroupContent(raw, ct))
	identity := fmt.Sprintf("%s/%d/%d", username, c.index, rowid)
	if serverID > 0 {
		identity = fmt.Sprintf("%s/server/%d", username, serverID)
	}
	c.msg = sft.SourceMessage{ID: fmt.Sprintf("%x", sha256.Sum256([]byte(identity))), Contact: username, Timestamp: ts, Content: content, Text: kind == 1, Mine: sender == c.self, Known: sender > 0 && (sender == c.self || sender == c.contact)}
	return true
}

// WalkSFTMessages merges per-shard cursors. Its caller holds the account-switch
// read lock, so every message belongs to the same source identity snapshot.
func (s *ContactService) WalkSFTMessages(ctx context.Context, username string, from, to int64, visit func(sft.SourceMessage) error) error {
	if strings.Contains(username, "@chatroom") {
		return fmt.Errorf("首版只支持私聊")
	}
	info := s.GetSelfInfo()
	if info == nil || info.Wxid == "" {
		return fmt.Errorf("当前账号身份尚未确认，请完成索引后重试")
	}
	var h sftHeap
	all := []*sftCursor{}
	defer func() {
		for _, c := range all {
			c.rows.Close()
		}
	}()
	for index, mdb := range s.msgRepo.DBsForUsername(username) {
		var contact, self int64
		if e := mdb.QueryRowContext(ctx, `SELECT rowid FROM Name2Id WHERE user_name=?`, username).Scan(&contact); e != nil {
			continue
		}
		if e := mdb.QueryRowContext(ctx, `SELECT rowid FROM Name2Id WHERE user_name=?`, info.Wxid).Scan(&self); e != nil {
			continue
		}
		rows, e := mdb.QueryContext(ctx, fmt.Sprintf(`SELECT rowid,COALESCE(server_id,0),create_time,local_type,message_content,COALESCE(WCDB_CT_message_content,0),COALESCE(real_sender_id,0) FROM [%s] WHERE (?=0 OR create_time>=?) AND (?=0 OR create_time<=?) ORDER BY create_time,rowid`, db.GetTableName(username)), from, from, to, to)
		if e != nil {
			return fmt.Errorf("读取聊天分库失败")
		}
		c := &sftCursor{rows: rows, contact: contact, self: self, index: index}
		all = append(all, c)
		if c.next(username) {
			heap.Push(&h, c)
		}
	}
	seenAt := map[string]bool{}
	var timestamp int64 = -1
	for h.Len() > 0 {
		if e := ctx.Err(); e != nil {
			return e
		}
		c := heap.Pop(&h).(*sftCursor)
		if c.msg.Timestamp != timestamp {
			seenAt = map[string]bool{}
			timestamp = c.msg.Timestamp
		}
		if !seenAt[c.msg.ID] {
			seenAt[c.msg.ID] = true
			if e := visit(c.msg); e != nil {
				return e
			}
		}
		if c.next(username) {
			heap.Push(&h, c)
		}
	}
	for _, c := range all {
		if e := c.rows.Err(); e != nil {
			return e
		}
	}
	return nil
}
