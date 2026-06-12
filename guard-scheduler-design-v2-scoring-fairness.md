# Guard Scheduler — Design Supplement v2  
## Scoring Window, Summary Averages, Selection & Random Band

**Parent document:** `guard-scheduler-design-en.pdf` (architecture, DB v1, flows, API, UI).  
**This supplement:** Replaces §3 (in-memory structs), §4.1 (scores), §4.4 (selection), §1.6 (assignments), and related report/metrics text **where they conflict** with v1.

**Status:** Design decision record — implement migrations and `scorer` / `scheduler` services to match this doc.

---

## 0. Goals (why v2)

1. **Single lookback window** for every score (global, location, time) with a clear SQL predicate.
2. **Two “summary” scores** per soldier — means over per-dimension vectors — as the main fairness signals for roster-wide balance.
3. **Selection** that avoids brittle deterministic ordering (same soldiers always picked when scores tie).
4. **Schema simplification:** drop persisted `zone_composite_id`; composite weight remains a **derived** value (`loc_weight × time_weight × hours`) at slot/assignment time.

---

## 1. Score lookback window

**Setting:** `score_lookback_days` (default `7`, configurable via `settings`).

```text
window_start = NOW() - (score_lookback_days * 1 day)
```

**Applies to all score numerators** (`global`, each `loc_score[*]`, each `time_score[*]`):

- Only assignments with `start_time >= window_start` and `status = 'confirmed'` count toward accumulated weight.

**Denominator (unchanged from v1):** `available_hours` for the same soldier over the **same** `[window_start, NOW())` interval, derived from `soldier_log` (present intervals). If `available_hours == 0`, define all scores as `0.0` (avoid division by zero).

**Which soldier column for aggregation:** Keep v1 rule — confirmed work is credited to **`actual_personal_id`** (the soldier who actually stood the shift). When confirming without swap, `actual_personal_id = planned_personal_id`. Scoring queries filter on the credited soldier ID.

**Pseudo-SQL fragment (illustrative):**

```sql
-- numerator example: global accumulated weight in window
SELECT COALESCE(SUM(weight), 0)
FROM assignments
WHERE actual_personal_id = :soldier_id
  AND status = 'confirmed'
  AND start_time >= :window_start;

-- loc_score[loc_id] numerator
SELECT COALESCE(SUM(weight), 0)
FROM assignments
WHERE actual_personal_id = :soldier_id
  AND status = 'confirmed'
  AND start_time >= :window_start
  AND zone_location_id = :loc_id;

-- time_score[zt_id] numerator
SELECT COALESCE(SUM(weight), 0)
FROM assignments
WHERE actual_personal_id = :soldier_id
  AND status = 'confirmed'
  AND start_time >= :window_start
  AND zone_time_id = :zt_id;
```

---

## 2. Per-soldier vectors and summary averages

### 2.1 Vectors

For each soldier, after loading numerators and `available_hours`:

- `LocationScores map[string]float64` — key: every `zone_locations.id` (or every location referenced by an active post; missing keys treated as `0`).
- `TimeScores map[string]float64` — key: every `settings.time_zones[].id`.

**Definitions:**

```text
LocationScores[loc_id] = loc_weight_numerator(loc_id) / available_hours
TimeScores[zt_id]    = time_weight_numerator(zt_id) / available_hours
GlobalScore          = total_weight_numerator / available_hours
```

### 2.2 Summary averages (primary fairness signals)

```text
AvgLocationScore = mean(values(LocationScores))   -- one value per known location key
AvgTimeScore     = mean(values(TimeScores))      -- one value per known time-zone key
```

**Note:** If the key universe is large, these are *unweighted* means across dimensions (each location/time band counts equally in the average). That matches “treat every zone dimension as equally important in roster-wide fairness.” If product later needs “weight by post hours exposure,” revisit the mean definition.

### 2.3 In-memory updates during a single generate run

v1 bumped an in-memory score after each draft assignment. v2 keeps that behavior under a single field:

```go
InMemoryWeightDelta float64 // += draft.Weight after each assignment to this soldier in this run
```

