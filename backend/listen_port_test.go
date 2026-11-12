package main

import (
	"net"
	"strconv"
	"testing"
)

func TestListenWithFallbackUsesBoundPort(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	preferred := strconv.Itoa(occupied.Addr().(*net.TCPAddr).Port)
	if _, _, err := listenWithFallback("127.0.0.1", preferred, false); err == nil {
		t.Fatal("server mode must report an occupied preferred port")
	}
	listener, actual, err := listenWithFallback("127.0.0.1", preferred, true)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if actual == preferred || actual != strconv.Itoa(listener.Addr().(*net.TCPAddr).Port) {
		t.Fatalf("fallback port %q does not match the bound listener", actual)
	}
	if _, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", actual)); err == nil {
		t.Fatal("returned listener did not retain the port")
	}
}

func TestListenWithFallbackEphemeralAndInvalidPorts(t *testing.T) {
	listener, actual, err := listenWithFallback("127.0.0.1", "0", true)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if actual == "0" || actual != strconv.Itoa(listener.Addr().(*net.TCPAddr).Port) {
		t.Fatalf("system-selected port not reported: %q", actual)
	}
	for _, port := range []string{"-1", "65536", "bad"} {
		if _, _, err := listenWithFallback("127.0.0.1", port, true); err == nil {
			t.Fatalf("invalid port %q was accepted", port)
		}
	}
}

func TestListenWithFallbackExhaustedHighRange(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:65535")
	if err != nil {
		t.Skipf("cannot reserve high port: %v", err)
	}
	defer occupied.Close()
	listener, actual, err := listenWithFallback("127.0.0.1", "65535", true)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if actual == "65535" || actual == "0" {
		t.Fatalf("expected system-selected fallback port, got %q", actual)
	}
}

func TestOAuthUsesActualListeningPort(t *testing.T) {
	t.Setenv("WELINK_PUBLIC_URL", "")
	previous := activeServerPort.Load()
	t.Cleanup(func() { activeServerPort.Store(previous) })
	port := "54321"
	activeServerPort.Store(&port)
	if got := geminiRedirectURI(); got != "http://127.0.0.1:54321/api/auth/gemini/callback" {
		t.Fatalf("incorrect callback URL: %s", got)
	}
	t.Setenv("WELINK_PUBLIC_URL", "https://welink.example.test/")
	if got := oauthRedirectURI(nil, "/callback"); got != "https://welink.example.test/callback" {
		t.Fatalf("explicit public URL not respected: %s", got)
	}
}
