package guardsched

import (
	"fmt"
	"math"
	"strings"

	"gopkg.in/yaml.v3"
)

// FullDaySpec holds parsed full_day slots_types config.
type FullDaySpec struct {
	StartH, EndH     int
	RestAfterH       float64
	WeightMult       float64
}

// WindowSpec is one window in windowed_slots.
type WindowSpec struct {
	Name       string
	H0, H1Excl int
	WeightMult float64
}

// ZoneLocation is one row from YAML `locations` (schema v2).
type ZoneLocation struct {
	ID     string
	Name   string
	Weight float64
	TypeID string // slots_types id for this location
}

// ZoneTimeBand is one row from YAML `time_zones`.
type ZoneTimeBand struct {
	ID       string
	Name     string
	Weight   float64
	FromHour int
	ToHour   int
}

// ZoneSlot is one concurrent slot row from YAML `slots` (order = slot index).
type ZoneSlot struct {
	LocationIndex int    // index into Locations
	DisplayName   string // optional display name from YAML
	Pattern       string // rotating | full_day | windowed_slots (from location type)
}

// ZoneConfig is schema v2 YAML (mixed patterns).
type ZoneConfig struct {
	Locations         []ZoneLocation
	TimeBands         []ZoneTimeBand
	Slots             []ZoneSlot
	ShiftHours        float64
	SchemaVersion     int
	FullDaySpecs      map[string]FullDaySpec
	WindowedSpecs     map[string][]WindowSpec
	WindowedRestHours map[string]float64
}

// ToZone builds the minimal Zone used by timeCategoryForHour and rotating sim.
func (z *ZoneConfig) ToZone() *Zone {
	lw := make([]float64, len(z.Locations))
	for i, loc := range z.Locations {
		lw[i] = loc.Weight
	}
	tw := make([]float64, len(z.TimeBands))
	tf := make([]int, len(z.TimeBands))
	tt := make([]int, len(z.TimeBands))
	for i, tb := range z.TimeBands {
		tw[i] = tb.Weight
		tf[i] = tb.FromHour
		tt[i] = tb.ToHour
	}
	sli := make([]int, len(z.Slots))
	sp := make([]string, len(z.Slots))
	for i, s := range z.Slots {
		sli[i] = s.LocationIndex
		sp[i] = s.Pattern
	}
	return &Zone{
		ShiftHours:      z.ShiftHours,
		LocWeights:      lw,
		TimeWeights:     tw,
		TimeFrom:        tf,
		TimeTo:          tt,
		SlotLocationIdx: sli,
		SlotPatterns:    sp,
	}
}

// SlotsPerBlock returns concurrent slot count.
func (z *ZoneConfig) SlotsPerBlock() int { return len(z.Slots) }

