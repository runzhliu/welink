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
	FirstMessage   string `json:"first_message_time"`
	LastMessage    string `json:"last_message_time"`
}
