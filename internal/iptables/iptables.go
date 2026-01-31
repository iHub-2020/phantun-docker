package iptables

import (
	"fmt"
	"log"
	"os/exec"
	"phantun-docker/internal/config"
)

// SetupClient applies iptables rules for Client mode
func SetupClient(c config.ClientConfig) error {
	// iptables -t nat -A POSTROUTING -s {tun_peer}/32 -m comment --comment "phantun" -j MASQUERADE
	return runIptables("-t", "nat", "-A", "POSTROUTING", 
		"-s", c.TunPeer + "/32", 
		"-m", "comment", "--comment", "phantun", 
		"-j", "MASQUERADE")
}

// CleanupClient removes iptables rules for Client mode
func CleanupClient(c config.ClientConfig) error {
	return runIptables("-t", "nat", "-D", "POSTROUTING", 
		"-s", c.TunPeer + "/32", 
		"-m", "comment", "--comment", "phantun", 
		"-j", "MASQUERADE")
}

// SetupServer applies iptables rules for Server mode
func SetupServer(s config.ServerConfig) error {
	// 1. DNAT: TCP dport {local_port} -> {tun_peer}:{remote_port}
	// Note: Phantun Server listens on TCP, but decapsulates to UDP to target?
	// The init script uses TCP for DNAT.
	// iptables -t nat -A PREROUTING -p tcp --dport {local_port} ... -j DNAT ...
	err := runIptables("-t", "nat", "-A", "PREROUTING", 
		"-p", "tcp", "--dport", s.LocalPort, 
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", fmt.Sprintf("%s:%s", s.TunPeer, s.RemotePort))
	if err != nil {
		return err
	}

	// 2. MASQUERADE: TCP dst {tun_peer} dport {remote_port}
	// iptables -t nat -A POSTROUTING -p tcp -d {tun_peer} --dport {remote_port} -j MASQUERADE
	return runIptables("-t", "nat", "-A", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeer, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
}

// CleanupServer removes iptables rules for Server mode
func CleanupServer(s config.ServerConfig) error {
	// Ignore errors during cleanup
	runIptables("-t", "nat", "-D", "PREROUTING", 
		"-p", "tcp", "--dport", s.LocalPort, 
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", fmt.Sprintf("%s:%s", s.TunPeer, s.RemotePort))

	runIptables("-t", "nat", "-D", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeer, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
	return nil
}

func runIptables(args ...string) error {
	cmd := exec.Command("iptables", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("iptables error: %v, output: %s", err, string(out))
		return fmt.Errorf("iptables failed: %w", err)
	}
	return nil
}

// GetRules returns current iptables-save output
func GetRules() (string, error) {
	cmd := exec.Command("iptables-save")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