// LoadZoneConfigYAML parses schema v2 zones document from bytes (DB or file).
func LoadZoneConfigYAML(raw []byte, slotsPerBlock int, shiftHoursOverride *float64) (*ZoneConfig, error) {
	var data map[string]any
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if int(intFromAny(data["schema_version"], 1)) < 2 || data["slots_types"] == nil {
		return nil, fmt.Errorf("zones: need schema_version>=2 and slots_types")
	}
	stypes, ok := data["slots_types"].([]any)
	if !ok || len(stypes) == 0 {
		return nil, fmt.Errorf("zones: slots_types must be non-empty list")
	}
	typePattern := map[string]string{}
	fullDay := map[string]FullDaySpec{}
	windowed := map[string][]WindowSpec{}
	winRest := map[string]float64{}
	for _, row := range stypes {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("slots_types: entry must be mapping")
		}
		tid := strings.TrimSpace(fmt.Sprint(m["id"]))
		pat := strings.TrimSpace(fmt.Sprint(m["pattern"]))
		if tid == "" {
			return nil, fmt.Errorf("slots_types: missing id")
		}
		switch pat {
		case "rotating":
			typePattern[tid] = pat
		case "full_day":
			typePattern[tid] = pat
			cfg, _ := m["config"].(map[string]any)
			if cfg == nil {
				return nil, fmt.Errorf("full_day %q: missing config", tid)
			}
			sh0, sh1, err := parseInclusiveFullDayHours(fmt.Sprint(cfg["start"]), fmt.Sprint(cfg["end"]))
			if err != nil {
				return nil, fmt.Errorf("full_day %q: %w", tid, err)
			}
			ra := 6.0
			if v, ok := cfg["rest_after_hours"]; ok {
				ra = floatFromAny(v)
			} else if v, ok := cfg["rest_after"]; ok {
				ra = floatFromAny(v)
			}
			wm := 1.0
			if v, ok := cfg["weight_multiplier"]; ok {
				wm = floatFromAny(v)
			} else if v, ok := cfg["weight_mult"]; ok {
				wm = floatFromAny(v)
			} else if v, ok := cfg["w_mult"]; ok {
				wm = floatFromAny(v)
			}
			fullDay[tid] = FullDaySpec{StartH: sh0, EndH: sh1, RestAfterH: ra, WeightMult: wm}
		case "windowed_slots":
			typePattern[tid] = pat
			cfg, _ := m["config"].(map[string]any)
			if cfg == nil {
				return nil, fmt.Errorf("windowed_slots %q: missing config", tid)
			}
			slotsW, _ := cfg["slots"].([]any)
			if len(slotsW) == 0 {
				return nil, fmt.Errorf("windowed_slots %q: config.slots required", tid)
			}
			var wl []WindowSpec
			for _, sw := range slotsW {
				sm, ok := sw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("windowed_slots %q: bad slots entry", tid)
				}
				h0, h1x, err := windowHalfOpenHours(fmt.Sprint(sm["start"]), fmt.Sprint(sm["end"]))
				if err != nil {
					return nil, fmt.Errorf("windowed_slots %q: %w", tid, err)
				}
				wm := 1.0
				if v, ok := sm["weight_multiplier"]; ok {
					wm = floatFromAny(v)
				} else if v, ok := sm["weight_mult"]; ok {
					wm = floatFromAny(v)
				}
				name := strings.TrimSpace(fmt.Sprint(sm["name"]))
				wl = append(wl, WindowSpec{Name: name, H0: h0, H1Excl: h1x, WeightMult: wm})
			}
			windowed[tid] = wl
			rh := 6.0
			if v, ok := m["rest_after_hours"]; ok {
				rh = floatFromAny(v)
			} else if v, ok := m["rest_after"]; ok {
				rh = floatFromAny(v)
			}
			winRest[tid] = rh
		default:
			return nil, fmt.Errorf("slots_types %q: unknown pattern %q", tid, pat)
		}
	}

	locsRaw := data["locations"]
	if locsRaw == nil {
		locsRaw = data["location_zones"]
	}
	locs, ok := locsRaw.([]any)
	if !ok || len(locs) == 0 {
		return nil, fmt.Errorf("zones: locations list required")
	}
	var locations []ZoneLocation
	locIDToIdx := map[string]int{}
	for i, row := range locs {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("locations[%d]: expected mapping", i)
		}
		zid := strings.TrimSpace(fmt.Sprint(m["id"]))
		name := strings.TrimSpace(fmt.Sprint(m["name"]))
		if name == "" {
			name = zid
		}
		lt := strings.TrimSpace(fmt.Sprint(m["type"]))
		if zid == "" || lt == "" {
			return nil, fmt.Errorf("locations[%d]: id and type required", i)
		}
		if _, ok := typePattern[lt]; !ok {
			return nil, fmt.Errorf("locations[%d]: unknown type %q", i, lt)
		}
		w := floatFromAny(m["weight"])
		locations = append(locations, ZoneLocation{ID: zid, Name: name, Weight: w, TypeID: lt})
		locIDToIdx[zid] = i
	}

	slotLoc, slotNames, err := parseSlotLocationIndices(data, slotsPerBlock, locIDToIdx)
	if err != nil {
		return nil, err
	}
	slots := make([]ZoneSlot, len(slotLoc))
	for sidx, li := range slotLoc {
		ltid := locations[li].TypeID
		slots[sidx] = ZoneSlot{
			LocationIndex: li,
			DisplayName:   slotNames[sidx],
			Pattern:       typePattern[ltid],
		}
	}

	shYaml := 8.0
	if v, ok := data["shift_hours"]; ok {
		shYaml = floatFromAny(v)
	}
	if shYaml <= 0 {
		shYaml = 8.0
	}
	shEff := shYaml
	if shiftHoursOverride != nil {
		shEff = *shiftHoursOverride
	}
	if _, err := CalendarBlocksPerDaySafe(shEff); err != nil {
		return nil, err
	}

	tzs, ok := data["time_zones"].([]any)
	if !ok || len(tzs) == 0 {
		return nil, fmt.Errorf("time_zones required")
	}
	defFrom := []int{0, 6, 12}
	defTo := []int{5, 11, 23}
	var timeBands []ZoneTimeBand
	for i, row := range tzs {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("time_zones[%d]: mapping", i)
		}
		zid := strings.TrimSpace(fmt.Sprint(m["id"]))
		name := strings.TrimSpace(fmt.Sprint(m["name"]))
		if name == "" {
			name = zid
		}
		if zid == "" {
			return nil, fmt.Errorf("time_zones[%d]: missing id", i)
		}
		di := i
		if di >= len(defFrom) {
			di = len(defFrom) - 1
		}
		timeBands = append(timeBands, ZoneTimeBand{
			ID:       zid,
			Name:     name,
			Weight:   floatFromAny(m["weight"]),
			FromHour: int(intFromAny(m["from_hour"], defFrom[di])),
			ToHour:   int(intFromAny(m["to_hour"], defTo[di])),
		})
	}

	zc := &ZoneConfig{
		Locations:         locations,
		TimeBands:         timeBands,
		Slots:             slots,
		ShiftHours:        shEff,
		SchemaVersion:     int(intFromAny(data["schema_version"], 2)),
		FullDaySpecs:      fullDay,
		WindowedSpecs:     windowed,
		WindowedRestHours: winRest,
	}
	return zc, nil
}

