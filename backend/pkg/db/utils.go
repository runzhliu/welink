package db

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
)

// GetTableName 根据用户名计算微信消息表名
func GetTableName(username string) string {
	hash := md5.Sum([]byte(username))
	return fmt.Sprintf("Msg_%s", hex.EncodeToString(hash[:]))
}
