package guardsched

import (
	"fmt"
	"math"
	"sort"
)

const (
	largeLinearGap            = 1_000_000_000
	maxRotatingDfsNodes       = 12_000_000
	maxRotatingDfsCombinations = 8000
	bandRelativeDefault       = 0.2
)

// Zone is a minimal zone config (rotating-only reference sim).
type Zone struct {
	ShiftHours      float64
	LocWeights      []float64
	TimeWeights     []float64
	TimeFromMin     []int
	TimeToExclMin   []int
	SlotLocationIdx []int
	SlotPatterns    []string
}

// Assignment is one duty row (rotating block fill).
type Assignment struct {
	Day            int
	CalendarBlock  int
	Slot           int
	SoldierIdx     int
	LocI           int
	TimeJ          int
	Kind           string
}

// Soldier tracks fairness weights (same semantics as Python).
type Soldier struct {
	Idx             int
	AvailableHours  float64
	WLoc            []float64
	WTime           []float64
	WGlobal         float64
	RawLoc          []float64
	RawTime         []float64
}

func makeSoldier(idx int, hours float64, nLoc, nTime int) *Soldier {
	return &Soldier{
		Idx:            idx,
		AvailableHours: hours,
		WLoc:           make([]float64, nLoc),
		WTime:          make([]float64, nTime),
		RawLoc:         make([]float64, nLoc),
		RawTime:        make([]float64, nTime),
	}
}

func (s *Soldier) totalRawGuardHours() float64 {
	t := 0.0
	for _, v := range s.RawLoc {
		t += v
	}
	return t
}

func (s *Soldier) addAssignment(locI, timeJ int, weight, rawShiftHours float64) {
	s.WGlobal += weight
	s.WLoc[locI] += weight
	s.WTime[timeJ] += weight
	s.RawLoc[locI] += rawShiftHours
	s.RawTime[timeJ] += rawShiftHours
}

func calendarBlocksPerDay(blockHours float64) int {
	if blockHours <= 0 {
		panic("block_hours must be positive")
	}
	q := 24.0 / blockHours
	n := int(math.Round(q))
	if math.Abs(float64(n)*blockHours-24.0) > 1e-5 {
		panic(fmt.Sprintf("24 must divide evenly by block_hours (got %v)", blockHours))
	}
	return n
}

func consecutiveFreeBlocksNeeded(blockHours, minFreeHours float64) int {
	if minFreeHours <= 0 {
		return 0
	}
	return int(math.Ceil(minFreeHours/blockHours - 1e-12))
}

func soldierMustRestThisBlock(soldierIdx, dayIdx, blockIdx, blocksPerDay, kRest int) bool {
	if kRest <= 0 {
		return false
	}
	B := blocksPerDay
	restStart := (soldierIdx + dayIdx) % B
	for j := 0; j < kRest; j++ {
		if blockIdx == (restStart+j)%B {
			return true
		}
	}
	return false
}

func consecutiveDutyBlocksBefore(busy [][][]bool, day, block, soldierIdx, blocksPd int) int {
	chain := 0
	d, b := day, block-1
	if b < 0 {
		d--
		if d < 0 {
			return 0
		}
		b = blocksPd - 1
	}
	for {
		if !busy[d][soldierIdx][b] {
			break
		}
		chain++
		if b > 0 {
			b--
		} else {
			d--
			if d < 0 {
				break
			}
			b = blocksPd - 1
		}
	}
	return chain
}

func gapFreeBlocksSinceLastDutyBeforeAssign(busy [][][]bool, day, block, soldierIdx, blocksPd int) int {
	B := blocksPd
	cur := day*B + block
	prev := cur - 1
	for prev >= 0 {
		pd, pb := prev/B, prev%B
		if busy[pd][soldierIdx][pb] {
			return cur - prev - 1
		}
		prev--
	}
	return largeLinearGap
}

func timeCategoryForHour(h int, z *Zone) int {
	startMin := (h % 24) * 60
	for j := range z.TimeFromMin {
		if timeBandContainsStartMin(z.TimeFromMin[j], z.TimeToExclMin[j], startMin) {
			return j
		}
	}
	panic(fmt.Sprintf("hour %d not covered by time_zones", h))
}

