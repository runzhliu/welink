// Package seed generates demo WeChat-like SQLite databases for demo/preview purposes.
// The generated data mimics the real WeChat database schema so the backend can
// serve a fully functional UI without requiring real decrypted databases.
package seed

import (
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Contact represents a demo contact entry.
type Contact struct {
	Username string
	Nickname string
	Remark   string
	Flag     int
	IsGroup  bool
}

var demoContacts = []Contact{
	{Username: "alice_wx", Nickname: "Alice", Remark: "同学 Alice", Flag: 3},
	{Username: "bob_2024", Nickname: "Bob", Remark: "前同事 Bob", Flag: 3},
	{Username: "charlie88", Nickname: "Charlie", Remark: "", Flag: 3},
	{Username: "diana_life", Nickname: "Diana", Remark: "Diana 同学", Flag: 3},
	{Username: "evan_tech", Nickname: "Evan", Remark: "Evan", Flag: 3},
	{Username: "fiona_art", Nickname: "Fiona", Remark: "", Flag: 3},
	{Username: "george_run", Nickname: "George", Remark: "George 跑步群友", Flag: 3},
	{Username: "helen_biz", Nickname: "Helen", Remark: "Helen 老板", Flag: 3},
	{Username: "ivan_game", Nickname: "Ivan", Remark: "", Flag: 3},
	{Username: "julia_cook", Nickname: "Julia", Remark: "Julia 厨艺班", Flag: 3},
	{Username: "kevin_music", Nickname: "Kevin", Remark: "", Flag: 3},
	{Username: "lisa_travel", Nickname: "Lisa", Remark: "旅游达人 Lisa", Flag: 3},
	// Groups
	{Username: "teamwork2024@chatroom", Nickname: "工作群 2024", Remark: "", Flag: 0, IsGroup: true},
	{Username: "family_circle@chatroom", Nickname: "家庭群", Remark: "", Flag: 0, IsGroup: true},
	{Username: "college_friends@chatroom", Nickname: "大学同学群", Remark: "", Flag: 0, IsGroup: true},
}

// demoSelfWxid is the fake "me" wxid used in demo messages.
const demoSelfWxid = "demo_self_wxid"

var textMessages = []string{
	"在吗？",
	"最近怎么样？",
	"好久不见！",
	"周末有空吗？",
	"刚看到一篇很好的文章，分享给你",
	"哈哈哈哈",
	"明天见！",
	"收到，知道了",
	"嗯嗯",
	"好的",
	"没问题",
	"你在哪里？",
	"吃了吗？",
	"今天天气真好",
	"忙吗？",
	"有个事情想跟你说",
	"新年快乐！",
	"生日快乐！",
	"辛苦了",
	"太厉害了！",
	"感谢你的帮助",
	"下次一起吃饭吧",
	"刚到家",
	"马上出发",
	"稍等一下",
	"好的，明白了",
	"最近工作很忙",
	"终于搞定了",
	"一起来嘛",
	"想你了",
	"加油！",
	"给你看个东西",
	"哈哈，太搞笑了",
	"这个你知道吗？",
	"我也觉得",
	"真的吗？",
	"不错啊",
	"有意思",
	"对对对",
	"我去了",
	"到了吗？",
	"快点！",
	"来不来？",
	"下班了",
	"今天很累",
	"周末去哪里玩？",
	"感觉不错",
	"哈哈哈",
	"好的呢",
	"谢谢！",
}

// tableNameForUser returns the Msg_<md5> table name for a given username.
func tableNameForUser(username string) string {
	hash := md5.Sum([]byte(username))
	return fmt.Sprintf("Msg_%s", hex.EncodeToString(hash[:]))
}

// Generate creates demo contact.db and message_0.db in destDir.
// If the files already exist they are removed first to avoid duplicate data
// on container restart.
func Generate(destDir string) error {
	contactDir := filepath.Join(destDir, "contact")
	messageDir := filepath.Join(destDir, "message")

	if err := os.MkdirAll(contactDir, 0755); err != nil {
		return err
	}
	if err := os.MkdirAll(messageDir, 0755); err != nil {
		return err
	}

	// Remove stale files to prevent duplicate rows on repeated starts.
	contactPath := filepath.Join(contactDir, "contact.db")
	messagePath := filepath.Join(messageDir, "message_0.db")
	_ = os.Remove(contactPath)
	_ = os.Remove(messagePath)

	if err := createContactDB(contactPath); err != nil {
		return fmt.Errorf("create contact db: %w", err)
	}
	if err := createMessageDB(messagePath); err != nil {
		return fmt.Errorf("create message db: %w", err)
	}

	log.Printf("[DEMO] Demo databases created in %s", destDir)
	return nil
}

func createContactDB(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS contact (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		nick_name TEXT,
		remark TEXT,
		alias TEXT,
		flag INTEGER DEFAULT 3,
		verify_flag INTEGER DEFAULT 0,
		big_head_url TEXT,
		small_head_url TEXT,
		description TEXT
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS chat_room (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		nick_name TEXT
	)`)
	if err != nil {
		return err
	}

	stmt, err := db.Prepare(`INSERT INTO contact (username, nick_name, remark, flag, verify_flag) VALUES (?, ?, ?, ?, 0)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range demoContacts {
		if _, err := stmt.Exec(c.Username, c.Nickname, c.Remark, c.Flag); err != nil {
			return err
		}
	}
	return nil
}

func createMessageDB(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()

	// Name2Id table: rowid is the primary key used by real_sender_id.
	// We insert one row per contact (+ self) so the rowid is predictable.
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS Name2Id (
		user_name TEXT PRIMARY KEY
	)`)
	if err != nil {
		return fmt.Errorf("create Name2Id: %w", err)
	}

	// Insert self first (rowid=1), then each contact sequentially.
	// rowid is implicit in SQLite and equals the insertion order here.
	if _, err := db.Exec(`INSERT INTO Name2Id (user_name) VALUES (?)`, demoSelfWxid); err != nil {
		return fmt.Errorf("insert self into Name2Id: %w", err)
	}

	// contactRowID maps username -> rowid in Name2Id
	contactRowID := make(map[string]int64)
	for _, c := range demoContacts {
		res, err := db.Exec(`INSERT INTO Name2Id (user_name) VALUES (?)`, c.Username)
		if err != nil {
			return fmt.Errorf("insert %s into Name2Id: %w", c.Username, err)
		}
		rid, _ := res.LastInsertId()
		contactRowID[c.Username] = rid
	}

	rng := rand.New(rand.NewSource(42))
	now := time.Now()

	for _, contact := range demoContacts {
		tableName := tableNameForUser(contact.Username)

		_, err := db.Exec(fmt.Sprintf(`CREATE TABLE IF NOT EXISTS [%s] (
			local_id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id INTEGER DEFAULT 0,
			local_type INTEGER DEFAULT 1,
			sort_seq INTEGER DEFAULT 0,
			real_sender_id INTEGER DEFAULT 0,
			create_time INTEGER NOT NULL,
			status INTEGER DEFAULT 1,
			message_content TEXT,
			compress_content TEXT,
			WCDB_CT_message_content INTEGER DEFAULT 0
		)`, tableName))
		if err != nil {
			return fmt.Errorf("create table %s: %w", tableName, err)
		}

		msgCount := msgCountForContact(contact, rng)
		selfRowID := int64(1)                    // rowid 1 = self
		otherRowID := contactRowID[contact.Username] // rowid N = this contact
		if err := insertMessages(db, tableName, contact, msgCount, now, rng, selfRowID, otherRowID); err != nil {
			return err
		}
	}

	return nil
}

func msgCountForContact(c Contact, rng *rand.Rand) int {
	if c.IsGroup {
		return 200 + rng.Intn(800)
	}
	switch c.Username {
	case "alice_wx":
		return 1500 + rng.Intn(500)
	case "bob_2024":
		return 800 + rng.Intn(400)
	case "helen_biz":
		return 1200 + rng.Intn(300)
	default:
		return 50 + rng.Intn(400)
	}
}

// msgTypeWeights maps local_type -> relative weight.
var msgTypeWeights = []struct {
	localType int
	weight    int
}{
	{1, 70},  // text
	{3, 10},  // image
	{34, 5},  // voice
	{43, 3},  // video
	{47, 8},  // emoji
	{49, 4},  // rich media
}

func pickMsgType(rng *rand.Rand) int {
	total := 0
	for _, w := range msgTypeWeights {
		total += w.weight
	}
	n := rng.Intn(total)
	for _, w := range msgTypeWeights {
		if n < w.weight {
			return w.localType
		}
		n -= w.weight
	}
	return 1
}

func insertMessages(db *sql.DB, tableName string, contact Contact, count int, now time.Time, rng *rand.Rand, selfRowID, otherRowID int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}

	stmt, err := tx.Prepare(fmt.Sprintf(
		`INSERT INTO [%s] (local_type, real_sender_id, create_time, message_content, WCDB_CT_message_content) VALUES (?, ?, ?, ?, 0)`,
		tableName,
	))
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	// Spread messages over last 2 years with some clustering.
	baseTime := now.AddDate(-2, 0, 0).Unix()
	span := now.Unix() - baseTime

	for i := 0; i < count; i++ {
		t := baseTime + rng.Int63n(span)
		// Bias toward recent months.
		if rng.Intn(3) == 0 {
			t = now.AddDate(0, -3, 0).Unix() + rng.Int63n(int64(3*30*24*3600))
		}

		msgType := pickMsgType(rng)
		var content string
		if msgType == 1 {
			content = textMessages[rng.Intn(len(textMessages))]
		}

		// 50/50 split between self and the contact.
		var senderID int64
		if rng.Intn(2) == 0 {
			senderID = selfRowID
		} else {
			senderID = otherRowID
		}

		if _, err := stmt.Exec(msgType, senderID, t, content); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}
