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

# Stage 2: Phantun Binaries Downloader & Compressor
FROM alpine:latest AS downloader

RUN apk add --no-cache curl zip upx ca-certificates
ARG PHANTUN_VERSION=latest
ARG TARGETARCH

WORKDIR /downloads

# Download correct binary for architecture from iHub-2020
# Download correct binary for architecture from iHub-2020
# Use dynamic version resolution
RUN VERSION="${PHANTUN_VERSION:-latest}" && \
    if [ "$VERSION" = "latest" ]; then \
    echo "Resolving latest version..."; \
    TAG=$(curl -s https://api.github.com/repos/iHub-2020/phantun/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'); \
    echo "Latest version resolved: ${TAG}"; \
    else \
    TAG="v${VERSION}"; \
    echo "Using specified version: ${TAG}"; \
    fi && \
    case "${TARGETARCH}" in \
    "amd64") ARCH="x86_64" ;; \
    "arm64") ARCH="aarch64" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    DOWNLOAD_URL="https://github.com/iHub-2020/phantun/releases/download/${TAG}/phantun_${ARCH}.zip" && \
    echo "Downloading from: ${DOWNLOAD_URL}" && \
    curl -fL "${DOWNLOAD_URL}" -o phantun.zip && \
    unzip phantun.zip && \
    chmod +x phantun_client phantun_server && \
    upx --best --lzma phantun_client phantun_server

# Stage 3: Final Runtime Image
FROM alpine:latest

# Install runtime dependencies (only essential)
RUN apk add --no-cache iptables ip6tables iproute2 ca-certificates curl

WORKDIR /app

# Copy binaries
COPY --from=downloader /downloads/phantun_client /usr/local/bin/phantun_client
COPY --from=downloader /downloads/phantun_server /usr/local/bin/phantun_server
COPY --from=builder /app/phantun-manager /app/phantun-manager

# Create config directory
RUN mkdir -p /etc/phantun

# Set environment
ENV PHANTUN_CONFIG=/etc/phantun/config.json
ENV PATH="/usr/local/bin:$PATH"

# MANDATORY: Health Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/status || exit 1

# Expose Web UI port
EXPOSE 8080

# Entrypoint
CMD ["/app/phantun-manager"]
