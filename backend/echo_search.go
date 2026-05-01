package main

// echo_search.go — "这句话谁说过 / Echo Search"
//
// 反向语义搜索：输入一句话，跨全库向量索引找到最相似的历史消息，
// 按"说话人"聚合返回——告诉你"这句话最像 X、Y、Z 说过的话"。
//
// 复用 vec_messages 已有的 embedding 索引，不新建表。
// 默认只搜私聊里"对方"说的话，可通过 query 参数放开。

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"welink/backend/service"
)

const (
	echoDefaultTopK         = 20
	echoMaxTopK             = 100
	echoDefaultMinMsgs      = 50
	echoDefaultDays         = 365
	echoCandidatesPerKey    = 5     // 单 contact 内最多保留的候选数（避免一个高频联系人霸榜）
	echoMaxKeys             = 800   // 单次跨库扫描的 contact 数量上限（防御性：超大库的兜底）
	echoMinSimilarityCutoff = 0.35  // 相似度过低的命中视为噪声丢弃
)

type EchoHit struct {
	Datetime   string  `json:"datetime"`
	Sender     string  `json:"sender"`
	Content    string  `json:"content"`
	Similarity float32 `json:"similarity"`
}

type EchoGroup struct {
	Key         string    `json:"key"`           // contact_key（私聊=wxid，群=xxx@chatroom）
	DisplayName string    `json:"display_name"`  // 展示名（备注 / 昵称 / username）
	Avatar      string    `json:"avatar,omitempty"`
	IsGroup     bool      `json:"is_group"`
	HitCount    int       `json:"hit_count"`     // 这个人/群里命中条数
	TopSim      float32   `json:"top_sim"`       // 该人最高相似度（用于排序）
	Hits        []EchoHit `json:"hits"`          // 该人/群下的命中消息（按相似度降序）
}

type EchoResponse struct {
	Query         string      `json:"query"`
	TotalHits     int         `json:"total_hits"`     // 命中消息总数（聚合前）
	KeysScanned   int         `json:"keys_scanned"`   // 实际扫描的 contact 数量
	KeysSkipped   int         `json:"keys_skipped"`   // 因过滤条件被跳过的 contact 数量
	ElapsedMs     int64       `json:"elapsed_ms"`
	Groups        []EchoGroup `json:"groups"`         // 按 TopSim 降序
}

func registerEchoSearchRoutes(prot *gin.RouterGroup, getSvc func() *service.ContactService) {
	prot.GET("/me/echo", echoSearchHandler(getSvc))
}

