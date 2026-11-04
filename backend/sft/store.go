package sft

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// All transitions are serialized, including file commits. SQLite remains the
// source of truth across restarts; no in-memory queue owns a training job.
type Store struct {
	db   *sql.DB
	root string
	mu   sync.Mutex
}

func ID(prefix string) string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return prefix + "_" + hex.EncodeToString(b)
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func encode(v any) []byte    { b, _ := json.Marshal(v); return b }

func Open(root string) (*Store, error) {
	if e := os.MkdirAll(root, 0700); e != nil {
		return nil, e
	}
	db, e := sql.Open("sqlite", filepath.Join(root, "sft.db"))
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, root: root}
	_, e = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS objects(id TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, project TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS objects_owner ON objects(owner,kind,project,created);
CREATE TABLE IF NOT EXISTS samples(dataset TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(dataset,id));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL, worker TEXT NOT NULL, state TEXT NOT NULL, idem TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(owner,kind,idem));
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(worker,state,created);
CREATE UNIQUE INDEX IF NOT EXISTS active_worker ON jobs(worker) WHERE worker<>'' AND state IN ('preparing','running','saving','stopping');
CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pairings(code_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(job TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(job,seq));
CREATE TABLE IF NOT EXISTS votes(evaluation TEXT NOT NULL, owner TEXT NOT NULL, sample TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(evaluation,owner,sample));`)
	if e != nil {
		db.Close()
		return nil, e
	}
	if e = os.Chmod(filepath.Join(root, "sft.db"), 0600); e != nil {
		db.Close()
		return nil, e
	}
	// A source read is local and cannot survive server shutdown. Remote processes
	// are deliberately left leased until that same worker reconciles.
	_, e = db.Exec(`UPDATE jobs SET state='failed', body=json_set(body,'$.state','failed','$.error','服务在数据构建期间重启，请重新准备数据') WHERE kind='dataset' AND state NOT IN ('succeeded','failed','canceled')`)
	if e == nil {
		_, e = db.Exec(`UPDATE objects SET body=json_set(body,'$.state','failed') WHERE kind='dataset' AND json_extract(body,'$.state')='building'`)
	}
	return s, e
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) put(owner, kind, project, id string, v any) error {
	_, e := s.db.Exec(`INSERT INTO objects VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body WHERE objects.owner=excluded.owner AND objects.kind=excluded.kind`, id, owner, kind, project, string(encode(v)), now())
	return e
}
func (s *Store) get(owner, kind, id string, v any) error {
	var b []byte
	e := s.db.QueryRow(`SELECT body FROM objects WHERE id=? AND owner=? AND kind=?`, id, owner, kind).Scan(&b)
	if e == sql.ErrNoRows {
		return ErrNotFound
	}
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func (s *Store) list(owner, kind, project string) ([]json.RawMessage, error) {
	r, e := s.db.Query(`SELECT body FROM objects WHERE owner=? AND kind=? AND (?='' OR project=?) ORDER BY created DESC,id`, owner, kind, project, project)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []json.RawMessage{}
	for r.Next() {
		var b []byte
		if e = r.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, r.Err()
}
func (s *Store) job(owner, id string) (Job, error) {
	var j Job
	var b []byte
	e := s.db.QueryRow(`SELECT body FROM jobs WHERE owner=? AND id=?`, owner, id).Scan(&b)
	if e == sql.ErrNoRows {
		return j, ErrNotFound
	}
	if e != nil {
		return j, e
	}
	e = json.Unmarshal(b, &j)
	return j, e
}
func (s *Store) saveJob(owner string, j Job) error {
	j.UpdatedAt = now()
	result, e := s.db.Exec(`UPDATE jobs SET body=?,state=? WHERE id=? AND owner=? AND json_extract(body,'$.last_seq')=? AND state NOT IN ('succeeded','failed','canceled','paused')`, string(encode(j)), j.State, j.ID, owner, j.LastSeq)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e == nil && n == 0 {
		return ErrConflict
	}
	return e
}
func (s *Store) newJob(owner, project, kind, worker, idem string, c TrainConfig, input any) (Job, error) {
	if idem == "" || len(idem) > 128 {
		return Job{}, fmt.Errorf("需要 1–128 字符的 Idempotency-Key")
	}
	var b []byte
	e := s.db.QueryRow(`SELECT body FROM jobs WHERE owner=? AND kind=? AND idem=?`, owner, kind, idem).Scan(&b)
	if e == nil {
		var old Job
		json.Unmarshal(b, &old)
		if old.ProjectID != project || old.WorkerID != worker || string(encode(old.Config)) != string(encode(c)) || string(old.Input) != string(encode(input)) {
			return Job{}, ErrConflict
		}
		return old, nil
	}
	if e != sql.ErrNoRows {
		return Job{}, e
	}
	j := Job{ID: ID("job"), ProjectID: project, Kind: kind, WorkerID: worker, State: "queued", Config: c, Input: encode(input), CreatedAt: now(), UpdatedAt: now()}
	_, e = s.db.Exec(`INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)`, j.ID, owner, project, kind, worker, j.State, idem, string(encode(j)), time.Now().UnixNano())
	return j, e
}
func (s *Store) jobsRaw(owner, project string) ([]Job, error) {
	r, e := s.db.Query(`SELECT body FROM jobs WHERE owner=? AND (?='' OR project=?) ORDER BY created DESC,id DESC`, owner, project, project)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Job{}
	for r.Next() {
		var b []byte
		var j Job
		if e = r.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &j); e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, r.Err()
}
func (s *Store) sampleList(owner, ds string) ([]Sample, error) {
	r, e := s.db.Query(`SELECT body FROM samples WHERE owner=? AND dataset=? ORDER BY id`, owner, ds)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Sample{}
	for r.Next() {
		var b []byte
		var v Sample
		if e = r.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, r.Err()
}
func (s *Store) saveSamples(owner, ds string, samples []Sample) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, v := range samples {
		if _, e = tx.Exec(`INSERT INTO samples VALUES(?,?,?,?) ON CONFLICT(dataset,id) DO UPDATE SET body=excluded.body WHERE samples.owner=excluded.owner`, ds, owner, v.ID, string(encode(v))); e != nil {
			return e
		}
	}
	return tx.Commit()
}

// Draft content and its optimistic revision commit together. A server crash
// cannot leave new reviews behind an old revision number.
func (s *Store) commitDataset(owner string, d Dataset, samples []Sample) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, v := range samples {
		if _, e = tx.Exec(`INSERT INTO samples VALUES(?,?,?,?) ON CONFLICT(dataset,id) DO UPDATE SET body=excluded.body WHERE samples.owner=excluded.owner`, d.ID, owner, v.ID, string(encode(v))); e != nil {
			return e
		}
	}
	_, e = tx.Exec(`INSERT INTO objects VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body WHERE objects.owner=excluded.owner`, d.ID, owner, "dataset", d.ProjectID, string(encode(d)), now())
	if e != nil {
		return e
	}
	return tx.Commit()
}

// Files are addressed by server-generated IDs, never client paths.
func (s *Store) file(owner, dataset, split string) string {
	return filepath.Join(s.root, "profiles", digest([]byte(owner)), "datasets", dataset, split+".jsonl")
}

func (s *Store) verifyDatasetFile(owner string, d Dataset, split string) (string, error) {
	expected := d.FileSHA256[split]
	if expected == "" {
		return "", fmt.Errorf("版本缺少文件校验，请基于此版创建草稿并重新冻结")
	}
	path := s.file(owner, d.ID, split)
	f, e := os.Open(path)
	if e != nil {
		return "", fmt.Errorf("冻结数据文件缺失，请重新准备版本")
	}
	defer f.Close()
	h := newHash()
	n, e := io.Copy(h, io.LimitReader(f, MaxImportBytes+1))
	if e != nil || n > MaxImportBytes || fmt.Sprintf("%x", h.Sum(nil)) != expected {
		return "", fmt.Errorf("冻结数据文件校验失败，请重新准备版本")
	}
	return path, nil
}
func atomicWrite(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".pending-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if e = f.Chmod(0600); e != nil {
		return e
	}
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(f.Name(), path)
}

func (s *Store) jobs(owner, project string) ([]Job, error) {
	jobs, e := s.jobsRaw(owner, project)
	if len(jobs) > 200 {
		jobs = jobs[:200]
	}
	for i := range jobs {
		jobs[i].Fence = ""
		if jobs[i].Kind == "evaluate" {
			jobs[i].Result = nil
		}
	}
	return jobs, e
}
