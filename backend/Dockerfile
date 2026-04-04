# Build stage
FROM golang:1.23-alpine AS builder
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go env -w GOPROXY=https://goproxy.cn,direct && \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X main.appVersion=${APP_VERSION} -X main.gitCommit=${GIT_COMMIT}" -o welink-backend .

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
CMD ["./welink-backend"]
