package sft

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/gin-gonic/gin"
)

type CleanupItem struct {
	ID     string `json:"id"`
	JobID  string `json:"job_id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Reason string `json:"reason"`
	path   string
}
type CleanupPreview struct {
	Items []CleanupItem `json:"items"`
	Bytes int64         `json:"bytes"`
	Hash  string        `json:"hash"`
}

// Successful models, frozen data and anything used by a child attempt are kept.
// Cleanup deliberately covers control-plane files only, never a worker's shared
// Hugging Face cache or another account's directory.
func (c *Controller) cleanupPreview(owner, project string) (CleanupPreview, error) {
	preview := CleanupPreview{Items: []CleanupItem{}}
	var p Project
	if e := c.store.get(owner, "project", project, &p); e != nil {
		return preview, e
	}
	jobs, e := c.store.jobsRaw(owner, project)
	if e != nil {
		return preview, e
	}
	referenced := map[string]bool{}
	for _, j := range jobs {
		if j.Config.ParentRun != "" {
			referenced[j.Config.ParentRun] = true
		}
	}
	for _, j := range jobs {
		if (j.State != "failed" && j.State != "canceled") || referenced[j.ID] {
			continue
		}
		artifacts, e := c.store.list(owner, "artifact", j.ID)
		if e != nil {
			return preview, e
		}
		for _, raw := range artifacts {
			var a Artifact
			if e = json.Unmarshal(raw, &a); e != nil {
				return preview, e
			}
			path := c.artifactFile(owner, a)
			info, e := os.Stat(path)
			if e != nil {
				continue
			}
			preview.Items = append(preview.Items, CleanupItem{ID: a.ID, JobID: j.ID, Name: a.Name, Size: info.Size(), Reason: "失败 / 停止任务的未引用产物，清理后不能从此文件继续训练", path: path})
		}
		for _, name := range []string{"adapter.tar", "checkpoint.tar", "manifest.json"} {
			a := Artifact{JobID: j.ID, Name: name}
			path := c.artifactFile(owner, a) + ".part"
			info, e := os.Stat(path)
			if e != nil || now()-info.ModTime().Unix() < 86400 {
				continue
			}
			preview.Items = append(preview.Items, CleanupItem{ID: digest([]byte(j.ID + name + ".part")), JobID: j.ID, Name: name + ".part", Size: info.Size(), Reason: "超过一天的未完成上传，任务已终止", path: path})
		}
	}
	sort.Slice(preview.Items, func(i, j int) bool { return preview.Items[i].ID < preview.Items[j].ID })
	for _, item := range preview.Items {
		preview.Bytes += item.Size
	}
	preview.Hash = digest(encode(preview.Items))
	return preview, nil
}
func (c *Controller) cleanupRoutes(r *gin.RouterGroup) {
	r.POST("/projects/:id/cleanup-preview", func(ctx *gin.Context) {
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		v, e := c.cleanupPreview(ctx.GetString("sft_owner"), ctx.Param("id"))
		respond(ctx, v, e)
	})
	r.POST("/projects/:id/cleanup", func(ctx *gin.Context) {
		var b struct {
			Hash string `json:"hash"`
		}
		if !bind(ctx, &b) {
			return
		}
		c.store.mu.Lock()
		defer c.store.mu.Unlock()
		owner := ctx.GetString("sft_owner")
		project := ctx.Param("id")
		preview, e := c.cleanupPreview(owner, project)
		if e != nil {
			fail(ctx, e)
			return
		}
		if b.Hash == "" || b.Hash != preview.Hash {
			fail(ctx, ErrConflict)
			return
		}
		removed := []string{}
		for _, item := range preview.Items {
			if filepath.Base(item.path) != item.Name {
				fail(ctx, fmt.Errorf("清理路径校验失败"))
				return
			}
			if e = os.Remove(item.path); e != nil && !os.IsNotExist(e) {
				fail(ctx, fmt.Errorf("清理未完成，请刷新清单后重试"))
				return
			}
			if filepath.Ext(item.Name) != ".part" {
				if _, e = c.store.db.Exec(`DELETE FROM objects WHERE owner=? AND kind='artifact' AND id=?`, owner, item.ID); e != nil {
					fail(ctx, e)
					return
				}
			}
			removed = append(removed, item.ID)
		}
		c.store.put(owner, "cleanup", project, ID("cleanup"), gin.H{"removed": removed, "bytes": preview.Bytes, "created_at": now()})
		respond(ctx, gin.H{"removed": len(removed), "bytes": preview.Bytes}, nil)
	})
}
