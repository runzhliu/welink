package main

// daily_digest.go — 每日社交简报
//
// 每天生成一份「昨天的社交摘要」：
//   - 新消息量（总数 + 活跃联系人 Top 5）
//   - 未回复：对方最后发消息、我还没回的联系人
//   - 即将到来的纪念日（3 天内）
//
// 懒生成：首次 GET /daily-digest/today 时按日期查表，不存在才真正生成。
// 不跑 cron，避免后台 goroutine 与生命周期纠葛；反正用户访问 home 就会触发。
// 无 LLM 调用，纯统计，快且免费。

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

// ── 表 ────────────────────────────────────────────────────────────────────────

func initDailyDigestTables() error {
	_, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS daily_digests (
		date          TEXT    PRIMARY KEY,      -- "YYYY-MM-DD"（昨天的本地日期）
		summary_json  TEXT    NOT NULL,
		created_at    INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("daily_digest: create table: %w", err)
	}
	return nil
}

// ── 数据结构 ──────────────────────────────────────────────────────────────────

type DigestActiveContact struct {
	Username     string `json:"username"`
	Name         string `json:"name"`
	Avatar       string `json:"avatar,omitempty"`
	MessageCount int64  `json:"message_count"` // 昨天这个联系人的消息数（仅对方 + 我 合计）
}

// 沉睡的老朋友：过去聊得多（消息 ≥ 500 条）但最近一次互动已是 30 天前
type DigestSleepingFriend struct {
	Username      string `json:"username"`
	Name          string `json:"name"`
	Avatar        string `json:"avatar,omitempty"`
	TotalMessages int64  `json:"total_messages"`
	DaysSince     int    `json:"days_since"`
	LastMessage   string `json:"last_message_time"`
}

