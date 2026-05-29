// Package seed generates demo WeChat-like SQLite databases for demo/preview purposes.
// The generated data mimics the real WeChat database schema so the backend can
// serve a fully functional UI without requiring real decrypted databases.
package seed

import (
	"crypto/md5"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// playerAvatarURLs maps username to a Wikimedia direct image URL (verified 200 OK).
// These are served via the existing /api/avatar?url=... proxy on the frontend.
var playerAvatarURLs = map[string]string{
	"arteta_mikel":        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Mikel_Arteta_2021_%28cropped%29.png/250px-Mikel_Arteta_2021_%28cropped%29.png",
	"raya_david":          "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/David_Raya_in_2025_%28cropped%29.jpg/250px-David_Raya_in_2025_%28cropped%29.jpg",
	"gabriel_magalhaes":   "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/GabrielLille2019.png/250px-GabrielLille2019.png",
	"timber_jurrien":      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/JURRIEN_TIMBER.jpg/250px-JURRIEN_TIMBER.jpg",
	"calafiori_riccardo":  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/2024_Emirates_Cup_-_Riccardo_Calafiori_%282%29_%28cropped%29.jpg/250px-2024_Emirates_Cup_-_Riccardo_Calafiori_%282%29_%28cropped%29.jpg",
	"lewis_skelly_myles":  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/1_Myles_Lewis-Skelly_arsenal_2025_%28cropped%29.jpg/250px-1_Myles_Lewis-Skelly_arsenal_2025_%28cropped%29.jpg",
	"tomiyasu_takehiro":   "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Takehiro_Tomiyasu%2C_2019_AFC_Asian_Cup_1.jpg/250px-Takehiro_Tomiyasu%2C_2019_AFC_Asian_Cup_1.jpg",
	"odegaard_martin":     "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Norway_Italy_-_June_2025_E_04.jpg/250px-Norway_Italy_-_June_2025_E_04.jpg",
	"rice_declan":         "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/1_declan_rice_arsenal_2025_%28cropped%29.jpg/250px-1_declan_rice_arsenal_2025_%28cropped%29.jpg",
	"partey_thomas":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/ATL-Madrid-Lokomotiv001-Thomas_%28cropped%29.jpg/250px-ATL-Madrid-Lokomotiv001-Thomas_%28cropped%29.jpg",
	"havertz_kai":         "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/2019-06-11_Fu%C3%9Fball%2C_M%C3%A4nner%2C_L%C3%A4nderspiel%2C_Deutschland-Estland_StP_2059_LR10_by_Stepro.jpg/250px-2019-06-11_Fu%C3%9Fball%2C_M%C3%A4nner%2C_L%C3%A4nderspiel%2C_Deutschland-Estland_StP_2059_LR10_by_Stepro.jpg",
	"saka_bukayo":         "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/1_bukayo_saka_arsenal_2025_%28cropped%29.jpg/250px-1_bukayo_saka_arsenal_2025_%28cropped%29.jpg",
	"martinelli_gabriel":  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/1_Gabriel_Martinelli_arsenal_2025_%28cropped%29.jpg/250px-1_Gabriel_Martinelli_arsenal_2025_%28cropped%29.jpg",
	"trossard_leandro":    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/RC_Lens_-_Arsenal_FC_%2803-10-2023%29_26_%28cropped%29.jpg/250px-RC_Lens_-_Arsenal_FC_%2803-10-2023%29_26_%28cropped%29.jpg",
	"jesus_gabriel":       "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/20180610_FIFA_Friendly_Match_Austria_vs._Brazil_Gabriel_Jesus_850_1688.jpg/250px-20180610_FIFA_Friendly_Match_Austria_vs._Brazil_Gabriel_Jesus_850_1688.jpg",
	"nwaneri_ethan":       "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Ethan_Nwaneri.png/250px-Ethan_Nwaneri.png",
	"sterling_raheem":     "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Raheem_Sterling_2018.jpg/250px-Raheem_Sterling_2018.jpg",
	// hein_karl, white_ben, zinchenko_oleksandr, vieira_fabio, jorginho_jorge,
	// stuivenberg_albert: no reliable Wikipedia thumbnail available → SVG fallback
}

// playerAvatarURL returns a Wikimedia URL for the player, or empty string if unknown.
func playerAvatarURL(username string, displayName string, isGroup bool) string {
	if url, ok := playerAvatarURLs[username]; ok {
		return url
	}
	return demoAvatarDataURI(displayName, isGroup)
}

// demoAvatarDataURI generates a small SVG data URI with colored background + initials.
// Colors cycle through a palette derived from the contact name so they're stable.
func demoAvatarDataURI(displayName string, isGroup bool) string {
	palette := []string{
		"#EF0107", // Arsenal red
		"#DB0007",
		"#C0392B",
		"#E74C3C",
		"#9B59B6",
		"#8E44AD",
		"#2980B9",
		"#16A085",
		"#27AE60",
		"#F39C12",
		"#D35400",
	}
	groupColor := "#576b95"

	var bg string
	if isGroup {
		bg = groupColor
	} else {
		h := 0
		for _, r := range displayName {
			h = h*31 + int(r)
		}
		if h < 0 {
			h = -h
		}
		bg = palette[h%len(palette)]
	}

	// Compute initials: up to 2 chars from word boundaries
	words := strings.Fields(displayName)
	initials := ""
	for _, w := range words {
		runes := []rune(w)
		if len(initials) < 2 && len(runes) > 0 {
			initials += string(runes[0])
		}
	}
	initials = strings.ToUpper(initials)
	if initials == "" {
		initials = "?"
	}

	fontSize := 24
	if len([]rune(initials)) > 1 {
		fontSize = 20
	}

	svg := fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`+
			`<circle cx="32" cy="32" r="32" fill="%s"/>`+
			`<text x="32" y="%d" font-family="Arial,Helvetica,sans-serif" font-size="%d" font-weight="700" fill="white" text-anchor="middle">%s</text>`+
			`</svg>`,
		bg, 32+fontSize/3, fontSize, initials,
	)
	return "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
}

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

// DemoSelfWxid 暴露给主包：seed 出来的"我"用的是这个 wxid。
const DemoSelfWxid = demoSelfWxid

// DemoContacts 返回 seed 出来的联系人列表（只读快照）。主包 demo AI seed 使用。
func DemoContacts() []Contact {
	out := make([]Contact, len(demoContacts))
	copy(out, demoContacts)
	return out
}

// TableNameForUser 暴露给主包：给定 username 返回消息表名。
func TableNameForUser(username string) string {
	return tableNameForUser(username)
}

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
	// URL 消息（给"URL 收藏"功能用）
	"看这个进球回放 https://www.arsenal.com/news/match-report",
	"训练计划我贴在这了 https://www.arsenal.com/training",
	"战术分析视频 https://youtu.be/arsenal-tactics-breakdown",
	"欧冠对阵表出来了 https://www.uefa.com/uefachampionsleague/",
	"更衣室新款球衣 https://shop.arsenal.com/new-kit",
	"队内投票链接 https://forms.gle/arsenal-team-vote",
	"赛程表 https://www.premierleague.com/fixtures",
	"这篇采访值得一看 https://theathletic.com/arsenal-feature",
}

// signaturePhrases 给每个联系人分配专属高频口头禅，让"秘密暗语"（TF-IDF）跑得出结果。
// 每个 key 的短语会被高频使用（~25% 消息从这里抽），形成高 TF + 低 DF。
var signaturePhrases = map[string][]string{
	"arteta_mikel": {
		"战术板", "压迫要到位", "我要的是强度", "Process 第一", "Play with courage",
	},
	"odegaard_martin": {
		"队长负责", "稳住节奏", "Pasa y muevete", "掌控中场", "这球我负责",
	},
	"saka_bukayo": {
		"Starboy mode", "内切射门", "来打你们怕的位置", "7号到位", "Starboy 就是我",
	},
	"rice_declan": {
		"中场扫荡", "拦截预判", "我来兜底", "Hammers 教会我的", "拼到最后一秒",
	},
	"havertz_kai": {
		"9号位思考", "Kaichemy", "顶住第一点", "要更冷静", "德味传中",
	},
	"gabriel_magalhaes": {
		"Aidar 兄弟", "后防不慌", "头球是我的菜", "桑巴防线", "阿迪永远在",
	},
	"martinelli_gabriel": {
		"巴西边路", "一脚油门", "Zoom zoom", "左路爆破", "给我球",
	},
	"jesus_gabriel": {
		"Jesus walks", "前场逼抢", "恩典时刻", "神圣进球", "See you in Emirates",
	},
	"raya_david": {
		"门线指挥", "Commander mode", "后场出球交给我", "稳如磐石", "Clean sheet",
	},
	"trossard_leandro": {
		"小比利时", "替补奇兵", "关键时刻在", "Pony ready", "补丁侠",
	},
	"nwaneri_ethan": {
		"小天才报到", "学长们带我", "Nwaneri time", "第一次首发", "英超初体验",
	},
	"arsenal_dressing_room@chatroom": {
		"更衣室合影", "三点半大巴出发", "赛前 playlist 有人点歌吗",
	},
	"emirates_north_bank@chatroom": {
		"North Bank 唱起来", "今晚酋长满员", "Arsenal till I die",
	},
	"tactics_board@chatroom": {
		"4-3-3 默认阵型", "高位逼抢 trigger", "后场出球三角站位",
	},
}

// 场景化补充语料：让健康日记 / 聊天地图 / 暧昧探测在 demo 里有数据。
// 比例都压得很低（见 pickText），避免淹没正常聊天。

// 伤病 / 生病 —— 健康日记（命中 health_log 的症状/行为词）
var illnessLines = []string{
	"膝盖有点疼，明天去医院拍个片",
	"昨晚开始发烧，38 度多，在吃退烧药",
	"感冒了，嗓子疼得厉害",
	"脚踝训练时崴了，下午去急诊看看",
	"腰有点拉伤，理疗师让我先歇两天",
	"昨天做了核磁，结果还好没伤到韧带",
	"有点咳嗽，估计是更衣室空调吹的",
	"头疼了一整天，可能没睡好",
	"肠胃炎犯了，拉肚子一整晚",
	"打了封闭针，明天应该能上",
	"牙疼，约了口腔科拔智齿",
	"过敏起疹子了，在抹药",
}

// 客场 / 季前赛城市 —— 聊天地图（命中 chat_geography 的地名）
var cityLines = []string{
	"这周末去曼彻斯特客场，大巴几点出发？",
	"欧冠这轮要飞巴黎，护照带好",
	"季前赛去东京和大阪，时差有点难受",
	"下周客场马德里，圣地亚哥伯纳乌见",
	"美国行确定了：纽约、洛杉矶、旧金山三站",
	"客场利物浦，安菲尔德氛围一向猛",
	"去巴塞罗那拉练，诺坎普踢一场友谊赛",
	"慕尼黑那场冷得要死，记得多带件外套",
	"米兰客场，圣西罗草皮听说不错",
	"季前赛新加坡站，闷热到爆",
	"迪拜冬训，恢复 + 拉练两不误",
	"首尔商业赛，球迷热情得不行",
}

// 更衣室玩梗向"暧昧"banter —— 暧昧探测（只给个别人，且明显是兄弟间玩笑）
var flirtLines = []string{
	"想你了哥们😘 快回来训练",
	"抱抱[抱抱] 今天踢得真不错",
	"晚安宝贝 哈哈哈 明天见",
	"好想你快点伤愈归队🥰",
	"亲一口 庆祝进球🎉",
}

// 只有这几个人之间有玩梗 banter，别让全队都"暧昧"
var flirtContacts = map[string]bool{
	"saka_bukayo":      true,
	"trossard_leandro": true,
	"nwaneri_ethan":    true,
}

// 引用回复时的"翻牌"评论 —— 群金句榜
var quoteReplyComments = []string{
	"哈哈哈这条封神", "笑死，名场面", "+1 我也这么觉得", "经典语录 截图了",
	"这要进群相册", "说得好 顶", "🐐", "绝了 哥", "教练说得对", "保存了当壁纸",
}

// pickText 给指定联系人挑一条文本消息。
// 先按低概率注入场景语料（伤病/城市/banter），否则 25% 取签名短语，再否则取通用池。
func pickText(username string, rng *rand.Rand) string {
	roll := rng.Intn(100)
	switch {
	case roll < 4:
		return illnessLines[rng.Intn(len(illnessLines))]
	case roll < 10:
		return cityLines[rng.Intn(len(cityLines))]
	case flirtContacts[username] && roll < 18:
		return flirtLines[rng.Intn(len(flirtLines))]
	}
	if sigs, ok := signaturePhrases[username]; ok && len(sigs) > 0 && rng.Intn(4) == 0 {
		return sigs[rng.Intn(len(sigs))]
	}
	return textMessages[rng.Intn(len(textMessages))]
}

// moneyMessageContent 为 local_type=49 的消息生成红包 / 转账 / 其他 app 消息的 XML。
// classifier 识别逻辑在 service.classifyMsgType：
//   - 含 "wcpay" + "redenvelope" → 红包
//   - 含 "wcpay"（不含 redenvelope） → 转账
//   - 其他 → "其他"
func moneyMessageContent(rng *rand.Rand) string {
	r := rng.Intn(100)
	switch {
	case r < 20: // 20% 红包
		amt := 5 + rng.Intn(95)
		return fmt.Sprintf(`<msg><appmsg><type>2001</type><wcpayinfo><paysubtype>redenvelope</paysubtype><feedsprice>%d.00</feedsprice><sendertitle>恭喜发财 COYG！</sendertitle></wcpayinfo></appmsg></msg>`, amt)
	case r < 35: // 15% 转账
		amt := 20 + rng.Intn(480)
		return fmt.Sprintf(`<msg><appmsg><type>2000</type><wcpayinfo><paysubtype>transfer</paysubtype><feedsprice>%d.00</feedsprice><pay_memo>球衣分摊</pay_memo></wcpayinfo></appmsg></msg>`, amt)
	default: // 其他 app 消息占位
		return `<msg><appmsg><type>5</type><title>链接/文件</title></appmsg></msg>`
	}
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

	// Remove stale files (including WAL/SHM journals) to prevent duplicate rows
	// and SQLITE_BUSY errors on repeated starts.
	contactPath := filepath.Join(contactDir, "contact.db")
	messagePath := filepath.Join(messageDir, "message_0.db")
	for _, p := range []string{
		contactPath, contactPath + "-wal", contactPath + "-shm",
		messagePath, messagePath + "-wal", messagePath + "-shm",
	} {
		_ = os.Remove(p)
	}

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
	db, err := sql.Open("sqlite", path+"?_journal_mode=DELETE")
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

	// chatroom_member：群成员关系表。关系星图 / 群成员数 / 零发言成员都靠它。
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS chatroom_member (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		room_id INTEGER NOT NULL,
		member_id INTEGER NOT NULL
	)`)
	if err != nil {
		return err
	}

	stmt, err := db.Prepare(`INSERT INTO contact (username, nick_name, remark, flag, verify_flag, small_head_url, big_head_url) VALUES (?, ?, ?, ?, 0, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	// contactID：username → contact.id（插入顺序自增），给 chatroom_member 用
	contactID := make(map[string]int64, len(demoContacts))
	for _, c := range demoContacts {
		displayName := c.Remark
		if displayName == "" {
			displayName = c.Nickname
		}
		avatar := playerAvatarURL(c.Username, displayName, c.IsGroup)
		res, err := stmt.Exec(c.Username, c.Nickname, c.Remark, c.Flag, avatar, avatar)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		contactID[c.Username] = id
	}

	// 把群写入 chat_room，并按差异化名单灌 chatroom_member。
	// 差异化（更衣室=全员 / 战术板=教练+中前场 / 北区=锋线社交圈）让关系星图有层次。
	roomStmt, err := db.Prepare(`INSERT INTO chat_room (username, nick_name) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer roomStmt.Close()
	memStmt, err := db.Prepare(`INSERT INTO chatroom_member (room_id, member_id) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer memStmt.Close()

	for _, c := range demoContacts {
		if !c.IsGroup {
			continue
		}
		res, err := roomStmt.Exec(c.Username, c.Nickname)
		if err != nil {
			return err
		}
		roomID, _ := res.LastInsertId()
		for _, mu := range membersForGroup(c.Username) {
			mid, ok := contactID[mu]
			if !ok {
				continue
			}
			if _, err := memStmt.Exec(roomID, mid); err != nil {
				return err
			}
		}
	}
	return nil
}

func createMessageDB(path string) error {
	db, err := sql.Open("sqlite", path+"?_journal_mode=DELETE")
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

		// 群聊：发言人从成员里随机抽（含"我"），让群发言榜真实多元
		var memberRowIDs []int64
		if contact.IsGroup {
			for _, mu := range membersForGroup(contact.Username) {
				if rid, ok := contactRowID[mu]; ok {
					memberRowIDs = append(memberRowIDs, rid)
				}
			}
			memberRowIDs = append(memberRowIDs, selfRowID)
		}

		if err := insertMessages(db, tableName, contact, msgCount, now, rng, selfRowID, otherRowID, memberRowIDs); err != nil {
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

// seedMsg 是生成阶段的一条消息（插库前的中间表示）。
type seedMsg struct {
	localType int
	senderID  int64
	ts        int64
	content   string
}

// insertMessages 生成并写入某联系人/群的消息。
//
// 关键：消息按「对话簇」生成 —— 同一段对话里你来我往、秒~分钟级间隔、
// 发送方有粘性，每段有明确发起人。这样回复速度榜（6h 内一来一回）和
// 主动指数榜（谁先开口）才有真实可算的数据，微信视图按天浏览也更像真聊天。
func insertMessages(db *sql.DB, tableName string, contact Contact, count int, now time.Time, rng *rand.Rand, selfRowID, otherRowID int64, memberRowIDs []int64) error {
	baseTime := now.AddDate(-2, 0, 0).Unix()
	span := now.Unix() - baseTime

	var msgs []seedMsg
	if contact.IsGroup {
		msgs = genGroupMessages(contact, count, now, baseTime, span, rng, memberRowIDs)
	} else {
		msgs = genPrivateSessions(contact, count, now, baseTime, span, rng, selfRowID, otherRowID)
	}

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

	for _, m := range msgs {
		if _, err := stmt.Exec(m.localType, m.senderID, m.ts, m.content); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// sessionStartTime 在 2 年跨度内挑一个会话起点，1/3 概率偏向最近 3 个月。
func sessionStartTime(now time.Time, baseTime, span int64, rng *rand.Rand) int64 {
	if rng.Intn(3) == 0 {
		return now.AddDate(0, -3, 0).Unix() + rng.Int63n(int64(3*30*24*3600))
	}
	return baseTime + rng.Int63n(span)
}

// sessionContent 按消息类型取内容（文本/红包有内容，其余空）。
func sessionContent(localType int, username string, rng *rand.Rand) string {
	switch localType {
	case 1:
		return pickText(username, rng)
	case 49:
		return moneyMessageContent(rng)
	}
	return ""
}

// chatDynamics 决定一个私聊的"节奏个性"：谁更主动、双向回复多快。
type chatDynamics struct {
	myInitProb     float64 // 我开场的概率（0~1）—— 决定主动指数榜
	theirReplyTier int     // TA 回我多快：0 秒回 / 1 一般 / 2 慢
	myReplyTier    int     // 我回 TA 多快
}

// dynamicsOverride 给重点联系人手挑个性，让榜单有看头；其余用 hash 派生。
var dynamicsOverride = map[string]chatDynamics{
	"arteta_mikel":        {0.30, 1, 0}, // 教练常主动 ping 你；你秒回教练
	"odegaard_martin":     {0.50, 0, 0}, // 队长，双向都快、最对等
	"saka_bukayo":         {0.68, 0, 1}, // 你常主动找 Saka；TA 秒回你
	"rice_declan":         {0.45, 1, 1},
	"havertz_kai":         {0.40, 2, 1}, // Havertz 回得慢
	"gabriel_magalhaes":   {0.55, 1, 0},
	"martinelli_gabriel":  {0.62, 0, 1}, // 你很主动；TA 秒回
	"jesus_gabriel":       {0.50, 2, 2}, // 都慢半拍
	"raya_david":          {0.35, 0, 0},
	"trossard_leandro":    {0.58, 1, 2},
}

func dynamicsFor(username string) chatDynamics {
	if d, ok := dynamicsOverride[username]; ok {
		return d
	}
	h := 0
	for _, r := range username {
		h = h*31 + int(r)
	}
	if h < 0 {
		h = -h
	}
	return chatDynamics{
		myInitProb:     0.30 + float64(h%41)/100.0, // 0.30~0.70
		theirReplyTier: h % 3,
		myReplyTier:    (h / 7) % 3,
	}
}

// gapForTier 把回复档位翻译成秒级延迟。全部远小于 6h，保证回复速度榜计入。
func gapForTier(tier int, rng *rand.Rand) int64 {
	switch tier {
	case 0:
		return int64(8 + rng.Intn(82)) // 8~89s 秒回
	case 2:
		return int64(300 + rng.Intn(2100)) // 5~40min 慢
	default:
		return int64(60 + rng.Intn(420)) // 1~8min 一般
	}
}

// genPrivateSessions 生成私聊的对话簇。
func genPrivateSessions(contact Contact, count int, now time.Time, baseTime, span int64, rng *rand.Rand, selfRowID, otherRowID int64) []seedMsg {
	dyn := dynamicsFor(contact.Username)
	msgs := make([]seedMsg, 0, count)
	remaining := count
	for remaining > 0 {
		ct := sessionStartTime(now, baseTime, span, rng)

		// 谁先开口
		cur := otherRowID
		if rng.Float64() < dyn.myInitProb {
			cur = selfRowID
		}

		slen := 3 + rng.Intn(13) // 每段 3~15 条
		if slen > remaining {
			slen = remaining
		}
		for k := 0; k < slen; k++ {
			lt := pickMsgType(rng)
			msgs = append(msgs, seedMsg{lt, cur, ct, sessionContent(lt, contact.Username, rng)})
			if k == slen-1 {
				break
			}
			// 70% 翻转说话人（一次回复），30% 同一人追发
			if rng.Intn(10) < 7 {
				next := selfRowID
				if cur == selfRowID {
					next = otherRowID
				}
				tier := dyn.theirReplyTier // next 是 TA → TA 回我的速度
				if next == selfRowID {
					tier = dyn.myReplyTier // next 是我 → 我回 TA 的速度
				}
				ct += gapForTier(tier, rng)
				cur = next
			} else {
				ct += int64(5 + rng.Intn(40)) // 5~44s 追发
			}
		}
		remaining -= slen
	}
	return msgs
}

// genGroupMessages 生成群聊：多成员对话簇 + 末尾追加「引用回复」（喂群金句榜）。
func genGroupMessages(contact Contact, count int, now time.Time, baseTime, span int64, rng *rand.Rand, memberRowIDs []int64) []seedMsg {
	if len(memberRowIDs) == 0 {
		memberRowIDs = []int64{1}
	}
	msgs := make([]seedMsg, 0, count+32)

	remaining := count
	for remaining > 0 {
		ct := sessionStartTime(now, baseTime, span, rng)
		slen := 4 + rng.Intn(14)
		if slen > remaining {
			slen = remaining
		}
		for k := 0; k < slen; k++ {
			sender := memberRowIDs[rng.Intn(len(memberRowIDs))]
			lt := pickMsgType(rng)
			msgs = append(msgs, seedMsg{lt, sender, ct, sessionContent(lt, contact.Username, rng)})
			if k == slen-1 {
				break
			}
			ct += int64(20 + rng.Intn(280)) // 20s~5min
		}
		remaining -= slen
	}

	// 引用回复：每条"名场面"被多人翻牌，金句榜按 svrid 聚合需 ≥2 次
	if iconics, ok := groupIconicQuotes[contact.Username]; ok {
		base := groupSvridBase(contact.Username)
		for qi, q := range iconics {
			svrid := base + int64(qi)
			origTs := now.AddDate(0, 0, -7).Unix() - rng.Int63n(int64(173*24*3600)) // 7~180 天前
			nrep := 3 + rng.Intn(5)                                                 // 3~7 次翻牌
			for r := 0; r < nrep; r++ {
				replier := memberRowIDs[rng.Intn(len(memberRowIDs))]
				replyText := quoteReplyComments[rng.Intn(len(quoteReplyComments))]
				ts := origTs + 60 + rng.Int63n(int64(5*24*3600))
				content := buildRefermsg(replyText, svrid, q.speaker, q.name, q.content, origTs)
				msgs = append(msgs, seedMsg{49, replier, ts, content})
			}
		}
	}

	return msgs
}

// buildRefermsg 拼一条「引用回复」消息的 XML（被 service.golden_quotes 解析）。
// 外层是回复正文，<refermsg> 里是被引用的原文（type=1 文本才算金句）。
func buildRefermsg(replyText string, svrid int64, chatusr, displayName, origContent string, origTs int64) string {
	return fmt.Sprintf(
		`<msg><appmsg><type>57</type><title>%s</title><refermsg><type>1</type><svrid>%d</svrid><fromusr>%s</fromusr><chatusr>%s</chatusr><displayname>%s</displayname><content>%s</content><createtime>%d</createtime></refermsg></appmsg></msg>`,
		replyText, svrid, chatusr, chatusr, displayName, origContent, origTs,
	)
}

// groupIconicQuotes 每个群的"名场面"原文（会被多次引用，进金句榜）。
var groupIconicQuotes = map[string][]struct {
	speaker string // 原话者 wxid（用于头像/姓名映射）
	name    string // 原话者显示名
	content string // 原文
}{
	"arsenal_dressing_room@chatroom": {
		{"saka_bukayo", "Bukayo Saka", "赢了！！！冠军我们的"},
		{"rice_declan", "Declan Rice", "拼到最后一秒，干就完了"},
		{"odegaard_martin", "Martin Ødegaard", "更衣室氛围我来 hold，你们专心踢"},
		{"havertz_kai", "Kai Havertz", "今天头球又顶进一个，感觉回来了"},
		{"gabriel_magalhaes", "Gabriel Magalhães", "后防交给我，一个都过不去"},
	},
	"emirates_north_bank@chatroom": {
		{"martinelli_gabriel", "Gabriel Martinelli", "左路爆破，给我球！"},
		{"saka_bukayo", "Bukayo Saka", "Starboy mode ON，准备起飞"},
		{"jesus_gabriel", "Gabriel Jesus", "酋长球场今晚一定炸裂"},
		{"nwaneri_ethan", "Ethan Nwaneri", "小天才报到，学长们带我"},
	},
	"tactics_board@chatroom": {
		{"arteta_mikel", "Mikel Arteta", "Process 第一，Play with courage"},
		{"arteta_mikel", "Mikel Arteta", "高位逼抢 trigger 抓早一点，看回放"},
		{"odegaard_martin", "Martin Ødegaard", "4-3-3 默认阵型，中场三角站好"},
		{"rice_declan", "Declan Rice", "我来兜底，你们前面放手压"},
	},
}

// groupSvridBase 给每个群一个不冲突的 svrid 起点，避免跨群撞号。
func groupSvridBase(group string) int64 {
	h := int64(0)
	for _, r := range group {
		h = h*131 + int64(r)
	}
	if h < 0 {
		h = -h
	}
	return 5_000_000 + (h%900)*1000
}

// tacticsMembers 战术板群成员：教练 + 队长 + 中前场核心
var tacticsMembers = []string{
	"arteta_mikel", "stuivenberg_albert", "odegaard_martin", "rice_declan",
	"partey_thomas", "havertz_kai", "vieira_fabio", "jorginho_jorge", "saka_bukayo",
}

// northBankMembers 北区社交圈：锋线 + 部分后防
var northBankMembers = []string{
	"saka_bukayo", "martinelli_gabriel", "trossard_leandro", "jesus_gabriel",
	"nwaneri_ethan", "gabriel_magalhaes", "white_ben", "sterling_raheem", "odegaard_martin",
}

// membersForGroup 返回某群的成员 username 列表。更衣室=全体球员。
func membersForGroup(group string) []string {
	switch group {
	case "tactics_board@chatroom":
		return tacticsMembers
	case "emirates_north_bank@chatroom":
		return northBankMembers
	default: // arsenal_dressing_room@chatroom 及其它：全体球员
		out := make([]string, 0, len(demoContacts))
		for _, c := range demoContacts {
			if !c.IsGroup {
				out = append(out, c.Username)
			}
		}
		return out
	}
}
