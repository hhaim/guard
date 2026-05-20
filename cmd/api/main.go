package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"guard/internal/db"
	"guard/internal/httpapi"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	planDebugOffset := 0
	if v := strings.TrimSpace(os.Getenv("PLAN_DEBUG_DAY_OFFSET")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			log.Fatalf("invalid PLAN_DEBUG_DAY_OFFSET: %q", v)
		}
		planDebugOffset = n
	}
	allowDebugOffset := true
	if v := strings.TrimSpace(os.Getenv("PLAN_ALLOW_DEBUG_OFFSET")); v != "" {
		allowDebugOffset = v == "1" || strings.EqualFold(v, "true")
	}
	api := &httpapi.Server{
		Pool:               pool,
		APIKey:             os.Getenv("API_KEY"),
		PlanDebugDayOffset: planDebugOffset,
		AllowDebugOffset:   allowDebugOffset,
	}
	if planDebugOffset > 0 {
		log.Printf("plan debug: effective today +%d days (set PLAN_ALLOW_DEBUG_OFFSET=1 to tune per request)", planDebugOffset)
	}
	apiMux := http.NewServeMux()
	api.Register(apiMux)

	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "web/dist"
	}
	handler := withStatic(apiMux, staticDir)
	handler = corsMiddleware(handler, os.Getenv("CORS_ORIGIN"))

	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}

	go func() {
		log.Printf("listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	shCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := srv.Shutdown(shCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func withStatic(api http.Handler, dir string) http.Handler {
	fi, err := os.Stat(dir)
	if err != nil || !fi.IsDir() {
		return api
	}
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler, origin string) http.Handler {
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