func effLocTime(s *Soldier, locI, timeJ int, deltasLoc, deltasTime [][]float64) (float64, float64) {
	den := math.Max(s.AvailableHours, 1e-9)
	loc := (s.WLoc[locI] + deltasLoc[s.Idx][locI]) / den
	tim := (s.WTime[timeJ] + deltasTime[s.Idx][timeJ]) / den
	return loc, tim
}

func zoneHasMultipleRotatingTypes(zone *ZoneConfig, rotSlotIndices []int) bool {
	tids := map[string]struct{}{}
	for _, sidx := range rotSlotIndices {
		if sidx < 0 || sidx >= len(zone.Slots) {
			continue
		}
		tid := zone.Locations[zone.Slots[sidx].LocationIndex].TypeID
		tids[tid] = struct{}{}
	}
	return len(tids) > 1
}

func soldierHasRotatingDutyDay(busyRot [][][]bool, day, soldierIdx, blocksPd int) bool {
	if day < 0 || day >= len(busyRot) || soldierIdx < 0 || soldierIdx >= len(busyRot[day]) {
		return false
	}
	for b := 0; b < blocksPd && b < len(busyRot[day][soldierIdx]); b++ {
		if busyRot[day][soldierIdx][b] {
			return true
		}
	}
	return false
}

func filterRotatingPoolOnePerDay(pool []*Soldier, busyRot [][][]bool, day, blocksPd int) []*Soldier {
	var filt []*Soldier
	for _, s := range pool {
		if !soldierHasRotatingDutyDay(busyRot, day, s.Idx, blocksPd) {
			filt = append(filt, s)
		}
	}
	if len(filt) == 0 {
		return pool
	}
	return filt
}

func hybridSortKeyTuple(
	s *Soldier, locI, timeJ int,
	deltasLoc, deltasTime [][]float64,
	dg float64,
) []float64 {
	den := math.Max(s.AvailableHours, 1e-9)
	dloc := make([]float64, len(s.WLoc))
	for i := range dloc {
		dloc[i] = deltasLoc[s.Idx][i]
	}
	dtime := make([]float64, len(s.WTime))
	for i := range dtime {
		dtime[i] = deltasTime[s.Idx][i]
	}
	eloc := make([]float64, len(s.WLoc))
	for i := range eloc {
		eloc[i] = (s.WLoc[i] + dloc[i]) / den
	}
	etime := make([]float64, len(s.WTime))
	for i := range etime {
		etime[i] = (s.WTime[i] + dtime[i]) / den
	}
	eg := (s.WGlobal + dg) / den
	var meanEtime float64
	for _, v := range etime {
		meanEtime += v
	}
	meanEtime /= float64(len(etime))
	return []float64{
		eloc[locI],
		eg,
		etime[timeJ],
		meanEtime,
		s.totalRawGuardHours(),
		float64(s.Idx),
	}
}

func hybridRotatingSortKeyTuple(
	s *Soldier, locI, timeJ int,
	deltasLoc, deltasTime [][]float64,
	dg float64,
) []float64 {
	den := math.Max(s.AvailableHours, 1e-9)
	dloc := make([]float64, len(s.WLoc))
	for i := range dloc {
		dloc[i] = deltasLoc[s.Idx][i]
	}
	dtime := make([]float64, len(s.WTime))
	for i := range dtime {
		dtime[i] = deltasTime[s.Idx][i]
	}
	eloc := make([]float64, len(s.WLoc))
	for i := range eloc {
		eloc[i] = (s.WLoc[i] + dloc[i]) / den
	}
	etime := make([]float64, len(s.WTime))
	for i := range etime {
		etime[i] = (s.WTime[i] + dtime[i]) / den
	}
	eg := (s.WGlobal + dg) / den
	var meanEtime float64
	for _, v := range etime {
		meanEtime += v
	}
	meanEtime /= float64(len(etime))
	return []float64{
		s.totalRawGuardHours(),
		eloc[locI],
		eg,
		etime[timeJ],
		meanEtime,
		float64(s.Idx),
	}
}

func lexLessFloatSlice(a, b []float64) bool {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] < b[i]-1e-15 {
			return true
		}
		if a[i] > b[i]+1e-15 {
			return false
		}
	}
	return len(a) < len(b)
}

