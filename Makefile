.PHONY: up down build dev test lint clean help

## ─── Docker ──────────────────────────────────────────────────────────────────

up:          ## 启动全部服务（生产模式）
	docker compose up --build -d

down:        ## 停止并移除容器
	docker compose down

logs:        ## 跟踪容器日志
	docker compose logs -f

restart:     ## 重启全部服务
	docker compose restart

## ─── 构建 ────────────────────────────────────────────────────────────────────

build: build-backend build-frontend  ## 构建后端 + 前端

build-backend:   ## 编译后端二进制（本地，无 CGO）
	cd backend && CGO_ENABLED=0 go build -o welink-backend .

build-frontend:  ## 构建前端静态资源
	cd frontend && npm install && npm run build

build-mcp:       ## 编译 MCP Server 二进制
	cd mcp-server && go build -o welink-mcp .

## ─── 本地开发 ─────────────────────────────────────────────────────────────────

dev-backend:     ## 本地启动后端（读取 config.yaml 或默认值）
	cd backend && go run .

dev-frontend:    ## 本地启动前端 Vite dev server
	cd frontend && npm run dev

## ─── 测试 ────────────────────────────────────────────────────────────────────

test:            ## 运行后端所有单元测试
	cd backend && go test ./... -v

test-short:      ## 运行后端单元测试（不显示详情）
	cd backend && go test ./...

## ─── 代码检查 ─────────────────────────────────────────────────────────────────

lint:            ## 运行 go vet 检查
	cd backend && go vet ./...
	cd mcp-server && go vet ./...

## ─── 清理 ────────────────────────────────────────────────────────────────────

## ─── macOS App & DMG ─────────────────────────────────────────────────────────

DMG_NAME  := WeLink
APP_DIR   := dist/$(DMG_NAME).app
MACOS_DIR := $(APP_DIR)/Contents/MacOS
RES_DIR   := $(APP_DIR)/Contents/Resources
# macOS SDK 路径（CGO 编译 webview 需要 -isysroot）
SYSROOT   := $(shell xcrun --sdk macosx --show-sdk-path 2>/dev/null)
# 版本号：有精确 tag（如 v1.2.0）时取 tag（去掉 v 前缀），否则 dev-<sha>
_GIT_TAG  := $(shell git describe --tags --exact-match 2>/dev/null)
_GIT_SHA  := $(shell git rev-parse --short HEAD 2>/dev/null)
APP_VERSION := $(if $(_GIT_TAG),$(patsubst v%,%,$(_GIT_TAG)),dev-$(_GIT_SHA))

dmg: _dmg-frontend _dmg-binary _dmg-bundle _dmg-package  ## 打包 macOS .app + 通用二进制 + DMG
	@echo ""
	@echo "✅  DMG 打包完成：dist/$(DMG_NAME).dmg"
	@echo "    用法：将 WeLink.app 拖入 /Applications，decrypted/ 放在与 WeLink.app 同级目录后双击运行。"

_dmg-frontend:
	cd frontend && npm install && npm run build
	rm -rf backend/static && mkdir -p backend/static
	cp -r frontend/dist/. backend/static/

_dmg-binary: _dmg-frontend
	# webview_go 需要 CGO（WKWebView）；-isysroot 指向 macOS SDK，解决 stdlib.h not found
	@echo "→ 编译 arm64 (Apple Silicon)..."
	cd backend && \
	  CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 \
	  CGO_CFLAGS="-target arm64-apple-macos12 -isysroot $(SYSROOT)" \
	  CGO_LDFLAGS="-target arm64-apple-macos12 -isysroot $(SYSROOT)" \
	  CC="xcrun clang -arch arm64" \
	  go build -tags app -ldflags="-s -w -X main.appVersion=$(APP_VERSION)" -o welink-arm64 .
	@echo "→ 编译 amd64 (Intel)..."
	cd backend && \
	  CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
	  CGO_CFLAGS="-target x86_64-apple-macos12 -isysroot $(SYSROOT)" \
	  CGO_LDFLAGS="-target x86_64-apple-macos12 -isysroot $(SYSROOT)" \
	  CC="xcrun clang -arch x86_64" \
	  go build -tags app -ldflags="-s -w -X main.appVersion=$(APP_VERSION)" -o welink-amd64 .
	@echo "→ 合并为 Universal Binary..."
	lipo -create -output backend/$(DMG_NAME) backend/welink-arm64 backend/welink-amd64
	rm backend/welink-arm64 backend/welink-amd64

_dmg-bundle: _dmg-binary
	rm -rf $(APP_DIR)
	mkdir -p $(MACOS_DIR) $(RES_DIR)
	cp backend/$(DMG_NAME) $(MACOS_DIR)/$(DMG_NAME)
	@printf '<?xml version="1.0" encoding="UTF-8"?>\n\
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n\
<plist version="1.0"><dict>\n\
  <key>CFBundleExecutable</key><string>$(DMG_NAME)</string>\n\
  <key>CFBundleIdentifier</key><string>io.github.runzhliu.welink</string>\n\
  <key>CFBundleName</key><string>$(DMG_NAME)</string>\n\
  <key>CFBundleDisplayName</key><string>WeLink 微信数据分析</string>\n\
  <key>CFBundleVersion</key><string>$(APP_VERSION)</string>\n\
  <key>CFBundleShortVersionString</key><string>$(APP_VERSION)</string>\n\
  <key>CFBundlePackageType</key><string>APPL</string>\n\
  <key>CFBundleIconFile</key><string>AppIcon</string>\n\
  <key>NSHumanReadableCopyright</key><string>Copyright © 2026 runzhliu. Licensed under AGPL-3.0.</string>\n\
  <key>NSHighResolutionCapable</key><true/>\n\
  <key>NSPrincipalClass</key><string>NSApplication</string>\n\
  <key>LSMinimumSystemVersion</key><string>12.0</string>\n\
</dict></plist>\n' > $(APP_DIR)/Contents/Info.plist
	cp assets/AppIcon.icns $(RES_DIR)/AppIcon.icns

_dmg-package:
	mkdir -p dist
	# Ad-hoc 签名：解决 Gatekeeper「身份不明开发者」拦截
	codesign --force --deep --sign - "$(APP_DIR)"
	# 移除本地构建产生的隔离属性，避免 macOS 弹出「无法打开」
	xattr -cr "$(APP_DIR)"
	rm -f "dist/$(DMG_NAME).dmg"
	pip3 install --quiet --break-system-packages dmgbuild
	python3 -m dmgbuild -s assets/dmg-settings.py \
		-D app="$(APP_DIR)" \
		"$(DMG_NAME)" "dist/$(DMG_NAME).dmg"
	rm -f backend/$(DMG_NAME)

## ─── 清理 ────────────────────────────────────────────────────────────────────

clean:           ## 删除本地编译产物
	rm -f backend/welink-backend
	rm -f mcp-server/welink-mcp
	rm -rf frontend/dist
	rm -rf backend/static
	rm -rf dist/

## ─── 帮助 ────────────────────────────────────────────────────────────────────

help:            ## 显示所有可用 target
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
