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

clean:           ## 删除本地编译产物
	rm -f backend/welink-backend
	rm -f mcp-server/welink-mcp
	rm -rf frontend/dist

## ─── 帮助 ────────────────────────────────────────────────────────────────────

help:            ## 显示所有可用 target
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
