package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// pragmaReadOnlyAllow 是只读 PRAGMA 子命令的白名单。
// 写入类的 PRAGMA（journal_mode / synchronous / writable_schema / foreign_keys 等）
// 会改变连接的持久状态——连接来自 *sql.DB 连接池，会影响其他业务的写入与完整性，
// 所以必须挡住，只放行查询 schema / 诊断信息这种纯读的。
var pragmaReadOnlyAllow = map[string]bool{
	"TABLE_INFO":        true,
	"TABLE_XINFO":       true,
	"INDEX_INFO":        true,
	"INDEX_XINFO":       true,
	"INDEX_LIST":        true,
	"FOREIGN_KEY_LIST":  true,
	"DATABASE_LIST":     true,
	"COLLATION_LIST":    true,
	"FUNCTION_LIST":     true,
	"MODULE_LIST":       true,
	"COMPILE_OPTIONS":   true,
	"ENCODING":          true,
	"PAGE_SIZE":         true,
	"PAGE_COUNT":        true,
	"FREELIST_COUNT":    true,
	"USER_VERSION":      true,
	"APPLICATION_ID":    true,
	"SCHEMA_VERSION":    true,
	"INTEGRITY_CHECK":   true,
	"QUICK_CHECK":       true,
	"CACHE_SIZE":        true, // 读取，不是写入
}

// validateReadOnlySQL 检查单条 SQL 语句是否只读。允许 SELECT / EXPLAIN，以及
// 白名单内的只读 PRAGMA 查询。写入类 PRAGMA、ATTACH、DROP 等一律拒绝。
func validateReadOnlySQL(trimmed string) error {
	upper := strings.ToUpper(trimmed)
	switch {
	case strings.HasPrefix(upper, "SELECT"), strings.HasPrefix(upper, "EXPLAIN"), strings.HasPrefix(upper, "WITH"):
		return nil
	case strings.HasPrefix(upper, "PRAGMA"):
		// 提取子命令名（去掉 "PRAGMA "，取第一个 word）
		rest := strings.TrimSpace(upper[len("PRAGMA"):])
		// 可能带 schema 前缀：PRAGMA main.table_info(...)
		if dot := strings.Index(rest, "."); dot > 0 && dot < 30 && !strings.ContainsAny(rest[:dot], " (=") {
			rest = rest[dot+1:]
		}
		// 子命令名 = 到第一个非字母数字下划线为止
		end := len(rest)
		for i, r := range rest {
			if !(r == '_' || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
				end = i
				break
			}
		}
		name := rest[:end]
		// 禁止 "PRAGMA foo = value" 这种写入形式，哪怕 foo 本身在白名单里
		tail := strings.TrimSpace(rest[end:])
		if strings.HasPrefix(tail, "=") {
			return fmt.Errorf("禁止写入类 PRAGMA：%s", name)
		}
		if pragmaReadOnlyAllow[name] {
			return nil
		}
		return fmt.Errorf("PRAGMA %s 不在只读白名单内", name)
	default:
		return fmt.Errorf("只允许执行 SELECT / EXPLAIN / 白名单 PRAGMA 语句")
	}
}

type DBManager struct {
	ContactDB  *sql.DB
	MessageDBs []*sql.DB
	dataDir    string
	// ExtraDBs 是额外注册的数据库（如 AI 分析库），key 为文件名，value 为路径
	ExtraDBs map[string]string
}

// RegisterExtraDB 注册一个额外的数据库（如 ai_analysis.db）到管理器，使其可被 SQL 编辑器访问。
func (mgr *DBManager) RegisterExtraDB(name, path string) {
	if mgr.ExtraDBs == nil {
		mgr.ExtraDBs = make(map[string]string)
	}
	mgr.ExtraDBs[name] = path
}

type DBInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	Type string `json:"type"` // "contact", "message", or "ai"
}

// TableInfo 表信息
type TableInfo struct {
	Name    string `json:"name"`
	RowCount int64  `json:"row_count"`
}

