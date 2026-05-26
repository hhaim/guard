// guardcli — database utilities for the guard scheduler (clear/export verified schedule).
//
// Usage:
//
//	guardcli schedule clear
//	guardcli schedule export --end 2026-05-19 --days-back 14 -o schedule.yaml
//	guardcli users list
//	guardcli users invites
//	guardcli users debug
//	guardcli users invite --email ADDR --role admin|readonly [--invited-by CLERK_ID] [--replace]
package main

import (
	"context"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
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
	case "db":
		return runDB(os.Args[2:])
	case "schedule":
		return runSchedule(os.Args[2:])
	case "users":
		return runUsers(os.Args[2:])
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
  guardcli db retention [--days 30] [--future-days 7]
  guardcli schedule clear
  guardcli schedule export --end YYYY-MM-DD --days-back N [-o file.yaml]
  guardcli users list
  guardcli users invites
  guardcli users debug
  guardcli users invite --email ADDR --role admin|readonly [--invited-by CLERK_ID] [--replace]

Environment:
  DATABASE_URL  Postgres connection string (required; use Neon pooled URL for remote)

Examples:
  guardcli db retention
  guardcli schedule clear
  guardcli schedule export --end 2026-05-19 --days-back 10 -o verified.yaml
  DATABASE_URL="$(npx -y neonctl@latest connection-string --pooled)" guardcli users invite --email they@example.com --role readonly
`)
}

func runDB(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "error: db subcommand required (retention)")
		return 2
	}
	switch args[0] {
	case "retention":
		return cmdDBRetention(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "error: unknown db command: %s\n", args[0])
		return 2
	}
}

func cmdDBRetention(args []string) int {
	fs := flag.NewFlagSet("retention", flag.ExitOnError)
	days := fs.Int("days", 30, "Minimum calendar days to retain (40-day partition blocks; default 30)")
	future := fs.Int("future-days", 7, "Pre-create partitions this many days ahead of today")
	_ = fs.Parse(args)
	if *days < 1 {
		fmt.Fprintln(os.Stderr, "error: --days must be >= 1")
		return 2
	}
	if *future < 0 {
		fmt.Fprintln(os.Stderr, "error: --future-days must be >= 0")
		return 2
	}

	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	dropped, err := repo.RunRetentionMaintenance(context.Background(), pool, *days, *future)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Printf("retention ok (keep %d days): dropped %d partition(s)\n", *days, dropped)
	return 0
}

func runUsers(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "error: users subcommand required (list|invites|debug|invite)")
		return 2
	}
	switch args[0] {
	case "list":
		return cmdUsersList()
	case "invites":
		return cmdUsersInvites()
	case "debug":
		return cmdUsersDebug()
	case "invite":
		return cmdUsersInvite(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "error: unknown users command: %s\n", args[0])
		return 2
	}
}

func cmdUsersList() int {
	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	users, err := repo.ListAppUsers(context.Background(), pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	return writeAppUsersCSV(os.Stdout, users)
}

func cmdUsersInvites() int {
	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	invites, err := repo.ListInvites(context.Background(), pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	return writeUserInvitesCSV(os.Stdout, invites)
}

func cmdUsersDebug() int {
	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	ctx := context.Background()
	users, err := repo.ListAppUsers(ctx, pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	invites, err := repo.ListInvites(ctx, pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}

	fmt.Fprintf(os.Stderr, "=== app_users (%d) ===\n", len(users))
	if writeAppUsersCSV(os.Stdout, users) != 0 {
		return 1
	}
	fmt.Fprintln(os.Stderr)
	fmt.Fprintf(os.Stderr, "=== user_invites (%d) ===\n", len(invites))
	if writeUserInvitesCSV(os.Stdout, invites) != 0 {
		return 1
	}
	return 0
}

func cmdUsersInvite(args []string) int {
	fs := flag.NewFlagSet("invite", flag.ExitOnError)
	email := fs.String("email", "", "Invitee email (must match Clerk sign-in)")
	role := fs.String("role", "readonly", "Role: admin or readonly")
	invitedBy := fs.String("invited-by", "", "Admin clerk_user_id (default: first admin in DB)")
	replace := fs.Bool("replace", false, "Delete existing invite rows for this email first")
	_ = fs.Parse(args)

	if strings.TrimSpace(*email) == "" {
		fmt.Fprintln(os.Stderr, "error: --email is required")
		return 2
	}
	if err := repo.ValidateRole(strings.TrimSpace(*role)); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}

	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	ctx := context.Background()
	inviter := strings.TrimSpace(*invitedBy)
	if inviter == "" {
		inviter, err = repo.FirstAdminClerkID(ctx, pool)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error: no admin in app_users; set --invited-by")
			return 2
		}
	}

	if *replace {
		n, err := repo.DeleteInvitesByEmail(ctx, pool, *email)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		if n > 0 {
			fmt.Fprintf(os.Stderr, "removed %d existing invite(s) for %s\n", n, strings.ToLower(strings.TrimSpace(*email)))
		}
	}

	inv, err := repo.CreateInvite(ctx, pool, *email, *role, inviter, nil)
	if err != nil {
		if errors.Is(err, repo.ErrDuplicateEmail) {
			fmt.Fprintln(os.Stderr, "error: email already has an invite (use --replace to overwrite)")
			return 2
		}
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}

	fmt.Fprintf(os.Stderr, "created pending invite id=%d email=%s role=%s invited_by=%s\n",
		inv.ID, inv.Email, inv.Role, inv.InvitedBy)
	fmt.Fprintln(os.Stderr, "invitee must sign in with this exact email; then run: guardcli users debug")
	return 0
}

func writeAppUsersCSV(w *os.File, users []repo.AppUser) int {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"clerk_user_id", "email", "role", "created_at", "invited_by"}); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	for _, u := range users {
		invitedBy := ""
		if u.InvitedBy != nil {
			invitedBy = *u.InvitedBy
		}
		if err := cw.Write([]string{
			u.ClerkUserID,
			u.Email,
			u.Role,
			u.CreatedAt.UTC().Format(time.RFC3339),
			invitedBy,
		}); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	return 0
}

func writeUserInvitesCSV(w *os.File, invites []repo.UserInvite) int {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{
		"id", "email", "role", "invited_by", "clerk_invitation_id", "created_at", "accepted_at", "pending",
	}); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	for _, inv := range invites {
		clerkInvID := ""
		if inv.ClerkInvitationID != nil {
			clerkInvID = *inv.ClerkInvitationID
		}
		acceptedAt := ""
		if inv.AcceptedAt != nil {
			acceptedAt = inv.AcceptedAt.UTC().Format(time.RFC3339)
		}
		pending := "true"
		if inv.AcceptedAt != nil {
			pending = "false"
		}
		if err := cw.Write([]string{
			fmt.Sprintf("%d", inv.ID),
			inv.Email,
			inv.Role,
			inv.InvitedBy,
			clerkInvID,
			inv.CreatedAt.UTC().Format(time.RFC3339),
			acceptedAt,
			pending,
		}); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	return 0
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
	fmt.Printf("cleared %d verified schedule day(s)\n", n)
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

	doc, err := repo.MergeScheduleRange(context.Background(), pool, from, end)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	data, err := repo.PlanDocToYAML(doc, from, end)
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
	fmt.Fprintf(os.Stderr, "wrote %d assignments to %s (%s .. %s)\n", len(doc.Assignments), *out, from.Format("2006-01-02"), end.Format("2006-01-02"))
	return 0
}
