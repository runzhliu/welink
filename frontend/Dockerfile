# Build stage
#
# 多架构构建时让 builder 固定在 runner 原生平台（--platform=$BUILDPLATFORM），
# 避免走 QEMU 模拟跑 Node.js（否则 arm64 上的 npm ci 要慢 5-10 倍，CI 卡死）。
# 前端产物（dist/ 的 JS/CSS/HTML）是纯静态文件、架构无关，
# 可以直接 COPY 给每个目标架构的 nginx final stage。
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# 用官方 registry 装包：仓库的 .npmrc 钉死了 npmmirror（淘宝镜像）方便国内开发，
# 但 CI / docker build 跑到 npmmirror 偶尔会出现 "Exit handler never called!"
# 的神秘失败 —— typescript 没装上、tsc not found、build 直接 exit 127。
# Docker 内强制官方源避坑；--registry 会覆盖 lockfile 的 resolved URL。
RUN npm ci --no-audit --no-fund --registry=https://registry.npmjs.org/
COPY . .
RUN npm run build

# Final stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# 用变量引用 upstream，配合 resolver 让 Nginx 在请求时才解析 backend hostname，
# 避免 backend 未就绪时 Nginx 启动失败
RUN printf 'server {\n\
    listen 80;\n\
    resolver 127.0.0.11 valid=5s;\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location ~* ^/api/ai/(analyze|rag|day-rag) {\n\
        set $backend http://backend:8080;\n\
        proxy_pass $backend;\n\
        proxy_http_version     1.1;\n\
        proxy_set_header       Connection "";\n\
        proxy_buffering        off;\n\
        proxy_cache            off;\n\
        proxy_read_timeout     600s;\n\
        proxy_connect_timeout  10s;\n\
        chunked_transfer_encoding on;\n\
    }\n\
    location /api {\n\
        set $backend http://backend:8080;\n\
        proxy_pass $backend;\n\
        proxy_read_timeout 120s;\n\
    }\n\
    location /swagger {\n\
        set $backend http://backend:8080;\n\
        proxy_pass $backend;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