// ColumnInfo 列信息
type ColumnInfo struct {
	CID          int    `json:"cid"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	NotNull      bool   `json:"not_null"`
	DefaultValue string `json:"default_value"`
	PrimaryKey   bool   `json:"primary_key"`
}

// TableData 表数据（带列定义）
type TableData struct {
	Columns []string        `json:"columns"`
	Rows    [][]interface{} `json:"rows"`
	Total   int64           `json:"total"`
}

// getDBByName 根据数据库名获取对应的 sql.DB 连接
func (mgr *DBManager) getDBByName(dbName string) *sql.DB {
	if dbName == "contact.db" {
		return mgr.ContactDB
	}
	// ExtraDBs（如 ai_analysis.db）
	if path, ok := mgr.ExtraDBs[dbName]; ok {
		if _, err := os.Stat(path); err == nil {
			db, err := sql.Open("sqlite", path)
			if err == nil {
				return db
			}
		}
	}
	// 在消息数据库列表中查找（通过路径匹配文件名）
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "../decrypted"
	}
	for _, mdb := range mgr.MessageDBs {
		// 通过查询 PRAGMA database_list 获取文件路径
		rows, err := mdb.Query("PRAGMA database_list")
		if err != nil {
			continue
		}
		for rows.Next() {
			var seq int
			var name, file string
			if err := rows.Scan(&seq, &name, &file); err != nil {
				continue
			}
			if filepath.Base(file) == dbName {
				rows.Close()
				return mdb
			}
		}
		rows.Close()
	}
	// fallback: 直接打开文件（防止路径遍历：只允许文件名，不含路径分隔符）
	if strings.ContainsAny(dbName, "/\\") || strings.Contains(dbName, "..") {
		return nil
	}
	msgDir := filepath.Join(dataDir, "message")
	dbPath := filepath.Clean(filepath.Join(msgDir, dbName))
	if !strings.HasPrefix(dbPath, filepath.Clean(msgDir)+string(filepath.Separator)) {
		return nil
	}
	if _, err := os.Stat(dbPath); err == nil {
		db, err := sql.Open("sqlite", dbPath)
		if err == nil {
			return db
		}
	}
	return nil
}

// GetTables 获取指定数据库的所有表
func (mgr *DBManager) GetTables(dbName string) ([]TableInfo, error) {
	db := mgr.getDBByName(dbName)
	if db == nil {
		return nil, fmt.Errorf("database %s not found", dbName)
	}

	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name); err != nil {
			continue
		}
		// 获取行数（跳过错误）
		_ = db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM [%s]", t.Name)).Scan(&t.RowCount)
		tables = append(tables, t)
	}
	return tables, nil
}

// GetTableSchema 获取表结构
func (mgr *DBManager) GetTableSchema(dbName, tableName string) ([]ColumnInfo, error) {
	db := mgr.getDBByName(dbName)
	if db == nil {
		return nil, fmt.Errorf("database %s not found", dbName)
	}

	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info([%s])", tableName))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var defaultVal sql.NullString
		if err := rows.Scan(&c.CID, &c.Name, &c.Type, &c.NotNull, &defaultVal, &c.PrimaryKey); err != nil {
			continue
		}
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		cols = append(cols, c)
	}
	return cols, nil
}

// GetTableData 获取表数据（分页）
func (mgr *DBManager) GetTableData(dbName, tableName string, offset, limit int) (*TableData, error) {
	db := mgr.getDBByName(dbName)
	if db == nil {
		return nil, fmt.Errorf("database %s not found", dbName)
	}

	// 获取总行数
	var total int64
	_ = db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM [%s]", tableName)).Scan(&total)

	// 获取列信息
	colRows, err := db.Query(fmt.Sprintf("PRAGMA table_info([%s])", tableName))
	if err != nil {
		return nil, err
	}
	var columns []string
	for colRows.Next() {
		var cid int
		var name, typ string
		var notNull bool
		var defVal sql.NullString
		var pk bool
		if err := colRows.Scan(&cid, &name, &typ, &notNull, &defVal, &pk); err != nil {
			continue
		}
		columns = append(columns, name)
	}
	colRows.Close()

	// 查询数据
	query := fmt.Sprintf("SELECT * FROM [%s] LIMIT %d OFFSET %d", tableName, limit, offset)
	dataRows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer dataRows.Close()

	var result [][]interface{}
	for dataRows.Next() {
		vals := make([]interface{}, len(columns))
		ptrs := make([]interface{}, len(columns))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := dataRows.Scan(ptrs...); err != nil {
			continue
		}
		row := make([]interface{}, len(columns))
		for i, v := range vals {
			switch val := v.(type) {
			case []byte:
				// 尝试 UTF-8 解码，否则显示十六进制
				s := string(val)
				valid := true
				for _, r := range s {
					if r == '\uFFFD' {
						valid = false
						break
					}
				}
				if valid && len(val) < 1024 {
					row[i] = s
				} else {
					row[i] = fmt.Sprintf("<binary %d bytes>", len(val))
				}
			default:
				row[i] = val
			}
		}
		result = append(result, row)
	}

	if columns == nil {
		columns = []string{}
	}
	if result == nil {
		result = [][]interface{}{}
	}
	return &TableData{
		Columns: columns,
		Rows:    result,
		Total:   total,
	}, nil
}

// QueryResult SQL 查询结果
type QueryResult struct {
	Columns []string        `json:"columns"`
	Rows    [][]interface{} `json:"rows"`
	Error   string          `json:"error,omitempty"`
}

// GetSchemaContext 生成所有数据库的 schema 摘要文本，用于喂给 LLM。
// 只取核心表（跳过 Chat_xxx 消息表，因为太多且结构相同），返回一段人类可读的描述。
func (mgr *DBManager) GetSchemaContext() string {
	var sb strings.Builder
	sb.WriteString("WeChat 数据库 schema 如下（SQLite）。共有 contact.db / message_N.db / ai_analysis.db 三类。\n\n")

	// contact.db
	sb.WriteString("【contact.db】联系人表。\n")
	if cols, err := mgr.GetTableSchema("contact.db", "contact"); err == nil {
		sb.WriteString("  contact(")
		for i, c := range cols {
			if i > 0 { sb.WriteString(", ") }
			sb.WriteString(c.Name + " " + c.Type)
		}
		sb.WriteString(")\n")
	}
	// chatroom_member
	if cols, err := mgr.GetTableSchema("contact.db", "chatroom_member"); err == nil && len(cols) > 0 {
		sb.WriteString("  chatroom_member(")
		for i, c := range cols {
			if i > 0 { sb.WriteString(", ") }
			sb.WriteString(c.Name)
		}
		sb.WriteString(")\n")
	}
	sb.WriteString("\n")

	// message_0.db（代表所有 message DB）
	sb.WriteString("【message_N.db】消息数据库（可能有多个，结构相同）。\n")
	sb.WriteString("  Name2Id(rowid INTEGER PK, user_name TEXT) — wxid 到 rowid 的映射\n")
	sb.WriteString("  Chat_<md5>(create_time INTEGER, local_type INTEGER, message_content BLOB,\n")
	sb.WriteString("    WCDB_CT_message_content INTEGER, real_sender_id INTEGER)\n")
	sb.WriteString("  — 每个联系人/群的消息存在独立的 Chat_<md5(username)> 表\n")
	sb.WriteString("  — local_type: 1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 49=应用消息\n")
	sb.WriteString("  — create_time 是 Unix 时间戳（秒）\n")
	sb.WriteString("  — real_sender_id 对应 Name2Id.rowid\n\n")

	// ai_analysis.db
	sb.WriteString("【ai_analysis.db】AI 分析数据。\n")
	for _, tbl := range []string{"ai_conversations", "skill_records", "mem_facts"} {
		cols, err := mgr.GetTableSchema("ai_analysis.db", tbl)
		if err != nil || len(cols) == 0 { continue }
		sb.WriteString("  " + tbl + "(")
		for i, c := range cols {
			if i > 0 { sb.WriteString(", ") }
			sb.WriteString(c.Name + " " + c.Type)
		}
		sb.WriteString(")\n")
	}
	sb.WriteString("\n")
	sb.WriteString("注意：每次查询只能指定一个数据库，不能跨库 JOIN。\n")
	return sb.String()
}

// ExecQuery 在指定数据库执行只读 SQL（只允许 SELECT）
func (mgr *DBManager) ExecQuery(dbName, sql string) *QueryResult {
	db := mgr.getDBByName(dbName)
	if db == nil {
		return &QueryResult{Error: "数据库不存在"}
	}

	trimmed := strings.TrimSpace(sql)
	if err := validateReadOnlySQL(trimmed); err != nil {
		return &QueryResult{Error: err.Error()}
	}

	rows, err := db.Query(trimmed)
	if err != nil {
		return &QueryResult{Error: err.Error()}
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return &QueryResult{Error: err.Error()}
	}

	var result [][]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		row := make([]interface{}, len(cols))
		for i, v := range vals {
			switch val := v.(type) {
			case []byte:
				s := string(val)
				valid := true
				for _, r := range s {
					if r == '\uFFFD' {
						valid = false
						break
					}
				}
				if valid && len(val) < 1024 {
					row[i] = s
				} else {
					row[i] = fmt.Sprintf("<binary %d bytes>", len(val))
				}
			default:
				row[i] = val
			}
		}
		result = append(result, row)
		if len(result) >= 500 {
			break
		}
	}

	return &QueryResult{Columns: cols, Rows: result}
}

// ExecQueryOnDB 在给定的 *sql.DB 连接上执行只读 SQL。
// 用于跨库联系人消息查询时直接操作已找到的 message DB 连接。
func ExecQueryOnDB(conn *sql.DB, sqlStr string) *QueryResult {
	trimmed := strings.TrimSpace(sqlStr)
	if err := validateReadOnlySQL(trimmed); err != nil {
		return &QueryResult{Error: err.Error()}
	}
	rows, err := conn.Query(trimmed)
	if err != nil {
		return &QueryResult{Error: err.Error()}
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return &QueryResult{Error: err.Error()}
	}
	var result [][]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals { ptrs[i] = &vals[i] }
		if err := rows.Scan(ptrs...); err != nil { continue }
		row := make([]interface{}, len(cols))
		for i, v := range vals {
			switch val := v.(type) {
			case []byte:
				s := string(val)
				if len(val) < 1024 { row[i] = s } else { row[i] = fmt.Sprintf("<binary %d bytes>", len(val)) }
			default:
				row[i] = val
			}
		}
		result = append(result, row)
		if len(result) >= 500 { break }
	}
	if result == nil { result = [][]interface{}{} }
	return &QueryResult{Columns: cols, Rows: result}
}

func (mgr *DBManager) GetDBInfos() []DBInfo {
	var infos []DBInfo

	// 联系人库
	if mgr.ContactDB != nil {
		path := filepath.Join(mgr.dataDir, "contact/contact.db")
		var size int64
		if fi, err := os.Stat(path); err == nil {
			size = fi.Size()
		}
		infos = append(infos, DBInfo{
			Name: "contact.db",
			Path: path,
			Size: size,
			Type: "contact",
		})
	}

	// 消息库
	msgDir := filepath.Join(mgr.dataDir, "message")
	files, _ := os.ReadDir(msgDir)
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".db") {
			var size int64
			if fi, err := f.Info(); err == nil {
				size = fi.Size()
			}
			infos = append(infos, DBInfo{
				Name: f.Name(),
				Path: filepath.Join(msgDir, f.Name()),
				Size: size,
				Type: "message",
			})
		}
	}

	// ExtraDBs（如 ai_analysis.db）
	for name, path := range mgr.ExtraDBs {
		var size int64
		if fi, err := os.Stat(path); err == nil {
			size = fi.Size()
		} else {
			continue // 文件不存在则不展示
		}
		infos = append(infos, DBInfo{
			Name: name,
			Path: path,
			Size: size,
			Type: "ai",
		})
	}

	return infos
}

// Close 关闭所有数据库连接。
func (mgr *DBManager) Close() {
	if mgr.ContactDB != nil {
		mgr.ContactDB.Close()
	}
	for _, mdb := range mgr.MessageDBs {
		mdb.Close()
	}
}

func NewDBManager(dataDir string) (*DBManager, error) {
	mgr := &DBManager{dataDir: dataDir}
	log.Printf("Initializing DBManager")

	// 1. 加载联系人数据库
	contactPath := filepath.Join(dataDir, "contact/contact.db")
	if _, err := os.Stat(contactPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("contact db not found at %s", contactPath)
	}

	db, err := sql.Open("sqlite", contactPath)
	if err != nil {
		// 读写失败，尝试只读模式
		db, err = sql.Open("sqlite", contactPath+"?mode=ro&_pragma=journal_mode(OFF)")
		if err != nil {
			return nil, fmt.Errorf("failed to open contact db: %v", err)
		}
		log.Printf("Opened contact.db in read-only mode")
	}
	mgr.ContactDB = db

	// 2. 加载所有消息数据库
	msgDir := filepath.Join(dataDir, "message")
	log.Printf("Scanning message dir")
	if _, err := os.Stat(msgDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("message dir not found at %s", msgDir)
	}
	files, err := os.ReadDir(msgDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read message dir: %v", err)
	}

	for _, file := range files {
		if strings.HasPrefix(file.Name(), "message_") && strings.HasSuffix(file.Name(), ".db") &&
		   !strings.Contains(file.Name(), "fts") && !strings.Contains(file.Name(), "resource") {

			dbPath := filepath.Join(msgDir, file.Name())
			// 先尝试读写模式打开（可创建优化索引，加速后续查询）
			// _busy_timeout=5000：遇到锁时最多等 5s 再报 SQLITE_BUSY，避免瞬时冲突
			mdb, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)")
			readOnly := false
			if err != nil {
				log.Printf("Warn: failed to open %s: %v", file.Name(), err)
				continue
			}
			// 检测是否只读：尝试执行轻量写操作
			if _, testErr := mdb.Exec("CREATE TABLE IF NOT EXISTS _welink_rw_test_(x INTEGER); DROP TABLE IF EXISTS _welink_rw_test_"); testErr != nil {
				// 只读文件系统，关闭后以只读模式重新打开
				mdb.Close()
				// 使用 immutable=1 避免 SQLite 尝试创建 WAL/journal 文件
				mdb, err = sql.Open("sqlite", dbPath+"?immutable=1")
				if err != nil {
					log.Printf("Warn: failed to open %s in readonly: %v", file.Name(), err)
					continue
				}
				readOnly = true
				log.Printf("Opened %s in read-only mode (immutable)", file.Name())
			}

			// 创建性能优化索引（只读时跳过）
			if !readOnly {
				createOptimizationIndexes(mdb, file.Name())
			}

			mgr.MessageDBs = append(mgr.MessageDBs, mdb)
		}
	}

	log.Printf("DBManager initialized: 1 contact DB, %d message DBs found.", len(mgr.MessageDBs))
	return mgr, nil
}

// createOptimizationIndexes 为消息表创建性能优化索引
func createOptimizationIndexes(db *sql.DB, dbName string) {
	// 获取所有消息表名
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")
	if err != nil {
		log.Printf("Warn: failed to list tables in %s: %v", dbName, err)
		return
	}
	var tableNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			tableNames = append(tableNames, name)
		}
	}
	rows.Close() // 必须先关闭读迭代器，否则下面 CREATE INDEX 会撞上 SQLITE_BUSY

	for _, tableName := range tableNames {
		// 为高频查询字段创建索引
		// 1. create_time 索引（用于时间范围查询和排序）
		createIndexIfNotExists(db, tableName, "create_time")

		// 2. local_type 索引（用于消息类型过滤）
		createIndexIfNotExists(db, tableName, "local_type")

		// 3. 组合索引（local_type + create_time）用于词云查询优化
		createCompositeIndex(db, tableName, "local_type", "create_time")

		// 4. real_sender_id 索引（群聊成员统计、发言者过滤）
		createIndexIfNotExists(db, tableName, "real_sender_id")
	}
}

// createIndexIfNotExists 创建单字段索引（如果不存在）
func createIndexIfNotExists(db *sql.DB, tableName, columnName string) {
	indexName := fmt.Sprintf("idx_%s_%s", tableName, columnName)

	// 检查索引是否存在
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", indexName).Scan(&count)
	if err != nil || count > 0 {
		return
	}

	// 创建索引
	sql := fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON [%s](%s)", indexName, tableName, columnName)
	if _, err := db.Exec(sql); err != nil {
		log.Printf("Warn: failed to create index %s: %v", indexName, err)
	} else {
		log.Printf("Created index: %s", indexName)
	}
}

// createCompositeIndex 创建组合索引
func createCompositeIndex(db *sql.DB, tableName, col1, col2 string) {
	indexName := fmt.Sprintf("idx_%s_%s_%s", tableName, col1, col2)

	// 检查索引是否存在
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", indexName).Scan(&count)
	if err != nil || count > 0 {
		return
	}

	// 创建组合索引
	sql := fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON [%s](%s, %s)", indexName, tableName, col1, col2)
	if _, err := db.Exec(sql); err != nil {
		log.Printf("Warn: failed to create composite index %s: %v", indexName, err)
	} else {
		log.Printf("Created composite index: %s", indexName)
	}
}
