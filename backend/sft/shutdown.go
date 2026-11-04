package sft

import "encoding/json"

// ShutdownLocal persists cooperative commands before an application exit.
// Remote GPU attempts retain their lease and apply the offline execution budget.
func (c *Controller) ShutdownLocal() error {
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	rows, e := c.store.db.Query(`SELECT owner,body FROM workers`)
	if e != nil {
		return e
	}
	type item struct {
		owner  string
		worker Worker
	}
	workers := []item{}
	for rows.Next() {
		var owner string
		var raw []byte
		if e = rows.Scan(&owner, &raw); e != nil {
			rows.Close()
			return e
		}
		var w Worker
		json.Unmarshal(raw, &w)
		if w.Local {
			workers = append(workers, item{owner, w})
		}
	}
	rows.Close()
	for _, value := range workers {
		jobs, e := c.store.jobsRaw(value.owner, value.worker.ProjectID)
		if e != nil {
			return e
		}
		for _, j := range jobs {
			if j.WorkerID != value.worker.ID || terminal(j.State) {
				continue
			}
			j.Cancel = true
			if j.State == "queued" {
				j.State = "canceled"
			} else {
				j.State = "stopping"
			}
			if e = c.store.saveJob(value.owner, j); e != nil {
				return e
			}
		}
		deployments, e := c.store.list(value.owner, "deployment", value.worker.ProjectID)
		if e != nil {
			return e
		}
		for _, raw := range deployments {
			var d Deployment
			json.Unmarshal(raw, &d)
			if d.WorkerID != value.worker.ID || d.State == "stopped" || d.State == "failed" {
				continue
			}
			d.Stop = true
			d.State = "stopping"
			if e = c.store.put(value.owner, "deployment", d.ProjectID, d.ID, d); e != nil {
				return e
			}
		}
	}
	return nil
}
