package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"guard/guardsched"
)

// APIErrorBody is the standard JSON error envelope for plan and simulation endpoints.
type APIErrorBody struct {
	Error             string         `json:"error"`
	Code              string         `json:"code,omitempty"`
	Message           string         `json:"message,omitempty"`
	Status            int            `json:"status,omitempty"`
	Request           map[string]any `json:"request,omitempty"`
	Processing        map[string]any `json:"processing,omitempty"`
	Hints             []string       `json:"hints,omitempty"`
	Details           map[string]any `json:"details,omitempty"`
	ConflictingDates  []string       `json:"conflicting_dates,omitempty"`
}

func writeAPIError(w http.ResponseWriter, body APIErrorBody) {
	if body.Error == "" {
		body.Error = body.Message
	}
	if body.Message == "" {
		body.Message = body.Error
	}
	if body.Status == 0 {
		body.Status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(body.Status)
	_ = json.NewEncoder(w).Encode(body)
}

func scheduleRunRequestSnapshot(body scheduleRunBody, slot string) map[string]any {
	req := map[string]any{
		"anchor_date": strings.TrimSpace(body.AnchorDate),
		"days":        body.Days,
	}
	if slot != "" {
		req["slot"] = slot
	}
	if body.Seed != nil {
		req["seed"] = *body.Seed
	}
	if body.ShiftHours != nil {
		req["shift_hours"] = *body.ShiftHours
	}
	if body.MinConsecutiveFreeHours != nil {
		req["min_consecutive_free_hours"] = *body.MinConsecutiveFreeHours
	}
	if body.MinFreeShiftsAfterDuty != nil {
		req["min_free_shifts_after_duty"] = *body.MinFreeShiftsAfterDuty
	}
	if body.BandRelative != nil {
		req["band_relative"] = *body.BandRelative
	}
	if body.SimTrials != nil {
		req["sim_trials"] = *body.SimTrials
	}
	if body.DebugDayOffset != nil {
		req["debug_day_offset"] = *body.DebugDayOffset
	}
	return req
}

func (s *Server) baseSimProcessing(debugOffset int) map[string]any {
	return map[string]any{
		"effective_today": s.effectiveTodayUTC(debugOffset).Format("2006-01-02"),
		"plan_anchor":     s.allowedPlanAnchor(debugOffset).Format("2006-01-02"),
		"debug_day_offset": s.planDebugOffset(debugOffset),
	}
}

func mergeProcessing(base map[string]any, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

var (
	reFillDaySlot = regexp.MustCompile(`cannot fill day (\d+) slot (\d+)`)
	reFillDayBlockSlot  = regexp.MustCompile(`cannot fill day (\d+) block (\d+) slot (\d+)`)
	reFullDayTeamType   = regexp.MustCompile(`need \d+ type ([^,]+),`)
	reOnDaySlot         = regexp.MustCompile(`on day (\d+) slot (\d+)`)
)

func classifySimulationError(err error) (code, headline string, hints []string, details map[string]any) {
	msg := err.Error()
	details = map[string]any{"raw": msg}

	switch {
	case errors.Is(err, guardsched.ErrRestConstraint) || strings.Contains(msg, "rest constraint"):
		code = "rest_constraint"
		headline = "Could not build a valid schedule"
		hints = []string{
			"Check soldier absences and status on the plan day(s) in the Soldiers tab.",
			"Try fewer plan days or relax min consecutive free hours.",
			"Ensure roster size meets the number of concurrent slots in zones config.",
		}
		if m := reFillDayBlockSlot.FindStringSubmatch(msg); len(m) == 4 {
			details["day"] = atoi(m[1])
			details["block"] = atoi(m[2])
			details["slot"] = atoi(m[3])
		} else if m := reFillDaySlot.FindStringSubmatch(msg); len(m) == 3 {
			details["day"] = atoi(m[1])
			details["slot"] = atoi(m[2])
		}
		if strings.Contains(msg, "full_day") {
			details["pattern"] = "full_day"
		} else if strings.Contains(msg, "windowed") {
			details["pattern"] = "windowed"
		} else if strings.Contains(msg, "rotating") {
			details["pattern"] = "rotating"
		}
	case strings.Contains(msg, "verified schedule on") && strings.Contains(msg, "shift_hours"):
		code = "history_shift_mismatch"
		headline = "Verified history uses a different shift length"
		hints = []string{
			"Align shift hours in zones config with verified schedule days, or clear conflicting history.",
		}
	case strings.Contains(msg, "history without continuation requires sim_trials 1"):
		code = "history_bootstrap_trials"
		headline = "History bootstrap requires a single simulation trial"
		hints = []string{
			"Set sim trials to 1, or ensure the latest verified day has a continuation checkpoint.",
		}
	case strings.Contains(msg, "cold continuation capture requires sim_trials 1"):
		code = "validation"
		headline = "Cold run requires a single simulation trial"
		hints = []string{"Set sim trials to 1 for this configuration."}
	case strings.Contains(msg, "full_day_team:"):
		code = "type_quota_unfilled"
		headline = "Team post type quota could not be filled"
		hints = []string{
			"Ensure enough soldiers with each required type_code (see zones type_quotas).",
			"Check Soldiers tab: absences and status on the plan day.",
			"Earlier full_day / full_day_team slots may use the only soldiers of that type.",
		}
		details["pattern"] = "full_day_team"
		if m := reOnDaySlot.FindStringSubmatch(msg); len(m) == 3 {
			details["day"] = atoi(m[1])
			details["slot"] = atoi(m[2])
		}
		if m := reFullDayTeamType.FindStringSubmatch(msg); len(m) == 2 {
			details["type_code"] = strings.TrimSpace(m[1])
		}
	default:
		code = "simulation_failed"
		headline = "Schedule simulation failed"
		hints = []string{"Review inputs and try again; use the developer panel for the full response."}
	}
	return code, headline, hints, details
}

func simFailure(
	status int,
	code, headline, message string,
	request, processing map[string]any,
	hints []string,
	details map[string]any,
) *APIErrorBody {
	if message == "" {
		message = headline
	}
	return &APIErrorBody{
		Error:      headline,
		Code:       code,
		Message:    message,
		Status:     status,
		Request:    request,
		Processing: processing,
		Hints:      hints,
		Details:    details,
	}
}

func validationFailure(headline, message string, request, processing map[string]any, hints ...string) *APIErrorBody {
	return simFailure(http.StatusBadRequest, "validation", headline, message, request, processing, hints, nil)
}

func internalFailure(message string, request map[string]any) *APIErrorBody {
	return simFailure(http.StatusInternalServerError, "internal", "Unexpected server error", message, request, nil, nil, nil)
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func planAnchorMismatch(err error, planAnchor string, request map[string]any) APIErrorBody {
	hints := []string{"Reload plan context and use the server plan anchor date."}
	if planAnchor != "" {
		hints = append(hints, "Expected anchor_date: "+planAnchor)
	}
	return APIErrorBody{
		Status:     http.StatusBadRequest,
		Code:       "anchor_mismatch",
		Error:      "Planning anchor does not match server",
		Message:    err.Error(),
		Request:    request,
		Processing: map[string]any{"plan_anchor": planAnchor},
		Hints:      hints,
	}
}
