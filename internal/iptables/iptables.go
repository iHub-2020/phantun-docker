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
	// SAFETY CHECK: Prevent high-jacking SSH
	if c.LocalPort == "22" {
		return fmt.Errorf("CRITICAL SECURITY ERROR: Cannot use port 22 for LocalPort. This would lock you out of the server!")
	}

	// iptables -t nat -A POSTROUTING -s {tun_peer}/32 -m comment --comment "phantun" -j MASQUERADE
	return ensureRule("-t", "nat", "-A", "POSTROUTING",
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
	// SAFETY CHECK: Prevent high-jacking SSH
	if s.LocalPort == "22" {
		return fmt.Errorf("CRITICAL SECURITY ERROR: Cannot use port 22 for LocalPort. This would lock you out of the server!")
	}

	// 1. DNAT: TCP dport {local_port} -> {tun_peer}:{local_port}
	err := ensureRule("-t", "nat", "-A", "PREROUTING",
		"-p", "tcp", "--dport", s.LocalPort,
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", s.TunPeer)
	if err != nil {
		return err
	}

	// 2. MASQUERADE: TCP dst {tun_peer} dport {remote_port}
	if err := ensureRule("-t", "nat", "-A", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeer, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE"); err != nil {
		return err
	}

	// 3. FORWARD: Allow traffic to/from TUN interface (Safe against default DROP)
	if err := ensureRule("-I", "FORWARD", "-i", s.TunName, "-j", "ACCEPT"); err != nil {
		log.Printf("Warning: Failed to add FORWARD input rule: %v", err)
	}
	if err := ensureRule("-I", "FORWARD", "-o", s.TunName, "-j", "ACCEPT"); err != nil {
		log.Printf("Warning: Failed to add FORWARD output rule: %v", err)
	}
	return nil
}

// CleanupServer removes iptables rules for Server mode
func CleanupServer(s config.ServerConfig) error {
	// Ignore errors during cleanup
	runIptables("-t", "nat", "-D", "PREROUTING",
		"-p", "tcp", "--dport", s.LocalPort,
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", s.TunPeer)

	runIptables("-t", "nat", "-D", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeer, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")

	runIptables("-D", "FORWARD", "-i", s.TunName, "-j", "ACCEPT")
	runIptables("-D", "FORWARD", "-o", s.TunName, "-j", "ACCEPT")

	return nil
}

func runIptables(args ...string) error {
	cmd := exec.Command("iptables", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		cmdStr := strings.Join(args, " ")
		isCleanup := strings.Contains(cmdStr, "-D")
		isCheck := strings.Contains(cmdStr, "-C")

		// "Bad rule" or "Does a matching rule exist" or "No chain/target/match"
		isBenignError := (isCleanup || isCheck) && (strings.Contains(string(out), "No chain/target/match") || strings.Contains(string(out), "Bad rule") || strings.Contains(string(out), "Does a matching rule exist"))

		if isBenignError {
			if isCheck {
				// For Check (-C), we must return the error so the caller knows the rule is missing!
				// But we don't log it because it's expected.
				return fmt.Errorf("check failed (benign): %w", err)
			}
			if isCleanup {
				// For Cleanup (-D), we return nil (success) because missing rule is fine.
				return nil
			}
		}
		// Real error: Log it
		log.Printf("iptables error: %v, output: %s", err, string(out))
		return fmt.Errorf("iptables failed: %w", err)
	}
	return nil
}

func runIp6tables(args ...string) error {
	cmd := exec.Command("ip6tables", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Suppress errors for:
		// 1. Deletion (-D) of non-existent rules
		// 2. Checking (-C) of non-existent rules
		cmdStr := strings.Join(args, " ")
		isCleanup := strings.Contains(cmdStr, "-D")
		isCheck := strings.Contains(cmdStr, "-C")

		isBenignError := (isCleanup || isCheck) && (strings.Contains(string(out), "No chain/target/match") || strings.Contains(string(out), "Bad rule") || strings.Contains(string(out), "Does a matching rule exist"))

		if isBenignError {
			return nil
		}
		log.Printf("ip6tables error: %v, output: %s", err, string(out))
		return fmt.Errorf("ip6tables failed: %w", err)
	}
	return nil
}

// ensureRuleIPv6 checks if a rule exists via ip6tables before adding it
func ensureRuleIPv6(args ...string) error {
	checkArgs := make([]string, len(args))
	copy(checkArgs, args)

	actionIndex := -1
	for i, arg := range checkArgs {
		if arg == "-A" || arg == "-I" {
			checkArgs[i] = "-C"
			actionIndex = i
			break
		}
	}

	if actionIndex != -1 {
		if err := runIp6tables(checkArgs...); err == nil {
			return nil
		}
	}
	return runIp6tables(args...)
}

// SetupClientIPv6 applies ip6tables rules for Client mode (IPv6)
func SetupClientIPv6(c config.ClientConfig) error {
	// ip6tables -t nat -A POSTROUTING -s {tun_peer_ipv6}/128 -m comment --comment "phantun" -j MASQUERADE
	return ensureRuleIPv6("-t", "nat", "-A", "POSTROUTING",
		"-s", c.TunPeerIPv6+"/128",
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
}

// CleanupClientIPv6 removes ip6tables rules for Client mode (IPv6)
func CleanupClientIPv6(c config.ClientConfig) error {
	return runIp6tables("-t", "nat", "-D", "POSTROUTING",
		"-s", c.TunPeerIPv6+"/128",
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
}

// SetupServerIPv6 applies ip6tables rules for Server mode (IPv6)
func SetupServerIPv6(s config.ServerConfig) error {
	// IPv6 DNAT
	// ip6tables -t nat -A PREROUTING -p tcp --dport {local_port} ... -j DNAT ...
	err := ensureRuleIPv6("-t", "nat", "-A", "PREROUTING",
		"-p", "tcp", "--dport", s.LocalPort,
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", s.TunPeerIPv6)
	if err != nil {
		return err
	}

	// IPv6 MASQUERADE
	return ensureRuleIPv6("-t", "nat", "-A", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeerIPv6, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
}

// CleanupServerIPv6 removes ip6tables rules for Server mode (IPv6)
func CleanupServerIPv6(s config.ServerConfig) error {
	runIp6tables("-t", "nat", "-D", "PREROUTING",
		"-p", "tcp", "--dport", s.LocalPort,
		"-m", "comment", "--comment", "phantun",
		"-j", "DNAT", "--to-destination", s.TunPeerIPv6)

	runIp6tables("-t", "nat", "-D", "POSTROUTING",
		"-p", "tcp", "-d", s.TunPeerIPv6, "--dport", s.RemotePort,
		"-m", "comment", "--comment", "phantun",
		"-j", "MASQUERADE")
	return nil
}

// ensureRule checks if a rule exists before adding it
func ensureRule(args ...string) error {
	// Construct check args: replace -A (Append) or -I (Insert) with -C (Check)
	checkArgs := make([]string, len(args))
	copy(checkArgs, args)

	actionIndex := -1
	for i, arg := range checkArgs {
		if arg == "-A" || arg == "-I" {
			checkArgs[i] = "-C"
			actionIndex = i
			break
		}
	}

	if actionIndex != -1 {
		// Check if rule exists
		if err := runIptables(checkArgs...); err == nil {
			// Rule exists, do nothing
			return nil
		}
	}

	// Rule doesn't exist (or check failed), try to add it
	return runIptables(args...)
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
		// Example line: -A POSTROUTING ... -m comment --comment phantun ...
		// We detect "phantun" keyword in the line, and ensure it's a rule (starts with -A)
		if strings.Contains(line, "phantun") && strings.HasPrefix(line, "-A") {
			// We only care about MASQUERADE and DNAT for now
			if strings.Contains(line, "MASQUERADE") || strings.Contains(line, "DNAT") {
				parts := strings.Fields(line)
				if len(parts) < 3 {
					continue
				}

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
