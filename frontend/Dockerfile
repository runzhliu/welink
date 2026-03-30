# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
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
