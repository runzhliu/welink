FROM node:20-alpine AS builder

ARG VERSION=dev

# VitePress 的 lastUpdated 会 spawn git；即使 build context 不含 .git，
# git 二进制不存在会直接抛 ENOENT 终止构建。装上即可让 VitePress 优雅降级。
RUN apk add --no-cache git

WORKDIR /app
COPY package.json ./
# 仓库 .npmrc 走 npmmirror（国内镜像）方便开发，但 docker build 偶尔会卡死，
# 强制走官方源避坑（同前端 Dockerfile）。
RUN npm install --registry=https://registry.npmjs.org/
COPY . .

# 将版本号注入到文档中（替换占位符 {{VERSION}}）
RUN sed -i "s/{{VERSION}}/${VERSION}/g" install.md

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/.vitepress/dist /usr/share/nginx/html
COPY nginx/default.conf                  /etc/nginx/templates/default.conf
COPY nginx/http-only.conf                /etc/nginx/templates/http-only.conf
COPY docker-entrypoint.sh               /docker-entrypoint.sh
COPY init-letsencrypt.sh                /init-letsencrypt.sh
RUN chmod +x /docker-entrypoint.sh /init-letsencrypt.sh \
    && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.sh"]