func bandUpperRelativeOnly(best, bandRelative float64) float64 {
	return best * (1.0 + bandRelative)
}

func applyTotalHoursBalance(pool []*Soldier, r *PyRandom, balanceTotalHours bool, totalHoursSlack float64) *Soldier {
	if !balanceTotalHours {
		return Choice(r, pool)
	}
	minRaw := pool[0].totalRawGuardHours()
	for _, s := range pool[1:] {
		v := s.totalRawGuardHours()
		if v < minRaw {
			minRaw = v
		}
	}
	cap := minRaw + math.Max(totalHoursSlack, 0.0)
	var pool3 []*Soldier
	for _, s := range pool {
		if s.totalRawGuardHours() <= cap+1e-9 {
			pool3 = append(pool3, s)
		}
	}
	if len(pool3) == 0 {
		pool3 = pool
	}
	return Choice(r, pool3)
}

type prefixFn func(*Soldier) []int

func pickSoldier(
	candidates []*Soldier,
	locI, timeJ int,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	prefix prefixFn,
) *Soldier {
	if len(candidates) == 0 {
		panic("no candidates")
	}
	type scored struct {
		s   *Soldier
		key [][]float64 // prefix + hybrid + tie parts
	}
	var rows []scored
	for _, s := range candidates {
		h := hybridSortKeyTuple(s, locI, timeJ, deltasLoc, deltasTime, deltasG[s.Idx])
		var full [][]float64
		if prefix != nil {
			p := prefix(s)
			full = append(full, floatSliceFromInts(p))
		}
		full = append(full, h)
		rows = append(rows, scored{s: s, key: full})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return lexLessFloatSlices(rows[i].key, rows[j].key)
	})
	ranked := make([]*Soldier, len(rows))
	for i := range rows {
		ranked[i] = rows[i].s
	}
	bestLoc, _ := effLocTime(ranked[0], locI, timeJ, deltasLoc, deltasTime)
	upperLoc := bandUpperRelativeOnly(bestLoc, bandRelative)
	var pool1 []*Soldier
	for _, s := range ranked {
		loc, _ := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if loc <= upperLoc+1e-15 {
			pool1 = append(pool1, s)
		}
	}
	bestTime := math.Inf(1)
	for _, s := range pool1 {
		_, tim := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if tim < bestTime {
			bestTime = tim
		}
	}
	upperTime := bandUpperRelativeOnly(bestTime, bandRelative)
	var pool2 []*Soldier
	for _, s := range pool1 {
		_, tim := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if tim <= upperTime+1e-15 {
			pool2 = append(pool2, s)
		}
	}
	return applyTotalHoursBalance(pool2, r, balanceTotalHours, totalHoursSlack)
}

func pickRotatingSoldier(
	candidates []*Soldier,
	locI, timeJ int,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	prefix prefixFn,
) *Soldier {
	if len(candidates) == 0 {
		panic("no candidates")
	}
	type scored struct {
		s   *Soldier
		key [][]float64
	}
	var rows []scored
	for _, s := range candidates {
		h := hybridRotatingSortKeyTuple(s, locI, timeJ, deltasLoc, deltasTime, deltasG[s.Idx])
		var full [][]float64
		if prefix != nil {
			full = append(full, floatSliceFromInts(prefix(s)))
		}
		full = append(full, h)
		rows = append(rows, scored{s: s, key: full})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return lexLessFloatSlices(rows[i].key, rows[j].key)
	})
	ranked := make([]*Soldier, len(rows))
	for i := range rows {
		ranked[i] = rows[i].s
	}
	minRaw := ranked[0].totalRawGuardHours()
	for _, s := range ranked[1:] {
		if v := s.totalRawGuardHours(); v < minRaw {
			minRaw = v
		}
	}
	rawCap := minRaw + math.Max(totalHoursSlack, 0.0)
	var pool0 []*Soldier
	for _, s := range ranked {
		if s.totalRawGuardHours() <= rawCap+1e-9 {
			pool0 = append(pool0, s)
		}
	}
	if len(pool0) == 0 {
		pool0 = ranked
	}
	bestLoc, _ := effLocTime(pool0[0], locI, timeJ, deltasLoc, deltasTime)
	upperLoc := bandUpperRelativeOnly(bestLoc, bandRelative)
	var pool1 []*Soldier
	for _, s := range pool0 {
		loc, _ := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if loc <= upperLoc+1e-15 {
			pool1 = append(pool1, s)
		}
	}
	bestTime := math.Inf(1)
	for _, s := range pool1 {
		_, tim := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if tim < bestTime {
			bestTime = tim
		}
	}
	upperTime := bandUpperRelativeOnly(bestTime, bandRelative)
	var pool2 []*Soldier
	for _, s := range pool1 {
		_, tim := effLocTime(s, locI, timeJ, deltasLoc, deltasTime)
		if tim <= upperTime+1e-15 {
			pool2 = append(pool2, s)
		}
	}
	if !balanceTotalHours {
		return Choice(r, pool2)
	}
	return Choice(r, pool2)
}

