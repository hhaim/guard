package availability

import "time"

// Status values for soldier_status_entry / scenario YAML.
const (
	StatusBase     = "base"
	StatusAway     = "away"
	StatusSick     = "sick"
	StatusTraining = "training"
	StatusOther    = "other"
	StatusOuting   = "outing"
)

// Legacy roster state "leave" maps to away.
func NormalizeStatus(s string) string {
	switch s {
	case "", StatusBase:
		return StatusBase
	case "leave":
		return StatusAway
	default:
		return s
	}
}

func IsBlockingStatus(s string) bool {
	switch NormalizeStatus(s) {
	case StatusAway, StatusSick, StatusTraining, StatusOther, StatusOuting:
		return true
	default:
		return false
	}
}

// Entry is one availability interval (hot, resolved, or scenario).
type Entry struct {
	SoldierID string
	StartAt   time.Time
	EndAt     *time.Time // nil = open-ended
	Status    string
}

// DaySoldiers is compiled availability for one plan day (output shape).
type DaySoldiers struct {
	AvailFull     []string              `json:"avail_full"`
	AvailPartial  map[string][][]string `json:"avail_partial,omitempty"`
	AvailAbsent   []string              `json:"avail_absent,omitempty"`
	Summary       DaySummary            `json:"summary"`
}

type DaySummary struct {
	Full           int `json:"full"`
	AbsentFull     int `json:"absent_full"`
	AbsentPartial  int `json:"absent_partial"`
}

// Interval is a half-open [Start, End) range in UTC.
type Interval struct {
	Start time.Time
	End   time.Time
}
