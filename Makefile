.PHONY: up down logs restart build build-backend build-frontend build-mcp \
        dev-backend dev-frontend test test-short lint clean help \
        docs-build docs-build-push docs-up docs-down docs-logs \
        demo-up demo-up-build demo-down demo-logs \
        server-up server-down server-logs server-pull \
        dev-deploy dev-down dev-logs

## ─── 主站 Docker（frontend + backend）────────────────────────────────────────
## 使用 docker-compose.yml，与 docs/ 完全隔离，互不影响。

up:          ## 启动主站服务（使用已有镜像，不重新 build）
	docker compose up -d

up-build:    ## 启动主站服务并重新构建镜像（自动注入版本号和 commit）
	APP_VERSION=$(APP_VERSION) GIT_COMMIT=$(GIT_COMMIT) docker compose up --build -d

down:        ## 停止并移除主站容器
	docker compose down

logs:        ## 跟踪主站容器日志
	docker compose logs -f

restart:     ## 重启主站服务
	docker compose restart

## ─── Demo 模式 ───────────────────────────────────────────────────────────────

demo-up:     ## 启动 Demo 容器（预置 Arsenal 测试数据）
	docker compose -f docker-compose.demo.yml up -d

demo-up-build: ## 启动 Demo 容器并重新构建镜像
	docker compose -f docker-compose.demo.yml up --build -d

demo-down:   ## 停止 Demo 容器
	docker compose -f docker-compose.demo.yml down

demo-logs:   ## 跟踪 Demo 容器日志
	docker compose -f docker-compose.demo.yml logs -f

## ─── 官网（docs/）────────────────────────────────────────────────────────────
## docs 独立 compose，平台架构与主站无关，不要混用。
## 本地开发：make docs-build && make docs-up
## CI 发布： make docs-build-push（需已登录 ghcr.io，使用 buildx 多平台）

# 官网版本号：有精确 tag 用 tag（含 v 前缀），否则用 commit 短 hash
_DOCS_TAG := $(shell git describe --tags --exact-match 2>/dev/null)
_DOCS_SHA := $(shell git rev-parse --short=6 HEAD 2>/dev/null)
DOCS_VERSION := $(if $(_DOCS_TAG),$(_DOCS_TAG),$(_DOCS_SHA))

docs-build:  ## 构建官网镜像（当前机器平台）
	docker compose -f docs/docker-compose.yml build --build-arg VERSION=$(DOCS_VERSION)

docs-build-push: ## 跨平台构建官网镜像并推送（linux/amd64 + linux/arm64）
	docker buildx build --platform linux/amd64,linux/arm64 \
	  --build-arg VERSION=$(DOCS_VERSION) \
	  -t ghcr.io/runzhliu/welink/website:main \
	  --push docs/

docs-up:     ## 启动官网容器
	docker compose -f docs/docker-compose.yml up -d

docs-down:   ## 停止官网容器
	docker compose -f docs/docker-compose.yml down

docs-logs:   ## 跟踪官网容器日志
	docker compose -f docs/docker-compose.yml logs -f

## ─── 服务器部署（官网 + Demo）───────────────────────────────────────────────
## 工作流：
##   本地开发机：make server-push   # 构建并推送镜像到 Docker Hub
##   线上服务器：make server-up     # 拉取镜像并启动（无需在服务器上编译）
##              make server-pull   # 更新：git pull + docker pull + restart
##
## 官网：https://welink.click    Demo：https://demo.welink.click

DOCKER_USER   := runzhliu
BUILD_PLATFORMS := linux/amd64,linux/arm64

## _server-build-push 使用 docker buildx 一次性多平台构建并推送
## 用法：$(call _server-build-push,<tag>,<context>[,extra-build-args])
## 需要先执行一次：docker buildx create --name welink --use（仅首次）
define _server-build-push
	@echo "→ buildx $(1) (amd64 + arm64)"; \
	docker buildx build $(3) \
		--platform linux/amd64,linux/arm64 \
		-t $(1):latest \
		--push \
		$(2)
endef

server-push: ## 【本地执行】多平台构建并推送到 Docker Hub（amd64 + arm64，需已 docker login）
	@docker buildx use welink 2>/dev/null || docker buildx create --name welink --driver docker-container --use
	$(call _server-build-push,$(DOCKER_USER)/welink-website,docs/,--build-arg VERSION=$(DOCS_VERSION))
	$(call _server-build-push,$(DOCKER_USER)/welink-frontend,frontend/)
	$(call _server-build-push,$(DOCKER_USER)/welink-backend,backend/,--build-arg APP_VERSION=$(APP_VERSION) --build-arg GIT_COMMIT=$(GIT_COMMIT))

server-up:   ## 【服务器执行】拉取最新镜像并启动官网 + Demo
	docker compose -f server-compose.yml pull
	docker compose -f server-compose.yml up -d

server-down: ## 停止官网 + Demo 所有容器
	docker compose -f server-compose.yml down

server-logs: ## 跟踪官网 + Demo 容器日志
	docker compose -f server-compose.yml logs -f

server-pull: ## 【服务器执行】git pull + 拉取新镜像 + 重启（一键更新）
	git pull
	docker compose -f server-compose.yml pull
	docker compose -f server-compose.yml up -d

