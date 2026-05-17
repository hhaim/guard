# Plan: checkpoint save/load for `guard_scheduler_sim.py`

## Goals

1. **`--save-state PATH`** — Write a portable checkpoint: run configuration + **embedded assignment history** in one JSON file + RNG metadata (optional embedded `zones_yaml` text).
2. **`--load-state PATH`** — Load checkpoint, validate config against current CLI + zones, **replay** assignments into internal state, then run the scheduler for **new** days.
3. **Config validation** — Fail fast (clear error) if loaded state is incompatible with the current run (soldiers, slots, zone identity, shift hours, constraint flags, etc.).
4. **Combined load + save** — `--load-state A --save-state B` (with `-d` or explicit “new days”) such that **B contains the full merged timeline** (e.g. load 30 + generate 30 ⇒ 60 days in B).
5. **Truncate history on load** — If the file contains more days than needed, support **“use only the last N days”** for replay (rolling window / smaller working set).

**Product scope (from prior discussion):** rolling fairness on replayed history is sufficient; **lifetime** parity with an infinite-horizon offline sim is **not** required. Default replay window for scoring should match the **number of days replayed** after truncate (or a separate `--replay-days` if we expose it).

---

## File layout (chosen)

**Single file** (default name **`checkpoint.json`**; path given to `--save-state`):

```text
checkpoint.json   # format_version, run_meta, assignments[], zones_yaml, …
```

Optional later: `--state-csv-export PATH` to dump the same rows as CSV for spreadsheets (not required for load).

**`state.json` top-level keys (illustrative)**

- `format_version` — integer; bump when assignment object shape or semantics change.
- `saved_at` — ISO-8601 UTC string (optional).
- `run_meta` — soldiers (`-x`), slots (`-y`), `shift_hours`, `min_consecutive_free_hours`, `max_consecutive_duty_blocks`, `min_free_shifts_after_duty`, `band_relative`, `balance_total_hours`, `total_hours_slack`, `zones_path` (original path), `zones_sha256` (hash of zone file bytes at save time), `schema_version` from zone, slot pattern signature.
- **No RNG / seed in file** (confirmed): each run uses the CLI `--seed` or non-deterministic `Random()` for new segments; checkpoints are not seed-portable across runs.
- `blocks_per_day`, `slots_per_block`, `num_days` — after any merge, the horizon length stored in this file.
- `assignments` — JSON array of objects, one per [`AssignmentRecord`](guard_scheduler_sim.py) field:

| JSON field | Type | Notes |
|------------|------|--------|
| `day` | int | 0-based |
| `calendar_block` | int | 0 .. B-1 |
| `slot` | int | 0 .. y-1 |
| `soldier_idx` | int | 0-based |
| `loc_i`, `time_j` | int | |
| `weight`, `raw_hours` | number | |
| `kind` | string | `rotating` / `windowed` / `full_day` |
| `start_hour` | int | |
| `rowspan` | int | default 1 |
| `win_start_block`, `win_end_block` | int | |
| `window_name` | string or null | |
| `linear_busy_span_blocks` | int or null | |

- `zones_yaml` — optional **string** copy of the exact YAML text used (recommended so load can diff without original path); if omitted, load requires matching file on disk via hash + path.

**Source of truth:** the `assignments` array + `run_meta` + zone bytes (embedded or matched file).

---

## CLI design

### Save only

```bash
python guard_scheduler_sim.py -x 10 -y 3 -d 30 --zones zones.yaml --seed 42 \
  --save-state ./out/checkpoint_30d
```

After a normal run: write bundle under `./out/checkpoint_30d/` (create directory).

### Load only (extend)

```bash
python guard_scheduler_sim.py -x 10 -y 3 -d 1 --zones zones.yaml \
  --load-state ./in/checkpoint_30d \
  [--replay-days 30]          # optional: truncate file to last 30 days before replay
  [--seed 99]                 # RNG for the *new* segment (see open questions)
```

Semantics:

