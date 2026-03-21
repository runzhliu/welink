//go:build app

package main

import "embed"

// embeddedFrontend holds the compiled React frontend (frontend/dist copied to static/).
//
//go:embed all:static
var embeddedFrontend embed.FS

var hasFrontend = true