func parseSlotLocationIndices(data map[string]any, slotsPerBlock int, locIDToIdx map[string]int) ([]int, []string, error) {
	raw := data["slots"]
	if raw == nil {
		raw = data["slot_locations"]
	}
	rows, ok := raw.([]any)
	if !ok {
		return nil, nil, fmt.Errorf("slots: must be a list")
	}
	if len(rows) != slotsPerBlock {
		return nil, nil, fmt.Errorf("slots: length %d != slotsPerBlock %d", len(rows), slotsPerBlock)
	}
	out := make([]int, slotsPerBlock)
	names := make([]string, slotsPerBlock)
	for i, entry := range rows {
		var lid, disp string
		switch e := entry.(type) {
		case string:
			lid = strings.TrimSpace(e)
		case map[string]any:
			lid = strings.TrimSpace(fmt.Sprint(e["location_id"]))
			if lid == "" {
				lid = strings.TrimSpace(fmt.Sprint(e["id"]))
			}
			disp = strings.TrimSpace(fmt.Sprint(e["name"]))
		default:
			return nil, nil, fmt.Errorf("slots[%d]: string or mapping", i)
		}
		if lid == "" {
			return nil, nil, fmt.Errorf("slots[%d]: missing location_id", i)
		}
		li, ok := locIDToIdx[lid]
		if !ok {
			return nil, nil, fmt.Errorf("slots[%d]: unknown location_id %q", i, lid)
		}
		out[i] = li
		names[i] = disp
	}
	return out, names, nil
}

func parseHHMMClock(s string) (int, error) {
	s = strings.TrimSpace(s)
	parts := strings.Split(s, ":")
	if len(parts) < 1 {
		return 0, fmt.Errorf("bad time %q", s)
	}
	var h, m int
	fmt.Sscanf(parts[0], "%d", &h)
	if len(parts) > 1 {
		fmt.Sscanf(parts[1], "%d", &m)
	}
	if m != 0 {
		return 0, fmt.Errorf("time %q must be whole hours", s)
	}
	if h == 24 {
		return 24, nil
	}
	if h < 0 || h > 23 {
		return 0, fmt.Errorf("hour out of range in %q", s)
	}
	return h, nil
}

func parseInclusiveFullDayHours(startS, endS string) (int, int, error) {
	lo, err := parseHHMMClock(startS)
	if err != nil {
		return 0, 0, err
	}
	hi, err := parseHHMMClock(endS)
	if err != nil {
		return 0, 0, err
	}
	if lo == 24 || hi == 24 {
		return 0, 0, fmt.Errorf("full_day start/end must be 0..23")
	}
	return lo, hi, nil
}

func windowHalfOpenHours(startS, endS string) (int, int, error) {
	h0, err := parseHHMMClock(startS)
	if err != nil {
		return 0, 0, err
	}
	es := strings.TrimSpace(endS)
	if es == "24:00" || es == "24:0" || es == "24" {
		return h0, 24, nil
	}
	h1, err := parseHHMMClock(es)
	if err != nil {
		return 0, 0, err
	}
	if h1 == 24 {
		return h0, 24, nil
	}
	return h0, h1, nil
}

// CalendarBlocksPerDaySafe returns 24/shift_hours if it divides evenly.
func CalendarBlocksPerDaySafe(blockHours float64) (int, error) {
	if blockHours <= 0 {
		return 0, fmt.Errorf("block_hours must be positive")
	}
	q := 24.0 / blockHours
	n := int(math.Round(q))
	if math.Abs(float64(n)*blockHours-24.0) > 1e-5 {
		return 0, fmt.Errorf("24 must divide evenly by shift_hours (got %v)", blockHours)
	}
	return n, nil
}
