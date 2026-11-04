package service

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSFTCursorUsesStableServerIdentityAndVerifiedRole(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	query := `SELECT 1,9001,1700000000,1,'我的回复',0,11`
	firstRows, e := db.Query(query)
	if e != nil {
		t.Fatal(e)
	}
	defer firstRows.Close()
	first := &sftCursor{rows: firstRows, contact: 10, self: 11, index: 0}
	if !first.next("alice") {
		t.Fatal("no message")
	}
	firstRows.Close()
	secondRows, e := db.Query(query)
	if e != nil {
		t.Fatal(e)
	}
	defer secondRows.Close()
	second := &sftCursor{rows: secondRows, contact: 20, self: 11, index: 5}
	if !second.next("alice") {
		t.Fatal("no message")
	}
	if first.msg.ID != second.msg.ID {
		t.Fatal("same server message acquired two identities across shards")
	}
	if !first.msg.Mine || !first.msg.Known || !first.msg.Text {
		t.Fatal("self role was not verified")
	}
	secondRows.Close()
	unknownRows, e := db.Query(`SELECT 2,0,1700000001,1,'不能判断角色',0,99`)
	if e != nil {
		t.Fatal(e)
	}
	defer unknownRows.Close()
	unknown := &sftCursor{rows: unknownRows, contact: 10, self: 11}
	unknown.next("alice")
	if unknown.msg.Known {
		t.Fatal("unknown sender was labeled as my reply")
	}
}
