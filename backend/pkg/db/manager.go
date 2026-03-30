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

// ExecQuery 在指定数据库执行只读 SQL（只允许 SELECT）
func (mgr *DBManager) ExecQuery(dbName, sql string) *QueryResult {
	db := mgr.getDBByName(dbName)
	if db == nil {
		return &QueryResult{Error: "数据库不存在"}
	}

	// 只允许 SELECT 语句（简单前缀检查）
	trimmed := strings.TrimSpace(sql)
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT") && !strings.HasPrefix(upper, "PRAGMA") && !strings.HasPrefix(upper, "EXPLAIN") {
		return &QueryResult{Error: "只允许执行 SELECT / PRAGMA / EXPLAIN 语句"}
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
		return nil, fmt.Errorf("failed to open contact db: %v", err)
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
			mdb, err := sql.Open("sqlite", dbPath)
			if err != nil {
				log.Printf("Warn: failed to open %s: %v", file.Name(), err)
				continue
			}

			// 创建性能优化索引
			createOptimizationIndexes(mdb, file.Name())

			mgr.MessageDBs = append(mgr.MessageDBs, mdb)
		}
	}

	log.Printf("DBManager initialized: 1 contact DB, %d message DBs found.", len(mgr.MessageDBs))
	return mgr, nil
}

// createOptimizationIndexes 为消息表创建性能优化索引
func createOptimizationIndexes(db *sql.DB, dbName string) {
	// 获取所有消息表名
	tables, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")
	if err != nil {
		log.Printf("Warn: failed to list tables in %s: %v", dbName, err)
		return
	}
	defer tables.Close()

	for tables.Next() {
		var tableName string
		if err := tables.Scan(&tableName); err != nil {
			continue
		}

		// 为高频查询字段创建索引
		// 1. create_time 索引（用于时间范围查询和排序）
		createIndexIfNotExists(db, tableName, "create_time")

		// 2. local_type 索引（用于消息类型过滤）
		createIndexIfNotExists(db, tableName, "local_type")

		// 3. 组合索引（local_type + create_time）用于词云查询优化
		createCompositeIndex(db, tableName, "local_type", "create_time")
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