- `-d` (or a dedicated flag `--extend-days` if we want to avoid overloading `-d`) = **number of new days to simulate** after replay.
- On load: read `state.json`, apply **truncate** (see below), **validate** config, **replay** CSV into `busy`, `busy_rot`, soldier numerators, then call existing scheduling loop for **only** new days with **day index offset** = `replay_day_count` so rest arc `(soldier_idx + day) % B` stays correct.

**Recommendation:** introduce **`--extend-days N`** for load path so `-d` stays “total days” for cold runs and load path is unambiguous:

- Cold run: `-d 30` unchanged.
- Load run: `--load-state ... --extend-days 1` (replay all rows in file subject to truncate, then append 1 day).

If we overload `-d` instead: document that with `--load-state`, `-d` means “new days only” (breaking change risk for scripts).

### Load + save (merged timeline)

```bash
python guard_scheduler_sim.py -x 10 -y 3 --zones zones.yaml \
  --load-state ./in/cp30 --replay-days 30 --extend-days 30 \
  --save-state ./out/cp60
```

- Replay last 30 days from `cp30` (if file had 100 days, truncate to last 30).
- Simulate 30 new days → total **60** days of assignments in `./out/cp60`.
- `state.json` in `cp60` reflects `num_days=60`, CSV has 60 days of rows, `run_meta` updated (new seed policy for extension).

### Truncate

- **`--replay-days N`** — After parsing CSV, keep only assignments with `day >= day_max_from_file - N + 1` (inclusive) **reindexed** to `0..N-1` **or** keep absolute day indices and set `day_offset` for new days — **prefer reindex** so internal arrays are always `0..total_days-1` and simpler.

Clarify in implementation doc:

- **Reindex on truncate:** historical days become `0..N-1`; new days become `N..N+extend-1`. Single contiguous horizon in one save file.

---

## Implementation phases

### Phase 1 — Serialization helpers

- `state_json_write(path: Path, document: dict)` — `json.dump`, UTF-8, indent for human diff (optional `--compact-state` later).
- `state_json_read(path: Path) -> dict`  
- `assignments_to_jsonable(records) -> list[dict]` / `assignments_from_jsonable(list) -> list[AssignmentRecord]`

### Phase 2 — Config fingerprint and validation

Build a **`RunConfigFingerprint`** dict from:

- `num_soldiers`, `slots_per_block`, `block_hours` (effective), zone `schema_version`, serialized slot pattern signature (tuple of patterns + slot location indices), `min_consecutive_free_hours`, `max_consecutive_duty_blocks`, `min_free_shifts_after_duty`, `band_relative`, `balance_total_hours`, `total_hours_slack`.

Compare to current run **before** replay. Mismatches → `SystemExit` with a diff-style message.

**Zones file:** compare by **hash of bytes** if `zones.yaml` is bundled; else compare **resolved fingerprint** (not only path string) so moving the file is OK if content matches.

### Phase 3 — Replay engine

New function:

`replay_assignments_into_state(assignments, zone, num_soldiers, block_hours, ...) -> (soldiers, busy, busy_rot, daily_raw_*, optional mats)`

- Iterate rows in **day, block, slot** order (stable sort).
- For each row: call same logic paths as `run_simulation` uses when committing an assignment (`add_assignment`, `_busy_span_set`, mark `busy_rot` for rotating only, etc.).
- **Do not** call `pick_soldier` during replay.

**Rolling fairness denominator:** set each soldier’s `available_hours` to **`replay_day_count * 24`** (after truncate/reindex) for the hybrid scores during the **extension** phase, aligning with prior decision (30-day window ⇒ 30×24). Document.

**Boundary (optional):** if implementing `last_rotating_duty_before_window` for cooldown across truncate, add optional columns or a small `boundary.json` in bundle — can be **phase 2** if rare.

### Phase 4 — Extend simulation

- Refactor `run_simulation` (or add `run_simulation_extend`) so the main loop can start at `day_start > 0` with pre-filled `busy`, `busy_rot`, soldiers, and `days_total = replay_days + extend_days`.

