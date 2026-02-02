package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"phantun-docker/internal/config"
	"phantun-docker/internal/iptables"
	"phantun-docker/internal/process"
	"phantun-docker/internal/system"
	"strings"
	"time"
)

type Handler struct {
	Config  *config.Config
	Manager *process.Manager
}

func NewHandler(cfg *config.Config, mgr *process.Manager) *Handler {
	return &Handler{
		Config:  cfg,
		Manager: mgr,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/status", h.handleStatus)
	mux.HandleFunc("GET /api/iptables", h.handleIptables)
	mux.HandleFunc("GET /api/config", h.handleGetConfig)
	mux.HandleFunc("POST /api/config", h.handleSaveConfig)
	mux.HandleFunc("DELETE /api/config", h.handleResetConfig)
	mux.HandleFunc("POST /api/action/restart", h.handleRestart)
	mux.HandleFunc("GET /api/logs", h.handleLogs)
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	binInfo := h.Manager.GetBinariesInfo()
	iptStats, _ := iptables.GetStats()
	tunIfaces, _ := system.GetTunInterfaces()

	status := map[string]interface{}{
		"enabled":   h.Config.General.Enabled,
		"system":    "running",
		"binary_ok": binInfo["ok"], // Backward compatibility
		"processes": h.Manager.GetStatus(),
		"diagnostics": map[string]interface{}{
			"binaries":   binInfo,
			"iptables":   iptStats,
			"interfaces": tunIfaces,
		},
	}
	json.NewEncoder(w).Encode(status)
}

func (h *Handler) handleIptables(w http.ResponseWriter, r *http.Request) {
	rules, err := iptables.GetRules()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"raw":   rules,
		"rules": strings.Split(rules, "\n"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(h.Config)
}

func (h *Handler) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var newCfg config.Config
	if err := json.NewDecoder(r.Body).Decode(&newCfg); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Update config fields safely
	h.Config.Update(newCfg.General, newCfg.Clients, newCfg.Servers)

	if err := h.Config.Save(); err != nil {
		http.Error(w, "Failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Apply changes (Restart)
	h.Manager.StopAll()
	if err := h.Manager.StartAll(); err != nil {
		http.Error(w, "Saved but failed to start processes: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleRestart(w http.ResponseWriter, r *http.Request) {
	h.Manager.StopAll()
	h.Manager.StartAll()
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := h.Manager.SubscribeLogs()
	defer h.Manager.UnsubscribeLogs(ch)

	// Heartbeat to keep connection alive
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
}

func (h *Handler) handleResetConfig(w http.ResponseWriter, r *http.Request) {
	// 1. Delete config file
	if err := os.Remove(h.Config.Path); err != nil && !os.IsNotExist(err) {
		http.Error(w, "Failed to delete config file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Reset in-memory config to defaults
	defaults := config.DefaultConfig()
	h.Config.Update(defaults.General, defaults.Clients, defaults.Servers)

	// 3. Stop all processes immediately
	h.Manager.StopAll()

	w.WriteHeader(http.StatusOK)
}
