package main

// http_clients.go — 共享的 HTTP client，给所有出站调用加上合理的超时保护。
//
// 之前所有 LLM / embedding / avatar 代理都用 http.DefaultClient.Do(req)，
// 后者**没有任何超时**。一旦下游 API 挂死或网络丢包，goroutine 永久阻塞，
// 累积起来会把进程拖到无法响应。
//
// 三类场景：
//
//   - httpClientLLMStream — 用于 LLM/Bedrock 流式生成。生成本身可能要几分钟，
//     不能加总超时；但拿到响应头的等待时间可控，用 ResponseHeaderTimeout
//     在网络挂死时早点 fail。
//
//   - httpClientLLMSync — 用于非流式 LLM 调用（一次性返回完整答复）。给个
//     5 分钟总超时，足够最长的同步生成完成。
//
//   - httpClientFast — 用于 embedding、探活、avatar 代理、token 换取等快路径。
//     60s 总超时。

import (
	"net"
	"net/http"
	"time"
)

var (
	// httpClientLLMStream 用于流式 LLM/Bedrock 调用。
	// 不设 Timeout（流式响应可能持续数分钟），但 ResponseHeaderTimeout
	// 限制建连后到收到首字节的时间，防止挂在握手或服务端僵死时永远阻塞。
	httpClientLLMStream = &http.Client{
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   15 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       90 * time.Second,
			MaxIdleConnsPerHost:   8,
		},
	}

	// httpClientLLMSync 用于非流式 LLM（一次性返回 / token 换取 / 探活）。
	// 5 分钟总超时，覆盖最长的同步生成场景。
	httpClientLLMSync = &http.Client{
		Timeout: 5 * time.Minute,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   15 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: 15 * time.Second,
			IdleConnTimeout:     90 * time.Second,
			MaxIdleConnsPerHost: 8,
		},
	}

	// httpClientFast 用于 embedding 批量、avatar 代理等快路径。60s 总超时。
	httpClientFast = &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   10 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
			IdleConnTimeout:     90 * time.Second,
			MaxIdleConnsPerHost: 16,
		},
	}
)