## ─── 本地开发部署 ─────────────────────────────────────────────
dev-deploy:  ## 本地 build 并部署（需设置 DEV_DOMAIN 环境变量）
	docker compose -f docker-compose.dev.yml up --build -d
	@echo ""
	@echo "✅  部署完成：https://$(DEV_DOMAIN)"

dev-down:    ## 停止本地开发部署
	docker compose -f docker-compose.dev.yml down

dev-logs:    ## 跟踪本地开发部署日志
	docker compose -f docker-compose.dev.yml logs -f

## ─── 构建 ────────────────────────────────────────────────────────────────────

build: build-backend build-frontend  ## 构建后端 + 前端

build-backend:   ## 编译后端二进制（本地，无 CGO）
	cd backend && CGO_ENABLED=0 go build -ldflags="-X main.appVersion=$(APP_VERSION) -X main.gitCommit=$(GIT_COMMIT)" -o welink-backend .

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
GIT_COMMIT  := $(or $(_GIT_SHA),unknown)

dmg: _dmg-package  ## 打包 macOS .app + 通用二进制 + DMG
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
	  go build -tags app -ldflags="-s -w -X main.appVersion=$(APP_VERSION) -X main.gitCommit=$(GIT_COMMIT)" -o welink-arm64 .
	@echo "→ 编译 amd64 (Intel)..."
	cd backend && \
	  CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
	  CGO_CFLAGS="-target x86_64-apple-macos12 -isysroot $(SYSROOT)" \
	  CGO_LDFLAGS="-target x86_64-apple-macos12 -isysroot $(SYSROOT)" \
	  CC="xcrun clang -arch x86_64" \
	  go build -tags app -ldflags="-s -w -X main.appVersion=$(APP_VERSION) -X main.gitCommit=$(GIT_COMMIT)" -o welink-amd64 .
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

_dmg-package: _dmg-bundle
	mkdir -p dist
	# Ad-hoc 签名：解决 Gatekeeper「身份不明开发者」拦截
	codesign --force --deep --sign - "$(APP_DIR)"
	# 移除本地构建产生的隔离属性，避免 macOS 弹出「无法打开」
	xattr -cr "$(APP_DIR)"
	rm -f "dist/$(DMG_NAME).dmg"
	pip3 install --quiet --break-system-packages dmgbuild 2>/dev/null || pip3 install --quiet dmgbuild
	python3 -m dmgbuild -s assets/dmg-settings.py \
		-D app="$(APP_DIR)" \
		"$(DMG_NAME)" "dist/$(DMG_NAME).dmg"
	rm -f backend/$(DMG_NAME)

## ─── Windows App & EXE ───────────────────────────────────────────────────────

EXE_NAME  := WeLink
EXE_DIR   := dist/windows

exe: _exe-package  ## 打包 Windows .exe + ZIP（需 GOOS=windows，无需 CGO）
	@echo ""
	@echo "✅  EXE 打包完成：dist/$(EXE_NAME)-windows-amd64.zip"
	@echo "    用法：解压后将 decrypted\\ 与 WeLink.exe 放在同一目录，双击运行。"

_exe-frontend:
	cd frontend && npm install && npm run build
	rm -rf backend/static && mkdir -p backend/static
	cp -r frontend/dist/. backend/static/

_exe-binary: _exe-frontend
	@echo "→ 生成 Windows 资源文件（图标 + 版本信息）..."
	@cd backend && python3 -c "\
import json; \
v='$(APP_VERSION)'.lstrip('v').split('-')[0].split('.'); \
parts=(v+['0','0','0'])[:4]; \
d=json.load(open('versioninfo.json')); \
fv={'Major':int(parts[0]) if parts[0].isdigit() else 0,'Minor':int(parts[1]) if parts[1].isdigit() else 0,'Patch':int(parts[2]) if parts[2].isdigit() else 0,'Build':0}; \
d['FixedFileInfo']['FileVersion']=fv; d['FixedFileInfo']['ProductVersion']=fv; \
d['StringFileInfo']['FileVersion']='$(APP_VERSION)'; \
d['StringFileInfo']['ProductVersion']='$(APP_VERSION)'; \
json.dump(d,open('versioninfo_build.json','w'),ensure_ascii=False,indent=2)"
	@cd backend && if command -v goversioninfo >/dev/null 2>&1; then \
	  goversioninfo -o resource_windows.syso versioninfo_build.json && echo "→ 资源文件已嵌入（图标 + 版本信息）"; \
	else \
	  echo "→ 跳过资源嵌入（goversioninfo 未安装，可运行 go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest 安装）"; \
	fi
	@rm -f backend/versioninfo_build.json
	@echo "→ 编译 Windows amd64（CGO_ENABLED=0，纯 Go WebView2）..."
	cd backend && \
	  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
	  go build -tags app \
	    -ldflags="-s -w -H windowsgui -X main.appVersion=$(APP_VERSION) -X main.gitCommit=$(GIT_COMMIT)" \
	    -o $(EXE_NAME).exe .
	rm -f backend/resource_windows.syso

_exe-package: _exe-binary
	mkdir -p $(EXE_DIR)
	mv backend/$(EXE_NAME).exe $(EXE_DIR)/$(EXE_NAME).exe
	cd dist && zip -r $(EXE_NAME)-windows-amd64.zip windows/$(EXE_NAME).exe

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
