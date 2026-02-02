package process

import (
	"fmt"
	"log"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"crypto/md5"
	"encoding/hex"
	"io"
	"os"
	"phantun-docker/internal/config"
	"phantun-docker/internal/iptables"
	"phantun-docker/internal/system"
)

// Process represents a running Phantun instance
type Process struct {
	ConfigID  string
	Cmd       *exec.Cmd
	Type      string // "client" or "server"
	StartTime time.Time
	ClientCfg config.ClientConfig
	ServerCfg config.ServerConfig
}

// ProcessDTO for API
type ProcessDTO struct {
	ID      string `json:"id"`
	Alias   string `json:"alias"`
	Type    string `json:"type"`
	PID     int    `json:"pid"`
	Running bool   `json:"running"`
}

// LogMessage represents a log entry
type LogMessage struct {
	Timestamp time.Time `json:"timestamp"`
	ProcessID string    `json:"process_id"` // Config ID
	Stream    string    `json:"stream"`     // "stdout" or "stderr"
	Content   string    `json:"content"`
}

// Manager handles all running processes
type Manager struct {
	processes map[string]*Process
	mu        sync.Mutex
	cfg       *config.Config

	// Log broadcasting
	logClients   map[chan LogMessage]bool
	logClientsMu sync.Mutex
	logBuffer    []LogMessage
	logBufferMax int
}

func NewManager(cfg *config.Config) *Manager {
	return &Manager{
		processes:    make(map[string]*Process),
		cfg:          cfg,
		logClients:   make(map[chan LogMessage]bool),
		logBuffer:    make([]LogMessage, 0, 100),
		logBufferMax: 100,
	}
}

// BroadcastLog sends a log message to all connected clients
func (m *Manager) BroadcastLog(msg LogMessage) {
	m.logClientsMu.Lock()
	defer m.logClientsMu.Unlock()

	// Append to buffer
	if len(m.logBuffer) >= m.logBufferMax {
		// Shift
		m.logBuffer = m.logBuffer[1:]
	}
	m.logBuffer = append(m.logBuffer, msg)

	for ch := range m.logClients {
		select {
		case ch <- msg:
		default:
			// Drop message if client is too slow
		}
	}
}

// SubscribeLogs returns a channel for receiving logs
func (m *Manager) SubscribeLogs() chan LogMessage {
	ch := make(chan LogMessage, 100)
	m.logClientsMu.Lock()

	// Replay buffer
	for _, msg := range m.logBuffer {
		select {
		case ch <- msg:
		default:
		}
	}

	m.logClients[ch] = true
	m.logClientsMu.Unlock()
	return ch
}

// UnsubscribeLogs removes a subscriber
func (m *Manager) UnsubscribeLogs(ch chan LogMessage) {
	m.logClientsMu.Lock()
	delete(m.logClients, ch)
	m.logClientsMu.Unlock()
	close(ch)
}

// Helper to capture output
func (m *Manager) captureOutput(cmd *exec.Cmd, id string) {
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				m.BroadcastLog(LogMessage{
					Timestamp: time.Now(),
					ProcessID: id,
					Stream:    "stdout",
					Content:   string(buf[:n]),
				})
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				m.BroadcastLog(LogMessage{
					Timestamp: time.Now(),
					ProcessID: id,
					Stream:    "stderr",
					Content:   string(buf[:n]),
				})
			}
			if err != nil {
				return
			}
		}
	}()
}

// StopAll stops all running processes
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, p := range m.processes {
		log.Printf("Stopping process %s (%s)", id, p.Type)
		if p.Cmd.Process != nil {
			p.Cmd.Process.Signal(syscall.SIGTERM)
		}
		// Note: We don't cleanup individual rules here anymore.
		// We rely on the global strategy.
		delete(m.processes, id)
	}

	// FORCE CLEANUP: Strict Policy
	// When stopping all, we must sanitize the firewall environment.
	if err := iptables.CleanupAll(); err != nil {
		log.Printf("Error during forced cleanup: %v", err)
	} else {
		log.Println("Global firewall cleanup executed.")
	}
}

