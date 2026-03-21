# Build stage
FROM node:18-alpine AS builder
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
    location /api {\n\
        set $backend http://backend:8080;\n\
        proxy_pass $backend;\n\
    }\n\
    location /swagger {\n\
        set $backend http://backend:8080;\n\
        proxy_pass $backend;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
