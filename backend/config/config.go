package config

import (
	"log"
	"os"

	"gopkg.in/yaml.v3"
)

// Config 是 WeLink 的完整配置结构体。
// 配置优先级：config.yaml > 环境变量 > 默认值。
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Data     DataConfig     `yaml:"data"`
	Analysis AnalysisConfig `yaml:"analysis"`
}

type ServerConfig struct {
	// Port HTTP 监听端口，默认 8080。也可通过环境变量 PORT 覆盖。
	Port string `yaml:"port"`
}

type DataConfig struct {
	// Dir 解密后的微信数据目录，默认 ../decrypted（本地开发）或 /app/data（Docker）。
	// 也可通过环境变量 DATA_DIR 覆盖。
	Dir string `yaml:"dir"`
}

type AnalysisConfig struct {
	// Timezone 时区名称，默认 Asia/Shanghai（即 CST UTC+8）。
	// 影响消息时间的小时/星期分布统计。
	Timezone string `yaml:"timezone"`

	// LateNightStartHour 深夜开始小时（含），默认 0（即 0:00 起）。
	LateNightStartHour int `yaml:"late_night_start_hour"`

	// LateNightEndHour 深夜结束小时（不含），默认 5（即到 4:59 止）。
	LateNightEndHour int `yaml:"late_night_end_hour"`

	// SessionGapSeconds 判断新对话段的时间间隔（秒），默认 21600（6 小时）。
	SessionGapSeconds int64 `yaml:"session_gap_seconds"`

	// WorkerCount 并发分析联系人的 goroutine 数，默认 4。
	WorkerCount int `yaml:"worker_count"`

	// LateNightMinMessages 进入深夜排行榜所需的最少消息数，默认 100。
	LateNightMinMessages int64 `yaml:"late_night_min_messages"`

	// LateNightTopN 深夜排行榜保留前 N 名，默认 20。
	LateNightTopN int `yaml:"late_night_top_n"`

	// DefaultInitFrom 启动后自动初始化的开始时间（Unix 秒，0 表示不限）。
	// 设置此值后，服务启动即自动开始索引，无需前端手动点击"开始分析"。
	DefaultInitFrom int64 `yaml:"default_init_from"`

	// DefaultInitTo 启动后自动初始化的结束时间（Unix 秒，0 表示不限）。
	DefaultInitTo int64 `yaml:"default_init_to"`
}

// defaults 返回所有字段的默认值。
func defaults() Config {
	return Config{
		Server: ServerConfig{
			Port: "8080",
		},
		Data: DataConfig{
			Dir: "../decrypted",
		},
		Analysis: AnalysisConfig{
			Timezone:             "Asia/Shanghai",
			LateNightStartHour:   0,
			LateNightEndHour:     5,
			SessionGapSeconds:    21600,
			WorkerCount:          4,
			LateNightMinMessages: 100,
			LateNightTopN:        20,
			DefaultInitFrom:      0,
			DefaultInitTo:        0,
		},
	}
}

// Load 加载配置，按以下优先级合并：
//  1. 默认值
//  2. config.yaml（若存在）
//  3. 环境变量 DATA_DIR / PORT（向后兼容）
func Load(configPath string) *Config {
	cfg := defaults()

	// 尝试加载 YAML 文件
	if configPath == "" {
		configPath = "config.yaml"
	}
	if data, err := os.ReadFile(configPath); err == nil {
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			log.Printf("[CONFIG] Failed to parse %s: %v, using defaults", configPath, err)
		} else {
			log.Printf("[CONFIG] Loaded config from %s", configPath)
		}
	} else if !os.IsNotExist(err) {
		log.Printf("[CONFIG] Cannot read %s: %v, using defaults", configPath, err)
	}

	// 环境变量覆盖（向后兼容旧用法）
	if v := os.Getenv("DATA_DIR"); v != "" {
		cfg.Data.Dir = v
	}
	if v := os.Getenv("PORT"); v != "" {
		cfg.Server.Port = v
	}

	return &cfg
}
