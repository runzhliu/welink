FROM node:20-alpine AS builder

ARG VERSION=dev

WORKDIR /app
COPY package.json ./
RUN npm install
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