type DigestUpcomingAnniv struct {
	Type        string `json:"type"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Date        string `json:"date"` // "MM-DD" 或 "YYYY-MM-DD"
	DaysUntil   int    `json:"days_until"`
}

type DailyDigest struct {
	Date                  string                 `json:"date"` // "YYYY-MM-DD"
	ActiveContactCount    int                    `json:"active_contact_count"`
	ActiveContacts        []DigestActiveContact  `json:"active_contacts"`
	SleepingCount         int                    `json:"sleeping_count"`
	SleepingFriends       []DigestSleepingFriend `json:"sleeping_friends"`
	UpcomingAnniversaries []DigestUpcomingAnniv  `json:"upcoming_anniversaries"`
	GeneratedAt           int64                  `json:"generated_at"`
}

// ── 持久化 ────────────────────────────────────────────────────────────────────

func getDailyDigestCached(date string) (*DailyDigest, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("daily_digest: db not initialized")
	}
	var js string
	err := aiDB.QueryRow(`SELECT summary_json FROM daily_digests WHERE date = ?`, date).Scan(&js)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var d DailyDigest
	if err := json.Unmarshal([]byte(js), &d); err != nil {
		return nil, err
	}
	return &d, nil
}

func saveDailyDigest(d *DailyDigest) error {
	js, err := json.Marshal(d)
	if err != nil {
		return err
	}
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("daily_digest: db not initialized")
	}
	_, err = aiDB.Exec(`INSERT INTO daily_digests(date, summary_json, created_at)
		VALUES(?, ?, ?)
		ON CONFLICT(date) DO UPDATE SET summary_json = excluded.summary_json, created_at = excluded.created_at`,
		d.Date, string(js), time.Now().Unix())
	return err
}

func listDailyDigests(days int) ([]DailyDigest, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("daily_digest: db not initialized")
	}
	if days <= 0 {
		days = 30
	}
	rows, err := aiDB.Query(`SELECT summary_json FROM daily_digests ORDER BY date DESC LIMIT ?`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DailyDigest{}
	for rows.Next() {
		var js string
		if rows.Scan(&js) != nil {
			continue
		}
		var d DailyDigest
		if json.Unmarshal([]byte(js), &d) == nil {
			out = append(out, d)
		}
	}
	return out, nil
}

// ── 生成 ──────────────────────────────────────────────────────────────────────

// buildDailyDigest 基于 contactSvc 的缓存统计，快速拼一份昨天的摘要。
// date 是 "YYYY-MM-DD"（昨天的本地日期）。
func buildDailyDigest(svc *service.ContactService, date string) *DailyDigest {
	d := &DailyDigest{
		Date:                  date,
		ActiveContacts:        []DigestActiveContact{},
		SleepingFriends:       []DigestSleepingFriend{},
		UpcomingAnniversaries: []DigestUpcomingAnniv{},
		GeneratedAt:           time.Now().Unix(),
	}
	if svc == nil {
		return d
	}

	// 昨天的时间区间（服务时区；用 time.Local 对齐 tz.Format 产出的 date）
	dayStart, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		return d
	}
	start := dayStart.Unix()
	end := dayStart.Add(24 * time.Hour).Unix()

	stats := svc.GetCachedStats()
	type activeEntry struct {
		username, name, avatar string
		lastTs                 int64
	}
	var activeToday []activeEntry
	var sleeping []DigestSleepingFriend
	nowTs := time.Now().Unix()
	const sleepThreshold = int64(30 * 86400) // 30 天没联系
	const sleepMinMsg = int64(500)            // 历史累计 ≥ 500 条才算"老朋友"

	for _, s := range stats {
		// 活跃：LastMessageTs 在昨天区间内
		if s.LastMessageTs >= start && s.LastMessageTs < end {
			name := nonEmptyName(s.Remark, s.Nickname, s.Username)
			activeToday = append(activeToday, activeEntry{
				username: s.Username,
				name:     name,
				avatar:   s.SmallHeadURL,
				lastTs:   s.LastMessageTs,
			})
		}
		// 沉睡的老朋友：过去聊得多但现在冷了
		if s.LastMessageTs > 0 && s.TotalMessages >= sleepMinMsg &&
			nowTs-s.LastMessageTs >= sleepThreshold {
			name := nonEmptyName(s.Remark, s.Nickname, s.Username)
			days := int((nowTs - s.LastMessageTs) / 86400)
			sleeping = append(sleeping, DigestSleepingFriend{
				Username:      s.Username,
				Name:          name,
				Avatar:        s.SmallHeadURL,
				TotalMessages: s.TotalMessages,
				DaysSince:     days,
				LastMessage:   time.Unix(s.LastMessageTs, 0).In(time.Local).Format("2006-01-02"),
			})
		}
	}

	// 活跃排序
	sort.Slice(activeToday, func(i, j int) bool { return activeToday[i].lastTs > activeToday[j].lastTs })
	d.ActiveContactCount = len(activeToday)
	for i, a := range activeToday {
		if i >= 5 {
			break
		}
		d.ActiveContacts = append(d.ActiveContacts, DigestActiveContact{
			Username: a.username, Name: a.name, Avatar: a.avatar, MessageCount: 0,
		})
	}

	// 沉睡的老朋友：按"消息多 × 沉默久"的乘积排序（找最"值得复苏"的关系）
	sort.Slice(sleeping, func(i, j int) bool {
		return sleeping[i].TotalMessages*int64(sleeping[i].DaysSince) >
			sleeping[j].TotalMessages*int64(sleeping[j].DaysSince)
	})
	d.SleepingCount = len(sleeping)
	if len(sleeping) > 5 {
		d.SleepingFriends = sleeping[:5]
	} else if len(sleeping) > 0 {
		// 注意：不能直接 d.SleepingFriends = sleeping —— 当 sleeping 为 nil
		// （没人满足条件，Demo 模式常见）时会把前面初始化的空 slice 覆盖成 nil，
		// JSON 序列化出 "null" 让前端 .length 炸
		d.SleepingFriends = sleeping
	}

	// 即将纪念日：3 天内
	events, milestones := svc.DetectAnniversaries()
	now := time.Now().In(time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	for _, e := range events {
		// e.Date 是 "MM-DD"
		mm, dd, ok := parseMMDD(e.Date)
		if !ok {
			continue
		}
		next := time.Date(today.Year(), time.Month(mm), dd, 0, 0, 0, 0, time.Local)
		if next.Before(today) {
			next = next.AddDate(1, 0, 0)
		}
		days := int(next.Sub(today).Hours() / 24)
		if days <= 3 {
			d.UpcomingAnniversaries = append(d.UpcomingAnniversaries, DigestUpcomingAnniv{
				Type:        e.Type,
				Username:    e.Username,
				DisplayName: e.DisplayName,
				Date:        e.Date,
				DaysUntil:   days,
			})
		}
	}
	for _, m := range milestones {
		if m.DaysUntil >= 0 && m.DaysUntil <= 3 {
			d.UpcomingAnniversaries = append(d.UpcomingAnniversaries, DigestUpcomingAnniv{
				Type:        "milestone",
				Username:    m.Username,
				DisplayName: fmt.Sprintf("%s · 认识 %d 天", m.DisplayName, m.NextMilestone),
				Date:        m.NextMilestoneDate,
				DaysUntil:   m.DaysUntil,
			})
		}
	}
	sort.Slice(d.UpcomingAnniversaries, func(i, j int) bool {
		return d.UpcomingAnniversaries[i].DaysUntil < d.UpcomingAnniversaries[j].DaysUntil
	})

	return d
}

func parseMMDD(s string) (mm, dd int, ok bool) {
	parts := strings.Split(s, "-")
	if len(parts) != 2 {
		return 0, 0, false
	}
	_, err := fmt.Sscanf(parts[0], "%d", &mm)
	if err != nil {
		return 0, 0, false
	}
	_, err = fmt.Sscanf(parts[1], "%d", &dd)
	if err != nil {
		return 0, 0, false
	}
	return mm, dd, true
}

func nonEmptyName(fields ...string) string {
	for _, s := range fields {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// ── 路由 ──────────────────────────────────────────────────────────────────────

func registerDailyDigestRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	// GET /daily-digest/today — 今天看昨天的摘要；懒生成
	prot.GET("/daily-digest/today", func(c *gin.Context) {
		yesterday := time.Now().In(time.Local).AddDate(0, 0, -1).Format("2006-01-02")
		if v := c.Query("date"); v != "" {
			yesterday = v
		}
		cached, _ := getDailyDigestCached(yesterday)
		if cached != nil {
			c.JSON(http.StatusOK, cached)
			return
		}
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "数据索引未就绪"})
			return
		}
		d := buildDailyDigest(svc, yesterday)
		_ = saveDailyDigest(d)
		c.JSON(http.StatusOK, d)
	})

	// GET /daily-digest/list?days=30 — 历史列表
	prot.GET("/daily-digest/list", func(c *gin.Context) {
		days := 30
		if v := c.Query("days"); v != "" {
			fmt.Sscanf(v, "%d", &days)
		}
		list, err := listDailyDigests(days)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"digests": list})
	})

	// POST /daily-digest/regen — 强制重生成（调试 / 数据变了后刷新用）
	prot.POST("/daily-digest/regen", func(c *gin.Context) {
		date := c.Query("date")
		if date == "" {
			date = time.Now().In(time.Local).AddDate(0, 0, -1).Format("2006-01-02")
		}
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "数据索引未就绪"})
			return
		}
		d := buildDailyDigest(svc, date)
		if err := saveDailyDigest(d); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, d)
	})
}