func echoSearchHandler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		t0 := time.Now()
		svc := getSvc()
		if svc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
			return
		}

		query := strings.TrimSpace(c.Query("q"))
		if query == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请输入要搜索的句子"})
			return
		}
		if len([]rune(query)) > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "搜索内容请控制在 200 字以内"})
			return
		}

		topK := parseIntDefault(c.Query("topK"), echoDefaultTopK)
		if topK < 1 {
			topK = echoDefaultTopK
		}
		if topK > echoMaxTopK {
			topK = echoMaxTopK
		}
		includeGroups := c.Query("include_groups") == "1"
		includeSelf := c.Query("include_self") == "1"
		minMsgs := parseIntDefault(c.Query("min_msgs"), echoDefaultMinMsgs)
		days := parseIntDefault(c.Query("days"), echoDefaultDays)

		aiDBMu.Lock()
		db := aiDB
		aiDBMu.Unlock()
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 数据库未初始化"})
			return
		}

		// 1. embed query（一次）
		prefs := loadPreferences()
		cfg := defaultEmbeddingConfig(prefs)
		queryEmbs, err := GetEmbeddingsBatch([]string{query}, cfg)
		if err != nil || len(queryEmbs) == 0 || queryEmbs[0] == nil {
			msg := "query embedding 失败"
			if err != nil {
				msg = msg + "：" + err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		queryVec := queryEmbs[0]

		// 2. 列出已建索引的 contact_key（按 msg_count 降序：高频先扫，体感更快）
		rows, err := db.Query(`SELECT contact_key, msg_count FROM vec_index_status
			WHERE msg_count >= ? ORDER BY msg_count DESC`, minMsgs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取索引列表失败：" + err.Error()})
			return
		}
		type keyMeta struct {
			key      string
			msgCount int
			isGroup  bool
		}
		allKeys := make([]keyMeta, 0, 64)
		skipped := 0
		for rows.Next() {
			var k string
			var n int
			if err := rows.Scan(&k, &n); err != nil {
				continue
			}
			isGroup := strings.HasSuffix(k, "@chatroom")
			if isGroup && !includeGroups {
				skipped++
				continue
			}
			allKeys = append(allKeys, keyMeta{k, n, isGroup})
		}
		rows.Close()
		if len(allKeys) > echoMaxKeys {
			allKeys = allKeys[:echoMaxKeys]
		}

		// 3. 时间下限（按 datetime 字符串比较，格式 "YYYY-MM-DD HH:MM:SS"）
		var sinceStr string
		if days > 0 {
			sinceStr = time.Now().AddDate(0, 0, -days).Format("2006-01-02 15:04:05")
		}

		// 4. 跨 key 流式扫描，每条算余弦相似度，单 key 保留 top-N 候选
		type scoredHit struct {
			key  string
			hit  EchoHit
		}
		allHits := make([]scoredHit, 0, len(allKeys)*echoCandidatesPerKey)
		queryDim := len(queryVec)
		scanned := 0
		for _, km := range allKeys {
			senderFilter := ""
			args := []interface{}{km.key}
			if !km.isGroup && !includeSelf {
				senderFilter = " AND sender = '对方'"
			}
			// 群聊下，排除"我"——群里的 sender 是发言人具体名，"我"自己的发言也用真名
			// 所以群里没法简单过滤自己，include_self 主要影响私聊
			if sinceStr != "" {
				senderFilter += " AND datetime >= ?"
				args = append(args, sinceStr)
			}
			q := `SELECT seq, datetime, sender, content, embedding
				FROM vec_messages WHERE contact_key = ?` + senderFilter
			r, err := db.Query(q, args...)
			if err != nil {
				continue
			}
			scanned++

			// 单 key 内用小顶堆思路：维护 echoCandidatesPerKey 个候选
			type cand struct {
				sim     float32
				dt, snd, ct string
			}
			localTop := make([]cand, 0, echoCandidatesPerKey+1)
			for r.Next() {
				var seq int
				var dt, snd, ct string
				var blob []byte
				if err := r.Scan(&seq, &dt, &snd, &ct, &blob); err != nil {
					continue
				}
				v := decodeVec(blob)
				if len(v) != queryDim {
					continue
				}
				sim := cosineSimilarity(queryVec, v)
				if sim < echoMinSimilarityCutoff {
					continue
				}
				// 插入并保持降序，最多保留 echoCandidatesPerKey
				inserted := false
				for i, x := range localTop {
					if sim > x.sim {
						localTop = append(localTop[:i], append([]cand{{sim, dt, snd, ct}}, localTop[i:]...)...)
						inserted = true
						break
					}
				}
				if !inserted && len(localTop) < echoCandidatesPerKey {
					localTop = append(localTop, cand{sim, dt, snd, ct})
				}
				if len(localTop) > echoCandidatesPerKey {
					localTop = localTop[:echoCandidatesPerKey]
				}
			}
			r.Close()
			for _, x := range localTop {
				allHits = append(allHits, scoredHit{
					key: km.key,
					hit: EchoHit{
						Datetime:   x.dt,
						Sender:     x.snd,
						Content:    x.ct,
						Similarity: x.sim,
					},
				})
			}
		}

		// 5. 全局排序后只取 topK 用于聚合（限制返回体积）
		sort.Slice(allHits, func(i, j int) bool {
			return allHits[i].hit.Similarity > allHits[j].hit.Similarity
		})
		if len(allHits) > topK {
			allHits = allHits[:topK]
		}

		// 6. 按 contact_key 聚合
		groupMap := make(map[string]*EchoGroup)
		for _, h := range allHits {
			g, ok := groupMap[h.key]
			if !ok {
				g = &EchoGroup{Key: h.key, IsGroup: strings.HasSuffix(h.key, "@chatroom")}
				groupMap[h.key] = g
			}
			g.Hits = append(g.Hits, h.hit)
			g.HitCount++
			if h.hit.Similarity > g.TopSim {
				g.TopSim = h.hit.Similarity
			}
		}

		// 7. 用 stats 填 display_name + avatar（一次遍历建索引）
		stats := svc.GetCachedStats()
		statByUser := make(map[string]int, len(stats))
		for i, s := range stats {
			statByUser[s.Username] = i
		}
		groups := make([]EchoGroup, 0, len(groupMap))
		for _, g := range groupMap {
			if idx, ok := statByUser[g.Key]; ok {
				st := stats[idx]
				name := st.Remark
				if name == "" {
					name = st.Nickname
				}
				if name == "" {
					name = st.Username
				}
				g.DisplayName = name
				g.Avatar = st.SmallHeadURL
			} else {
				g.DisplayName = g.Key
			}
			// hits 已经按相似度降序（单 key 局部 + 全局排序后插入顺序保持）
			groups = append(groups, *g)
		}
		sort.Slice(groups, func(i, j int) bool {
			if groups[i].TopSim != groups[j].TopSim {
				return groups[i].TopSim > groups[j].TopSim
			}
			return groups[i].HitCount > groups[j].HitCount
		})

		c.JSON(http.StatusOK, EchoResponse{
			Query:       query,
			TotalHits:   len(allHits),
			KeysScanned: scanned,
			KeysSkipped: skipped,
			ElapsedMs:   time.Since(t0).Milliseconds(),
			Groups:      groups,
		})
	}
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

