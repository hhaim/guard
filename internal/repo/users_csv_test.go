package repo

import (
	"strings"
	"testing"
	"time"
)

func TestParseAppUsersCSV_roundTrip(t *testing.T) {
	invitedBy := "user_admin"
	created := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	in := `clerk_user_id,email,role,created_at,invited_by
user_admin,admin@example.com,admin,2026-05-01T12:00:00Z,
preauth:viewer@example.com,viewer@example.com,readonly,2026-05-01T12:00:00Z,user_admin
`
	users, err := ParseAppUsersCSV(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 {
		t.Fatalf("got %d users", len(users))
	}
	if users[0].Email != "admin@example.com" || users[0].Role != "admin" {
		t.Fatalf("admin: %+v", users[0])
	}
	if users[1].InvitedBy == nil || *users[1].InvitedBy != invitedBy {
		t.Fatalf("invited_by: %+v", users[1].InvitedBy)
	}
	if !users[0].CreatedAt.Equal(created) {
		t.Fatalf("created_at: %v", users[0].CreatedAt)
	}

	var buf strings.Builder
	if err := WriteAppUsersCSV(&buf, users); err != nil {
		t.Fatal(err)
	}
	again, err := ParseAppUsersCSV(strings.NewReader(buf.String()))
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 2 {
		t.Fatalf("round trip count: %d", len(again))
	}
}

func TestSortUsersForInsert_dependencyOrder(t *testing.T) {
	admin := "admin_id"
	users := []AppUser{
		{ClerkUserID: "viewer", Email: "v@example.com", Role: "readonly", InvitedBy: &admin},
		{ClerkUserID: admin, Email: "a@example.com", Role: "admin"},
	}
	sorted, err := SortUsersForInsert(users, false)
	if err != nil {
		t.Fatal(err)
	}
	if sorted[0].ClerkUserID != admin {
		t.Fatalf("expected admin first, got %s", sorted[0].ClerkUserID)
	}
}

func TestSortUsersForInsert_missingDependency(t *testing.T) {
	missing := "missing_admin"
	users := []AppUser{
		{ClerkUserID: "viewer", Email: "v@example.com", Role: "readonly", InvitedBy: &missing},
	}
	_, err := SortUsersForInsert(users, true)
	if err == nil {
		t.Fatal("expected dependency error")
	}
}

func TestParseUserInvitesCSV(t *testing.T) {
	in := `id,email,role,invited_by,clerk_invitation_id,created_at,accepted_at,pending
7,pending@example.com,readonly,admin_id,,2026-05-01T12:00:00Z,,true
`
	invites, err := ParseUserInvitesCSV(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(invites) != 1 || invites[0].ID != 7 || invites[0].Email != "pending@example.com" {
		t.Fatalf("got %+v", invites)
	}
	if invites[0].AcceptedAt != nil {
		t.Fatal("expected pending invite")
	}
}
