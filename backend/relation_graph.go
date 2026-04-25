package main

// relation_graph.go — 关系星图
//
// 把所有联系人画成一张力导向图：
//   节点：联系人（大小=消息量、颜色=主要聊天时段）
//   边：两人共同所在的群聊（权重=共同群数）
// 图本身在前端 D3 渲染；后端只负责把节点和边算出来。

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

type RelationNode struct {
	ID          string `json:"id"`            // wxid
	DisplayName string `json:"display_name"`
	Avatar      string `json:"avatar,omitempty"`
	Messages    int64  `json:"messages"`      // 跟我的消息总量
	PeakHour    int    `json:"peak_hour"`     // 0-23，跟我最活跃的小时
	Period      string `json:"period"`        // "morning" / "day" / "evening" / "night"
	GroupCount  int    `json:"group_count"`   // 这个人和我共同所在的群数
}

type RelationEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Weight int    `json:"weight"` // 共同群聊数量
}

type RelationGraphResponse struct {
	Nodes []RelationNode `json:"nodes"`
	Edges []RelationEdge `json:"edges"`
	// 概览：节点是按消息量降序，limit 应用在节点上；边只在节点之间产生。
	TotalContacts int `json:"total_contacts"`
}

func registerRelationGraphRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/me/relation-graph", relationGraphHandler(getSvc))
}

func relationGraphHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		// 默认最多 80 个节点；用户可加参数 ?limit=120 微调
		limit := 80
		if v := c.Query("limit"); v != "" {
			if n := atoiSafe(v); n >= 20 && n <= 200 {
				limit = n
			}
		}

		stats := svc.GetCachedStats()
		// 1. 过滤私聊 + 有消息，按消息量排序，取前 N
		type pick struct {
			username string
			name     string
			avatar   string
			total    int64
			peakHour int
		}
		picks := make([]pick, 0, 256)
		for _, st := range stats {
			if strings.HasSuffix(st.Username, "@chatroom") || strings.HasPrefix(st.Username, "gh_") {
				continue
			}
			if st.TotalMessages <= 0 {
				continue
			}
			name := st.Remark
			if name == "" {
				name = st.Nickname
			}
			if name == "" {
				name = st.Username
			}
			picks = append(picks, pick{
				username: st.Username,
				name:     name,
				avatar:   st.SmallHeadURL,
				total:    st.TotalMessages,
				peakHour: -1, // 当前实现先不算 peak（避免对每个人扫消息库），前端用默认色
			})
		}
		sort.Slice(picks, func(i, j int) bool { return picks[i].total > picks[j].total })
		totalContacts := len(picks)
		if len(picks) > limit {
			picks = picks[:limit]
		}

		// 2. 一次性拿到全部群 → 成员
		rooms := svc.GetAllRoomMemberships()

		// 3. 建立节点 wxid 集合（仅入选的）+ 计算每人 group_count（与我共同所在的群数）
		nodeSet := make(map[string]bool, len(picks))
		for _, p := range picks {
			nodeSet[p.username] = true
		}
		groupCnt := make(map[string]int, len(picks))
		// 4. 对每个群，把成员里"在 nodeSet 内的"两两连边
		edgeMap := make(map[[2]string]int) // sorted pair → 共同群数
		for _, members := range rooms {
			// 先去重 + 只保留入选节点
			inGroup := make([]string, 0, len(members))
			seen := make(map[string]bool, len(members))
			for _, m := range members {
				if seen[m] {
					continue
				}
				seen[m] = true
				if nodeSet[m] {
					inGroup = append(inGroup, m)
				}
			}
			for _, m := range inGroup {
				groupCnt[m]++
			}
			// 两两连边（无向图，按 wxid 排序保证唯一）
			for i := 0; i < len(inGroup); i++ {
				for j := i + 1; j < len(inGroup); j++ {
					a, b := inGroup[i], inGroup[j]
					if a > b {
						a, b = b, a
					}
					edgeMap[[2]string{a, b}]++
				}
			}
		}

		// 5. 输出节点
		nodes := make([]RelationNode, 0, len(picks))
		for _, p := range picks {
			nodes = append(nodes, RelationNode{
				ID:          p.username,
				DisplayName: p.name,
				Avatar:      p.avatar,
				Messages:    p.total,
				PeakHour:    p.peakHour,
				Period:      periodName(p.peakHour),
				GroupCount:  groupCnt[p.username],
			})
		}

		// 6. 输出边（按权重降序，最多 800 条以免前端渲染崩）
		const maxEdges = 800
		edges := make([]RelationEdge, 0, len(edgeMap))
		for k, w := range edgeMap {
			edges = append(edges, RelationEdge{Source: k[0], Target: k[1], Weight: w})
		}
		sort.Slice(edges, func(i, j int) bool { return edges[i].Weight > edges[j].Weight })
		if len(edges) > maxEdges {
			edges = edges[:maxEdges]
		}

		c.JSON(http.StatusOK, RelationGraphResponse{
			Nodes:         nodes,
			Edges:         edges,
			TotalContacts: totalContacts,
		})
	}
}

// periodName 把 0-23 小时归到四档时段
func periodName(h int) string {
	switch {
	case h < 0:
		return "unknown"
	case h >= 6 && h < 11:
		return "morning"
	case h >= 11 && h < 17:
		return "day"
	case h >= 17 && h < 23:
		return "evening"
	default:
		return "night"
	}
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
		if n > 1000000 {
			return -1
		}
	}
	return n
}
