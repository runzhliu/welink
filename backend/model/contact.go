package model

type Contact struct {
	Username     string `json:"username"`
	Nickname     string `json:"nickname"`
	Remark       string `json:"remark"`
	Alias        string `json:"alias"`
	Flag         int    `json:"flag"`
	Description  string `json:"description"`
	BigHeadURL   string `json:"big_head_url"`
	SmallHeadURL string `json:"small_head_url"`
}

type ContactStats struct {
	Contact
	TotalMessages  int64  `json:"total_messages"`
	TheirMessages  int64  `json:"their_messages"`
	MyMessages     int64  `json:"my_messages"`
	TheirChars     int64  `json:"their_chars"`
	MyChars        int64  `json:"my_chars"`
	FirstMessage   string `json:"first_message_time"`
	LastMessage    string `json:"last_message_time"`
	// Unix 秒时间戳版本，前端做相对时间显示用；0 表示没有消息或未知
	FirstMessageTs int64  `json:"first_message_ts,omitempty"`
	LastMessageTs  int64  `json:"last_message_ts,omitempty"`
}
