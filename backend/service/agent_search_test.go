package service

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"welink/backend/model"
	"welink/backend/pkg/db"
	"welink/backend/repository"
)

func TestAgentSearchPastLegacyLimitAndGroupSender(t *testing.T) {
	contacts, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "contacts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer contacts.Close()
	messages, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "messages.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer messages.Close()
	execSQL := func(database *sql.DB, query string, args ...any) {
		t.Helper()
		if _, err := database.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	execSQL(contacts, `CREATE TABLE contact (username TEXT, remark TEXT, nick_name TEXT, small_head_url TEXT)`)
	execSQL(contacts, `INSERT INTO contact VALUES ('friend','','朋友',''), ('self','','我',''), ('member','','成员','')`)
	execSQL(messages, `CREATE TABLE Name2Id (user_name TEXT)`)
	execSQL(messages, `INSERT INTO Name2Id (rowid,user_name) VALUES (1,'friend'),(2,'self'),(3,'member')`)
	friend, group := db.GetTableName("friend"), db.GetTableName("room@chatroom")
	for _, table := range []string{friend, group} {
		execSQL(messages, fmt.Sprintf(`CREATE TABLE [%s] (create_time INTEGER, local_type INTEGER, message_content TEXT, WCDB_CT_message_content INTEGER, real_sender_id INTEGER)`, table))
	}
	for i := 0; i < 205; i++ {
		execSQL(messages, fmt.Sprintf(`INSERT INTO [%s] VALUES (?,1,'虚构关键词',0,?)`, friend), 1704067200+i, 1+i%2)
	}
	execSQL(messages, fmt.Sprintf(`INSERT INTO [%s] VALUES (1704067201,1,'群聊关键词',0,2), (1704067202,1,'群聊关键词',0,3)`, group))
	mgr := &db.DBManager{ContactDB: contacts, MessageDBs: []*sql.DB{messages}}
	svc := &ContactService{dbMgr: mgr, msgRepo: repository.NewMessageRepository(mgr), tz: time.UTC, cache: []ContactStatsExtended{{ContactStats: model.ContactStats{Contact: model.Contact{Username: "friend"}, MyMessages: 1}}}}
	if got := len(svc.SearchMessages("friend", "关键词", true)); got != 200 {
		t.Fatalf("legacy UI limit: %d", got)
	}
	if got := len(svc.SearchMessagesWithLimit("friend", "关键词", true, 206)); got != 205 {
		t.Fatalf("agent results: %d", got)
	}
	got := svc.SearchGroupMessages("room@chatroom", "关键词", "")
	if len(got) != 2 || got[0].IsMine || !got[1].IsMine {
		t.Fatalf("group sender attribution incorrect: %+v", got)
	}
}
