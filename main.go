package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"phantun-docker/internal/api"
	"phantun-docker/internal/config"
	"phantun-docker/internal/process"
)

//go:embed web/*
var content embed.FS

func main() {
	configPath := flag.String("config", "/etc/phantun/config.json", "Path to configuration file")
	port := flag.Int("port", 8080, "Web UI port")
	flag.Parse()

	// 1. Load Config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Printf("Warning: Failed to load config from %s: %v. Using defaults.", *configPath, err)
		cfg = config.DefaultConfig()
	}

	// 2. Initialize Process Manager
	mgr := process.NewManager(cfg)

	// 3. Start Processes
	if err := mgr.StartAll(); err != nil {
		log.Printf("Error starting processes: %v", err)
	}
	defer mgr.StopAll() // Cleanup on exit

	// 4. Initialize API
	apiHandler := api.NewHandler(cfg, mgr)
	mux := http.NewServeMux()
	apiHandler.RegisterRoutes(mux)

	// 5. Serve Static Files (Frontend)
	// 'web' is the root of embed.FS.
	// We want to serve 'web' folder content at /.
	webFS, err := fs.Sub(content, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(webFS)))

	// 6. Start HTTP/HTTPS Server
	certFile := "/etc/phantun/cert.pem"
	keyFile := "/etc/phantun/key.pem"
	
	// Simple check if certs exist
	useTLS := false
	if _, err := os.Stat(certFile); err == nil {
		if _, err := os.Stat(keyFile); err == nil {
			useTLS = true
		}
	}

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: mux,
	}

	go func() {
		if useTLS {
			log.Printf("Phantun Manager listening on :%d (HTTPS)", *port)
			if err := server.ListenAndServeTLS(certFile, keyFile); err != http.ErrServerClosed {
				log.Fatalf("HTTPS server error: %v", err)
			}
		} else {
			log.Printf("Phantun Manager listening on :%d (HTTP)", *port)
			if err := server.ListenAndServe(); err != http.ErrServerClosed {
				log.Fatalf("HTTP server error: %v", err)
			}
		}
	}()

	// 7. Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("Shutting down...")
	mgr.StopAll()
}
