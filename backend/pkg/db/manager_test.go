package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestDatabaseBrowserQuotesIdentifiersAndDefersCounts(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "contact.db")
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Exec(`CREATE TABLE "odd""name" (id INTEGER PRIMARY KEY, value TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`INSERT INTO "odd""name" (value) VALUES ('ok')`); err != nil {
		t.Fatal(err)
	}

	mgr := &DBManager{ContactDB: conn, dataDir: filepath.Dir(dbPath)}
	tables, err := mgr.GetTables("contact.db")
	if err != nil {
		t.Fatal(err)
	}
	if len(tables) != 1 || tables[0].Name != `odd"name` {
		t.Fatalf("unexpected tables: %#v", tables)
	}
	if tables[0].RowCount != nil {
		t.Fatalf("table list should defer COUNT(*), got %v", *tables[0].RowCount)
	}

	schema, err := mgr.GetTableSchema("contact.db", `odd"name`)
	if err != nil || len(schema) != 2 {
		t.Fatalf("unexpected schema: %#v, err=%v", schema, err)
	}
	data, err := mgr.GetTableData("contact.db", `odd"name`, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if data.Total != 1 || len(data.Rows) != 1 {
		t.Fatalf("unexpected data: %#v", data)
	}
}

func TestExtraDatabaseReleaseClosesTemporaryPool(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ai.db")
	seed, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := seed.Exec(`CREATE TABLE sample (id INTEGER)`); err != nil {
		t.Fatal(err)
	}
	seed.Close()

	mgr := &DBManager{ExtraDBs: map[string]string{"ai.db": dbPath}}
	conn, release := mgr.getDBByName("ai.db")
	if conn == nil {
		t.Fatal("expected extra database connection")
	}
	release()
	if err := conn.Ping(); err == nil {
		t.Fatal("temporary extra database pool remained open after release")
	}
}
