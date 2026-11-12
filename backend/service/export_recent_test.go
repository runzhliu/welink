package service

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"welink/backend/pkg/db"
	"welink/backend/repository"
)

func TestRecentExportsMergeShardsAndSkipEmpty(t *testing.T) {
	open := func(name string) *sql.DB {
		t.Helper()
		database, err := sql.Open("sqlite", filepath.Join(t.TempDir(), name))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { database.Close() })
		return database
	}
	exec := func(database *sql.DB, query string, args ...any) {
		t.Helper()
		if _, err := database.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	contacts, first, second := open("contacts.db"), open("first.db"), open("second.db")
	exec(contacts, `CREATE TABLE contact (username TEXT, remark TEXT, nick_name TEXT, small_head_url TEXT)`)
	exec(contacts, `INSERT INTO contact VALUES ('friend','','朋友',''),('member','','成员','')`)
	for _, database := range []*sql.DB{first, second} {
		exec(database, `CREATE TABLE Name2Id (user_name TEXT)`)
		exec(database, `INSERT INTO Name2Id (rowid,user_name) VALUES (1,'friend'),(2,'member')`)
		for _, username := range []string{"friend", "room@chatroom"} {
			exec(database, fmt.Sprintf(`CREATE TABLE [%s] (create_time INTEGER, local_type INTEGER, message_content TEXT, WCDB_CT_message_content INTEGER, real_sender_id INTEGER)`, db.GetTableName(username)))
		}
	}
	for _, username := range []string{"friend", "room@chatroom"} {
		table := db.GetTableName(username)
		for _, row := range []struct {
			database *sql.DB
			ts       int
			text     string
		}{
			{first, 100, "old"}, {first, 130, "a"}, {first, 150, "c"},
			{second, 110, "older"}, {second, 140, "b"}, {second, 160, ""},
		} {
			exec(row.database, fmt.Sprintf(`INSERT INTO [%s] VALUES (?,1,?,0,1)`, table), row.ts, row.text)
		}
	}
	mgr := &db.DBManager{ContactDB: contacts, MessageDBs: []*sql.DB{first, second}}
	svc := &ContactService{dbMgr: mgr, msgRepo: repository.NewMessageRepository(mgr), tz: time.UTC}
	var contactTexts, groupTexts []string
	for _, m := range svc.ExportContactMessagesLimited("friend", 105, 160, 3) {
		contactTexts = append(contactTexts, m.Content)
	}
	for _, m := range svc.ExportGroupMessagesLimited("room@chatroom", 105, 160, 3) {
		groupTexts = append(groupTexts, m.Content)
	}
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(contactTexts, want) || !reflect.DeepEqual(groupTexts, want) {
		t.Fatalf("incorrect recent messages: contact=%v group=%v want=%v", contactTexts, groupTexts, want)
	}
	if got := svc.ExportContactMessagesAll("friend"); len(got) != 5 || got[0].Content != "old" || got[4].Content != "c" {
		t.Fatalf("unbounded export changed: %+v", got)
	}
}
