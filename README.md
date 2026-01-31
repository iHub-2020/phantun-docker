# Phantun Docker Manager

A lightweight, efficient, and user-friendly Docker container for managing [Phantun](https://github.com/dndx/phantun) UDP-to-TCP obfuscation services.

## ✨ Features

*   **Lightweight**: Built with **Go (Golang)** and Alpine Linux. Minimal resource usage (< 30MB image).
*   **Web UI**: Premium dark-themed interface for managing instances (Client & Server modes).
*   **Zero Dependencies**: Single binary architecture. No Python/Pip or Node.js required at runtime.
*   **Hot Reload**: Restart services instantly from the dashboard.
*   **Diagnostics**: View active IPTables rules directly in the UI.

## 🚀 Quick Start

### Prerequisites
*   Docker & Docker Compose
*   Linux Kernel with TUN/TAP support (Standard on most VPS/Desktops)
*   **Host Networking** is enabled by default for optimal performance and IPTables management.

### Installation

1.  **Clone or Download** this repository.
2.  **Run**:
    ```bash
    docker-compose up -d --build
    ```
3.  **Access the Dashboard**:
    open `http://localhost:8080` (or your server IP).

## 🛠 Configuration

Configuration is stored in `config/config.json`. The web interface is the recommended way to modify it.

### Docker Compose
```yaml
services:
  phantun:
    network_mode: "host"       # Required for iptables/tun
    cap_add:
      - NET_ADMIN              # Required for TUN creation
    devices:
      - /dev/net/tun           # Phantun needs this
    volumes:
      - ./config:/etc/phantun  # Persist config
```

## 🖥 Backend Architecture

*   **Language**: Go 1.22
*   **Framework**: Standard Library (net/http)
*   **Assets**: Embedded (HTML/CSS/JS compiled into binary)
*   **Process Management**: Native `os/exec`

## 🎨 Frontend

*   **Design**: Custom Premium Dark Theme (CSS Variables, Responsive)
*   **Logic**: Vanilla JS (ES6+) calling REST API
*   **Speed**: Zero-latency loading (Embedded assets)

## ⚠️ Requirements
*   The container must run with `--cap-add=NET_ADMIN` and `--device /dev/net/tun`.
*   If running on a router (OpenWrt Docker), ensure `kmod-tun` is installed.

---
*Based on `openwrt-reyan_new/luci-app-phantun` logic but rewritten for Cloud Native efficiency.*
