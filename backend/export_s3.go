package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"welink/backend/service"
)

// exportS3Handler 上传每个 doc 作为独立 object 到 S3 兼容存储
// 支持 AWS S3 / Cloudflare R2 / 阿里云 OSS / 腾讯 COS / 七牛 Kodo / MinIO / Backblaze B2。
func exportS3Handler(getSvc func() *service.ContactService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
			return
		}
		prefs := loadPreferences()
		bucket := strings.TrimSpace(prefs.S3Bucket)
		ak := strings.TrimSpace(prefs.S3AccessKey)
		sk := strings.TrimSpace(prefs.S3SecretKey)
		if bucket == "" || ak == "" || sk == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 S3 Bucket / AccessKey / SecretKey"})
			return
		}
		endpoint := strings.TrimSpace(prefs.S3Endpoint)
		if endpoint == "" {
			endpoint = "s3.amazonaws.com"
		}
		// 去掉 endpoint 前面的 https:// 方便 minio-go 判 Secure
		secure := true
		if strings.HasPrefix(endpoint, "http://") {
			secure = false
			endpoint = strings.TrimPrefix(endpoint, "http://")
		} else {
			endpoint = strings.TrimPrefix(endpoint, "https://")
		}
		endpoint = strings.TrimSuffix(endpoint, "/")

		cli, err := minio.New(endpoint, &minio.Options{
			Creds:        credentials.NewStaticV4(ak, sk, ""),
			Secure:       secure,
			Region:       strings.TrimSpace(prefs.S3Region),
			BucketLookup: bucketLookupMode(prefs.S3UsePathStyle),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "S3 client 初始化失败：" + err.Error()})
			return
		}

		docs, err := collectAll(getSvc(), req.Items)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		prefix := strings.Trim(prefs.S3PathPrefix, "/")
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
		defer cancel()

		results := make([]ExportResult, 0, len(docs))
		for _, d := range docs {
			fname := safeFilename(d.Filename) + ".md"
			key := fname
			if prefix != "" {
				key = prefix + "/" + fname
			}
			data := []byte(d.Markdown)
			_, err := cli.PutObject(ctx, bucket, key, bytes.NewReader(data), int64(len(data)),
				minio.PutObjectOptions{ContentType: "text/markdown; charset=utf-8"})
			r := ExportResult{Title: d.Title, OK: err == nil, Bytes: len(data)}
			if err != nil {
				r.Error = err.Error()
			} else {
				// 组装可读 URL（不保证可公开访问，供用户定位）
				scheme := "https"
				if !secure {
					scheme = "http"
				}
				if prefs.S3UsePathStyle {
					r.URL = fmt.Sprintf("%s://%s/%s/%s", scheme, endpoint, bucket, key)
				} else {
					r.URL = fmt.Sprintf("%s://%s.%s/%s", scheme, bucket, endpoint, key)
				}
			}
			results = append(results, r)
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	}
}

func bucketLookupMode(pathStyle bool) minio.BucketLookupType {
	if pathStyle {
		return minio.BucketLookupPath
	}
	return minio.BucketLookupAuto
}
