package iptables

import (
	"fmt"
	"log"
	"os/exec"
	"phantun-docker/internal/config"
	"strings"
)

// SetupClient applies iptables rules for Client mode
func SetupClient(c config.ClientConfig) error {
	// iptables -t nat -A POSTROUTING -s {tun_peer}/32 -m comment --comment "phantun" -j MASQUERADE
	return runIptables("-t", "nat", "-A", "POSTROUTING",
		"-s", c.TunPeer+"/32",
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
}

// CleanupClient removes iptables rules for Client mode
func CleanupClient(c config.ClientConfig) error {
	return runIptables("-t", "nat", "-D", "POSTROUTING",
		"-s", c.TunPeer+"/32",
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

// CleanupAll removes ALL rules created by Phantun (marked with comment "phantun")
// This implements the "Clean Slate" strategy.
func CleanupAll() error {
	// 1. Get all rules
	saveCmd := exec.Command("iptables-save")
	out, err := saveCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to list rules: %w", err)
	}

	lines := strings.Split(string(out), "\n")
	var commands [][]string

	// 2. Parse lines to find Phantun rules
	for _, line := range lines {
		// Example line: -A POSTROUTING -s 192.168.200.1/32 -m comment --comment "phantun" -j MASQUERADE
		if strings.Contains(line, "--comment \"phantun\"") {
			// We only care about MASQUERADE and DNAT for now, to be safe
			if strings.Contains(line, "-j MASQUERADE") || strings.Contains(line, "-j DNAT") {
				// Convert "-A" to "-D"
				// iptables-save output is like: -A CHAIN ...
				// We need to construct: iptables -t nat -D CHAIN ...

				// Basic parsing:
				// Line starts with -A <CHAIN> <ARGS...>
				// We want: -D <CHAIN> <ARGS...>

				parts := strings.Fields(line)
				if len(parts) < 3 || parts[0] != "-A" {
					continue
				}

				// Reconstruct args for deletion
				// Note: iptables-save output usually doesn't include table name in the line,
				// it's in the *nat header. We assume these are NAT rules because we only use NAT.

				// Replace -A with -D
				parts[0] = "-D"
				commands = append(commands, parts)
			}
		}
	}

	// 3. Execute deletions
	for _, cmdArgs := range commands {
		// Prepend "-t nat" assuming all our rules are in nat table
		fullArgs := append([]string{"-t", "nat"}, cmdArgs...)

		fmt.Printf("Cleaning rule: iptables %s\n", strings.Join(fullArgs, " "))

		cmd := exec.Command("iptables", fullArgs...)
		if out, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Failed to delete rule: %v, output: %s", err, string(out))
			// Continue cleaning others
		}
	}

	return nil
}

// GetStats returns a map of rule counts
func GetStats() (map[string]int, error) {
	rules, err := GetRules()
	if err != nil {
		return nil, err
	}

	// We count lines that contain our marker tag
	// Logic: Split by newline -> filter "comment phantun" -> count MASQUERADE/DNAT
	lines := strings.Split(rules, "\n")
	masq := 0
	dnat := 0

	for _, line := range lines {
		if strings.Contains(line, "phantun") {
			if strings.Contains(line, "MASQUERADE") {
				masq++
			}
			if strings.Contains(line, "DNAT") {
				dnat++
			}
		}
	}

	stats := map[string]int{
		"masquerade": masq,
		"dnat":       dnat,
	}
	stats["total"] = stats["masquerade"] + stats["dnat"]
	return stats, nil
}
