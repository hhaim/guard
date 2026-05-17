# Checkpoint save/load — implementation guide

**Status:** Implemented in `guard_scheduler_sim.py` (see `--save-state` / `--load-state` / `--extend-days` / `--replay-days`).

**User decisions:**

- Do **not** persist RNG seed between runs (omit `rng` / `seed` from checkpoint JSON).
- Default artifact name **`checkpoint.json`** is fine (`--save-state PATH` writes that path).

---

## 1. Imports (`guard_scheduler_sim.py`)

Add:

```python
import hashlib
```

Add to dataclass import:

```python
from dataclasses import asdict, dataclass, field
```

---

## 2. Constants and JSON helpers (insert after `build_busy_tensor`, ~line 609)

- `CHECKPOINT_FORMAT_VERSION = 1`
- `_sha256_file(path: Path) -> str`
- `slot_pattern_signature(zone) -> dict` — `slot_patterns`, `slot_location_indices`, `loc_ids`, `time_ids` (tuples → lists).
- `build_checkpoint_run_meta(zone, zones_path, slots_eff, block_hours, args) -> dict` — all fields needed for validation (soldiers from `args.soldiers`, flags, `zones_sha256`, `zones_path` str, `schema_version`).
- `assignment_record_to_dict(a: AssignmentRecord) -> dict` — all fields; omit None `linear_busy_span_blocks` or use explicit null.
- `assignment_record_from_dict(d: dict) -> AssignmentRecord`
- `checkpoint_sort_key(a: AssignmentRecord) -> tuple` — `(a.day, phase, a.calendar_block, a.slot)` with `phase` 0=`full_day`, 1=`windowed`, 2=`rotating`.
- `truncate_reindex_assignments(records, replay_days: int) -> List[AssignmentRecord]` — `max_d = max(a.day)`, `cut = max_d - replay_days + 1`, drop `a.day < cut`, reassign `day = a.day - cut` (new dataclass instances).
- `validate_checkpoint_document(doc, zone, zones_path, slots_eff, block_hours, args) -> None` — compare `run_meta` to current fingerprint; on mismatch `raise SystemExit` with human-readable diff.
- `replay_checkpoint_assignments(...)` — sort by `checkpoint_sort_key`; for each record apply the same mutations as `run_simulation` when committing:
  - **rotating:** `soldier.add_assignment`, `busy[day,s,b]=True`, `busy_rot[...]=True`, `daily_raw_loc`/`daily_raw_time` += `raw_hours` at `loc_i`/`time_j`.
  - **full_day:** resolve `tid` from slot → `full_day_specs[tid]`; loop wall hours `sh0..sh1` with per-hour `add_assignment` + `_busy_span_set` + `daily_raw_*` like the sim (~lines 1489–1517).
  - **windowed:** resolve `wdef` by `window_name` or unique / block match; same loop as sim (~lines 1588–1616).
- `write_checkpoint_json(path, doc)` / `read_checkpoint_json(path) -> dict`
- `build_checkpoint_document(zone, zones_path, zones_yaml_text, run_meta, assignments) -> dict` — keys: `format_version`, `saved_at` (ISO UTC), `run_meta`, `blocks_per_day`, `slots_per_block`, `num_days`, `assignments`, `zones_yaml` (full text). **No** `rng` / `seed`.

---

## 3. `run_simulation_checkpoint_extend(...)` (insert before `compute_max_consecutive_free_hours`)

Signature mirrors `run_simulation` kwargs +:

- `prefix_assignments: List[AssignmentRecord]`
- `prefix_days: int`
- `extend_days: int`

Algorithm:

1. `total_days = prefix_days + extend_days`, `B = calendar_blocks_per_day(sh)`.
2. `assert_rest_feasible_counting` (same as cold run).
3. `soldiers = [make_soldier(i, float(prefix_days) * 24.0, nl, nt) for ...]` — rolling fairness denominator = replay window only.
4. Allocate `busy`, `busy_rot`, `daily_raw_*` shape `(total_days, ...)`.
5. `replay_checkpoint_assignments(...)` over `prefix_assignments` (already truncated/reindexed to `0..prefix_days-1`).
6. **Validate prefix:** `build_schedule_compare_matrix(prefix_assignments, prefix_days, ...)` (must be complete); `expected_assignment_count(zone, prefix_days, ...)` == `len(prefix_assignments)`.
7. **Extension — skip DFS:** For `day in range(prefix_days, total_days)` run the same three phases as `run_simulation`:
   - full_day slots (copy ~lines 1440–1518),
   - windowed (~1520–1617),
   - rotating **greedy only** (~1707–1803): never call `_dfs_rotating_only_mask` for checkpoint runs (document: checkpoint + extend uses greedy rotating only).