**Application rule:** When comparing soldiers during `pickSoldier`, use **effective** scores:

```text
effective_global      = GlobalScore      + InMemoryWeightDelta / max(available_hours, ε)
effective_loc[loc]    = LocationScores[loc] + (draft_loc_delta) / max(available_hours, ε)
effective_time[zt]    = TimeScores[zt] + (draft_time_delta) / max(available_hours, ε)
```

…where draft deltas accrue from assignments already placed **in this run** (same proportional split as weight: the full `draft.Weight` increments the numerator for that slot’s `zone_location_id` and `zone_time_id`, and global). Implementation detail: either maintain running effective numerators or distribute `InMemoryWeightDelta` across dimensions — simplest is to maintain separate in-memory numerator deltas per dimension + global.

---

## 3. Selection policy — answering “Option A vs B”

### 3.1 Decision (recommended default): **Hybrid ordering, then random band**

**Rationale:** Pure **Option A** (`AvgLocationScore`, `AvgTimeScore`) optimizes *roster-wide* balance but can under-correct “who is most owed for *this* gate” and “who is most owed for *this* night band.” Pure **Option B** fixes local fairness but can starve cross-location balance. A **hybrid** matches military intuition: *first* pick among those who are least loaded **for this slot’s location and time band**, *then* use averages to break ties in a way that preserves global equity.

**Deterministic ordering (lexicographic):**

1. `loc_score[slot.ZoneLocationID]` ascending (effective)
2. `AvgLocationScore` ascending (effective)
3. `time_score[slot.ZoneTimeID]` ascending (effective)
4. `AvgTimeScore` ascending (effective)
5. `GlobalScore` ascending (effective)
6. Stable tie-break: `PersonalID` (only for reproducibility in tests; see random band below)

**Alternate profile (optional setting): `fairness_mode = global_mean`**

- Use **Option A only:** sort by `AvgLocationScore`, then `AvgTimeScore`, then `GlobalScore`.  
- Use when command explicitly wants “ignore local cell, optimize roster totals.”

This doc treats **hybrid** as the default.

### 3.2 Randomness within a band (breaks cyclic determinism)

After sorting eligible soldiers, build a pool:

**Constants:**

- `BAND_RELATIVE = 0.10` (±10% band, configurable)
- `BAND_ABSOLUTE = 0.01` (minimum width when best ≈ 0)

**Step 1 — location leg (on `loc_score[slot.ZoneLocationID]`):**

```text
best_loc = min effective loc_score for slot location among eligible
upper_loc = max(best_loc * (1 + BAND_RELATIVE), best_loc + BAND_ABSOLUTE)
pool = { s | s.effective_loc_score(slot) <= upper_loc }
```

**Step 2 — time leg (within `pool`, on `time_score[slot.ZoneTimeID]`):**

```text
best_time = min effective time score for slot time zone among pool
upper_time = max(best_time * (1 + BAND_RELATIVE), best_time + BAND_ABSOLUTE)
pool = { s in pool | s.effective_time_score(slot) <= upper_time }
```

**Step 3 — pick uniformly at random from `pool`.**

**Why this answers “band applies to what?” (Question 2):** The default is **sequential bands on the two slot-specific dimensions** (location score for this slot’s location, then time score for this slot’s time ID). That preserves interpretability (“among similarly under-used at the gate, diversify; among those, similarly under-used at night”).

**Alternative (not default):** Single composite key, e.g. `cell_score = loc_score[slot.Loc] + time_score[slot.Zt]` or weighted sum — harder to explain to operators and mixes units unless carefully normalized.

**Fresh start / all zeros:** `BAND_ABSOLUTE` ensures `upper_*` > `best_*` when `best = 0`, so the pool does not collapse to a single soldier.

---

## 4. Database: `assignments` (v2)

Remove persisted composite identifier; keep snapshots needed for historical weight integrity:

```sql
ALTER TABLE assignments
  DROP COLUMN IF EXISTS zone_composite_id;
```

**Remaining columns (zone-related):**

