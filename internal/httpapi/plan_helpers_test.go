package httpapi

import (
	"testing"
	"time"

	"guard/guardsched"
)

func TestValidatePlanAnchorTomorrowUTC(t *testing.T) {
	s := &Server{}
	want := s.allowedPlanAnchor(0)
	got := time.Date(want.Year(), want.Month(), want.Day(), 0, 0, 0, 0, time.UTC)
	if err := s.validatePlanAnchor(got, 0); err != nil {
		t.Fatalf("expected ok for %s: %v", got.Format("2006-01-02"), err)
	}
	today := utcToday()
	if err := s.validatePlanAnchor(today, 0); err == nil {
		t.Fatal("expected error for today anchor")
	}
}

func TestValidatePlanAnchorDebugOffset(t *testing.T) {
	s := &Server{}
	offset := 10
	want := s.allowedPlanAnchor(offset)
	got := time.Date(want.Year(), want.Month(), want.Day(), 0, 0, 0, 0, time.UTC)
	if err := s.validatePlanAnchor(got, offset); err != nil {
		t.Fatalf("expected ok for offset %d anchor %s: %v", offset, got.Format("2006-01-02"), err)
	}
	if err := s.validatePlanAnchor(s.allowedPlanAnchor(0), offset); err == nil {
		t.Fatal("expected error when anchor does not match debug offset")
	}
}

func TestClampPlanDebugDayOffset(t *testing.T) {
	if clampPlanDebugDayOffset(-1) != 0 || clampPlanDebugDayOffset(9999) != maxPlanDebugDayOffset {
		t.Fatal("clamp bounds")
	}
}

func TestValidProposalSlot(t *testing.T) {
	if !validProposalSlot("01") || !validProposalSlot("04") {
		t.Fatal("01 and 04 should be valid")
	}
	if validProposalSlot("05") || validProposalSlot("1") {
		t.Fatal("invalid slots should be rejected")
	}
}

func TestAssignmentsJSONToRecords(t *testing.T) {
	keys := []string{"a", "b"}
	assigns := []map[string]any{
		{"day": 0, "calendar_block": 1, "start_hour": 8, "slot": 0, "soldier_id": "b", "kind": "rotating"},
	}
	recs := guardsched.RecordsFromAssignmentJSON(assigns, keys)
	if len(recs) != 1 || recs[0].SoldierIdx != 1 {
		t.Fatalf("got %+v", recs)
	}
}
