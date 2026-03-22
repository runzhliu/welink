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

// Arsenal 2025/26 first-team squad & coaching staff — COYG! 🔴⚪
var demoContacts = []Contact{
	// Coaching Staff
	{Username: "arteta_mikel",        Nickname: "Mikel Arteta",        Remark: "主教练",   Flag: 3},
	{Username: "stuivenberg_albert",  Nickname: "Albert Stuivenberg",  Remark: "助理教练", Flag: 3},
	// Goalkeepers
	{Username: "raya_david",          Nickname: "David Raya",          Remark: "1号",      Flag: 3},
	{Username: "hein_karl",           Nickname: "Karl Hein",           Remark: "",         Flag: 3},
	// Defenders
	{Username: "white_ben",           Nickname: "Ben White",           Remark: "",         Flag: 3},
	{Username: "gabriel_magalhaes",   Nickname: "Gabriel Magalhães",   Remark: "阿迪",     Flag: 3},
	{Username: "timber_jurrien",      Nickname: "Jurriën Timber",      Remark: "",         Flag: 3},
	{Username: "calafiori_riccardo",  Nickname: "Riccardo Calafiori",  Remark: "",         Flag: 3},
	{Username: "zinchenko_oleksandr", Nickname: "Oleksandr Zinchenko", Remark: "锌锌",     Flag: 3},
	{Username: "lewis_skelly_myles",  Nickname: "Myles Lewis-Skelly",  Remark: "MLS",      Flag: 3},
	{Username: "tomiyasu_takehiro",   Nickname: "Takehiro Tomiyasu",   Remark: "冨安健洋", Flag: 3},
	// Midfielders
	{Username: "odegaard_martin",     Nickname: "Martin Ødegaard",     Remark: "队长",     Flag: 3},
	{Username: "rice_declan",         Nickname: "Declan Rice",         Remark: "大米",     Flag: 3},
	{Username: "partey_thomas",       Nickname: "Thomas Partey",       Remark: "",         Flag: 3},
	{Username: "havertz_kai",         Nickname: "Kai Havertz",         Remark: "",         Flag: 3},
	{Username: "vieira_fabio",        Nickname: "Fábio Vieira",        Remark: "",         Flag: 3},
	{Username: "jorginho_jorge",      Nickname: "Jorginho",            Remark: "",         Flag: 3},
	// Forwards
	{Username: "saka_bukayo",         Nickname: "Bukayo Saka",         Remark: "7号",      Flag: 3},
	{Username: "martinelli_gabriel",  Nickname: "Gabriel Martinelli",  Remark: "马丁内利", Flag: 3},
	{Username: "trossard_leandro",    Nickname: "Leandro Trossard",    Remark: "",         Flag: 3},
	{Username: "jesus_gabriel",       Nickname: "Gabriel Jesus",       Remark: "耶稣",     Flag: 3},
	{Username: "nwaneri_ethan",       Nickname: "Ethan Nwaneri",       Remark: "小天才",   Flag: 3},
	{Username: "sterling_raheem",     Nickname: "Raheem Sterling",     Remark: "",         Flag: 3},
	// Groups
	{Username: "arsenal_dressing_room@chatroom", Nickname: "更衣室",         Remark: "", Flag: 0, IsGroup: true},
	{Username: "emirates_north_bank@chatroom",   Nickname: "北伦敦红区",     Remark: "", Flag: 0, IsGroup: true},
	{Username: "tactics_board@chatroom",         Nickname: "战术板",         Remark: "", Flag: 0, IsGroup: true},
}

// demoSelfWxid is the fake "me" wxid used in demo messages.
const demoSelfWxid = "demo_self_wxid"

var textMessages = []string{
	// 日常
	"在吗？",
	"明天训练几点开始？",
	"收到，知道了",
	"嗯嗯",
	"好的",
	"没问题",
	"稍等一下",
	"辛苦了",
	"哈哈哈哈",
	"加油！",
	"生日快乐！",
	"马上到",
	"已经到更衣室了",
	"热身做好了吗？",
	"伤势恢复得怎么样了？",
	"今晚吃什么？",
	// 足球 & 训练
	"COYG！",
	"北伦敦是红色的！",
	"We Are Arsenal！",
	"今天的传跑配合真的很顺",
	"那个进球太绝了！！",
	"压迫打得不错，继续保持",
	"下半场要提速，前场逼抢",
	"定位球练得怎么样了？",
	"点球又进了！",
	"裁判眼睛看清楚！",
	"越位？我明明在线上",
	"今晚欧冠，全力以赴",
	"酋长球场今晚一定炸裂",
	"赢了！！！冠军我们的",
	"这赛季联赛冠军一定是我们的",
	"战术板上Arteta说得很清楚",
	"防线要整体压上，别拉得太开",
	"左路打出去！",
	"打穿他们！",
	"角球机会，全员压上",
	"补时进球，疯了！！",
	"上午战术课，下午恢复训练",
	"昨晚没睡好，腿有点沉",
	"赛后冰浴真的很爽",
	"新赛季目标：三冠王",
	"不败赛季我们可以的",
	"Invincibles 2.0 加油",
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

	log.Printf("[DEMO] Demo databases created")
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
		return 300 + rng.Intn(900)
	}
	switch c.Username {
	case "odegaard_martin": // 队长，联系最多
		return 1500 + rng.Intn(500)
	case "saka_bukayo": // 7号核心
		return 1200 + rng.Intn(400)
	case "arteta_mikel": // 主教练
		return 900 + rng.Intn(300)
	case "rice_declan", "havertz_kai":
		return 700 + rng.Intn(300)
	case "gabriel_magalhaes", "martinelli_gabriel":
		return 600 + rng.Intn(300)
	default:
		return 60 + rng.Intn(400)
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
