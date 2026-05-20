// guardcli — database utilities for the guard scheduler (clear/export verified schedule).
//
// Usage:
//
//	guardcli schedule clear
//	guardcli schedule export --end 2026-05-19 --days-back 14 -o schedule.yaml
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"guard/internal/db"
	"guard/internal/repo"
)

func main() {
	os.Exit(run())
}

func run() int {
	if len(os.Args) < 2 {
		printUsage()
		return 2
	}
	switch os.Args[1] {
	case "schedule":
		return runSchedule(os.Args[2:])
	case "help", "-h", "--help":
		printUsage()
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		printUsage()
		return 2
	}
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `guardcli — guard scheduler DB tools

Usage:
  guardcli schedule clear
  guardcli schedule export --end YYYY-MM-DD --days-back N [-o file.yaml]

Environment:
  DATABASE_URL  Postgres connection string (required)

Examples:
  guardcli schedule clear
  guardcli schedule export --end 2026-05-19 --days-back 10 -o verified.yaml
`)
}

func runSchedule(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "error: schedule subcommand required (clear|export)")
		return 2
	}
	switch args[0] {
	case "clear":
		return cmdScheduleClear()
	case "export":
		return cmdScheduleExport(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "error: unknown schedule command: %s\n", args[0])
		return 2
	}
}

func openPool() (*db.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	return db.Connect(context.Background(), url)
}

func cmdScheduleClear() int {
	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()
	n, err := repo.DeleteAllSchedule(context.Background(), pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Printf("cleared %d schedule rows\n", n)
	return 0
}

func cmdScheduleExport(args []string) int {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	endS := fs.String("end", "", "End date YYYY-MM-DD (default: today UTC)")
	daysBack := fs.Int("days-back", 14, "Days before end date (inclusive range)")
	out := fs.String("o", "", "Output YAML file (default: stdout)")
	_ = fs.Parse(args)

	end := time.Now().UTC().Truncate(24 * time.Hour)
	if *endS != "" {
		t, err := time.Parse("2006-01-02", *endS)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error: invalid --end:", err)
			return 2
		}
		end = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	back := *daysBack
	if back < 0 {
		back = 0
	}
	from := end.AddDate(0, 0, -back)

	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	rows, err := repo.QueryScheduleRange(context.Background(), pool, from, end)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	data, err := repo.ScheduleRowsToYAML(rows, from, end)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if *out == "" || *out == "-" {
		_, _ = os.Stdout.Write(data)
		return 0
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "wrote %d rows to %s (%s .. %s)\n", len(rows), *out, from.Format("2006-01-02"), end.Format("2006-01-02"))
	return 0
}
