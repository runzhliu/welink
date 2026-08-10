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
//   - httpClientFast — 用于 embedding、探活、token 换取等快路径。
//     60s 总超时。

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

func isBlockedOutboundIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	// Shared address space（CGNAT）不是公网目标，也经常承载运营商内部服务。
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	return cgnat.Contains(ip)
}

// dialPublicContext 先解析目标域名，再直接拨号到校验过的 IP。这样校验和连接使用
// 同一个解析结果，避免 DNS rebinding 在两次解析之间把公网域名切到内网地址。
func dialPublicContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid outbound address: %w", err)
	}
	var ips []net.IP
	if literal := net.ParseIP(host); literal != nil {
		ips = []net.IP{literal}
	} else {
		ips, err = net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("outbound host has no IP address")
	}
	for _, ip := range ips {
		if isBlockedOutboundIP(ip) {
			return nil, fmt.Errorf("outbound address %s is not public", ip)
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, ip := range ips {
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	return nil, lastErr
}

func checkPublicRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return fmt.Errorf("too many redirects")
	}
	if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
		return fmt.Errorf("redirect scheme %q is not allowed", req.URL.Scheme)
	}
	return nil
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Hostname() != "" && (u.Scheme == "http" || u.Scheme == "https")
}

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

	// httpClientFast 用于 embedding 批量、探活等快路径。60s 总超时。
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

	// httpClientPublic 仅用于用户可控的公网资源代理。它不使用环境代理，并在实际
	// DialContext 中拒绝环回、私网、链路本地和 CGNAT 地址；每次重定向同样受限。
	httpClientPublic = &http.Client{
		Timeout:       60 * time.Second,
		CheckRedirect: checkPublicRedirect,
		Transport: &http.Transport{
			DialContext:           dialPublicContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 20 * time.Second,
			IdleConnTimeout:       60 * time.Second,
			MaxIdleConnsPerHost:   8,
		},
	}
)