| Column             | Type    | Notes                                      |
|--------------------|---------|--------------------------------------------|
| `zone_location_id` | TEXT    | NOT NULL, snapshot                         |
| `zone_time_id`     | TEXT    | NOT NULL, snapshot                         |
| `weight`           | REAL    | NOT NULL, `hours × loc_weight × time_weight` |

**Derived (not stored):** `zone_composite_label = zone_location_id || '_' || zone_time_id` for UI/matrix display only.

**Indexes:** unchanged intent; add/keep composites for reporting filters if needed:

```sql
CREATE INDEX IF NOT EXISTS idx_asgn_zone_loc ON assignments(zone_location_id);
CREATE INDEX IF NOT EXISTS idx_asgn_zone_time ON assignments(zone_time_id);
```

---

## 5. Go structs (replace conflicting v1 definitions)

### 5.1 `Soldier`

```go
type Soldier struct {
    PersonalID          string
    Name                string
    IsPresent           bool
    Location            string
    Preferences         SoldierPreferences
    Constraints         SoldierConstraints
    FirstGuardNotBefore *time.Time

    AvailableHours float64 // same window as scores

    GlobalScore      float64
    LocationScores   map[string]float64 // zone_location_id -> score
    TimeScores       map[string]float64 // zone_time_id -> score
    AvgLocationScore float64            // mean(LocationScores)
    AvgTimeScore     float64            // mean(TimeScores)

    InMemoryWeightDelta float64 // or structured per-dimension deltas — see §2.3
}
```

### 5.2 `Slot`

Drop `ZoneCompositeID` **or** keep as a **computed** field when building slots (not persisted):

```go
type Slot struct {
    PostID           int
    ZoneLocationID   string
    ZoneLocationW    float64
    ZoneTimeID       string
    ZoneTimeW        float64
    StartTime        time.Time
    EndTime          time.Time
    ShiftHours       float64
    RequiredGuards   int
    BaseWeight       float64 // ShiftHours × ZoneLocationW × ZoneTimeW
}
```

### 5.3 `ScheduleMetrics`

```go
type ScheduleMetrics struct {
    Coverage            float64
    SleepViolations     int
    FairnessStd         float64            // std dev of GlobalScore (effective after run optional)

    LocationFairnessStd map[string]float64 // per zone_location_id: std dev across soldiers
    TimeFairnessStd     map[string]float64 // per zone_time_id: std dev across soldiers

    AvgLocationStd      float64            // std dev of AvgLocationScore across soldiers
    AvgTimeStd          float64            // std dev of AvgTimeScore across soldiers
}
```

---

## 6. Settings & product surface changes

| Key                     | Change |
|-------------------------|--------|
| `zone_fairness_enabled` | Replace with `fairness_mode` enum: `hybrid` (default) \| `global_mean` \| `disabled` (pure global score only). |
| `score_lookback_days`   | Unchanged meaning; now **strictly** shared by all numerators. |
| New optional keys       | `selection_band_relative` (default `0.1`), `selection_band_absolute` (default `0.01`). |

**UI copy:** Explain banded random selection under “Fairness” help text to commanders.

---

## 7. Reports & API deltas (vs v1 PDF)

- `GET /api/reports/soldiers`: return `global`, `per_location`, `per_time`, **`avg_location`**, **`avg_time`**; remove `per_composite` **or** derive composite rows client-side from loc×time for backward compatibility.
- Zone matrix screen: still shows `loc × time` weights; drill-down uses `assignments.zone_location_id` + `zone_time_id`.

---

## 8. Migration & implementation checklist

1. **DB migration:** drop `zone_composite_id`; backfill not needed — historical rows still have loc+time; composite is derivable.
2. **`scorer.go`:** implement `TimeScores`, `AvgLocationScore`, `AvgTimeScore`; remove `CompositeScores` queries.
3. **`scheduler.go`:** `pickSoldier` → hybrid ordering + two-stage band + secure RNG (use `crypto/rand` or inject RNG interface for tests).
4. **Metrics:** compute new std-dev maps plus averages.
5. **Tests:**  
   - all-zero scores → pool size > 1 with absolute band  
   - tied scores → randomness does not always pick same soldier across runs (statistical smoke)  
   - effective scores move during a run as `InMemoryWeightDelta` accrues  