// StartAll starts all enabled instances from config
func (m *Manager) StartAll() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. Check Global Switch
	if !m.cfg.General.Enabled {
		log.Println("Global switch disabled. Skipping start.")
		// Firewall rules are already cleaned by StopAll or Main Init.
		return nil
	}

	// 2. CLEANUP ZOMBIE INTERFACES
	// Before starting anything, we ensure only explicitly configured TUN interfaces exist.
	allowedTuns := []string{}
	for _, c := range m.cfg.Clients {
		if c.TunName != "" {
			allowedTuns = append(allowedTuns, c.TunName)
		}
	}
	for _, s := range m.cfg.Servers {
		if s.TunName != "" {
			allowedTuns = append(allowedTuns, s.TunName)
		}
	}

	if err := system.CleanupUnusedTunInterfaces(allowedTuns); err != nil {
		log.Printf("Warning: Failed to cleanup zombie interfaces: %v", err)
	}

	// 3. Count Active Instances
	activeCount := 0
	for _, client := range m.cfg.Clients {
		if client.Enabled {
			activeCount++
		}
	}
	for _, server := range m.cfg.Servers {
		if server.Enabled {
			activeCount++
		}
	}

	// 3. Check Effective Instances
	if activeCount == 0 {
		log.Println("No enabled instances found. Skipping start.")
		return nil
	}

	// 4. Proceed with Startup
	log.Printf("Starting %d active instances...", activeCount)

	for _, client := range m.cfg.Clients {
		if client.Enabled {
			if err := m.startClient(client); err != nil {
				log.Printf("Failed to start client %s: %v", client.Alias, err)
			}
		}
	}

	for _, server := range m.cfg.Servers {
		if server.Enabled {
			if err := m.startServer(server); err != nil {
				log.Printf("Failed to start server %s: %v", server.Alias, err)
			}
		}
	}
	return nil
}

func (m *Manager) startClient(c config.ClientConfig) error {
	// 0. Apply Defaults
	if c.TunLocal == "" {
		c.TunLocal = "192.168.200.1"
	}
	if c.TunPeer == "" {
		c.TunPeer = "192.168.200.2"
	}

	// 1. Setup Iptables (IPv4)
	if err := iptables.SetupClient(c); err != nil {
		return fmt.Errorf("iptables setup failed: %w", err)
	}
	// Setup IPv6 if enabled
	if !c.IPv4Only {
		// Use defaults if empty, matching Rust defaults
		if c.TunPeerIPv6 == "" {
			c.TunPeerIPv6 = "fcc8::2"
		}
		if err := iptables.SetupClientIPv6(c); err != nil {
			log.Printf("Warning: Failed to setup IPv6 firewall for client %s: %v", c.Alias, err)
			// Don't fail hard, user might not have IPv6
		}
	}

	// 2. Start Binary
	args := []string{
		"--local", fmt.Sprintf("%s:%s", c.LocalAddr, c.LocalPort),
		"--remote", fmt.Sprintf("%s:%s", c.RemoteAddr, c.RemotePort),
		"--tun-local", c.TunLocal,
		"--tun-peer", c.TunPeer,
	}
	if c.TunName != "" {
		args = append(args, "--tun", c.TunName)
	}

	// Handle IPv6 / IPv4Only
	if c.IPv4Only {
		args = append(args, "--ipv4-only")
	} else {
		if c.TunLocalIPv6 != "" {
			args = append(args, "--tun-local6", c.TunLocalIPv6)
		}
		if c.TunPeerIPv6 != "" {
			args = append(args, "--tun-peer6", c.TunPeerIPv6)
		}
	}

	// Handle Handshake
	if c.HandshakeFile != "" {
		args = append(args, "--handshake-packet", c.HandshakeFile)
	}

	cmd := exec.Command("phantun_client", args...)

	// Capture output
	m.captureOutput(cmd, c.ID)

	if err := cmd.Start(); err != nil {
		// Cleanup iptables on failure
		iptables.CleanupClient(c)
		if !c.IPv4Only {
			iptables.CleanupClientIPv6(c)
		}
		return err
	}

	m.processes[c.ID] = &Process{
		ConfigID:  c.ID,
		Cmd:       cmd,
		Type:      "client",
		StartTime: time.Now(),
		ClientCfg: c,
	}
	log.Printf("Started Client %s (PID %d)", c.Alias, cmd.Process.Pid)
	return nil
}

