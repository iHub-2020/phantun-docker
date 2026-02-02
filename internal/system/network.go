package system

import (
	"log"
	"net"
	"os/exec"
	"strings"
)

type InterfaceInfo struct {
	Name   string   `json:"name"`
	Status string   `json:"status"` // "UP" or "DOWN"
	Addrs  []string `json:"addrs"`  // IPv6 or IPv4
}

// GetTunInterfaces returns status of all tun* or PointToPoint interfaces
func GetTunInterfaces() ([]InterfaceInfo, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}

	var infos []InterfaceInfo
	for _, i := range ifaces {
		// Check for PointToPoint flag OR "tun" prefix as fallback
		isTun := (i.Flags&net.FlagPointToPoint != 0) || strings.HasPrefix(i.Name, "tun")

		if isTun {
			status := "DOWN"
			if i.Flags&net.FlagUp != 0 {
				status = "UP"
			}

			var addrList []string
			addrs, _ := i.Addrs()
			for _, a := range addrs {
				addrList = append(addrList, a.String())
			}

			infos = append(infos, InterfaceInfo{
				Name:   i.Name,
				Status: status,
				Addrs:  addrList,
			})
		}
	}
	return infos, nil
}

// CleanupUnusedTunInterfaces removes any tun* interface NOT present in the allowed list.
// This prevents "Zombie Interfaces" from persisting after config changes.
func CleanupUnusedTunInterfaces(allowedNames []string) error {
	// 1. Get all TUN interfaces
	ifaces, err := net.Interfaces()
	if err != nil {
		return err
	}

	// Create map for O(1) lookup
	allowed := make(map[string]bool)
	for _, name := range allowedNames {
		allowed[name] = true
	}

	for _, i := range ifaces {
		// Only target "tun*" interfaces. Ignoring "lo", "eth0", etc.
		if strings.HasPrefix(i.Name, "tun") {
			// If not allowed, kill it.
			if !allowed[i.Name] {
				log.Printf("Cleaning up zombie interface: %s", i.Name)
				cmd := exec.Command("ip", "link", "delete", i.Name)
				if out, err := cmd.CombinedOutput(); err != nil {
					log.Printf("Failed to delete interface %s: %v, output: %s", i.Name, err, string(out))
					// Continue trying others even if one fails
				}
			}
		}
	}
	return nil
}
