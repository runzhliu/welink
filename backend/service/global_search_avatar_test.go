package service

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"welink/backend/model"
	"welink/backend/pkg/db"
	"welink/backend/repository"
)

func TestGlobalSearchGroupSenderAvatars(t *testing.T) {
	for _, withNameTable := range []bool{true, false} {
		t.Run(fmt.Sprintf("name-table-%v", withNameTable), func(t *testing.T) {
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
			execSQL := func(database *sql.DB, query string) {
				t.Helper()
				if _, err := database.Exec(query); err != nil {
					t.Fatal(err)
				}
			}
			execSQL(contacts, `CREATE TABLE contact (username TEXT, remark TEXT, nick_name TEXT, small_head_url TEXT)`)
			execSQL(contacts, `INSERT INTO contact VALUES ('room@chatroom','','测试群','/room.png'), ('member','备注名','昵称','/member.png'), ('friend','','好友',''), ('self','','我','/self.png')`)
			groupTable := db.GetTableName("room@chatroom")
			friendTable := db.GetTableName("friend")
			for _, table := range []string{groupTable, friendTable} {
				execSQL(messages, fmt.Sprintf(`CREATE TABLE [%s] (create_time INTEGER, local_type INTEGER, message_content TEXT, real_sender_id INTEGER)`, table))
			}
			execSQL(messages, fmt.Sprintf(`INSERT INTO [%s] VALUES (1704067200, 1, 'member:' || char(10) || '测试关键词', 0)`, groupTable))
			if withNameTable {
				execSQL(messages, `CREATE TABLE Name2Id (user_name TEXT)`)
				execSQL(messages, `INSERT INTO Name2Id (rowid,user_name) VALUES (1,'friend'),(2,'self'),(3,'member')`)
				execSQL(messages, fmt.Sprintf(`INSERT INTO [%s] VALUES (1704067201, 1, '测试关键词本人', 2), (1704067202, 1, '测试关键词成员', 3)`, groupTable))
				execSQL(messages, fmt.Sprintf(`INSERT INTO [%s] VALUES (1704067200, 1, '私聊', 1), (1704067201, 1, '私聊', 2)`, friendTable))
			}
			mgr := &db.DBManager{ContactDB: contacts, MessageDBs: []*sql.DB{messages}}
			svc := &ContactService{dbMgr: mgr, msgRepo: repository.NewMessageRepository(mgr), tz: time.UTC,
				cache: []ContactStatsExtended{{ContactStats: model.ContactStats{Contact: model.Contact{Username: "friend"}, MyMessages: 1}}}}
			groups := svc.GlobalSearch(context.Background(), "测试关键词", "group")
			if len(groups) != 1 {
				t.Fatalf("got %d groups", len(groups))
			}
			var prefixFound, memberFound, selfFound bool
			for _, msg := range groups[0].Messages {
				switch msg.Content {
				case "测试关键词":
					prefixFound = msg.Speaker == "备注名" && msg.AvatarURL == "/member.png" && !msg.IsMine
				case "测试关键词成员":
					memberFound = msg.Speaker == "备注名" && msg.AvatarURL == "/member.png" && !msg.IsMine
				case "测试关键词本人":
					selfFound = msg.IsMine && msg.AvatarURL == "/self.png"
				}
			}
			if !prefixFound || (withNameTable && (!memberFound || !selfFound)) {
				t.Fatalf("incorrect search sender resolution: prefix=%v member=%v self=%v", prefixFound, memberFound, selfFound)
			}
		})
	}
}
