// guardcli — database utilities for the guard scheduler (clear/export verified schedule).
//
// Usage:
//
//	guardcli schedule clear
//	guardcli schedule export --end 2026-05-19 --days-back 14 -o schedule.yaml
//	guardcli users list
//	guardcli users invites
//	guardcli users debug
//	guardcli users export -o users.csv [--invites invites.csv]
//	guardcli users import -i users.csv [--invites invites.csv] [--replace]
//	guardcli users invite --email ADDR --role admin|readonly [--invited-by CLERK_ID] [--replace]
//	guardcli users bootstrap-admin --email ADDR
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"guard/guardsched"
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
  guardcli db reset --yes
  guardcli schedule clear
  guardcli schedule export --end YYYY-MM-DD --days-back N [-o file.yaml]
  guardcli users list
  guardcli users invites
  guardcli users debug
  guardcli users export -o users.csv [--invites invites.csv]
  guardcli users import -i users.csv [--invites invites.csv] [--replace]
  guardcli users invite --email ADDR --role admin|readonly [--invited-by CLERK_ID] [--replace]
  guardcli users bootstrap-admin --email ADDR

Environment:
  DATABASE_URL  Postgres connection string (required; use Neon pooled URL for remote)

Examples:
  guardcli db retention
  guardcli db reset --yes
  guardcli schedule clear
  guardcli schedule export --end 2026-05-19 --days-back 10 -o verified.yaml
  DATABASE_URL="$(npx -y neonctl@latest connection-string --pooled)" guardcli users export -o users.csv --invites invites.csv
  DATABASE_URL=... guardcli db reset --yes && DATABASE_URL=... guardcli users import -i users.csv --invites invites.csv --replace
  DATABASE_URL="$(npx -y neonctl@latest connection-string --pooled)" guardcli users invite --email they@example.com --role readonly
`)
}

func runDB(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "error: db subcommand required (retention|reset)")
		return 2
	}
	switch args[0] {
	case "retention":
		return cmdDBRetention(args[1:])
	case "reset":
		return cmdDBReset(args[1:])
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

func cmdDBReset(args []string) int {
	fs := flag.NewFlagSet("reset", flag.ExitOnError)
	yes := fs.Bool("yes", false, "Confirm destructive drop of all guard app tables")
	keepMigrations := fs.Bool("keep-migrations", false, "Do not clear schema_migrations")
	_ = fs.Parse(args)
	if !*yes {
		fmt.Fprintln(os.Stderr, `error: db reset is destructive; pass --yes to confirm

Drops: cfg, audit, schedule, app_users, user_invites, soldier_status_*, partition functions.
By default also clears schema_migrations (omit with --keep-migrations).`)
		return 2
	}

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "error: DATABASE_URL is required")
		return 2
	}
	pool, err := db.OpenPool(context.Background(), url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	if err := db.ResetAppSchema(context.Background(), pool.Pool, !*keepMigrations); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Fprintln(os.Stderr, "db reset ok: app tables removed")
	if !*keepMigrations {
		fmt.Fprintln(os.Stderr, "schema_migrations cleared; run guardcli users import or start the API to apply 000001_schema.sql")
	}
	return 0
}

func runUsers(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "error: users subcommand required (list|invites|debug|export|import|invite|bootstrap-admin)")
		return 2
	}
	switch args[0] {
	case "list":
		return cmdUsersList()
	case "invites":
		return cmdUsersInvites()
	case "debug":
		return cmdUsersDebug()
	case "export":
		return cmdUsersExport(args[1:])
	case "import":
		return cmdUsersImport(args[1:])
	case "bootstrap-admin":
		return cmdUsersBootstrapAdmin(args[1:])
	case "invite":
		return cmdUsersInvite(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "error: unknown users command: %s\n", args[0])
		return 2
	}
}

func cmdUsersBootstrapAdmin(args []string) int {
	fs := flag.NewFlagSet("bootstrap-admin", flag.ExitOnError)
	email := fs.String("email", "", "Admin email (must match Clerk Google sign-in)")
	_ = fs.Parse(args)
	if strings.TrimSpace(*email) == "" {
		fmt.Fprintln(os.Stderr, "error: --email is required")
		return 2
	}
	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()
	u, err := repo.EnsureBootstrapAdmin(context.Background(), pool, *email)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "bootstrap admin: %s role=%s clerk_user_id=%s\n", u.Email, u.Role, u.ClerkUserID)
	fmt.Fprintln(os.Stderr, "Sign in with that email; Clerk id will rebind on first API request.")
	return 0
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

func cmdUsersExport(args []string) int {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	out := fs.String("o", "", "Output CSV for app_users (default: stdout)")
	invitesOut := fs.String("invites", "", "Optional output CSV for user_invites")
	_ = fs.Parse(args)

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

	userW := os.Stdout
	if *out != "" && *out != "-" {
		f, err := os.Create(*out)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		defer f.Close()
		userW = f
	} else if *invitesOut != "" {
		fmt.Fprintln(os.Stderr, "error: --invites requires -o (cannot write both to stdout)")
		return 2
	}
	if writeAppUsersCSV(userW, users) != 0 {
		return 1
	}
	if *out != "" && *out != "-" {
		fmt.Fprintf(os.Stderr, "exported %d app_user(s) to %s\n", len(users), *out)
	}

	if *invitesOut == "" {
		return 0
	}
	invites, err := repo.ListInvites(ctx, pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	f, err := os.Create(*invitesOut)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	defer f.Close()
	if writeUserInvitesCSV(f, invites) != 0 {
		return 1
	}
	fmt.Fprintf(os.Stderr, "exported %d invite(s) to %s\n", len(invites), *invitesOut)
	return 0
}

func cmdUsersImport(args []string) int {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	in := fs.String("i", "", "Input CSV for app_users (required)")
	invitesIn := fs.String("invites", "", "Optional input CSV for user_invites")
	replace := fs.Bool("replace", false, "Truncate app_users and user_invites before import")
	_ = fs.Parse(args)

	if strings.TrimSpace(*in) == "" {
		fmt.Fprintln(os.Stderr, "error: --i is required")
		return 2
	}

	userData, err := os.ReadFile(*in)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	users, err := repo.ParseAppUsersCSV(strings.NewReader(string(userData)))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}

	var invites []repo.UserInvite
	if *invitesIn != "" {
		inviteData, err := os.ReadFile(*invitesIn)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		invites, err = repo.ParseUserInvitesCSV(strings.NewReader(string(inviteData)))
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
	}

	pool, err := openPool()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer pool.Close()

	ctx := context.Background()
	if err := db.EnsureAppSchema(ctx, pool.Pool); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if *replace {
		if err := repo.TruncateUsers(ctx, pool); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		fmt.Fprintln(os.Stderr, "truncated app_users and user_invites")
	}

	nUsers, err := repo.ImportAppUsers(ctx, pool, users, *replace)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "imported %d app_user(s) from %s\n", nUsers, *in)

	if *invitesIn == "" {
		return 0
	}
	nInvites, err := repo.ImportUserInvites(ctx, pool, invites)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "imported %d invite(s) from %s\n", nInvites, *invitesIn)
	return 0
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
	if err := repo.WriteAppUsersCSV(w, users); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	return 0
}

func writeUserInvitesCSV(w *os.File, invites []repo.UserInvite) int {
	if err := repo.WriteUserInvitesCSV(w, invites); err != nil {
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
	// Admin CLI: connect without Migrate so export/import work on legacy schemas
	// (e.g. remote Neon before squashed 000001_schema.sql is recorded).
	return db.OpenPool(context.Background(), url)
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

	end := guardsched.TodayFakeUTC()
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
