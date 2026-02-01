package process

import (
	"fmt"
	"log"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"phantun-docker/internal/config"
	"phantun-docker/internal/iptables"
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
}

func NewManager(cfg *config.Config) *Manager {
	return &Manager{
		processes:  make(map[string]*Process),
		cfg:        cfg,
		logClients: make(map[chan LogMessage]bool),
	}
}

// BroadcastLog sends a log message to all connected clients
func (m *Manager) BroadcastLog(msg LogMessage) {
	m.logClientsMu.Lock()
	defer m.logClientsMu.Unlock()
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

		// Cleanup iptables
		if p.Type == "client" {
			if err := iptables.CleanupClient(p.ClientCfg); err != nil {
				log.Printf("Failed to clean iptables for client %s: %v", id, err)
			}
		} else if p.Type == "server" {
			if err := iptables.CleanupServer(p.ServerCfg); err != nil {
				log.Printf("Failed to clean iptables for server %s: %v", id, err)
			}
		}

		delete(m.processes, id)
	}
}

// StartAll starts all enabled instances from config
func (m *Manager) StartAll() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.cfg.General.Enabled {
		log.Println("Global switch disabled. Skipping start.")
		return nil
	}

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
	// 1. Setup Iptables
	if err := iptables.SetupClient(c); err != nil {
		return fmt.Errorf("iptables setup failed: %w", err)
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

	cmd := exec.Command("phantun_client", args...)

	// Capture output
	m.captureOutput(cmd, c.ID)

	if err := cmd.Start(); err != nil {
		// Cleanup iptables on failure
		iptables.CleanupClient(c)
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
	// 1. Setup Iptables
	if err := iptables.SetupServer(s); err != nil {
		return fmt.Errorf("iptables setup failed: %w", err)
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

	cmd := exec.Command("phantun_server", args...)

	// Capture output
	m.captureOutput(cmd, s.ID)

	if err := cmd.Start(); err != nil {
		iptables.CleanupServer(s)
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
