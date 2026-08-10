package main

// scheduled_tasks.go — 定时任务（主动总结 / 挖掘）
//
// 用户写一条指令 + 选目标会话 + 选周期，系统就定时跑一次：
// 拉取这段时间的聊天记录 → 按任务类型拼 prompt → CompleteLLM → 结果存进收件箱。
//
// 生命周期约束：本地 app，后端只在 app 开着时跑。所以：
//   - 一个每分钟扫一遍的 ticker goroutine 检查到期任务（next_run_at <= now）
//   - "错过的任务"（关 app 期间到期）= next_run_at 已过 → 下次开 app 第一波 tick 补跑一次
//   - 补跑后 next_run_at 从「现在」重算，绝不堆积多次
//
// 串行执行，避免同时打爆 LLM。Demo 模式下 CompleteLLM 走 mock，无真实费用。

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	taskMaxTranscriptChars = 48000 // 单次喂给 LLM 的聊天记录字符上限（控 token）
	taskMaxLookbackDays    = 30    // 首次/超长窗口的回看上限
	taskFeedDefaultLimit   = 50    // 收件箱默认拉多少条
)

// ── 表 ────────────────────────────────────────────────────────────────────────

func initScheduledTaskTables() error {
	if _, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		name          TEXT    NOT NULL,
		task_type     TEXT    NOT NULL,          -- summary | todo | watch | mood | custom
		prompt        TEXT    NOT NULL DEFAULT '',-- 用户指令 / 关注内容
		target_kind   TEXT    NOT NULL,          -- contact | group | all_private | all_group
		target_id     TEXT    NOT NULL DEFAULT '',-- 会话 wxid（all_* 时为空）
		target_name   TEXT    NOT NULL DEFAULT '',-- 展示名快照
		schedule_kind TEXT    NOT NULL,          -- daily | weekly | interval
		time_of_day   TEXT    NOT NULL DEFAULT '09:00', -- HH:MM（daily/weekly）
		weekday       INTEGER NOT NULL DEFAULT 1, -- 0=周日…6=周六（weekly）
		interval_hours INTEGER NOT NULL DEFAULT 24,-- interval 模式
		enabled       INTEGER NOT NULL DEFAULT 1,
		last_run_at   INTEGER NOT NULL DEFAULT 0,
		next_run_at   INTEGER NOT NULL DEFAULT 0,
		created_at    INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("scheduled_tasks: create table: %w", err)
	}
	if _, err := aiDB.Exec(`CREATE TABLE IF NOT EXISTS task_runs (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		task_id     INTEGER NOT NULL,
		status      TEXT    NOT NULL,        -- success | error | skipped
		result      TEXT    NOT NULL DEFAULT '',
		error       TEXT    NOT NULL DEFAULT '',
		msg_count   INTEGER NOT NULL DEFAULT 0,
		window_from INTEGER NOT NULL DEFAULT 0,
		window_to   INTEGER NOT NULL DEFAULT 0,
		read        INTEGER NOT NULL DEFAULT 0,
		created_at  INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("task_runs: create table: %w", err)
	}
	aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, created_at DESC)`)
	// 收件箱按时间全局倒序，给个全局索引
	aiDB.Exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_created ON task_runs(created_at DESC)`)
	return nil
}

// ── 数据结构 ──────────────────────────────────────────────────────────────────

type ScheduledTask struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	TaskType      string `json:"task_type"`
	Prompt        string `json:"prompt"`
	TargetKind    string `json:"target_kind"`
	TargetID      string `json:"target_id"`
	TargetName    string `json:"target_name"`
	ScheduleKind  string `json:"schedule_kind"`
	TimeOfDay     string `json:"time_of_day"`
	Weekday       int    `json:"weekday"`
	IntervalHours int    `json:"interval_hours"`
	Enabled       bool   `json:"enabled"`
	LastRunAt     int64  `json:"last_run_at"`
	NextRunAt     int64  `json:"next_run_at"`
	CreatedAt     int64  `json:"created_at"`

	// 附带：最近一次运行（列表里展示用）
	LastRun *TaskRun `json:"last_run,omitempty"`
}

type TaskRun struct {
	ID         int64  `json:"id"`
	TaskID     int64  `json:"task_id"`
	TaskName   string `json:"task_name,omitempty"` // feed 里 join 出来
	Status     string `json:"status"`
	Result     string `json:"result"`
	Error      string `json:"error"`
	MsgCount   int    `json:"msg_count"`
	WindowFrom int64  `json:"window_from"`
	WindowTo   int64  `json:"window_to"`
	Read       bool   `json:"read"`
	CreatedAt  int64  `json:"created_at"`
}

var validTaskTypes = map[string]bool{"summary": true, "todo": true, "watch": true, "mood": true, "custom": true}
var validTargetKinds = map[string]bool{"contact": true, "group": true, "all_private": true, "all_group": true}
var validScheduleKinds = map[string]bool{"daily": true, "weekly": true, "interval": true}

// ── 调度时间计算 ──────────────────────────────────────────────────────────────

// computeNextRun 从 from 之后算出下一次执行的 Unix 时间（本地时区）。
func computeNextRun(t *ScheduledTask, from time.Time) int64 {
	switch t.ScheduleKind {
	case "interval":
		h := t.IntervalHours
		if h < 1 {
			h = 1
		}
		return from.Add(time.Duration(h) * time.Hour).Unix()

	case "weekly":
		hh, mm := parseHHMM(t.TimeOfDay)
		cand := time.Date(from.Year(), from.Month(), from.Day(), hh, mm, 0, 0, time.Local)
		for i := 0; i < 8; i++ {
			if int(cand.Weekday()) == t.Weekday && cand.After(from) {
				return cand.Unix()
			}
			cand = cand.AddDate(0, 0, 1)
		}
		return cand.Unix()

	default: // daily
		hh, mm := parseHHMM(t.TimeOfDay)
		cand := time.Date(from.Year(), from.Month(), from.Day(), hh, mm, 0, 0, time.Local)
		if !cand.After(from) {
			cand = cand.AddDate(0, 0, 1)
		}
		return cand.Unix()
	}
}

func parseHHMM(s string) (int, int) {
	parts := strings.SplitN(strings.TrimSpace(s), ":", 2)
	hh, mm := 9, 0
	if len(parts) == 2 {
		if v, err := strconv.Atoi(parts[0]); err == nil && v >= 0 && v < 24 {
			hh = v
		}
		if v, err := strconv.Atoi(parts[1]); err == nil && v >= 0 && v < 60 {
			mm = v
		}
	}
	return hh, mm
}

// ── 持久化 ────────────────────────────────────────────────────────────────────

func taskFromRow(scan func(dest ...any) error) (*ScheduledTask, error) {
	var t ScheduledTask
	var enabled int
	err := scan(&t.ID, &t.Name, &t.TaskType, &t.Prompt, &t.TargetKind, &t.TargetID, &t.TargetName,
		&t.ScheduleKind, &t.TimeOfDay, &t.Weekday, &t.IntervalHours, &enabled,
		&t.LastRunAt, &t.NextRunAt, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	t.Enabled = enabled != 0
	return &t, nil
}

const taskSelectCols = `id,name,task_type,prompt,target_kind,target_id,target_name,
	schedule_kind,time_of_day,weekday,interval_hours,enabled,last_run_at,next_run_at,created_at`

func listTasks() ([]*ScheduledTask, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	rows, err := aiDB.Query(`SELECT ` + taskSelectCols + ` FROM scheduled_tasks ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ScheduledTask
	for rows.Next() {
		t, err := taskFromRow(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func getTask(id int64) (*ScheduledTask, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	row := aiDB.QueryRow(`SELECT `+taskSelectCols+` FROM scheduled_tasks WHERE id = ?`, id)
	t, err := taskFromRow(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

func insertTask(t *ScheduledTask) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("db not initialized")
	}
	res, err := aiDB.Exec(`INSERT INTO scheduled_tasks
		(name,task_type,prompt,target_kind,target_id,target_name,schedule_kind,time_of_day,weekday,interval_hours,enabled,last_run_at,next_run_at,created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.Name, t.TaskType, t.Prompt, t.TargetKind, t.TargetID, t.TargetName,
		t.ScheduleKind, t.TimeOfDay, t.Weekday, t.IntervalHours, boolToInt(t.Enabled),
		t.LastRunAt, t.NextRunAt, t.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func updateTaskRow(t *ScheduledTask) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE scheduled_tasks SET
		name=?,task_type=?,prompt=?,target_kind=?,target_id=?,target_name=?,
		schedule_kind=?,time_of_day=?,weekday=?,interval_hours=?,enabled=?,next_run_at=? WHERE id=?`,
		t.Name, t.TaskType, t.Prompt, t.TargetKind, t.TargetID, t.TargetName,
		t.ScheduleKind, t.TimeOfDay, t.Weekday, t.IntervalHours, boolToInt(t.Enabled), t.NextRunAt, t.ID)
	return err
}

func setTaskRunStamps(id, lastRun, nextRun int64) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return
	}
	aiDB.Exec(`UPDATE scheduled_tasks SET last_run_at=?, next_run_at=? WHERE id=?`, lastRun, nextRun, id)
}

