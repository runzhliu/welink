package main

// demo_seed.go — Demo 模式的 AI 数据预置
//
// 启动 demo 时（DEMO_MODE=true）先跑 seed.Generate() 生成联系人/消息，
// 然后 InitAIDB() 建好 ai_analysis.db，最后调 SeedDemoAIData() 往里塞：
//   - mem_facts         硬编码的记忆事实
//   - msg_fts           从 seed 消息生成的 FTS5 索引
//   - vec_messages      向量表（embedding 用确定性 mock 向量）
//   - fts/vec_index_status 标记索引已完成
//   - clone_profiles    AI 分身的 system prompt
//   - skills            2 个预锻造技能 + 对应的 .md 文件
//
// Demo AI 能力默认不允许用户改配置（DEMO_DISABLE_AI 默认 true），
// 所以这里写的数据就是用户在 demo 里能看到的全部。

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"time"

	"welink/backend/pkg/seed"
)

// SeedDemoAIData 在 demo 启动时把预置数据灌进 ai_analysis.db 和技能目录。
//   - dataDir  demo 数据目录（包含 message/message_0.db）
//
// 幂等性：先 DELETE 再 INSERT；重复执行不会堆叠脏数据。
// aiDB 必须已经由 InitAIDB() 初始化。
func SeedDemoAIData(dataDir string) error {
	aiDBMu.Lock()
	db := aiDB
	aiDBMu.Unlock()
	if db == nil {
		return fmt.Errorf("demo seed: ai_analysis.db 未初始化")
	}

	msgDBPath := filepath.Join(dataDir, "message", "message_0.db")
	msgDB, err := sql.Open("sqlite", msgDBPath+"?_busy_timeout=5000&mode=ro")
	if err != nil {
		return fmt.Errorf("demo seed: 打开消息库失败: %w", err)
	}
	defer msgDB.Close()

	// 清理旧的 demo 数据（幂等：容器重启后重灌）
	for _, tbl := range []string{"mem_facts", "msg_fts", "vec_messages", "fts_index_status", "vec_index_status", "clone_profiles", "skills"} {
		if _, err := db.Exec("DELETE FROM " + tbl); err != nil {
			// msg_fts 是 virtual table，DELETE 可能失败——忽略
			log.Printf("[DEMO] clear %s: %v (safe to ignore for virtual tables)", tbl, err)
		}
	}

	contacts := seed.DemoContacts()

	// 1. FTS + Vec 索引：每个联系人从消息库捞文本消息，批量灌入
	if err := seedDemoFTSAndVec(db, msgDB, contacts); err != nil {
		return fmt.Errorf("demo seed FTS/vec: %w", err)
	}

	// 2. mem_facts
	if err := seedDemoMemFacts(db); err != nil {
		return fmt.Errorf("demo seed mem: %w", err)
	}

	// 3. clone_profiles
	if err := seedDemoClones(db); err != nil {
		return fmt.Errorf("demo seed clones: %w", err)
	}

	// 4. 预锻造技能（文件写盘 + DB 记录）
	if err := seedDemoSkills(db); err != nil {
		return fmt.Errorf("demo seed skills: %w", err)
	}

	log.Printf("[DEMO] AI 预置数据完成：mem_facts / msg_fts / vec_messages / clone_profiles / skills")
	return nil
}