---

## 9. Summary of resolved open questions

| Question | Resolution |
|----------|--------------|
| **Sort key: A, B, or both?** | **Default = both (hybrid):** slot `loc_score`, then `AvgLocationScore`, then slot `time_score`, then `AvgTimeScore`, then `GlobalScore`. Optional **global_mean** mode = Option A only. |
| **Band: sequential vs composite?** | **Default = sequential:** band on **slot location** score, then band on **slot time** score within surviving pool; then uniform random. Documented alternative: single composite (not default). |

---

## 10. References

- Original v1 design: `guard-scheduler-design-en.pdf` (sections 1–8).  
- This file supersedes v1 for: assignments schema (§1.6), composite scoring (§2 matrix narrative stays, storage changes), structs (§3), algorithm §4.1 and §4.4, and report drill-downs that referenced `zone_composite_id`.

---

## 11. Worked example — 10 soldiers, 3×3 zones, 3 concurrent slots

**Intent:** Show one greedy pass with **hybrid sort** + **sequential bands** (location leg, then time leg) + **random choice** from the final pool.  
**Confirmed decisions:** sort key = **both** (slot-specific then averages); band = **sequential** on slot `loc_score` then slot `time_score`.

### 11.1 Zone definitions

**Locations (`zone_locations`)**

| id | name | weight (for weight×hours only; not used in this scoring table) |
|----|------|------------------------------------------------------------------|
| `loc_gate` | Main gate | 1.2 |
| `loc_tower` | Tower | 1.0 |
| `loc_yard` | Yard / perimeter | 0.9 |

**Time bands (`time_zones` in settings)**

| id | name | hour range (illustrative) | weight |
|----|------|---------------------------|--------|
| `zt_night` | Night | 00:00–05:59 | 1.5 |
| `zt_morn` | Morning | 06:00–11:59 | 0.9 |
| `zt_day` | Day | 12:00–23:59 | 1.0 |

### 11.2 Scenario

- **10 soldiers**, all eligible (present, rest OK, daily cap OK).  
- **3 posts**, each `schedule_type = always`, **1 guard** per post, same wall-clock shift **02:00–06:00** → all slots map to **`zt_night`**.  
- Slots are **parallel** (same start/end). Processing order when `start_time` ties: **`post_id` ascending** (Gate → Tower → Yard).

| slot | post | `zone_location_id` | `zone_time_id` |
|------|------|--------------------|----------------|
| A | Main gate | `loc_gate` | `zt_night` |
| B | Tower | `loc_tower` | `zt_night` |
| C | Yard | `loc_yard` | `zt_night` |

**Band parameters:** `BAND_RELATIVE = 0.10`, `BAND_ABSOLUTE = 0.01`.

**In-run score bump (for illustration):** after each assignment, add **`δ = 0.01`** to that soldier’s **global**, **slot location**, and **slot time** “effective” scores only (same as adding weight `1.0` with `available_hours = 100`). **Averages are recomputed** from the three location and three time values after each bump when evaluating the next slot.

### 11.3 Soldier metrics (before the run)

Per-soldier scores are **already normalized** (e.g. accumulated weight ÷ available hours in the lookback window).  
**AvgL** = mean(`loc_gate`, `loc_tower`, `loc_yard`). **AvgT** = mean(`zt_night`, `zt_morn`, `zt_day`).

