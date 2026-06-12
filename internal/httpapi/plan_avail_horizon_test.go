package httpapi

import "testing"

func TestPlanAvailHorizonDays(t *testing.T) {
	tests := []struct {
		name             string
		planDays         int
		prefixDays       int
		hasHistory       bool
		useWitnessExtend bool
		want             int
	}{
		{name: "cold no history", planDays: 1, want: 1},
		{name: "witness extend", planDays: 1, prefixDays: 14, hasHistory: true, useWitnessExtend: true, want: 1},
		{name: "bootstrap cold", planDays: 1, prefixDays: 14, hasHistory: true, useWitnessExtend: false, want: 15},
		{name: "bootstrap multi plan day", planDays: 2, prefixDays: 14, hasHistory: true, useWitnessExtend: false, want: 16},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := planAvailHorizonDays(tc.planDays, tc.prefixDays, tc.hasHistory, tc.useWitnessExtend); got != tc.want {
				t.Fatalf("planAvailHorizonDays() = %d, want %d", got, tc.want)
			}
		})
	}
}