func (m *Manager) startServer(s config.ServerConfig) error {
	// 0. Apply Defaults
	if s.TunLocal == "" {
		s.TunLocal = "192.168.201.1"
	}
	if s.TunPeer == "" {
		s.TunPeer = "192.168.201.2"
	}

	// 1. Setup Iptables (IPv4)
	if err := iptables.SetupServer(s); err != nil {
		return fmt.Errorf("iptables setup failed: %w", err)
	}
	// Setup IPv6
	if !s.IPv4Only {
		if s.TunPeerIPv6 == "" {
			s.TunPeerIPv6 = "fcc9::2"
		}
		if err := iptables.SetupServerIPv6(s); err != nil {
			log.Printf("Warning: Failed to setup IPv6 firewall for server %s: %v", s.Alias, err)
		}
	}

	args := []string{
		"--local", s.LocalPort,
		"--remote", fmt.Sprintf("%s:%s", s.RemoteAddr, s.RemotePort),
		"--tun-local", s.TunLocal,
		"--tun-peer", s.TunPeer,
	}
	if s.TunName != "" {
		args = append(args, "--tun", s.TunName)
	}

	// Handle IPv6 / IPv4Only
	if s.IPv4Only {
		args = append(args, "--ipv4-only")
	} else {
		if s.TunLocalIPv6 != "" {
			args = append(args, "--tun-local6", s.TunLocalIPv6)
		}
		if s.TunPeerIPv6 != "" {
			args = append(args, "--tun-peer6", s.TunPeerIPv6)
		}
	}

	// Handle Handshake
	if s.HandshakeFile != "" {
		args = append(args, "--handshake-packet", s.HandshakeFile)
	}

	cmd := exec.Command("phantun_server", args...)

	// Capture output
	m.captureOutput(cmd, s.ID)

	if err := cmd.Start(); err != nil {
		iptables.CleanupServer(s)
		if !s.IPv4Only {
			iptables.CleanupServerIPv6(s)
		}
		return err
	}

	m.processes[s.ID] = &Process{
		ConfigID:  s.ID,
		Cmd:       cmd,
		Type:      "server",
		StartTime: time.Now(),
		ServerCfg: s,
	}
	log.Printf("Started Server %s (PID %d)", s.Alias, cmd.Process.Pid)
	return nil
}

// GetStatus returns the list of running processes
func (m *Manager) GetStatus() []ProcessDTO {
	m.mu.Lock()
	defer m.mu.Unlock()

	var list []ProcessDTO
	for _, p := range m.processes {
		// Basic check if process is likely running
		// In a real manager, we should use os.FindProcess or monitor exit channel
		running := true
		if p.Cmd.ProcessState != nil && p.Cmd.ProcessState.Exited() {
			running = false
		}

		alias := ""
		if p.Type == "client" {
			alias = p.ClientCfg.Alias
		} else {
			alias = p.ServerCfg.Alias
		}

		list = append(list, ProcessDTO{
			ID:      p.ConfigID,
			Alias:   alias,
			Type:    p.Type,
			PID:     p.Cmd.Process.Pid,
			Running: running,
		})
	}
	return list
}

// CheckBinaries verifies if Phantun executables are present (Deprecated, use GetBinariesInfo)
func (m *Manager) CheckBinaries() bool {
	_, err1 := exec.LookPath("phantun_client")
	_, err2 := exec.LookPath("phantun_server")
	return err1 == nil && err2 == nil
}

// GetBinariesInfo returns detailed binary info
func (m *Manager) GetBinariesInfo() map[string]interface{} {
	info := map[string]interface{}{
		"client": "missing",
		"server": "missing",
		"ok":     false,
	}

	if path, err := exec.LookPath("phantun_client"); err == nil {
		info["client"] = getFileHash(path)
	}
	if path, err := exec.LookPath("phantun_server"); err == nil {
		info["server"] = getFileHash(path)
	}

	if info["client"] != "missing" && info["server"] != "missing" {
		info["ok"] = true
	}
	return info
}

func getFileHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return "readable-error"
	}
	defer f.Close()

	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "hash-error"
	}
	return hex.EncodeToString(h.Sum(nil))[:8] // Short hash
}