- **DFS path:** today’s code may DFS the **entire** `days` horizon. For extend mode either:
  - **disable DFS** when `extend_days` / load path is active and use greedy path only, or
  - run DFS only over **`extend_days`** with **initial constraints** from replayed `busy`/`busy_rot` (more work; document limitation v1 = greedy-only on extend).

Recommend **v1: extend mode uses greedy rotating path only** (or fail if DFS would have been selected).

### Phase 5 — Wire argparse + tests

- Unit tests: save → load+truncate → replay numerators match direct run on truncated slice.
- Integration: load 30 + extend 1 → matrix full for 31 days; save → 60-day merge test.

---

## Reporting when load+extend

- HTML/heatmaps should cover **all** days in memory (`replay + extend`).
- `--json-output` should emit `day0..day{total-1}` for merged run.

---

## Resolved / open

1. **Bundle format** — **Single JSON file** (e.g. **`checkpoint.json`**) with embedded `assignments` array (chosen). Optional CSV export later for tooling only.
2. **RNG** — **Do not save seed or RNG state** between runs; each execution supplies its own `--seed` (or default nondeterminism) for newly generated days.
3. **CLI naming** — Prefer **`--extend-days`** with **`--load-state`**; **`-d`/`--days`** becomes optional when loading (use `extend_days` from `--extend-days` or fallback to `-d`). See [guard_sim_checkpoint_IMPLEMENTATION.md](guard_sim_checkpoint_IMPLEMENTATION.md).

---

## Implementation status

**Implemented** in [guard_scheduler_sim.py](guard_scheduler_sim.py): `--save-state`, `--load-state`, `--extend-days`, `--replay-days`; `-d` optional when loading; checkpoint JSON with `run_meta`, `zones_yaml`, embedded `assignments` (no RNG/seed). See module docstring examples.

Details: [guard_sim_checkpoint_IMPLEMENTATION.md](guard_sim_checkpoint_IMPLEMENTATION.md).

---

## Risks / limits

- **DFS global feasibility** does not extend cleanly; v1 extend = greedy path or explicit error.
- **Truncate + cooldown** edge case (no rotating duty in window) — optional boundary metadata later.
- **Large CSVs** — 60 days × many blocks × slots is fine; 1000+ days may want gzip (phase 2).

---

## Files to touch

| File | Change |
|------|--------|
| [guard_scheduler_sim.py](guard_scheduler_sim.py) | argparse, save/load, replay, refactor loop for extend + DFS policy |
| New tests under `tests/` or inline `if __name__` — prefer `pytest` if repo already uses it | golden save/load |

---

## Acceptance criteria

1. `--save-state PATH` after `-d N` produces **`PATH` as a single JSON file** with `assignments` length consistent with a full schedule for `N` days (and `run_meta`, `zones_yaml`; no RNG/seed).
2. `--load-state PATH --extend-days M` validates fingerprint, replays embedded assignments, produces **M** new days, reports OK.
3. Mismatch soldiers/slots/shift_hours / zone hash → non-zero exit with readable diff.
4. `--load-state PATH --replay-days 20 --extend-days M` when file has 100 days: only last 20 days replayed (reindexed 0..19), new days 20..19+M; with `--save-state OUT`, **OUT** has **`num_days = 20 + M`** and a single merged `assignments` list.
5. Combined load+save updates `saved_at` / `num_days` and embedded `zones_yaml` policy as documented.

---

## Implementation status (done)

Implemented in `guard_scheduler_sim.py`: `--save-state`, `--load-state`, `--extend-days`, `--replay-days`; `-d` optional when `--load-state` is set; single JSON checkpoint (`format_version`, `saved_at`, `run_meta`, `blocks_per_day`, `slots_per_block`, `num_days`, `zones_yaml`, `assignments`) — **no** persisted seed. Extension path uses **greedy rotating only** (no all-days DFS). See module docstring for CLI examples.
