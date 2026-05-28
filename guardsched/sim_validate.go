package guardsched

import (
	"errors"
	"fmt"
	"math"
)

// ErrRestConstraint is returned when rest / duty constraints cannot be satisfied.
var ErrRestConstraint = errors.New("guardsched: rest constraint")

// SimulationStats mirrors Python counters used after rotating fill.
type SimulationStats struct {
	ShiftCooldownExclusions       int
	ShiftCooldownPoolIterations   int
	ShiftCooldownViolationsPost   int
}

// AssignmentRecord is one scheduled duty (all patterns).
type AssignmentRecord struct {
	Day                   int
	CalendarBlock         int
	StartHour             int
	Slot                  int
	SoldierIdx            int
	LocI                  int
	TimeJ                 int
	Weight                float64
	RawHours              float64
	Kind                  string
	Rowspan               int
	WinStartBlock         int
	WinEndBlock           int
	WindowName            string
	LinearBusySpanBlocks  int // 0 = unset (rotating)
}

func restBlocksAligned(restAfterH, sh float64) int {
	if restAfterH <= 0 {
		return 0
	}
	restAl := math.Ceil(restAfterH/sh) * sh
	return int(math.Round(restAl / sh))
}

func dutyBlocksInclusiveWallHours(sh float64, h0, h1Incl int) (b0, b1 int) {
	shi := int(sh)
	b0 = h0 / shi
	b1 = h1Incl / shi
	return b0, b1
}

func dutyBlocksHalfOpenWallHours(sh float64, h0, h1Excl int) (b0, b1 int) {
	if h1Excl <= h0 {
		shi := int(sh)
		b0 = h0 / shi
		return b0, b0
	}
	shi := int(sh)
	b0 = h0 / shi
	b1 = (h1Excl - 1) / shi
	return b0, b1
}

func linearBusySpanDutyHoursPlusRest(day, B int, sh float64, hDuty0, hDuty1 int, halfOpen bool, restAfterH float64, planStartHour int) (L0, span int) {
	_ = halfOpen // unified end+rest mapping.
	endExcl := int(math.Floor(float64(hDuty1) + restAfterH + 1e-9))
	if endExcl <= hDuty0 {
		endExcl = hDuty0 + 1
	}
	shi := int(sh)
	startRel := (hDuty0 - planStartHour) % 24
	if startRel < 0 {
		startRel += 24
	}
	durH := endExcl - hDuty0
	if durH <= 0 {
		durH = 1
	}
	endRel := startRel + durH
	b0 := startRel / shi
	b1 := (endRel - 1) / shi
	span = b1 - b0 + 1
	L0 = day*B + b0
	return L0, span
}

func busySpanSet(busy [][][]bool, soldier, L0, spanBlocks, B, days int) {
	maxL := days * B
	for k := 0; k < spanBlocks; k++ {
		L := L0 + k
		if L >= maxL {
			break
		}
		d, b := L/B, L%B
		busy[d][soldier][b] = true
	}
}

func anyBusySpan(busy [][][]bool, soldier, L0, spanBlocks, B, days int) bool {
	maxL := days * B
	for k := 0; k < spanBlocks; k++ {
		L := L0 + k
		if L >= maxL {
			break
		}
		d, b := L/B, L%B
		if busy[d][soldier][b] {
			return true
		}
	}
	return false
}

func assertRestFeasibleCounting(numSoldiers, blocksPerDay, slotsPerBlock int, blockHours, minFreeHours float64) error {
	if minFreeHours <= 0 {
		return nil
	}
	if minFreeHours > 24.0+1e-9 {
		return fmt.Errorf("%w: min consecutive free cannot exceed 24h", ErrRestConstraint)
	}
	B := blocksPerDay
	y := slotsPerBlock
	k := consecutiveFreeBlocksNeeded(blockHours, minFreeHours)
	if y > numSoldiers {
		return fmt.Errorf("%w: need at least %d soldiers for %d concurrent slots", ErrRestConstraint, y, y)
	}
	if B < k {
		return fmt.Errorf("%w: day has only %d blocks; need %d free blocks for %.gh rest", ErrRestConstraint, B, k, minFreeHours)
	}
	shiftsPerDay := B * y
	maxBlocksOnDuty := B - k
	if maxBlocksOnDuty <= 0 {
		return fmt.Errorf("%w: impossible rest vs duty density", ErrRestConstraint)
	}
	minSoldiers := int(math.Ceil(float64(shiftsPerDay) / float64(maxBlocksOnDuty)))
	if numSoldiers < minSoldiers {
		return fmt.Errorf("%w: need at least %d soldiers (have %d)", ErrRestConstraint, minSoldiers, numSoldiers)
	}
	return nil
}

