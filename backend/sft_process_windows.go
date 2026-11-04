//go:build windows

package main

import "os/exec"

func configureSFTProcess(_ *exec.Cmd) {}

func terminateSFTProcess(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func killSFTProcess(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