| Soldier | loc_gate | loc_tower | loc_yard | **AvgL** | zt_night | zt_morn | zt_day | **AvgT** | **Global** |
|---------|----------|-----------|----------|----------|----------|---------|--------|----------|------------|
| S1 | 0.01 | 0.10 | 0.12 | 0.0767 | 0.02 | 0.05 | 0.05 | 0.0400 | 0.080 |
| S2 | 0.02 | 0.08 | 0.08 | 0.0600 | 0.03 | 0.05 | 0.05 | 0.0433 | 0.090 |
| S3 | 0.02 | 0.05 | 0.05 | 0.0400 | 0.02 | 0.06 | 0.06 | 0.0467 | 0.070 |
| S4 | 0.03 | 0.02 | 0.02 | 0.0233 | 0.04 | 0.03 | 0.03 | 0.0333 | 0.060 |
| S5 | 0.03 | 0.03 | 0.02 | 0.0267 | 0.01 | 0.04 | 0.05 | 0.0333 | 0.065 |
| S6 | 0.04 | 0.01 | 0.01 | 0.0200 | 0.03 | 0.03 | 0.03 | 0.0300 | 0.055 |
| S7 | 0.04 | 0.02 | 0.01 | 0.0233 | 0.02 | 0.03 | 0.04 | 0.0300 | 0.055 |
| S8 | 0.05 | 0.00 | 0.00 | 0.0167 | 0.04 | 0.02 | 0.02 | 0.0267 | 0.050 |
| S9 | 0.05 | 0.01 | 0.00 | 0.0200 | 0.015 | 0.04 | 0.04 | 0.0317 | 0.048 |
| S10 | 0.06 | 0.00 | 0.00 | 0.0200 | 0.01 | 0.05 | 0.05 | 0.0367 | 0.045 |

### 11.4 Slot A — `loc_gate` + `zt_night`

**Step 1 — Hybrid ordering**  
Sort by `(loc_gate, AvgL, zt_night, AvgT, Global)` ascending:

1. S1 — (0.01, 0.0767, 0.02, 0.0400, 0.080)  
2. S3 — (0.02, 0.0400, 0.02, 0.0467, 0.070)  
3. S2 — (0.02, 0.0600, 0.03, 0.0433, 0.090)  
4. S4 — (0.03, 0.0233, 0.04, 0.0333, 0.060)  
5. S5 — (0.03, 0.0267, 0.01, 0.0333, 0.065)  
6. S6 — (0.04, 0.0200, 0.03, 0.0300, 0.055)  
7. S7 — (0.04, 0.0233, 0.02, 0.0300, 0.055)  
8. S8 — (0.05, 0.0167, 0.04, 0.0267, 0.050)  
9. S9 — (0.05, 0.0200, 0.015, 0.0317, 0.048)  
10. S10 — (0.06, 0.0200, 0.01, 0.0367, 0.045)

**Step 2 — Band on `loc_gate`**

- `best_loc = 0.01` (S1)  
- `upper_loc = max(0.01 × 1.1, 0.01 + 0.01) = 0.02`  
- **Pool₁:** `loc_gate ≤ 0.02` → **{S1, S3, S2}**

**Step 3 — Band on `zt_night` within Pool₁**

| Soldier | zt_night |
|---------|----------|
| S1 | 0.02 |
| S3 | 0.02 |
| S2 | 0.03 |

- `best_time = 0.02`  
- `upper_time = max(0.02 × 1.1, 0.02 + 0.01) = 0.03`  
- **Pool₂:** `zt_night ≤ 0.03` → **{S1, S3, S2}** (unchanged)

**Step 4 — Random choice**  
Uniform pick from **{S1, S3, S2}**. Suppose RNG returns **S3**.

**Update S3:** `loc_gate += 0.01`, `zt_night += 0.01`, `Global += 0.01` → loc_gate **0.03**, zt_night **0.03**, Global **0.080**; recompute **AvgL** = (0.03+0.05+0.05)/3 ≈ **0.0433**, **AvgT** = (0.03+0.06+0.06)/3 = **0.0500**.

### 11.5 Slot B — `loc_tower` + `zt_night` (S3 unavailable — already assigned)

Eligible: all except S3.

**Hybrid ordering** (key columns `(loc_tower, AvgL, zt_night, AvgT, Global)`):