func floatSliceFromInts(p []int) []float64 {
	o := make([]float64, len(p))
	for i, v := range p {
		o[i] = float64(v)
	}
	return o
}

func lexLessFloatSlices(a, b [][]float64) bool {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if lexLessFloatSlice(a[i], b[i]) {
			return true
		}
		if lexLessFloatSlice(b[i], a[i]) {
			return false
		}
	}
	return len(a) < len(b)
}

func rotatingPrefixKey(
	busy, busyRot [][][]bool,
	day, block, blocksPd, days, kRest int,
) prefixFn {
	return func(s *Soldier) []int {
		nxtD, nxtB := nextCalendarBlock(day, block, blocksPd, days)
		preferEvening := 1
		if nxtD >= 0 {
			unavailNext := soldierMustRestThisBlock(s.Idx, nxtD, nxtB, blocksPd, kRest) || busy[nxtD][s.Idx][nxtB]
			if unavailNext {
				preferEvening = 0
			} else {
				preferEvening = 1
			}
		}
		gap := gapFreeBlocksSinceLastDutyBeforeAssign(busyRot, day, block, s.Idx, blocksPd)
		return []int{preferEvening, gap}
	}
}

func nextCalendarBlock(day, block, blocksPerDay, days int) (int, int) {
	lin := day*blocksPerDay + block + 1
	if lin >= days*blocksPerDay {
		return -1, -1
	}
	return lin / blocksPerDay, lin % blocksPerDay
}

func rotatingSlotIndices(patterns []string) []int {
	var out []int
	for i, p := range patterns {
		if p == "rotating" {
			out = append(out, i)
		}
	}
	return out
}

func rotatingEligibleForMask(
	soldiers []*Soldier,
	draftRot, busy [][][]bool,
	day, b, blocksPd, kRest, maxConsecutiveDuty, xCool int,
	avail AvailabilityChecker,
	planDayStartHour int,
	sh float64,
	typeCodes []string,
	typeExclude map[string]struct{},
	enforceOneRotatingPerDay bool,
) []*Soldier {
	var out []*Soldier
	for _, s := range soldiers {
		if soldierExcludedByType(typeCodes, s.Idx, typeExclude) {
			continue
		}
		if soldierMustRestThisBlock(s.Idx, day, b, blocksPd, kRest) {
			continue
		}
		if busy[day][s.Idx][b] || draftRot[day][s.Idx][b] {
			continue
		}
		if maxConsecutiveDuty > 0 &&
			consecutiveDutyBlocksBefore(draftRot, day, b, s.Idx, blocksPd) >= maxConsecutiveDuty {
			continue
		}
		if xCool > 0 {
			gap := gapFreeBlocksSinceLastDutyBeforeAssign(draftRot, day, b, s.Idx, blocksPd)
			if gap < xCool && gap < largeLinearGap {
				continue
			}
		}
		if avail != nil && !soldierAvail(avail, s.Idx, day, func() bool {
			return avail.AvailRotatingBlock(s.Idx, day, b, planDayStartHour, sh)
		}) {
			continue
		}
		if enforceOneRotatingPerDay && soldierHasRotatingDutyDay(draftRot, day, s.Idx, blocksPd) {
			continue
		}
		out = append(out, s)
	}
	return out
}

func nChooseK(n, k int) int {
	if k < 0 || k > n {
		return 0
	}
	if k > n-k {
		k = n - k
	}
	c := 1
	for i := 1; i <= k; i++ {
		c = c * (n - k + i) / i
	}
	return c
}

