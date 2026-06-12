package httpapi

import (
	"testing"

	"guard/guardsched"
	"guard/internal/model"
)

func TestContinuationModelRoundTrip(t *testing.T) {
	sched := &guardsched.ContinuationSnapshot{
		FormatVersion: guardsched.CheckpointFormatVersion,
		NumDays:       14,
		RNGState: &guardsched.RNGStateJSON{
			Version: 3,
			State:   make([]int, 625),
		},
	}
	m := continuationFromSched(sched)
	back, err := continuationToSched(m)
	if err != nil {
		t.Fatal(err)
	}
	if back == nil || back.NumDays != 14 || back.RNGState == nil {
		t.Fatalf("round trip: %+v", back)
	}
}

func TestPlanDocCarriesContinuation(t *testing.T) {
	doc := model.PlanDoc{
		FormatVersion: model.PlanFormatVersion,
		AnchorDate:    "2026-06-01",
		Days:          1,
		ShiftHours:    4,
		Continuation: &model.SimContinuation{
			FormatVersion: 2,
			NumDays:       15,
		},
	}
	if doc.Continuation == nil || doc.Continuation.NumDays != 15 {
		t.Fatal("continuation not on plan doc")
	}
}