1. S8 — (0.00, 0.0167, 0.04, 0.0267, 0.050)  
2. S10 — (0.00, 0.0200, 0.01, 0.0367, 0.045)  
3. S9 — (0.01, 0.0200, 0.015, 0.0317, 0.048)  
4. S6 — (0.01, 0.0200, 0.03, 0.0300, 0.055)  
5. S7 — (0.02, 0.0233, 0.02, 0.0300, 0.055)  
6. S4 — (0.02, 0.0233, 0.04, 0.0333, 0.060)  
7. S5 — (0.03, 0.0267, 0.01, 0.0333, 0.065)  
8. S2 — (0.08, 0.0600, 0.03, 0.0433, 0.090)  
9. S1 — (0.10, 0.0767, 0.02, 0.0400, 0.080)

**Band on `loc_tower`**

- `best_loc = 0.00`  
- `upper_loc = max(0 × 1.1, 0 + 0.01) = 0.01`  
- **Pool₁:** `loc_tower ≤ 0.01` → **{S8, S10, S9, S6}**

**Band on `zt_night` within Pool₁**

| Soldier | zt_night |
|---------|----------|
| S8 | 0.04 |
| S10 | 0.01 |
| S9 | 0.015 |
| S6 | 0.03 |

- `best_time = 0.01` (S10)  
- `upper_time = max(0.011, 0.02) = 0.02`  
- **Pool₂:** `zt_night ≤ 0.02` → **{S10, S9}** (S8 and S6 drop out)

**Random choice:** Suppose RNG picks **S10**.

**Update S10:** tower +0.01, night +0.01, Global +0.01 → loc_tower **0.01**, zt_night **0.02**, Global **0.055**; **AvgL** = (0.06+0.01+0)/3 ≈ **0.0233**, **AvgT** = (0.02+0.05+0.05)/3 ≈ **0.0400**.

### 11.6 Slot C — `loc_yard` + `zt_night` (S3, S10 unavailable)

**Hybrid ordering** (`loc_yard`, `AvgL`, `zt_night`, `AvgT`, `Global`):

1. S8 — (0.00, 0.0167, 0.04, 0.0267, 0.050)  
2. S9 — (0.00, 0.0200, 0.015, 0.0317, 0.048)  
3. S6 — (0.01, 0.0200, 0.03, 0.0300, 0.055)  
4. S7 — (0.01, 0.0233, 0.02, 0.0300, 0.055)  
5. S4 — (0.02, 0.0233, 0.04, 0.0333, 0.060)  
6. S5 — (0.02, 0.0267, 0.01, 0.0333, 0.065)  
7. S2 — (0.08, 0.0600, 0.03, 0.0433, 0.090)  
8. S1 — (0.12, 0.0767, 0.02, 0.0400, 0.080)

**Band on `loc_yard`**

- `best_loc = 0.00`  
- `upper_loc = 0.01`  
- **Pool₁:** **{S8, S9, S6, S7}**

**Band on `zt_night` within Pool₁**

| Soldier | zt_night |
|---------|----------|
| S8 | 0.04 |
| S9 | 0.015 |
| S6 | 0.03 |
| S7 | 0.02 |

- `best_time = 0.015` (S9)  
- `upper_time = max(0.015 × 1.1, 0.015 + 0.01) = 0.025`  
- **Pool₂:** `zt_night ≤ 0.025` → **{S9, S7}**

**Random choice:** Suppose RNG picks **S7**.

### 11.7 Result summary

| Slot | Post | Assignment | Why not only S1 / “lowest global”? |
|------|------|------------|-------------------------------------|
| A | Gate | **S3** | Gate-specific load: S1 wins ordering but **band** keeps S2,S3; night load then still ties S1≈S3; RNG picks S3 — avoids always picking S1. |
| B | Tower | **S10** | Lowest `loc_tower` is 0 for several; **night** band narrows to {S10, S9}; S10 had lowest `zt_night` in that pool. |
| C | Yard | **S7** | Yard leaders S8,S9; **night** band removes S8 (high night load); final pool {S9,S7}, RNG picks S7. |

**Takeaway:** Hybrid sort encodes **“who is most owed for this post’s location and time band”**; sequential bands implement **“close enough on location, then close enough on night duty”**; randomness breaks ties so **ordering alone does not freeze the same soldier forever**.

*Re-run with different RNG seeds to see S1 or S2 take Gate, S9 take Tower, etc., without changing eligibility or the fairness story.*
