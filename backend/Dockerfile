# Build stage
#
# 多架构构建时 builder 固定在 runner 原生平台（$BUILDPLATFORM），
# 用 Go 原生交叉编译到目标平台（$TARGETOS / $TARGETARCH），
# 比走 QEMU 模拟跑整个 Go toolchain 快 3-5 倍。
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go env -w GOPROXY=https://goproxy.cn,direct && \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -ldflags="-s -w -X main.appVersion=${APP_VERSION} -X main.gitCommit=${GIT_COMMIT}" -o welink-backend .

# Final stage
FROM alpine:3.21
RUN adduser -D -u 1001 welink && \
    mkdir -p /app/prefs && \
    chown -R welink:welink /app
WORKDIR /app
COPY --from=builder /app/welink-backend .
RUN chown welink:welink /app/welink-backend
USER welink
EXPOSE 8080
ENV GIN_MODE=release
ENV DATA_DIR=/app/data
# 容器内必须监听 0.0.0.0 才能接收 docker 端口映射进来的流量；
# 由 docker-compose.yml 里的 127.0.0.1:8080:8080 限制宿主机暴露范围。
ENV WELINK_LISTEN_LAN=1
CMD ["./welink-backend"]
