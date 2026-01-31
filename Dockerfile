# syntax=docker/dockerfile:1

# Stage 1: Build the Go Manager
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go module files
COPY go.mod ./
# RUN go mod download

# Copy source code
COPY . .

# Build the binary
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -ldflags="-w -s" -o phantun-manager main.go

# Stage 2: Phantun Binaries Downloader
FROM alpine:latest AS downloader

RUN apk add --no-cache curl zip

ARG PHANTUN_VERSION=0.6.0
ARG TARGETARCH

WORKDIR /downloads
# Download correct binary for architecture
# Naming: phantun_{arch}-unknown-linux-musl.zip
RUN case "${TARGETARCH}" in \
    "amd64") ARCH="x86_64-unknown-linux-musl" ;; \
    "arm64") ARCH="aarch64-unknown-linux-musl" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    curl -L "https://github.com/dndx/phantun/releases/download/v${PHANTUN_VERSION}/phantun_${ARCH}.zip" -o phantun.zip && \
    unzip phantun.zip

# Stage 3: Final Runtime Image
FROM alpine:latest

# Install runtime dependencies including curl for healthcheck
RUN apk add --no-cache iptables ip6tables iproute2 ca-certificates bash curl

WORKDIR /app

# Copy binaries
COPY --from=downloader /downloads/phantun_client /usr/local/bin/phantun_client
COPY --from=downloader /downloads/phantun_server /usr/local/bin/phantun_server
COPY --from=builder /app/phantun-manager /app/phantun-manager

# Create config directory
RUN mkdir -p /etc/phantun

# Set environment
ENV PHANTUN_CONFIG=/etc/phantun/config.json

# Expose Web UI port
EXPOSE 8080

# Entrypoint
CMD ["/app/phantun-manager"]
