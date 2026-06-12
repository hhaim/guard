package repo

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"guard/internal/db"
)

const (
	appUserCSVHeader = "clerk_user_id,email,role,created_at,invited_by"
	inviteCSVHeader  = "id,email,role,invited_by,clerk_invitation_id,created_at,accepted_at,pending"
)

func WriteAppUsersCSV(w io.Writer, users []AppUser) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(strings.Split(appUserCSVHeader, ",")); err != nil {
		return err
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
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func WriteUserInvitesCSV(w io.Writer, invites []UserInvite) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(strings.Split(inviteCSVHeader, ",")); err != nil {
		return err
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
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func ParseAppUsersCSV(r io.Reader) ([]AppUser, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	records, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	start := 0
	if len(records[0]) >= 3 && records[0][0] == "clerk_user_id" {
		start = 1
	}
	var out []AppUser
	for i := start; i < len(records); i++ {
		row := records[i]
		if len(row) == 0 || (len(row) == 1 && strings.TrimSpace(row[0]) == "") {
			continue
		}
		if len(row) < 3 {
			return nil, fmt.Errorf("row %d: expected at least clerk_user_id,email,role", i+1)
		}
		u := AppUser{
			ClerkUserID: strings.TrimSpace(row[0]),
			Email:       normalizeEmail(row[1]),
			Role:        strings.TrimSpace(row[2]),
		}
		if u.ClerkUserID == "" || u.Email == "" {
			return nil, fmt.Errorf("row %d: clerk_user_id and email are required", i+1)
		}
		if err := ValidateRole(u.Role); err != nil {
			return nil, fmt.Errorf("row %d: %w", i+1, err)
		}
		if len(row) > 3 && strings.TrimSpace(row[3]) != "" {
			t, err := time.Parse(time.RFC3339, strings.TrimSpace(row[3]))
			if err != nil {
				return nil, fmt.Errorf("row %d: invalid created_at: %w", i+1, err)
			}
			u.CreatedAt = t.UTC()
		}
		if len(row) > 4 {
			if v := strings.TrimSpace(row[4]); v != "" {
				u.InvitedBy = &v
			}
		}
		out = append(out, u)
	}
	return out, nil
}

func ParseUserInvitesCSV(r io.Reader) ([]UserInvite, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	records, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	start := 0
	if len(records[0]) >= 2 && records[0][0] == "id" && records[0][1] == "email" {
		start = 1
	}
	var out []UserInvite
	for i := start; i < len(records); i++ {
		row := records[i]
		if len(row) == 0 || (len(row) == 1 && strings.TrimSpace(row[0]) == "") {
			continue
		}
		if len(row) < 4 {
			return nil, fmt.Errorf("invite row %d: expected at least id,email,role,invited_by", i+1)
		}
		inv := UserInvite{
			Email:     normalizeEmail(row[1]),
			Role:      strings.TrimSpace(row[2]),
			InvitedBy: strings.TrimSpace(row[3]),
		}
		if idStr := strings.TrimSpace(row[0]); idStr != "" {
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invite row %d: invalid id: %w", i+1, err)
			}
			inv.ID = id
		}
		if inv.Email == "" || inv.InvitedBy == "" {
			return nil, fmt.Errorf("invite row %d: email and invited_by are required", i+1)
		}
		if err := ValidateRole(inv.Role); err != nil {
			return nil, fmt.Errorf("invite row %d: %w", i+1, err)
		}
		if len(row) > 4 {
			if v := strings.TrimSpace(row[4]); v != "" {
				inv.ClerkInvitationID = &v
			}
		}
		if len(row) > 5 && strings.TrimSpace(row[5]) != "" {
			t, err := time.Parse(time.RFC3339, strings.TrimSpace(row[5]))
			if err != nil {
				return nil, fmt.Errorf("invite row %d: invalid created_at: %w", i+1, err)
			}
			inv.CreatedAt = t.UTC()
		}
		if len(row) > 6 {
			if v := strings.TrimSpace(row[6]); v != "" {
				t, err := time.Parse(time.RFC3339, v)
				if err != nil {
					return nil, fmt.Errorf("invite row %d: invalid accepted_at: %w", i+1, err)
				}
				t = t.UTC()
				inv.AcceptedAt = &t
			}
		}
		out = append(out, inv)
	}
	return out, nil
}

// SortUsersForInsert orders users so invited_by references exist in the batch or DB.
// When strict is true, every non-empty invited_by must refer to another user in the batch.
func SortUsersForInsert(users []AppUser, strict bool) ([]AppUser, error) {
	if len(users) == 0 {
		return users, nil
	}
	batch := make(map[string]struct{}, len(users))
	for _, u := range users {
		batch[u.ClerkUserID] = struct{}{}
	}
	inserted := make(map[string]bool, len(users))
	var out []AppUser
	remaining := append([]AppUser(nil), users...)
	for len(remaining) > 0 {
		var next []AppUser
		progress := false
		for _, u := range remaining {
			if canInsertUser(u, inserted, batch, strict) {
				out = append(out, u)
				inserted[u.ClerkUserID] = true
				progress = true
			} else {
				next = append(next, u)
			}
		}
		if !progress {
			var blocked []string
			for _, u := range remaining {
				if u.InvitedBy != nil {
					blocked = append(blocked, fmt.Sprintf("%s->%s", u.Email, *u.InvitedBy))
				}
			}
			sort.Strings(blocked)
			return nil, fmt.Errorf("cannot resolve invited_by dependencies: %s", strings.Join(blocked, ", "))
		}
		remaining = next
	}
	return out, nil
}

func canInsertUser(u AppUser, inserted map[string]bool, batch map[string]struct{}, strict bool) bool {
	if u.InvitedBy == nil || *u.InvitedBy == "" {
		return true
	}
	ref := *u.InvitedBy
	if inserted[ref] {
		return true
	}
	if _, inBatch := batch[ref]; inBatch {
		return false
	}
	return !strict
}

// TruncateUsers removes all app_users and user_invites (for clean import).
func TruncateUsers(ctx context.Context, pool *db.Pool) error {
	_, err := pool.Exec(ctx, `TRUNCATE user_invites, app_users RESTART IDENTITY CASCADE`)
	return err
}

// ImportAppUsers inserts users in dependency order.
func ImportAppUsers(ctx context.Context, pool *db.Pool, users []AppUser, strict bool) (int, error) {
	sorted, err := SortUsersForInsert(users, strict)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, u := range sorted {
		createdAt := u.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}
		tag, err := pool.Exec(ctx,
			`INSERT INTO app_users (clerk_user_id, email, role, created_at, invited_by)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (clerk_user_id) DO UPDATE SET
			   email = EXCLUDED.email,
			   role = EXCLUDED.role,
			   created_at = EXCLUDED.created_at,
			   invited_by = EXCLUDED.invited_by`,
			u.ClerkUserID, u.Email, u.Role, createdAt, u.InvitedBy,
		)
		if err != nil {
			return n, fmt.Errorf("import user %s: %w", u.Email, err)
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}

// ImportUserInvites inserts invite rows and advances the id sequence when explicit ids are used.
func ImportUserInvites(ctx context.Context, pool *db.Pool, invites []UserInvite) (int, error) {
	n := 0
	var maxID int64
	for _, inv := range invites {
		createdAt := inv.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}
		if inv.ID > 0 {
			_, err := pool.Exec(ctx,
				`INSERT INTO user_invites (id, email, role, invited_by, clerk_invitation_id, created_at, accepted_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 ON CONFLICT (email) DO UPDATE SET
				   role = EXCLUDED.role,
				   invited_by = EXCLUDED.invited_by,
				   clerk_invitation_id = EXCLUDED.clerk_invitation_id,
				   created_at = EXCLUDED.created_at,
				   accepted_at = EXCLUDED.accepted_at`,
				inv.ID, inv.Email, inv.Role, inv.InvitedBy, inv.ClerkInvitationID, createdAt, inv.AcceptedAt,
			)
			if err != nil {
				return n, fmt.Errorf("import invite %s: %w", inv.Email, err)
			}
			if inv.ID > maxID {
				maxID = inv.ID
			}
		} else {
			_, err := pool.Exec(ctx,
				`INSERT INTO user_invites (email, role, invited_by, clerk_invitation_id, created_at, accepted_at)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 ON CONFLICT (email) DO UPDATE SET
				   role = EXCLUDED.role,
				   invited_by = EXCLUDED.invited_by,
				   clerk_invitation_id = EXCLUDED.clerk_invitation_id,
				   created_at = EXCLUDED.created_at,
				   accepted_at = EXCLUDED.accepted_at`,
				inv.Email, inv.Role, inv.InvitedBy, inv.ClerkInvitationID, createdAt, inv.AcceptedAt,
			)
			if err != nil {
				return n, fmt.Errorf("import invite %s: %w", inv.Email, err)
			}
		}
		n++
	}
	if maxID > 0 {
		_, err := pool.Exec(ctx,
			`SELECT setval(pg_get_serial_sequence('user_invites', 'id'), GREATEST($1, (SELECT COALESCE(MAX(id), 1) FROM user_invites)))`,
			maxID,
		)
		if err != nil {
			return n, err
		}
	}
	return n, nil
}
