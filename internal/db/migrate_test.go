package db

import (
	"sort"
	"testing"
)

func TestMigrationNamesSortedLexically(t *testing.T) {
	names := []string{"000003_a.sql", "000001_init.sql", "000002_users.sql"}
	sort.Strings(names)
	if names[0] != "000001_init.sql" || names[1] != "000002_users.sql" || names[2] != "000003_a.sql" {
		t.Fatalf("order: %v", names)
	}
}