func computeMaxConsecutiveFreeHours(busy [][][]bool, blockHours float64) [][]float64 {
	days := len(busy)
	if days == 0 {
		return nil
	}
	nS := len(busy[0])
	B := len(busy[0][0])
	out := make([][]float64, days)
	for d := range out {
		out[d] = make([]float64, nS)
		for s := 0; s < nS; s++ {
			row := busy[d][s]
			busyAny := false
			for _, v := range row {
				if v {
					busyAny = true
					break
				}
			}
			if !busyAny {
				out[d][s] = float64(B) * blockHours
				continue
			}
			doubled := make([]bool, 2*B)
			copy(doubled, row)
			copy(doubled[B:], row)
			run := 0
			best := 0
			for j := 0; j < 2*B; j++ {
				if !doubled[j] {
					run++
					if run > B {
						run = B
					}
					if run > best {
						best = run
					}
				} else {
					run = 0
				}
			}
			out[d][s] = float64(best) * blockHours
		}
	}
	return out
}

func validateScheduleRest(maxFree [][]float64, minFreeHours float64, assignments []*AssignmentRecord) error {
	if minFreeHours <= 0 {
		return nil
	}
	var violations []string
	for d := 0; d < len(maxFree); d++ {
		for s := 0; s < len(maxFree[d]); s++ {
			if assignments != nil {
				skip := false
				for _, a := range assignments {
					if a.Day != d || a.SoldierIdx != s {
						continue
					}
					k := a.Kind
					if k == "" {
						k = "rotating"
					}
					if k == "full_day" || k == "full_day_team" || k == "windowed" {
						skip = true
						break
					}
				}
				if skip {
					continue
				}
			}
			if maxFree[d][s]+1e-9 < minFreeHours {
				violations = append(violations, fmt.Sprintf("day %d S%d max_free=%.2fh", d+1, s, maxFree[d][s]))
			}
		}
	}
	if len(violations) == 0 {
		return nil
	}
	n := 8
	if len(violations) < n {
		n = len(violations)
	}
	msg := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			msg += ", "
		}
		msg += violations[i]
	}
	if len(violations) > 8 {
		msg += fmt.Sprintf(" … (+%d more)", len(violations)-8)
	}
	return fmt.Errorf("%w: schedule rest violated: %s", ErrRestConstraint, msg)
}

func validateMaxConsecutiveDuty(busyRot [][][]bool, maxRun int) error {
	if maxRun <= 0 {
		return nil
	}
	days := len(busyRot)
	nS := len(busyRot[0])
	B := len(busyRot[0][0])
	for s := 0; s < nS; s++ {
		run := 0
		for d := 0; d < days; d++ {
			for b := 0; b < B; b++ {
				if busyRot[d][s][b] {
					run++
					if run > maxRun {
						return fmt.Errorf("%w: soldier S%d has >%d consecutive rotating duty blocks (day %d block %d)", ErrRestConstraint, s, maxRun, d+1, b+1)
					}
				} else {
					run = 0
				}
			}
		}
	}
	return nil
}

func countShiftCooldownViolations(duty [][][]bool, minFreeShiftsAfterDuty int) int {
	if minFreeShiftsAfterDuty <= 0 {
		return 0
	}
	days := len(duty)
	nS := len(duty[0])
	B := len(duty[0][0])
	x := minFreeShiftsAfterDuty
	bad := 0
	for s := 0; s < nS; s++ {
		last := -1
		for d := 0; d < days; d++ {
			for b := 0; b < B; b++ {
				cur := d*B + b
				if duty[d][s][b] {
					if last >= 0 && cur-last-1 < x {
						bad++
					}
					last = cur
				}
			}
		}
	}
	return bad
}