func rotatingDutyBlocksInDraft(draftRot [][][]bool, soldierIdx int) int {
	n := 0
	for d := range draftRot {
		for b := range draftRot[d][soldierIdx] {
			if draftRot[d][soldierIdx][b] {
				n++
			}
		}
	}
	return n
}

type rotatingCombKey struct {
	maxLoad, sumLoad, negIdxSum int
}

func rotatingCombinationSortKey(draftRot [][][]bool, comb []*Soldier) rotatingCombKey {
	maxL, sumL, idxSum := 0, 0, 0
	for _, s := range comb {
		load := rotatingDutyBlocksInDraft(draftRot, s.Idx)
		if load > maxL {
			maxL = load
		}
		sumL += load
		idxSum += s.Idx
	}
	return rotatingCombKey{maxLoad: maxL, sumLoad: sumL, negIdxSum: -idxSum}
}

func forEachCombinationSoldiersFair(
	draftRot [][][]bool,
	pool []*Soldier,
	k int,
	fn func([]*Soldier) bool,
) bool {
	var combs [][]*Soldier
	var comb []*Soldier
	var rec func(start int)
	rec = func(start int) {
		if len(comb) == k {
			cp := append([]*Soldier(nil), comb...)
			combs = append(combs, cp)
			return
		}
		for i := start; i < len(pool); i++ {
			comb = append(comb, pool[i])
			rec(i + 1)
			comb = comb[:len(comb)-1]
		}
	}
	rec(0)
	sort.Slice(combs, func(i, j int) bool {
		ki := rotatingCombinationSortKey(draftRot, combs[i])
		kj := rotatingCombinationSortKey(draftRot, combs[j])
		if ki.maxLoad != kj.maxLoad {
			return ki.maxLoad < kj.maxLoad
		}
		if ki.sumLoad != kj.sumLoad {
			return ki.sumLoad < kj.sumLoad
		}
		return ki.negIdxSum < kj.negIdxSum
	})
	for _, c := range combs {
		if fn(c) {
			return true
		}
	}
	return false
}

func dfsRotatingOnlyMask(
	draftRot, busy [][][]bool,
	soldiers []*Soldier,
	L, days, blocksPd, nRot, kRest, maxConsecutiveDuty, xCool int,
	avail AvailabilityChecker,
	planDayStartHour int,
	sh float64,
	typeCodes []string,
	typeExclude map[string]struct{},
	enforceOneRotatingPerDay bool,
	nodes *int,
) bool {
	if L >= days*blocksPd {
		return true
	}
	day, b := L/blocksPd, L%blocksPd
	cands := rotatingEligibleForMask(soldiers, draftRot, busy, day, b, blocksPd, kRest, maxConsecutiveDuty, xCool, avail, planDayStartHour, sh, typeCodes, typeExclude, enforceOneRotatingPerDay)
	if len(cands) < nRot {
		return false
	}
	*nodes++
	if *nodes > maxRotatingDfsNodes {
		return false
	}
	return forEachCombinationSoldiersFair(draftRot, cands, nRot, func(comb []*Soldier) bool {
		for _, s := range comb {
			draftRot[day][s.Idx][b] = true
		}
		bad := false
		if maxConsecutiveDuty > 0 {
			for _, s := range comb {
				runHere := 1 + consecutiveDutyBlocksBefore(draftRot, day, b, s.Idx, blocksPd)
				if runHere > maxConsecutiveDuty {
					bad = true
					break
				}
			}
		}
		if !bad {
			if dfsRotatingOnlyMask(draftRot, busy, soldiers, L+1, days, blocksPd, nRot, kRest, maxConsecutiveDuty, xCool, avail, planDayStartHour, sh, typeCodes, typeExclude, enforceOneRotatingPerDay, nodes) {
				return true
			}
		}
		for _, s := range comb {
			draftRot[day][s.Idx][b] = false
		}
		return false
	})
}

func forEachCombinationSoldiers(pool []*Soldier, k int, fn func([]*Soldier) bool) bool {
	var comb []*Soldier
	var rec func(start int) bool
	rec = func(start int) bool {
		if len(comb) == k {
			cp := append([]*Soldier(nil), comb...)
			return fn(cp)
		}
		for i := start; i < len(pool); i++ {
			comb = append(comb, pool[i])
			if rec(i + 1) {
				return true
			}
			comb = comb[:len(comb)-1]
		}
		return false
	}
	return rec(0)
}

