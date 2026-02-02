package config

import (
	"encoding/json"
	"os"
	"sync"
)

// GeneralConfig holds global settings
type GeneralConfig struct {
	Enabled  bool   `json:"enabled"`
	LogLevel string `json:"log_level"` // "info", "debug", "error"
}

// ClientConfig holds Phantun Client settings
type ClientConfig struct {
	ID            string `json:"id"` // Unique ID for management
	Alias         string `json:"alias"`
	Enabled       bool   `json:"enabled"`
	LocalAddr     string `json:"local_addr"`
	LocalPort     string `json:"local_port"`
	RemoteAddr    string `json:"remote_addr"`
	RemotePort    string `json:"remote_port"`
	TunLocal      string `json:"tun_local"`
	TunPeer       string `json:"tun_peer"`
	TunLocalIPv6  string `json:"tun_local_ipv6,omitempty"`
	TunPeerIPv6   string `json:"tun_peer_ipv6,omitempty"`
	TunName       string `json:"tun_name,omitempty"`
	HandshakeFile string `json:"handshake_file,omitempty"`
	IPv4Only      bool   `json:"ipv4_only,omitempty"`
}

// ServerConfig holds Phantun Server settings
type ServerConfig struct {
	ID            string `json:"id"`
	Alias         string `json:"alias"`
	Enabled       bool   `json:"enabled"`
	LocalPort     string `json:"local_port"`
	RemoteAddr    string `json:"remote_addr"`
	RemotePort    string `json:"remote_port"`
	TunLocal      string `json:"tun_local"`
	TunPeer       string `json:"tun_peer"`
	TunLocalIPv6  string `json:"tun_local_ipv6,omitempty"`
	TunPeerIPv6   string `json:"tun_peer_ipv6,omitempty"`
	TunName       string `json:"tun_name,omitempty"`
	HandshakeFile string `json:"handshake_file,omitempty"`
	IPv4Only      bool   `json:"ipv4_only,omitempty"`
}

// Config represents the application configuration
type Config struct {
	General GeneralConfig  `json:"general"`
	Clients []ClientConfig `json:"clients"`
	Servers []ServerConfig `json:"servers"`
	mu      sync.RWMutex   `json:"-"`
	Path    string         `json:"-"` // File path for saving
}

// DefaultConfig returns a default configuration
func DefaultConfig() *Config {
	return &Config{
		General: GeneralConfig{
			Enabled:  false,
			LogLevel: "info",
		},
		Clients: []ClientConfig{},
		Servers: []ServerConfig{},
	}
}

// Load reads configuration from file
func Load(path string) (*Config, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := DefaultConfig()
			cfg.Path = path
			return cfg, nil
		}
		return nil, err
	}
	defer f.Close()

	var cfg Config
	if err := json.NewDecoder(f).Decode(&cfg); err != nil {
		return nil, err
	}
	cfg.Path = path
	return &cfg, nil
}

// Save writes configuration to file
func (c *Config) Save() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.Path == "" {
		return os.ErrInvalid
	}

	f, err := os.Create(c.Path)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(c)
}

// Update updates the configuration fields in a thread-safe manner
func (c *Config) Update(general GeneralConfig, clients []ClientConfig, servers []ServerConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.General = general
	c.Clients = clients
	c.Servers = servers
}
