# Build stage
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o welink-backend .

# Final stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/welink-backend .
EXPOSE 8080
ENV GIN_MODE=release
ENV DATA_DIR=/app/data
CMD ["./welink-backend"]