func allSlotsRotating(patterns []string) bool {
	for _, p := range patterns {
		if p != "rotating" {
			return false
		}
	}
	return true
}

func countRotating(patterns []string) int {
	n := 0
	for _, p := range patterns {
		if p == "rotating" {
			n++
		}
	}
	return n
}

// RunSimulationAllRotating runs the same builder as Python when every slot is rotating
// (no full_day / windowed slot rows). Panics on constraint failure (mirrors Python errors).
func RunSimulationAllRotating(
	numSoldiers, slotsPerBlock, days int,
	z *Zone,
	blockHours float64,
	r *PyRandom,
	minConsecutiveFreeHours float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	maxConsecutiveDutyBlocks int,
	minFreeShiftsAfterDuty int,
	bandRelative float64,
	planDayStartHour int,
) []*Assignment {
	if numSoldiers < slotsPerBlock {
		panic("need soldiers >= slots per block")
	}
	if len(z.SlotPatterns) != slotsPerBlock {
		panic("slot patterns length mismatch")
	}
	if !allSlotsRotating(z.SlotPatterns) {
		panic("RunSimulationAllRotating: only all-rotating zones are supported in Go")
	}
	sh := blockHours
	B := calendarBlocksPerDay(sh)
	nRot := countRotating(z.SlotPatterns)
	nl := len(z.LocWeights)
	nt := len(z.TimeWeights)
	hoursTotal := float64(days) * 24.0
	soldiers := make([]*Soldier, numSoldiers)
	for i := range soldiers {
		soldiers[i] = makeSoldier(i, hoursTotal, nl, nt)
	}
	busy := new3DBool(days, numSoldiers, B)
	busyRot := new3DBool(days, numSoldiers, B)
	deltasLoc := new2DFloat(numSoldiers, nl)
	deltasTime := new2DFloat(numSoldiers, nt)
	deltasG := make([]float64, numSoldiers)
	var assignments []*Assignment
	kRest := consecutiveFreeBlocksNeeded(sh, minConsecutiveFreeHours)
	xCool := minFreeShiftsAfterDuty
	if xCool > 0 && minConsecutiveFreeHours > 0 && float64(xCool)*sh+1e-9 >= minConsecutiveFreeHours && nRot == slotsPerBlock {
		kRest = 0
	}
	rotIdx := rotatingSlotIndices(z.SlotPatterns)
	dfsOk := false
	rotatingDfsTried := false
	if xCool > 0 && len(rotIdx) == slotsPerBlock && len(rotIdx) > 0 &&
		nChooseK(numSoldiers, len(rotIdx)) <= maxRotatingDfsCombinations {
		rotatingDfsTried = true
		dr := new3DBool(days, numSoldiers, B)
		nodes := 0
		if dfsRotatingOnlyMask(dr, busy, soldiers, 0, days, B, len(rotIdx), kRest, maxConsecutiveDutyBlocks, xCool, nil, planDayStartHour, sh, nil, nil, false, &nodes) {
			copy3D(busyRot, dr)
			dfsOk = true
			for day := 0; day < days; day++ {
				for b := 0; b < B; b++ {
					startH := BlockStartHour(planDayStartHour, b, sh)
					timeJ := timeCategoryForHour(startH, z)
					tw := z.TimeWeights[timeJ]
					var inBlock []*Soldier
					for _, s := range soldiers {
						if dr[day][s.Idx][b] {
							inBlock = append(inBlock, s)
						}
					}
					var assigned []*Soldier
					clear2D(deltasLoc)
					clear2D(deltasTime)
					clear1D(deltasG)
					var rotPf prefixFn
					if xCool > 0 {
						rotPf = rotatingPrefixKey(busy, busyRot, day, b, B, days, kRest)
					}
					for _, sidx := range rotIdx {
						locI := z.SlotLocationIdx[sidx]
						lw := z.LocWeights[locI]
						weight := sh * lw * tw
						var pool []*Soldier
						for _, s := range inBlock {
							if !containsSoldier(assigned, s) {
								pool = append(pool, s)
							}
						}
						chosen := pickRotatingSoldier(pool, locI, timeJ, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
						assigned = append(assigned, chosen)
						chosen.addAssignment(locI, timeJ, weight, sh)
						busy[day][chosen.Idx][b] = true
						deltasLoc[chosen.Idx][locI] += weight
						deltasTime[chosen.Idx][timeJ] += weight
						deltasG[chosen.Idx] += weight
						assignments = append(assignments, &Assignment{
							Day: day, CalendarBlock: b, Slot: sidx, SoldierIdx: chosen.Idx,
							LocI: locI, TimeJ: timeJ, Kind: "rotating",
						})
					}
				}
			}
		}
	}
	if dfsOk {
		return assignments
	}
	for day := 0; day < days; day++ {
		for b := 0; b < B; b++ {
			startH := BlockStartHour(planDayStartHour, b, sh)
			timeJ := timeCategoryForHour(startH, z)
			tw := z.TimeWeights[timeJ]
			var assigned []*Soldier
			clear2D(deltasLoc)
			clear2D(deltasTime)
			clear1D(deltasG)
			var rotPf prefixFn
			if xCool > 0 {
				rotPf = rotatingPrefixKey(busy, busyRot, day, b, B, days, kRest)
			}
			for sidx := 0; sidx < slotsPerBlock; sidx++ {
				if z.SlotPatterns[sidx] != "rotating" {
					continue
				}
				locI := z.SlotLocationIdx[sidx]
				lw := z.LocWeights[locI]
				weight := sh * lw * tw
				var base []*Soldier
				for _, s := range soldiers {
					if containsSoldier(assigned, s) {
						continue
					}
					if soldierMustRestThisBlock(s.Idx, day, b, B, kRest) {
						continue
					}
					if busy[day][s.Idx][b] {
						continue
					}
					if maxConsecutiveDutyBlocks > 0 &&
						consecutiveDutyBlocksBefore(busyRot, day, b, s.Idx, B) >= maxConsecutiveDutyBlocks {
						continue
					}
					base = append(base, s)
				}
				pool := base
				if xCool > 0 {
					var filt []*Soldier
					for _, s := range base {
						gap := gapFreeBlocksSinceLastDutyBeforeAssign(busyRot, day, b, s.Idx, B)
						if gap >= xCool || gap >= largeLinearGap {
							filt = append(filt, s)
						}
					}
					pool = filt
				}
				if len(pool) == 0 {
					msg := "rotating: cannot fill"
					if rotatingDfsTried && !dfsOk {
						msg += " (DFS found no feasible mask)"
					}
					panic(msg)
				}
				chosen := pickRotatingSoldier(pool, locI, timeJ, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
				assigned = append(assigned, chosen)
				chosen.addAssignment(locI, timeJ, weight, sh)
				busy[day][chosen.Idx][b] = true
				busyRot[day][chosen.Idx][b] = true
				deltasLoc[chosen.Idx][locI] += weight
				deltasTime[chosen.Idx][timeJ] += weight
				deltasG[chosen.Idx] += weight
				assignments = append(assignments, &Assignment{
					Day: day, CalendarBlock: b, Slot: sidx, SoldierIdx: chosen.Idx,
					LocI: locI, TimeJ: timeJ, Kind: "rotating",
				})
			}
		}
	}
	return assignments
}

func containsSoldier(xs []*Soldier, s *Soldier) bool {
	for _, t := range xs {
		if t.Idx == s.Idx {
			return true
		}
	}
	return false
}

func new3DBool(d1, d2, d3 int) [][][]bool {
	o := make([][][]bool, d1)
	for i := range o {
		o[i] = make([][]bool, d2)
		for j := range o[i] {
			o[i][j] = make([]bool, d3)
		}
	}
	return o
}

func new2DFloat(r, c int) [][]float64 {
	o := make([][]float64, r)
	for i := range o {
		o[i] = make([]float64, c)
	}
	return o
}

func clear2D(m [][]float64) {
	for i := range m {
		for j := range m[i] {
			m[i][j] = 0
		}
	}
}

func clear1D(v []float64) {
	for i := range v {
		v[i] = 0
	}
}

func copy3D(dst, src [][][]bool) {
	for i := range src {
		for j := range src[i] {
			copy(dst[i][j], src[i][j])
		}
	}
}
