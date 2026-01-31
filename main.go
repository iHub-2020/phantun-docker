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

	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"time"

	"phantun-docker/internal/api"
	"phantun-docker/internal/config"
	"phantun-docker/internal/process"
)

var (
	authUser  string
	authPass  string
	authToken string
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
	webFS, err := fs.Sub(content, "web")
	if err != nil {
		log.Fatal(err)
	}
	fileHandler := http.FileServer(http.FS(webFS))
	// We handle "/" with fileHandler, but specific paths first
	mux.Handle("/", fileHandler)

	// Auth Routes
	mux.HandleFunc("/api/login", handleLogin)
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		// Serve login.html specifically
		f, err := webFS.Open("login.html")
		if err != nil {
			http.Error(w, "Login page not found", 404)
			return
		}
		defer f.Close()
		stat, _ := f.Stat()
		buf, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, "Failed to read login page", 500)
			return
		}
		http.ServeContent(w, r, "login.html", stat.ModTime(), bytes.NewReader(buf))
	})

	// Init Auth
	initAuth()

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
		Handler: authMiddleware(mux),
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
	mgr.StopAll()
}

// --- Auth Helpers ---

func initAuth() {
	authUser = os.Getenv("PHANTUN_USER")
	if authUser == "" {
		authUser = "admin"
	}
	authPass = os.Getenv("PHANTUN_PASSWORD")
	if authPass == "" {
		authPass = "admin"
	}
	// Generate random token
	b := make([]byte, 16)
	rand.Read(b)
	authToken = hex.EncodeToString(b)
	log.Printf("Auth initialized. User: %s", authUser)
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow public paths
		if r.URL.Path == "/login" || r.URL.Path == "/api/login" || strings.HasPrefix(r.URL.Path, "/static/") {
			next.ServeHTTP(w, r)
			return
		}

		// Check Cookie
		cookie, err := r.Cookie("auth_token")
		if err == nil && cookie.Value == authToken {
			next.ServeHTTP(w, r)
			return
		}

		// Auth failed
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
		} else {
			http.Redirect(w, r, "/login", http.StatusFound)
		}
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Bad request", 400)
		return
	}

	if creds.Username == authUser && creds.Password == authPass {
		// Set Cookie
		http.SetCookie(w, &http.Cookie{
			Name:    "auth_token",
			Value:   authToken,
			Path:    "/",
			Expires: time.Now().Add(24 * time.Hour),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	} else {
		http.Error(w, "Invalid credentials", 401)
	}
}
