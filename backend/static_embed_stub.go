//go:build !app

package main

import "io/fs"

// embeddedFrontend is nil in Docker/server builds; frontend is served by Nginx.
var embeddedFrontend fs.FS

var hasFrontend = false