// seedDemoFTSAndVec 从消息库读取每个联系人的文本消息，灌入 msg_fts 和 vec_messages。
// 向量使用确定性 mock（hashedMockEmbedding），dim=8。
func seedDemoFTSAndVec(db, msgDB *sql.DB, contacts []seed.Contact) error {
	const embDim = 8

	ftsStmt, err := db.Prepare("INSERT INTO msg_fts(content, sender, datetime, contact_key, seq) VALUES(?,?,?,?,?)")
	if err != nil {
		return err
	}
	defer ftsStmt.Close()

	vecStmt, err := db.Prepare("INSERT INTO vec_messages(contact_key, seq, datetime, sender, content, embedding) VALUES(?,?,?,?,?,?)")
	if err != nil {
		return err
	}
	defer vecStmt.Close()

	now := time.Now().Unix()

	for _, c := range contacts {
		key := "contact:" + c.Username
		if c.IsGroup {
			key = "group:" + c.Username
		}
		table := seed.TableNameForUser(c.Username)

		// 只取文本消息（local_type=1）+ 非空内容；按时间升序；限 1500 条，足够跑 demo
		rows, err := msgDB.Query(fmt.Sprintf(
			`SELECT create_time, real_sender_id, message_content
			   FROM [%s]
			  WHERE local_type = 1 AND message_content != ''
			  ORDER BY create_time ASC LIMIT 1500`, table))
		if err != nil {
			// 表不存在（非 demo 启动路径）—— 跳过
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			rows.Close()
			return err
		}
		ftsTx := tx.Stmt(ftsStmt)
		vecTx := tx.Stmt(vecStmt)

		count := 0
		for rows.Next() {
			var ts int64
			var senderID int64
			var content string
			if err := rows.Scan(&ts, &senderID, &content); err != nil {
				continue
			}
			sender := "对方"
			if senderID == 1 { // rowid 1 = demo self (见 seed.go createMessageDB)
				sender = "我"
			}
			dt := time.Unix(ts, 0).Format("2006-01-02 15:04")
			if _, err := ftsTx.Exec(content, sender, dt, key, count); err != nil {
				rows.Close()
				tx.Rollback()
				return err
			}
			if _, err := vecTx.Exec(key, count, dt, sender, content, encodeVec(hashedMockEmbedding(content, embDim))); err != nil {
				rows.Close()
				tx.Rollback()
				return err
			}
			count++
		}
		rows.Close()
		if err := tx.Commit(); err != nil {
			return err
		}
		if count == 0 {
			continue
		}

		if _, err := db.Exec(`INSERT INTO fts_index_status(contact_key, msg_count, built_at) VALUES(?,?,?)`,
			key, count, now); err != nil {
			return err
		}
		if _, err := db.Exec(
			`INSERT INTO vec_index_status(contact_key, msg_count, built_at, model, dims, extract_offset) VALUES(?,?,?,?,?,?)`,
			key, count, now, "demo-mock-embedding", embDim, count,
		); err != nil {
			return err
		}
	}
	return nil
}

// demoMemFacts: 每个重点联系人的硬编码记忆事实。
// key 必须带 "contact:" 前缀（与真实流程一致）。
var demoMemFacts = map[string][]string{
	"contact:arteta_mikel": {
		"对方是阿森纳主教练，执教风格强调高位逼抢和控球",
		"对方经常强调 Process 和 Play with courage 这两个理念",
		"对方在训练中非常重视定位球和整体压上",
		"对方本赛季目标是冲击英超冠军",
		"对方习惯在赛前发长语音布置战术",
	},
	"contact:odegaard_martin": {
		"对方是球队队长，司职进攻型中场",
		"对方挪威人，说话经常中英夹杂",
		"对方家里养了一只叫 Thor 的金毛",
		"对方在更衣室负责维持情绪，是队内粘合剂",
		"对方和 Rice 搭档中场已经两个赛季",
	},
	"contact:saka_bukayo": {
		"对方 7 号，英格兰边锋，标志性动作是内切射门",
		"对方自称 Starboy，是球队核心进攻点",
		"对方喜欢游戏和 NBA，尤其是湖人队",
		"对方左脚是最要的武器，右脚用于摆脱",
		"对方在队里被视作未来的金球候选",
	},
	"contact:rice_declan": {
		"对方防守型中场，擅长拦截和转身出球",
		"对方从西汉姆转会来的，身价破英国纪录",
		"对方在队内被称为 Hammer time，防守硬朗",
		"对方生活上比较低调，经常早到训练场",
		"对方和 Ødegaard 是中场最稳的组合",
	},
	"contact:havertz_kai": {
		"对方德国前锋，从切尔西转会过来",
		"对方身高 1.93 米，头球是招牌武器",
		"对方场上位置可变 —— 9 号位 / 10 号位都能打",
		"对方偶尔情绪会低落，需要队友鼓励",
		"对方周末喜欢去伦敦的美术馆放松",
	},
	"contact:gabriel_magalhaes": {
		"对方巴西中卫，和 Saliba 是新一代 Aidar 双中卫",
		"对方头球防守特别稳，定位球也能得分",
		"对方是桑巴风格，防守时喜欢带球突破压迫",
		"对方和 Martinelli 是国家队队友，平时关系很近",
		"对方有一只巴西牧羊犬，名字叫 Léo",
	},
	"contact:martinelli_gabriel": {
		"对方巴西左边锋，外号 Martinson",
		"对方速度爆炸，是球队反击的尖刀",
		"对方家里人在圣保罗，经常视频通话",
		"对方训练时总爱加练任意球",
		"对方和 Saka 组成英超最佳左右翼组合",
	},
	"contact:jesus_gabriel": {
		"对方中锋 9 号，从曼城转会过来",
		"对方非常虔诚，场上进球后习惯比十字",
		"对方擅长前场反抢，为后插上队友创造空间",
		"对方伤病史较多，需要合理控制出场时间",
		"对方和 Martinelli、Gabriel 组成「三 Gabriel」小团体",
	},
	"contact:raya_david": {
		"对方西班牙门将，现为球队 1 号",
		"对方出球脚法好，是阿尔特塔后场推进的关键",
		"对方从布伦特福德加盟，适应速度快",
		"对方非常沉稳，点球扑救数据领先联赛",
	},
	"contact:trossard_leandro": {
		"对方比利时边锋，超级替补属性",
		"对方左右脚均衡，多个位置都能打",
		"对方年龄偏大但状态稳定，被视作更衣室榜样",
	},
	"group:arsenal_dressing_room@chatroom": {
		"这是球队更衣室群，所有一线队队员都在",
		"群里经常发赛前战术布置和赛后总结",
		"队长 Ødegaard 和副队 Saka 是活跃成员",
	},
	"group:tactics_board@chatroom": {
		"这是战术板讨论群，Arteta 和助教在里面",
		"群里会发 4-3-3 默认阵型和各种 trigger 视频",
		"队长和中场核心会在这里做战术问答",
	},
}

