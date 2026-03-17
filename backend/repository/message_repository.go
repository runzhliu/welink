package repository

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
	"welink/backend/pkg/db"
)

type MessageRepository struct {
	dbMgr    *db.DBManager
	tableMap map[string][]int // tableName -> []dbIndex
	mu       sync.RWMutex
}

func NewMessageRepository(mgr *db.DBManager) *MessageRepository {
	repo := &MessageRepository{
		dbMgr:    mgr,
		tableMap: make(map[string][]int),
	}
	repo.buildIndex()
	return repo
}

// buildIndex 启动时扫描所有库，建立“表名 -> 数据库索引”的映射
func (r *MessageRepository) buildIndex() {
	log.Println("Building message table index...")
	for idx, mdb := range r.dbMgr.MessageDBs {
		rows, err := mdb.Query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")
		if err != nil {
			continue
		}
		for rows.Next() {
			var name string
			rows.Scan(&name)
			r.mu.Lock()
			r.tableMap[name] = append(r.tableMap[name], idx)
			r.mu.Unlock()
		}
		rows.Close()
	}
	log.Printf("Index built: %d tables found.", len(r.tableMap))
}

type UserMsgStats struct {
	TotalCount int64
	FirstTime  int64
	LastTime   int64
}

func (r *MessageRepository) GetUserStats(username string) UserMsgStats {
	tableName := db.GetTableName(username)
	r.mu.RLock()
	dbIndices, ok := r.tableMap[tableName]
	r.mu.RUnlock()

	if !ok {
		return UserMsgStats{}
	}

	var stats UserMsgStats
	stats.FirstTime = 9999999999
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, idx := range dbIndices {
		wg.Add(1)
		go func(mdb *sql.DB) {
			defer wg.Done()
			query := fmt.Sprintf("SELECT COUNT(*), MIN(create_time), MAX(create_time) FROM [%s]", tableName)
			var count int64
			var minT, maxT sql.NullInt64
			err := mdb.QueryRow(query).Scan(&count, &minT, &maxT)
			if err != nil || count == 0 {
				return
			}

			mu.Lock()
			stats.TotalCount += count
			if minT.Valid && minT.Int64 < stats.FirstTime {
				stats.FirstTime = minT.Int64
			}
			if maxT.Valid && maxT.Int64 > stats.LastTime {
				stats.LastTime = maxT.Int64
			}
			mu.Unlock()
		}(r.dbMgr.MessageDBs[idx])
	}
	wg.Wait()

	if stats.FirstTime == 9999999999 {
		stats.FirstTime = 0
	}
	return stats
}
