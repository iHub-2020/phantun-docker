package system

import (
	"net"
	"strings"
)

type InterfaceInfo struct {
	Name   string   `json:"name"`
	Status string   `json:"status"` // "UP" or "DOWN"
	Addrs  []string `json:"addrs"`  // IPv6 or IPv4
}

// GetTunInterfaces returns status of all tun* interfaces
func GetTunInterfaces() ([]InterfaceInfo, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}

	var infos []InterfaceInfo
	for _, i := range ifaces {
		if strings.HasPrefix(i.Name, "tun") {
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