8. Build `Z`, `Z_day`, `Z_avg`, `max_free`, run `validate_schedule_rest`, `validate_max_consecutive_duty`, `count_shift_cooldown_violations` on full tensors.
9. Return same tuple as `run_simulation`.

Merge `assignments = sorted(prefix_assignments by key) + newly appended extension records` (prefix list is fixed; extension appends new `AssignmentRecord`s in loop — keep one list: start with `list(prefix_assignments)` then `extend_assignments` during loops, or `assignments = sorted(prefix) + new` at end).

---

## 4. Argparse (`main`)

```text
--save-state PATH
--load-state PATH
--extend-days N   # optional if -d provided when load (see below)
--replay-days N   # optional: keep last N days from file
```

Change `-d` / `--days` to `default=None`, `required=False`.

**Validation in `main`:**

- If not `--load-state` and `args.days is None`: `SystemExit("-d/--days is required")`.
- If `--load-state`: `extend_days = args.extend_days if args.extend_days is not None else args.days`; if `extend_days is None or extend_days < 1`: exit with message.
- If both `args.extend_days` and `args.days` set and differ when `--load-state`: exit or pick one rule (recommend: **prefer `--extend-days`** when present).
- If `--load-state` and `args.sim_trials > 1`: `SystemExit` (or document unsupported).
- If `--load-state` and `args.sweep_band_relative`: exit.

**Load branch:**

1. `doc = read_checkpoint_json(Path(args.load_state))`
2. `assignments = [assignment_record_from_dict(x) for x in doc["assignments"]]`
3. If `args.replay_days`: `assignments = truncate_reindex_assignments(assignments, args.replay_days)`
4. `prefix_days = max(a.day for a in assignments) + 1` (or from `doc["num_days"]` if you require consistency with `len` of days — safer recompute from max day + 1).
5. `validate_checkpoint_document(doc, zone, zones_path, slots_eff, block_hours_eff, args)`
6. `rng = random.Random(args.seed)` if seed else `random.Random()`
7. `pack = run_simulation_checkpoint_extend(..., prefix_assignments=assignments, prefix_days=prefix_days, extend_days=extend_days, ...)`
8. `sim_meta = {"fairness": fairness_metrics(...), "trial_seed": args.seed, "trial_index": 0}` (align with downstream code).
9. Set `args.days = prefix_days + extend_days` for downstream heatmaps / title / `expected_assignment_count` checks (mutate `args.days` or use local `total_days` variable everywhere after branch).

**Save branch** (after successful `pack`):

- If `args.save_state`: build `doc` from current `assignments`, `run_meta`, `zones_path.read_text()`, `num_days=args.days`, write JSON.

**Combined load+save:** run load branch then save branch with merged `assignments` and `total_days`.

---

## 5. Docstring / `--help`

Update module docstring with examples:

```bash
python guard_scheduler_sim.py -x 10 -y 3 -d 5 --zones zones.yaml --seed 1 --save-state checkpoint.json --no-html --no-png
python guard_scheduler_sim.py -x 10 -y 3 --zones zones.yaml --load-state checkpoint.json --extend-days 2 --replay-days 5 --no-html --no-png
```

---

## 6. Tests (optional)

- Round-trip: cold `d=2`, save, load `--replay-days 2 --extend-days 0` invalid; use `--extend-days 1` and assert matrix prefix matches first 2 days of original for same seed... extension changes RNG. Simpler test: **replay-only** `extend_days=0` not supported — require `extend>=1`.

- Truncate: synthetic 10-day doc, `--replay-days 3`, assert only last 3 days replayed (`max day == 2` after reindex).

---

## 7. Update `guard_sim_checkpoint_state_plan.md`

- Remove `rng` from required JSON schema.
- Note default filename `checkpoint.json`.
- Mark implementation: see this file; apply in Agent mode.