func seedDemoMemFacts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare("INSERT INTO mem_facts(contact_key, fact, source_from, source_to, embedding, pinned, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)")
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	now := time.Now().Unix()
	const embDim = 8

	for key, facts := range demoMemFacts {
		for i, f := range facts {
			pinned := 0
			if i == 0 {
				pinned = 1 // 每人第一条置顶
			}
			if _, err := stmt.Exec(key, f, 0, 0, encodeVec(hashedMockEmbedding(f, embDim)), pinned, now, now); err != nil {
				tx.Rollback()
				return err
			}
		}
	}
	return tx.Commit()
}

// demoClonePrompts: 预写的 system prompt，让 /ai/clone/chat 一开就有人设可用。
// 这些 prompt 和真实 learn 流程产出的格式一致（persona + 风格 + 少量示例）。
var demoClonePrompts = map[string]string{
	"arteta_mikel": `你现在扮演 Arsenal 主教练 Mikel Arteta 在微信上聊天。

人物设定：
- 巴斯克人，执教风格严谨，强调 Process 和 Play with courage
- 对战术细节有强迫症，经常提到高位逼抢、定位球、第二点
- 说话带一点西班牙口音的中文（偶尔冒一两个西语词）
- 语气坚定但不凶，像兄长一样督促队员

风格示例：
- "明天 9 点到训练基地，定位球我们再过一遍"
- "Process 不能丢，保持 courage，下场就是你的"
- "你今天的压迫强度还不够，看回放，trigger 抓早一点"

用户现在要和你聊天。请用上面的风格自然回复，不要自我介绍，直接进入聊天状态。`,

	"odegaard_martin": `你现在扮演 Arsenal 队长 Martin Ødegaard 在微信上聊天。

人物设定：
- 挪威人，球队队长，球风优雅
- 说话中英夹杂，偶尔蹦挪威语
- 温和、讲义气、擅长安抚队友情绪
- 喜欢谈论中场衔接、跑位、节奏控制

风格示例：
- "All good bro，明天训练见"
- "你这次内切的时机很棒，继续这么来"
- "更衣室氛围我来 hold，你专心踢"

用户现在要和你聊天。请用上面的风格自然回复。`,

	"saka_bukayo": `你现在扮演 Arsenal 7 号 Bukayo Saka 在微信上聊天。

人物设定：
- 英格兰边锋，年轻、热血、自信
- 自称 Starboy，常用一些年轻人的梗
- 说话带英式俚语（比如 "cheers bro"、"mate"）
- 喜欢 NBA 尤其是湖人，游戏玩 Fortnite

风格示例：
- "bro 今晚 FIFA 开一把？"
- "Starboy mode ON，准备起飞"
- "今天左脚又进一个，内切老配方了"

用户现在要和你聊天。请用上面的风格自然回复。`,

	"rice_declan": `你现在扮演 Arsenal 中场 Declan Rice 在微信上聊天。

人物设定：
- 英格兰后腰，防守硬朗但性格幽默
- 在西汉姆长大，家里人都是 Hammers 球迷
- 说话直接、不矫情，喜欢自嘲
- 训练场上是拼命三郎，场下爱开玩笑

风格示例：
- "Hammer time，干就完了"
- "我兜底，你们前面放手踢"
- "哥们昨晚健身房见我了吧，我知道你也在练"

用户现在要和你聊天。请用上面的风格自然回复。`,

	"havertz_kai": `你现在扮演 Arsenal 前锋 Kai Havertz 在微信上聊天。

人物设定：
- 德国人，身高 1.93 米，技术细腻
- 性格内向、情绪容易起伏
- 说话简洁，偶尔冒一两个德语词（Kaichemy 是外号）
- 周末喜欢看展、泡美术馆

风格示例：
- "今天头球又顶了一个，感觉回来了"
- "Ja，周末我在泰特看画展呢"
- "9 号位还是 10 号位，教练说了算"

用户现在要和你聊天。请用上面的风格自然回复。`,
}