func deleteTaskRow(id int64) error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("db not initialized")
	}
	aiDB.Exec(`DELETE FROM task_runs WHERE task_id=?`, id)
	_, err := aiDB.Exec(`DELETE FROM scheduled_tasks WHERE id=?`, id)
	return err
}

func saveTaskRun(r *TaskRun) (int64, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return 0, fmt.Errorf("db not initialized")
	}
	res, err := aiDB.Exec(`INSERT INTO task_runs
		(task_id,status,result,error,msg_count,window_from,window_to,read,created_at)
		VALUES (?,?,?,?,?,?,?,0,?)`,
		r.TaskID, r.Status, r.Result, r.Error, r.MsgCount, r.WindowFrom, r.WindowTo, r.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func listTaskRuns(taskID int64, limit int) ([]*TaskRun, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	rows, err := aiDB.Query(`SELECT id,task_id,status,result,error,msg_count,window_from,window_to,read,created_at
		FROM task_runs WHERE task_id=? ORDER BY created_at DESC LIMIT ?`, taskID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRuns(rows)
}

func latestRun(taskID int64) *TaskRun {
	runs, err := listTaskRuns(taskID, 1)
	if err != nil || len(runs) == 0 {
		return nil
	}
	return runs[0]
}

// taskFeed 返回最近的运行结果（跨任务，join 任务名）+ 未读数。
func taskFeed(limit int) ([]*TaskRun, int, error) {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return nil, 0, fmt.Errorf("db not initialized")
	}
	rows, err := aiDB.Query(`SELECT r.id,r.task_id,t.name,r.status,r.result,r.error,r.msg_count,r.window_from,r.window_to,r.read,r.created_at
		FROM task_runs r JOIN scheduled_tasks t ON t.id=r.task_id
		ORDER BY r.created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []*TaskRun
	for rows.Next() {
		var r TaskRun
		var read int
		if err := rows.Scan(&r.ID, &r.TaskID, &r.TaskName, &r.Status, &r.Result, &r.Error,
			&r.MsgCount, &r.WindowFrom, &r.WindowTo, &read, &r.CreatedAt); err != nil {
			return nil, 0, err
		}
		r.Read = read != 0
		out = append(out, &r)
	}
	var unread int
	aiDB.QueryRow(`SELECT COUNT(*) FROM task_runs WHERE read=0 AND status='success'`).Scan(&unread)
	return out, unread, nil
}

func markFeedRead() error {
	aiDBMu.Lock()
	defer aiDBMu.Unlock()
	if aiDB == nil {
		return fmt.Errorf("db not initialized")
	}
	_, err := aiDB.Exec(`UPDATE task_runs SET read=1 WHERE read=0`)
	return err
}

func scanRuns(rows *sql.Rows) ([]*TaskRun, error) {
	var out []*TaskRun
	for rows.Next() {
		var r TaskRun
		var read int
		if err := rows.Scan(&r.ID, &r.TaskID, &r.Status, &r.Result, &r.Error,
			&r.MsgCount, &r.WindowFrom, &r.WindowTo, &read, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Read = read != 0
		out = append(out, &r)
	}
	return out, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ── 调度器 ────────────────────────────────────────────────────────────────────

var (
	schedulerOnce       sync.Once
	schedulerAcquireSvc func() (*service.ContactService, func())
	taskRunMu           sync.Mutex // 串行执行，避免并发打 LLM
)

// StartTaskScheduler 启动后台调度 goroutine（每分钟一 tick）。幂等。
func StartTaskScheduler(acquireSvc func() (*service.ContactService, func())) {
	schedulerOnce.Do(func() {
		schedulerAcquireSvc = acquireSvc
		go func() {
			// 启动后稍等服务就绪，再做一次"补跑"扫描
			time.Sleep(20 * time.Second)
			runDueTasks()
			ticker := time.NewTicker(60 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				runDueTasks()
			}
		}()
	})
}

func runDueTasks() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[tasks] scheduler panic: %v", r)
		}
	}()
	tasks, err := listTasks()
	if err != nil {
		return
	}
	now := time.Now().Unix()
	for _, t := range tasks {
		if !t.Enabled || t.NextRunAt == 0 || t.NextRunAt > now {
			continue
		}
		runTaskAndRecord(t, false)
	}
}

// runTaskAndRecord 执行一个任务，存结果，并推进 next_run_at（调度器用，阻塞拿锁）。
// manual=true 时是用户手动"立即执行"，不改调度时间（只更新 last_run）。
func runTaskAndRecord(t *ScheduledTask, manual bool) *TaskRun {
	taskRunMu.Lock()
	defer taskRunMu.Unlock()
	return recordTaskRunLocked(t, manual, nil)
}

// recordTaskRunLocked 假定调用方已持有 taskRunMu。
func recordTaskRunLocked(t *ScheduledTask, manual bool, svc *service.ContactService) *TaskRun {
	run := executeTask(t, svc)
	run.CreatedAt = time.Now().Unix()
	if id, err := saveTaskRun(run); err == nil {
		run.ID = id
	}

	now := time.Now()
	next := t.NextRunAt
	if !manual {
		next = computeNextRun(t, now)
	}
	setTaskRunStamps(t.ID, now.Unix(), next)
	t.LastRunAt = now.Unix()
	t.NextRunAt = next
	return run
}

// executeTask 真正干活：取记录 → 拼 prompt → LLM → 组装 TaskRun（不落库）。
func executeTask(t *ScheduledTask, svc *service.ContactService) *TaskRun {
	run := &TaskRun{TaskID: t.ID, WindowTo: time.Now().Unix()}

	if svc == nil && schedulerAcquireSvc != nil {
		var release func()
		svc, release = schedulerAcquireSvc()
		if release != nil {
			defer release()
		}
	}
	if svc == nil {
		run.Status = "error"
		run.Error = "服务未就绪"
		return run
	}

	since := taskWindowStart(t)
	run.WindowFrom = since

	transcript, count, err := gatherTaskTranscript(svc, t, since)
	if err != nil {
		run.Status = "error"
		run.Error = err.Error()
		return run
	}
	run.MsgCount = count
	if count == 0 {
		run.Status = "skipped"
		run.Error = "这段时间没有新消息"
		return run
	}

	msgs := buildTaskPrompt(t, transcript)
	out, err := CompleteLLM(msgs, loadPreferences())
	if err != nil {
		run.Status = "error"
		run.Error = err.Error()
		return run
	}
	run.Status = "success"
	run.Result = strings.TrimSpace(out)
	return run
}

// taskWindowStart 算这次要总结的起点（Unix 秒）。
func taskWindowStart(t *ScheduledTask) int64 {
	now := time.Now()
	if t.LastRunAt > 0 {
		since := t.LastRunAt
		if min := now.AddDate(0, 0, -taskMaxLookbackDays).Unix(); since < min {
			since = min
		}
		return since
	}
	// 首次：按周期给个合理回看窗
	switch t.ScheduleKind {
	case "weekly":
		return now.AddDate(0, 0, -7).Unix()
	case "interval":
		h := t.IntervalHours
		if h < 1 {
			h = 1
		}
		return now.Add(-time.Duration(h) * time.Hour).Unix()
	default:
		return now.AddDate(0, 0, -1).Unix()
	}
}

// ── 取聊天记录 ────────────────────────────────────────────────────────────────

func gatherTaskTranscript(svc *service.ContactService, t *ScheduledTask, since int64) (string, int, error) {
	var b strings.Builder
	count := 0

	appendContact := func(name, username string) {
		if b.Len() >= taskMaxTranscriptChars {
			return
		}
		msgs := svc.ExportContactMessages(username, since, 0)
		if len(msgs) == 0 {
			return
		}
		b.WriteString(fmt.Sprintf("\n【与 %s 的私聊】\n", name))
		for _, m := range msgs {
			if b.Len() >= taskMaxTranscriptChars {
				break
			}
			who := "对方"
			if m.IsMine {
				who = "我"
			}
			b.WriteString(fmt.Sprintf("%s %s %s: %s\n", m.Date, m.Time, who, contentForTask(m.Content, m.Type)))
			count++
		}
	}

	appendGroup := func(name, username string) {
		if b.Len() >= taskMaxTranscriptChars {
			return
		}
		msgs := svc.ExportGroupMessages(username, since, 0)
		if len(msgs) == 0 {
			return
		}
		b.WriteString(fmt.Sprintf("\n【群「%s」】\n", name))
		for _, m := range msgs {
			if b.Len() >= taskMaxTranscriptChars {
				break
			}
			b.WriteString(fmt.Sprintf("%s %s %s: %s\n", m.Date, m.Time, m.Speaker, contentForTask(m.Content, m.Type)))
			count++
		}
	}

	switch t.TargetKind {
	case "contact":
		appendContact(t.TargetName, t.TargetID)
	case "group":
		appendGroup(t.TargetName, t.TargetID)
	case "all_private":
		stats := svc.GetCachedStats()
		sort.Slice(stats, func(i, j int) bool { return stats[i].LastMessageTs > stats[j].LastMessageTs })
		for _, st := range stats {
			if b.Len() >= taskMaxTranscriptChars {
				break
			}
			if st.LastMessageTs < since {
				continue
			}
			appendContact(contactDisplayName(st), st.Username)
		}
	case "all_group":
		groups := svc.GetGroups()
		sort.Slice(groups, func(i, j int) bool { return groups[i].LastMessageTs > groups[j].LastMessageTs })
		for _, g := range groups {
			if b.Len() >= taskMaxTranscriptChars {
				break
			}
			if g.LastMessageTs < since {
				continue
			}
			appendGroup(g.Name, g.Username)
		}
	default:
		return "", 0, fmt.Errorf("未知的目标类型: %s", t.TargetKind)
	}

	return b.String(), count, nil
}

func contactDisplayName(st service.ContactStatsExtended) string {
	if st.Remark != "" {
		return st.Remark
	}
	if st.Nickname != "" {
		return st.Nickname
	}
	return st.Username
}

// contentForTask 把非文本消息转成简短占位，文本截断超长。
func contentForTask(content string, lt int) string {
	if (lt & 0xFFFF) != 1 {
		switch lt & 0xFFFF {
		case 3:
			return "[图片]"
		case 34:
			return "[语音]"
		case 43:
			return "[视频]"
		case 47:
			return "[表情]"
		case 49:
			return "[链接/卡片]"
		default:
			if content == "" {
				return "[非文本消息]"
			}
		}
	}
	if r := []rune(content); len(r) > 500 {
		return string(r[:500]) + "…"
	}
	return content
}

// ── prompt 构造 ───────────────────────────────────────────────────────────────

func buildTaskPrompt(t *ScheduledTask, transcript string) []LLMMessage {
	base := "你是用户的私人微信聊天助理。基于下面提供的聊天记录完成任务。" +
		"只依据记录里真实出现的内容，不要编造、不要臆测。用简洁的中文 Markdown 输出，重点突出、可快速浏览。"

	var instruction string
	switch t.TaskType {
	case "todo":
		instruction = "请挖掘出需要用户跟进的事项：未回复的问题、答应过但还没做的事、约定的时间/地点/安排、明确的待办。" +
			"用清单列出，每条注明涉及的人和简短的原话依据。如果确实没有，就明确说「暂无待办」。"
	case "watch":
		focus := strings.TrimSpace(t.Prompt)
		if focus == "" {
			focus = "用户关注的话题"
		}
		instruction = fmt.Sprintf("请围绕用户关注的内容【%s】，从聊天记录里找出相关的消息，并归纳进展、要点和值得注意的地方。"+
			"注明出处（谁、大概什么时候说的）。如果没有相关内容，就说明没有。", focus)
	case "mood":
		instruction = "请分析这段时间对方/群里的情绪与关系氛围变化：是热络还是冷淡、有没有摩擦或惊喜、整体基调如何。给出具体依据。"
	case "custom":
		instruction = strings.TrimSpace(t.Prompt)
		if instruction == "" {
			instruction = "请总结这段时间聊天的要点。"
		}
	default: // summary
		instruction = "请总结这段时间聊天的要点：主要聊了什么、有哪些重要信息或决定、有什么值得注意的变化。"
	}

	// summary/todo/mood 允许用户补充额外要求
	if t.Prompt != "" && (t.TaskType == "summary" || t.TaskType == "todo" || t.TaskType == "mood") {
		instruction += "\n\n用户的额外要求：" + strings.TrimSpace(t.Prompt)
	}

	user := instruction + "\n\n———— 聊天记录 ————\n" + transcript

	return []LLMMessage{
		{Role: "system", Content: base},
		{Role: "user", Content: user},
	}
}

// ── 路由 ──────────────────────────────────────────────────────────────────────

func registerScheduledTaskRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	// 列表（带最近一次运行）
	prot.GET("/tasks", func(c *gin.Context) {
		tasks, err := listTasks()
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		for _, t := range tasks {
			t.LastRun = latestRun(t.ID)
		}
		c.JSON(http.StatusOK, gin.H{"tasks": tasks})
	})

	// 创建
	prot.POST("/tasks", func(c *gin.Context) {
		var t ScheduledTask
		if err := c.ShouldBindJSON(&t); err != nil {
			c.JSON(400, gin.H{"error": "参数错误"})
			return
		}
		if err := normalizeTask(&t); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		t.CreatedAt = time.Now().Unix()
		t.LastRunAt = 0
		t.NextRunAt = computeNextRun(&t, time.Now())
		id, err := insertTask(&t)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		t.ID = id
		c.JSON(http.StatusOK, t)
	})

	// 更新
	prot.PUT("/tasks/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		existing, err := getTask(id)
		if err != nil || existing == nil {
			c.JSON(404, gin.H{"error": "任务不存在"})
			return
		}
		var t ScheduledTask
		if err := c.ShouldBindJSON(&t); err != nil {
			c.JSON(400, gin.H{"error": "参数错误"})
			return
		}
		if err := normalizeTask(&t); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		t.ID = id
		t.CreatedAt = existing.CreatedAt
		t.LastRunAt = existing.LastRunAt
		// 调度相关变了就重算 next
		t.NextRunAt = computeNextRun(&t, time.Now())
		if err := updateTaskRow(&t); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, t)
	})

	// 删除
	prot.DELETE("/tasks/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		if err := deleteTaskRow(id); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// 立即执行一次（同步，返回结果）
	prot.POST("/tasks/:id/run-now", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		t, err := getTask(id)
		if err != nil || t == nil {
			c.JSON(404, gin.H{"error": "任务不存在"})
			return
		}
		// 不阻塞：若后台调度器或另一次手动执行正在跑，直接告知忙，避免请求挂死
		if !taskRunMu.TryLock() {
			c.JSON(http.StatusConflict, gin.H{"error": "有任务正在执行中，请稍后再试"})
			return
		}
		run := recordTaskRunLocked(t, true, getSvc())
		taskRunMu.Unlock()
		c.JSON(http.StatusOK, run)
	})

	// 某任务的运行历史
	prot.GET("/tasks/:id/runs", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		limit := 30
		if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
			limit = v
		}
		runs, err := listTaskRuns(id, limit)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"runs": runs})
	})

	// 收件箱：跨任务最近结果 + 未读数
	prot.GET("/tasks/feed", func(c *gin.Context) {
		limit := taskFeedDefaultLimit
		if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
			limit = v
		}
		runs, unread, err := taskFeed(limit)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"runs": runs, "unread": unread})
	})

	// 全部标记已读
	prot.POST("/tasks/feed/read", func(c *gin.Context) {
		if err := markFeedRead(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

// normalizeTask 校验 + 补默认值。
func normalizeTask(t *ScheduledTask) error {
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		return fmt.Errorf("任务名不能为空")
	}
	if !validTaskTypes[t.TaskType] {
		return fmt.Errorf("无效的任务类型")
	}
	if !validTargetKinds[t.TargetKind] {
		return fmt.Errorf("无效的目标类型")
	}
	if (t.TargetKind == "contact" || t.TargetKind == "group") && strings.TrimSpace(t.TargetID) == "" {
		return fmt.Errorf("请选择目标会话")
	}
	if !validScheduleKinds[t.ScheduleKind] {
		return fmt.Errorf("无效的调度周期")
	}
	if t.TaskType == "custom" && strings.TrimSpace(t.Prompt) == "" {
		return fmt.Errorf("自定义任务需要填写指令")
	}
	if t.TaskType == "watch" && strings.TrimSpace(t.Prompt) == "" {
		return fmt.Errorf("关键词盯梢需要填写关注内容")
	}
	if t.TimeOfDay == "" {
		t.TimeOfDay = "09:00"
	}
	if t.Weekday < 0 || t.Weekday > 6 {
		t.Weekday = 1
	}
	if t.IntervalHours < 1 {
		t.IntervalHours = 24
	}
	return nil
}