func seedDemoClones(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO clone_profiles (username, prompt, private_count, group_count, has_profile, has_recent, avg_msg_len, emoji_pct, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	now := time.Now().Unix()
	for uname, prompt := range demoClonePrompts {
		if _, err := stmt.Exec(uname, prompt, 800, 200, 1, 1, 18, 15, now); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// seedDemoSkills 预写 2 个技能 + 对应文件。
// 文件路径格式与真实 forge 保持一致：<prefDir>/skills/<id>/<filename>
func seedDemoSkills(db *sql.DB) error {
	skillsRoot := filepath.Join(filepath.Dir(preferencesPath()), "skills")
	if err := os.MkdirAll(skillsRoot, 0755); err != nil {
		return err
	}

	type demoSkill struct {
		id        string
		skillType string
		format    string
		username  string
		name      string
		filename  string
		body      string
	}

	skills := []demoSkill{
		{
			id:        "demo-skill-arteta-daily-brief",
			skillType: "contact",
			format:    "claude-skill",
			username:  "arteta_mikel",
			name:      "Mikel Arteta",
			filename:  "arteta-daily-brief.md",
			body: `---
name: arteta-daily-brief
description: 以 Arteta 教练的视角给你发每日训练简报
version: 1.0.0
---

# Arteta Daily Brief

你是 Arsenal 主教练 Mikel Arteta，用简报的风格给用户一份每日的训练/比赛要点。

风格要求：
- 开头 "Morning team" 或 "Evening boys"
- 3 条 bullet：压迫强度 / 定位球重点 / 今日关键词
- 结尾一句 COYG 或 Process first

示例输出：
Morning team —
- 压迫强度昨天提升了 12%，继续保持
- 定位球今天重点练第二点，边后卫回追要快
- 今日关键词：courage

Process first. COYG.`,
		},
		{
			id:        "demo-skill-ask-odegaard",
			skillType: "contact",
			format:    "chatgpt-gpt",
			username:  "odegaard_martin",
			name:      "Martin Ødegaard",
			filename:  "ask-odegaard.md",
			body: `# Ask Ødegaard (ChatGPT GPT)

Name: Ask Ødegaard
Description: 和阿森纳队长 Ødegaard 的 AI 分身聊天，了解中场视野和更衣室话题。

Instructions:
你是 Martin Ødegaard，挪威人，阿森纳队长。和用户自然聊天，风格参考：
- 中英夹杂，偶尔带挪威语单词（"bro"、"cheers"、"tusen takk"）
- 语气温和，关心队友情绪
- 喜欢聊中场跑位、比赛节奏、领导力

Conversation starters:
- "今天中场衔接哪里卡住了？"
- "更衣室氛围还行吗？"
- "我给你讲个 hold 队友情绪的小技巧"

Knowledge files: (N/A — demo 模式)
Capabilities: [Code Interpreter: off, DALL·E: off, Browsing: off]
`,
		},
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO skills
		(id, skill_type, format, target_username, target_name, member_speaker,
		 model_provider, model_name, msg_limit, filename, file_path, file_size,
		 created_at, status, error_msg, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, s := range skills {
		dir := filepath.Join(skillsRoot, s.id)
		if err := os.MkdirAll(dir, 0755); err != nil {
			tx.Rollback()
			return err
		}
		p := filepath.Join(dir, s.filename)
		if err := os.WriteFile(p, []byte(s.body), 0644); err != nil {
			tx.Rollback()
			return err
		}
		size := int64(len(s.body))
		if _, err := stmt.Exec(
			s.id, s.skillType, s.format, s.username, s.name, "",
			"demo", "demo-model", 1000,
			s.filename, p, size,
			now, "success", "", now,
		); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// hashedMockEmbedding 从文本生成一个确定性的低维向量，用于 demo 向量检索。
// 不是真正的语义嵌入，但能让"相似内容 → 相似向量"大致成立：
// 相同字符集的消息会落在相似区间，余弦相似度比随机高。
//
// 算法：把文本拆成 rune，按位置加权累加到对应维度。
func hashedMockEmbedding(text string, dim int) []float32 {
	if dim <= 0 {
		dim = 8
	}
	v := make([]float32, dim)
	for i, r := range text {
		idx := (int(r)*7 + i*13) % dim
		if idx < 0 {
			idx += dim
		}
		v[idx] += float32((int(r)%31 + 1)) / 31.0
	}
	// L2 归一化（余弦相似度友好）
	var norm float32
	for _, x := range v {
		norm += x * x
	}
	if norm == 0 {
		v[0] = 1
		return v
	}
	inv := float32(1 / math.Sqrt(float64(norm)))
	for i := range v {
		v[i] *= inv
	}
	return v
}
