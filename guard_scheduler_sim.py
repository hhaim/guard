#!/usr/bin/env python3
"""
Guard scheduler fairness simulation (**hybrid_rel** soldier pick: relative band + global in sort key).

- Zone **names and weights** load from YAML (3 locations + 3 time *categories*).
- **Calendar shifts per day** = `24 / shift_hours` (YAML `shift_hours` or ``--shift-hours``). Each block runs **-y**
  concurrent slot assignments → **6 × y** shifts per day (e.g. y=3 → 18).
- Each block’s **start hour** maps to one time category via YAML `from_hour` / `to_hour` (weights).
- Heatmaps: **locations** = each soldier’s raw share across posts (row sums to 100%). **Time bands** =
  each soldier’s share of their **own** guard hours in Night / Morning / Day: ``raw_time[j] / sum(raw_time)``
  (row sums to 100%). Fairness **score** uses weights; raw logs unchanged.
- **Raw time bands** in the schedule follow ``zones.yaml`` (block **start hour** → category).
  The HTML summary table shows **time as % of each soldier’s raw hours** (sums to 100% per row).
- HTML report: per-day **schedule tables**; **two** full-period heatmaps (locations vs time) and **two**
  mean-daily heatmaps; free-time chart; summary bars for **mean** max consecutive free with **min–max**
  whiskers; soldier table includes min/mean/max free per day.
- PNG outputs: ``-o`` is the **location** full-period heatmap; sibling files add ``_time``,
  ``_avg_daily_loc``, ``_avg_daily_time``, ``_mean_free_bars``, ``_max_free_bars``, and
  ``_soldier_timelines`` (green = off post, red = posted duty blocks only; YAML ``rest_after`` excluded).
- HTML: **Schedule by soldier** tables (every block: post or FREE), plus the timeline figure.
- **PDF:** use ``--pdf`` (writes ``<html-stem>.pdf``) or ``--pdf-output my.pdf``; requires **WeasyPrint**.
- **Soldier pick:** ``hybrid_rel`` only — sort by this slot’s location load, then **global weighted**
  load, then time bands; keep candidates within **``--band-relative``** of the best on location
  and time (multiplicative: ``best × (1+R)``). Default **R = 0.2**.
- **Band sweep:** ``--sweep-band-relative 0.05,0.10,0.15`` re-runs the sim per R and prints
  fairness metrics; exits without PNG/HTML. With ``--sim-trials N``, each R scores **N** seeds then
  **one** replay at the best seed (requires ``--seed`` when ``N``>1).
- **Multi-trial:** ``--sim-trials N`` scores **N** runs (seeds ``S … S+N-1``), keeps only the best
  seed, then **replays** that seed once for outputs (``N``>1 needs ``--seed``). The winning seed is
  enough to **reproduce** that schedule with ``--sim-trials 1`` and the same other flags.
- **Total hours:** among band-fair candidates, prefer soldiers with **fewer cumulative raw
  guard hours** (optional ``--no-total-hours-balance``, ``--total-hours-balance-slack``).
- **Consecutive duty:** by default a soldier works at most **2** calendar blocks in a row; the next block
  must be free (no three shifts back-to-back). Override with ``--max-consecutive-duty-blocks`` (``0`` = off).
- **Rest:** each soldier must have at least **8 h consecutive free** within each calendar day
  (configurable). A **counting pre-check** runs first; while building the schedule each soldier
  keeps a **fixed k-block rest arc** per day (phase rotates by day) so duty never eats that sleep
  window. Afterward we **verify**. If a block cannot be filled or rest is violated → **stop**.

Usage:
  python guard_scheduler_sim.py -x 10 -y 3 -d 30 --zones zones.yaml --save-state checkpoint.json
  python guard_scheduler_sim.py -x 10 -y 3 --zones zones.yaml --load-state checkpoint.json --extend-days 5
  python guard_scheduler_sim.py -x 10 -y 3 --zones zones.yaml --load-state big.json --replay-days 20 --extend-days 1 --save-state out.json

Requires: numpy, matplotlib, PyYAML  (pip install numpy matplotlib pyyaml).
Optional PDF: ``pip install weasyprint`` then ``--pdf`` or ``--pdf-output PATH``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import sys
import html as html_module
import io
import random
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from itertools import combinations
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

try:
    import yaml
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install PyYAML: pip install pyyaml") from e

_mpl_bundle: Optional[Tuple[Any, Any, Any]] = None


def _get_matplotlib() -> Tuple[Any, Any, Any]:
    """
    Lazy-import matplotlib with a non-interactive backend so importing this module
    (e.g. in unit tests) does not require a GUI framework.
    """
    global _mpl_bundle
    if _mpl_bundle is not None:
        return _mpl_bundle
    try:
        import matplotlib

        matplotlib.use(os.environ.get("MPLBACKEND", "Agg"), force=True)
        import matplotlib.pyplot as plt
        from matplotlib.colors import Normalize
        from matplotlib.patches import Patch
    except ImportError as e:  # pragma: no cover
        raise SystemExit("Install matplotlib: pip install matplotlib numpy") from e
    _mpl_bundle = (plt, Normalize, Patch)
    return _mpl_bundle


BLOCK_HOURS_DEFAULT = 3.0
ALLOWED_SHIFT_HOURS = frozenset({2.0, 3.0, 4.0})
BAND_RELATIVE_DEFAULT = 0.2
LEGACY_ROT_TYPE_ID = "rot_auto"
# Each soldier needs this many consecutive **off-duty** hours within every 24 h day.
MIN_CONSECUTIVE_FREE_HOURS_DEFAULT = 8.0
# At most this many calendar blocks on duty in a row (simulation time); next block must be free.
# Default 2 ⇒ no third consecutive duty block (≥ one free block between runs of three shifts).
MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT = 2
DEFAULT_PLAN_DAY_START = "05:00"
DEFAULT_PLAN_DAY_START_HOUR = 5


class RestConstraintError(RuntimeError):
    """Raised when the ≥N h consecutive free-time rule cannot be satisfied."""


def consecutive_free_blocks_needed(block_hours: float, min_free_hours: float) -> int:
    """Smallest number of consecutive free blocks (each block_hours long) whose sum ≥ min_free_hours."""
    if min_free_hours <= 0:
        return 0
    return int(np.ceil(min_free_hours / block_hours - 1e-12))


def consecutive_duty_blocks_before(
    busy: np.ndarray,
    day: int,
    block: int,
    soldier_idx: int,
    blocks_pd: int,
) -> int:
    """
    Count consecutive duty blocks immediately before ``(day, block)`` in linear simulation order
    (previous block same day, then wrap to prior days).
    """
    chain = 0
    d, b = day, block - 1
    if b < 0:
        d -= 1
        if d < 0:
            return 0
        b = blocks_pd - 1
    while True:
        if not busy[d, soldier_idx, b]:
            break
        chain += 1
        if b > 0:
            b -= 1
        else:
            d -= 1
            if d < 0:
                break
            b = blocks_pd - 1
    return chain


def validate_max_consecutive_duty(busy: np.ndarray, max_run: int) -> None:
    """Ensure no soldier has more than ``max_run`` consecutive duty blocks (linear time)."""
    if max_run <= 0:
        return
    days, n_s, B = busy.shape
    for s in range(n_s):
        run = 0
        for d in range(days):
            for b in range(B):
                if busy[d, s, b]:
                    run += 1
                    if run > max_run:
                        raise RestConstraintError(
                            f"Internal check: soldier S{s} has more than {max_run} consecutive "
                            f"duty blocks (day {d + 1}, block {b + 1})."
                        )
                else:
                    run = 0


def soldier_must_rest_this_block(
    soldier_idx: int,
    day_idx: int,
    block_idx: int,
    blocks_per_day: int,
    k_rest_blocks: int,
) -> bool:
    """
    True if this soldier is fixed off-duty for this calendar block.

    Each soldier is given ``k_rest_blocks`` consecutive blocks off per day, on the
    circular day boundary, with phase ``(soldier_idx + day_idx) % B``. They are never
    assigned during those blocks, so they always have ≥ ``k_rest_blocks`` contiguous
    free time (enough for ``min_consecutive_free_hours`` when ``k_rest_blocks`` matches).

    This fixes greedy overload: fairness-only picking can assign more than ``B - k``
    blocks to someone and fragment rest even when ``n`` is sufficient.
    """
    if k_rest_blocks <= 0:
        return False
    B = blocks_per_day
    rest_start = (soldier_idx + day_idx) % B
    for j in range(k_rest_blocks):
        if block_idx == (rest_start + j) % B:
            return True
    return False


def assert_rest_feasible_counting(
    num_soldiers: int,
    blocks_per_day: int,
    slots_per_block: int,
    block_hours: float,
    min_free_hours: float,
) -> None:
    """
    Necessary condition: total daily shifts can be covered while each soldier works
    at most (blocks_per_day - k) blocks, where k consecutive free blocks are needed for rest.
    """
    if min_free_hours <= 0:
        return
    if min_free_hours > 24.0 + 1e-9:
        raise RestConstraintError(
            "min consecutive free time cannot exceed 24 h within a single day."
        )

    B = blocks_per_day
    y = slots_per_block
    k = consecutive_free_blocks_needed(block_hours, min_free_hours)

    if y > num_soldiers:
        raise RestConstraintError(
            f"Not enough soldiers: need at least {y} to fill {y} concurrent slots per block "
            f"(you have {num_soldiers})."
        )

    if B < k:
        raise RestConstraintError(
            f"A day has only {B} blocks of {block_hours:g} h; need {k} consecutive free blocks "
            f"to reach {min_free_hours:g} h off — not enough time in the day."
        )

    shifts_per_day = B * y
    max_blocks_on_duty = B - k
    if max_blocks_on_duty <= 0:
        raise RestConstraintError(
            f"Not enough soldiers: with ≥{min_free_hours:g} h consecutive free, no one can work "
            f"any block, but {shifts_per_day} shifts must be filled each day."
        )

    min_soldiers = int(np.ceil(shifts_per_day / max_blocks_on_duty))
    if num_soldiers < min_soldiers:
        raise RestConstraintError(
            f"Not enough soldiers: need at least {min_soldiers} to cover {shifts_per_day} shifts/day "
            f"({B} blocks × {y} slots) while each soldier keeps ≥{min_free_hours:g} h consecutive free "
            f"(at most {max_blocks_on_duty} duty blocks per soldier per day in an optimal packing). "
            f"You have {num_soldiers} soldiers."
        )


LARGE_LINEAR_GAP = 10**9


@dataclass
class SimulationStats:
    """Counters for optional constraints (reporting)."""

    shift_cooldown_exclusions: int = 0
    """Rotating slots: soldier would pass rest/duty caps but was dropped for shift-cooldown."""
    shift_cooldown_pool_iterations: int = 0
    """Rotating slot fills where ``min_free_shifts_after_duty`` > 0 (cooldown filter applied)."""
    shift_cooldown_violations_post: int = 0
    """Post-build rotating cooldown violations on ``busy_rot`` (must stay 0 if builder is consistent)."""


def _next_calendar_block(
    day: int, block: int, blocks_per_day: int, days: int
) -> Optional[Tuple[int, int]]:
    """Next (day, block) in linear calendar order, or ``None`` after the last block."""
    lin = day * blocks_per_day + block + 1
    if lin >= days * blocks_per_day:
        return None
    return divmod(lin, blocks_per_day)


def _rotating_prefix_key(
    busy: np.ndarray,
    busy_rot: np.ndarray,
    day: int,
    block: int,
    blocks_per_day: int,
    days: int,
    k_rest: int,
) -> Callable[["Soldier"], Tuple[int, int]]:
    """Prefix sort for rotating picks: reserve morning-eligible soldiers across midnight.

    Returned tuple is prepended **before** hybrid fairness keys in ``pick_soldier`` so it
    dominates differing per-gate location scores.

    With ``min_free_shifts_after_duty``, evening duty blocks who are still eligible next
    morning are scarce; greedy fairness on the last block of a day can consume them and
    make the next day's first blocks infeasible.  Prefer soldiers who are already off the
    board for the *next* calendar block (mandatory rest arc or YAML ``busy``), then tighter
    rotating cooldown slack (smaller gap since last **rotating** duty in ``busy_rot``).
    """

    def tie(s: "Soldier") -> Tuple[int, int]:
        nxt = _next_calendar_block(day, block, blocks_per_day, days)
        if nxt is None:
            prefer_evening = 1
        else:
            d2, b2 = nxt
            unavail_next = soldier_must_rest_this_block(
                s.idx, d2, b2, blocks_per_day, k_rest
            ) or bool(busy[d2, s.idx, b2])
            # Sort ascending: 0 = cannot work next block → pick first for this block.
            prefer_evening = 0 if unavail_next else 1
        gap = gap_free_blocks_since_last_duty_before_assign(
            busy_rot, day, block, s.idx, blocks_per_day
        )
        return (prefer_evening, gap)

    return tie


# Backwards-compatible name (tests may reference).
_rotating_tie_break_key = _rotating_prefix_key


def gap_free_blocks_since_last_duty_on_tensor(
    duty: np.ndarray,
    day: int,
    block: int,
    soldier_idx: int,
    blocks_per_day: int,
) -> int:
    """Like ``gap_free_blocks_since_last_duty_before_assign`` but scans an arbitrary duty mask."""
    B = blocks_per_day
    cur = day * B + block
    prev = cur - 1
    while prev >= 0:
        pd, pb = divmod(prev, B)
        if duty[pd, soldier_idx, pb]:
            return cur - prev - 1
        prev -= 1
    return LARGE_LINEAR_GAP


def gap_free_blocks_since_last_duty_before_assign(
    busy: np.ndarray,
    day: int,
    block: int,
    soldier_idx: int,
    blocks_per_day: int,
) -> int:
    """
    Linear simulation order: count calendar blocks strictly between the previous duty
    block for this soldier and the block we are about to assign (``day``, ``block``).

    If there was no prior duty, returns ``LARGE_LINEAR_GAP`` (treated as “no cooldown yet”).
    """
    return gap_free_blocks_since_last_duty_on_tensor(
        busy, day, block, soldier_idx, blocks_per_day
    )


def count_shift_cooldown_violations(
    duty: np.ndarray,
    min_free_shifts_after_duty: int,
) -> int:
    """Count rotating (or generic) duty blocks with fewer than ``x`` free blocks since prior duty.

    Pass **rotating-only** duty (``busy_rot``) so full_day / windowed spans in ``busy`` do not
    inflate consecutive-duty counts. The rotating assignment pool uses the same mask for
    ``min_free_shifts_after_duty`` gap checks.
    """
    if min_free_shifts_after_duty <= 0:
        return 0
    days, n_s, B = duty.shape
    x = min_free_shifts_after_duty
    bad = 0
    for s in range(n_s):
        last = -1
        for d in range(days):
            for b in range(B):
                cur = d * B + b
                if duty[d, s, b]:
                    if last >= 0 and cur - last - 1 < x:
                        bad += 1
                    last = cur
    return bad


def validate_schedule_rest(
    max_free: np.ndarray,
    min_free_hours: float,
    *,
    assignments: Optional[Sequence[AssignmentRecord]] = None,
) -> None:
    """Ensure built schedule meets per-day max consecutive free for every soldier.

    Soldiers with a ``full_day``, ``full_day_team`` or ``windowed`` assignment that day are skipped: their
    duty is a fixed pattern outside the rotating rest-arc model, and the calendar may be
    fully committed (YAML-driven) without a separate 24 h ``min_free`` window.
    """
    if min_free_hours <= 0:
        return
    violations: List[Tuple[int, int, float]] = []
    for d in range(max_free.shape[0]):
        for s in range(max_free.shape[1]):
            if assignments is not None:
                skip = False
                for a in assignments:
                    if a.day != d or a.soldier_idx != s:
                        continue
                    k = getattr(a, "kind", "rotating") or "rotating"
                    if k in ("full_day", "full_day_team", "windowed"):
                        skip = True
                        break
                if skip:
                    continue
            if float(max_free[d, s]) + 1e-9 < min_free_hours:
                violations.append((d, s, float(max_free[d, s])))
    if not violations:
        return
    parts = [f"day {d + 1} S{s} max_free={v:.2f}h" for d, s, v in violations[:8]]
    extra = f" … (+{len(violations) - 8} more)" if len(violations) > 8 else ""
    raise RestConstraintError(
        f"Schedule does not give ≥{min_free_hours:g} h consecutive free to every soldier: {', '.join(parts)}"
        f"{extra}. Not enough soldiers for this greedy assignment (try more soldiers or another --seed)."
    )


@dataclass
class ZoneConfig:
    """Loaded from zones YAML (schema v2: zone_loc, time_zones, slots_types, per-location ``type``)."""

    loc_ids: Tuple[str, ...]
    loc_names: Tuple[str, ...]
    loc_weights: Tuple[float, ...]
    time_ids: Tuple[str, ...]
    time_names: Tuple[str, ...]
    time_weights: Tuple[float, ...]
    # Inclusive hour-of-day [0..23] for mapping block start hour → time category
    time_hour_from: Tuple[int, ...]
    time_hour_to: Tuple[int, ...]
    # ``slot_location_indices[s]`` = location index for concurrent slot ``s`` (0-based)
    slot_location_indices: Tuple[int, ...]
    schema_version: int = 2
    # Calendar grid step in hours (must tile 24 h; see ``calendar_blocks_per_day``).
    shift_hours: float = 8.0
    # Per-slot pattern (same length as slot_location_indices): rotating | full_day | windowed_slots
    slot_patterns: Tuple[str, ...] = ()
    slot_display_names: Tuple[str, ...] = ()
    # Parallel to zone_loc: slots_types id for each location row
    location_type_ids: Tuple[str, ...] = ()
    loc_full_names: Tuple[str, ...] = ()
    full_day_specs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    full_day_team_specs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    windowed_specs: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    windowed_rest_hours: Dict[str, float] = field(default_factory=dict)
    windowed_headcount: Dict[str, int] = field(default_factory=dict)
    disabled_weekdays: Dict[str, Tuple[int, ...]] = field(default_factory=dict)
    slot_soldiers_required: Tuple[int, ...] = ()

    @property
    def n_loc(self) -> int:
        return len(self.loc_ids)

    @property
    def n_time(self) -> int:
        return len(self.time_ids)

    def heatmap_column_labels(self) -> List[str]:
        return [f"{self.loc_names[i]}\n({self.loc_ids[i]})" for i in range(self.n_loc)] + [
            f"{self.time_names[j]}\n({self.time_ids[j]})" for j in range(self.n_time)
        ]


@dataclass
class AssignmentRecord:
    day: int  # 0-based
    calendar_block: int  # 0 .. (24/block_hours - 1)
    start_hour: int  # 0..23, block start (wall clock)
    slot: int  # concurrent slot index within block (0 .. y-1)
    soldier_idx: int
    loc_i: int
    time_j: int  # YAML time category for weight / fairness
    weight: float
    raw_hours: float
    kind: str = "rotating"
    rowspan: int = 1
    win_start_block: int = 0
    win_end_block: int = 0
    window_name: Optional[str] = None
    # When set (full_day / windowed from the simulator), ``build_busy_tensor`` marks this many
    # consecutive calendar blocks starting at ``day * B + calendar_block``, including post-duty
    # ``rest_after`` time. ``assignment_occupied_blocks`` still lists **duty** blocks only (HTML row).
    linear_busy_span_blocks: Optional[int] = None


def assignment_occupied_blocks(a: AssignmentRecord, blocks_pd: int) -> List[int]:
    """Calendar block indices this assignment occupies on its **duty** row (matrix / rowspan)."""
    k = getattr(a, "kind", "rotating") or "rotating"
    if k in ("full_day", "full_day_team", "windowed"):
        return list(range(int(a.win_start_block), int(a.win_end_block) + 1))
    return [int(a.calendar_block)]


def build_schedule_compare_matrix(
    assignments: Sequence[AssignmentRecord],
    days: int,
    blocks_pd: int,
    slots_per_block: int,
) -> List[List[List[int]]]:
    """
    Per-day matrix: ``matrix[day][block][slot]`` = soldier index (0-based).

    Rotating posts fill a single ``(day, block, slot)``. ``full_day`` / ``windowed`` posts
    repeat the same soldier index for every duty ``calendar_block`` in
    ``assignment_occupied_blocks`` (same semantics as the HTML schedule matrix).
    """
    mat: List[List[List[int]]] = [
        [[-1] * slots_per_block for _ in range(blocks_pd)] for _ in range(days)
    ]
    for a in assignments:
        k = getattr(a, "kind", "rotating") or "rotating"
        if k == "rotating":
            if mat[a.day][a.calendar_block][a.slot] not in (-1, a.soldier_idx):
                raise ValueError("schedule matrix conflict (rotating)")
            mat[a.day][a.calendar_block][a.slot] = int(a.soldier_idx)
        elif k in ("full_day", "full_day_team", "windowed"):
            for bb in assignment_occupied_blocks(a, blocks_pd):
                cur = mat[a.day][bb][a.slot]
                if cur not in (-1, a.soldier_idx):
                    raise ValueError("schedule matrix conflict (spanning duty)")
                mat[a.day][bb][a.slot] = int(a.soldier_idx)
        else:
            raise ValueError(f"unknown assignment kind {k!r}")
    return mat


def schedule_compare_json_document(
    zone: ZoneConfig,
    assignments: Sequence[AssignmentRecord],
    *,
    days: int,
    blocks_pd: int,
    slots_per_block: int,
    block_hours: float,
    num_soldiers: int,
    extra_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Canonical JSON-friendly dict for cross-checking schedules (e.g. Python vs Go).

    Top-level keys: ``format_version``, ``meta``, ``day0`` … ``day{n-1}``.
    Each ``day*`` holds ``{"matrix": [[soldier,...], ...]}`` with shape
    ``(blocks_per_day, slots_per_block)``.
    """
    matrix = build_schedule_compare_matrix(assignments, days, blocks_pd, slots_per_block)
    meta: Dict[str, Any] = {
        "days": int(days),
        "blocks_per_day": int(blocks_pd),
        "slots": int(slots_per_block),
        "shift_hours": float(block_hours),
        "soldiers": int(num_soldiers),
        "schema_version": int(zone.schema_version),
    }
    if extra_meta:
        meta.update(extra_meta)
    doc: Dict[str, Any] = {"format_version": 1, "meta": meta}
    for d in range(days):
        doc[f"day{d}"] = {"matrix": matrix[d]}
    return doc


def write_schedule_compare_json(path: str | Path, doc: Dict[str, Any]) -> None:
    """Write ``schedule_compare_json_document`` output with stable key ordering."""
    Path(path).write_text(json.dumps(doc, indent=2, sort_keys=True), encoding="utf-8")


def build_busy_tensor(
    assignments: Sequence[AssignmentRecord],
    days: int,
    num_soldiers: int,
    blocks_pd: int,
    *,
    include_yaml_rest: bool = True,
) -> np.ndarray:
    """``busy[day, soldier, block]`` = soldier unavailable in that calendar block.

    When ``include_yaml_rest`` is True (default), ``full_day`` / ``windowed`` assignments
    also mark post-duty ``rest_after`` blocks (same linear tiling as the simulator). When
    False, only **posted duty** blocks are set — use that for timeline figures so they match
    per-block HTML tables (which list assignments, not YAML rest gaps).
    """
    busy = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    max_l = days * blocks_pd
    for a in assignments:
        span = getattr(a, "linear_busy_span_blocks", None)
        if include_yaml_rest and span is not None and int(span) > 0:
            L0 = int(a.day) * blocks_pd + int(a.calendar_block)
            for k in range(int(span)):
                L = L0 + k
                if L >= max_l:
                    break
                d, b = divmod(L, blocks_pd)
                busy[d, a.soldier_idx, b] = True
        else:
            for b in assignment_occupied_blocks(a, blocks_pd):
                busy[a.day, a.soldier_idx, b] = True
    return busy


# --- Checkpoint save/load (see guard_sim_checkpoint_state_plan.md) ---

CHECKPOINT_FORMAT_VERSION = 2
CHECKPOINT_FORMAT_VERSION_LEGACY = 1


@dataclass
class SimWitnessCapture:
    """Filled during ``run_simulation`` when rotating fill reaches ``split_day``."""

    split_day: int
    rng_state: Optional[Tuple[Any, ...]] = None
    suffix_nonrot: List[AssignmentRecord] = field(default_factory=list)
    captured: bool = False


def rng_state_to_json(state: Tuple[Any, ...]) -> Dict[str, Any]:
    """Serialize ``random.Random.getstate()`` for checkpoint v2."""
    if len(state) < 2:
        raise ValueError("invalid RNG state tuple")
    version = int(state[0])
    inner = state[1]
    if not isinstance(inner, (list, tuple)):
        raise ValueError("RNG state[1] must be a sequence")
    out: Dict[str, Any] = {
        "version": version,
        "state": [int(x) for x in inner],
    }
    if len(state) > 2:
        out["gauss"] = state[2]
    return out


def rng_state_from_json(doc: Dict[str, Any]) -> Tuple[Any, ...]:
    """Restore state for ``random.Random.setstate()``."""
    version = int(doc["version"])
    inner = tuple(int(x) for x in doc["state"])
    if "gauss" in doc:
        return (version, inner, doc["gauss"])
    return (version, inner, None)


def suffix_nonrot_from_assignments(
    records: Sequence[AssignmentRecord], split_day: int
) -> List[AssignmentRecord]:
    return [
        replace(a)
        for a in records
        if int(a.day) >= int(split_day)
        and str(a.kind or "rotating") != "rotating"
    ]


def _maybe_capture_witness_rng(
    witness: Optional[SimWitnessCapture],
    day: int,
    rng: random.Random,
) -> None:
    """Capture RNG after rotating fill on day ``split_day - 1`` (before day ``split_day``)."""
    if witness is None or witness.captured:
        return
    if int(day) + 1 != int(witness.split_day):
        return
    witness.rng_state = rng.getstate()
    witness.captured = True


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def slot_pattern_signature(zone: ZoneConfig) -> Dict[str, Any]:
    return {
        "slot_patterns": list(zone.slot_patterns),
        "slot_location_indices": list(zone.slot_location_indices),
        "loc_ids": list(zone.loc_ids),
        "time_ids": list(zone.time_ids),
    }


def build_checkpoint_run_meta(
    zone: ZoneConfig,
    zones_path: Path,
    slots_eff: int,
    block_hours: float,
    args: Any,
) -> Dict[str, Any]:
    zone_bytes = zones_path.read_bytes()
    return {
        "soldiers": int(args.soldiers),
        "slots_per_block": int(slots_eff),
        "shift_hours": float(block_hours),
        "schema_version": int(zone.schema_version),
        "min_consecutive_free_hours": float(args.min_consecutive_free_hours),
        "max_consecutive_duty_blocks": int(args.max_consecutive_duty_blocks),
        "min_free_shifts_after_duty": int(args.min_free_shifts_after_duty),
        "band_relative": float(args.band_relative),
        "balance_total_hours": not bool(args.no_total_hours_balance),
        "total_hours_slack": float(args.total_hours_balance_slack),
        "zones_path": str(zones_path),
        "zones_sha256": _sha256_bytes(zone_bytes),
        "slot_pattern_signature": slot_pattern_signature(zone),
    }


def assignment_record_to_dict(a: AssignmentRecord) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "day": int(a.day),
        "calendar_block": int(a.calendar_block),
        "start_hour": int(a.start_hour),
        "slot": int(a.slot),
        "soldier_idx": int(a.soldier_idx),
        "loc_i": int(a.loc_i),
        "time_j": int(a.time_j),
        "weight": float(a.weight),
        "raw_hours": float(a.raw_hours),
        "kind": str(a.kind or "rotating"),
        "rowspan": int(a.rowspan),
        "win_start_block": int(a.win_start_block),
        "win_end_block": int(a.win_end_block),
    }
    if a.window_name is not None:
        d["window_name"] = str(a.window_name)
    if a.linear_busy_span_blocks is not None:
        d["linear_busy_span_blocks"] = int(a.linear_busy_span_blocks)
    return d


def assignment_record_from_dict(d: Dict[str, Any]) -> AssignmentRecord:
    lbs = d.get("linear_busy_span_blocks", None)
    return AssignmentRecord(
        day=int(d["day"]),
        calendar_block=int(d["calendar_block"]),
        start_hour=int(d["start_hour"]),
        slot=int(d["slot"]),
        soldier_idx=int(d["soldier_idx"]),
        loc_i=int(d["loc_i"]),
        time_j=int(d["time_j"]),
        weight=float(d["weight"]),
        raw_hours=float(d["raw_hours"]),
        kind=str(d.get("kind", "rotating")),
        rowspan=int(d.get("rowspan", 1)),
        win_start_block=int(d.get("win_start_block", 0)),
        win_end_block=int(d.get("win_end_block", 0)),
        window_name=(str(d["window_name"]) if d.get("window_name") is not None else None),
        linear_busy_span_blocks=(int(lbs) if lbs is not None else None),
    )


def checkpoint_replay_sort_key(a: AssignmentRecord) -> Tuple[int, int, int, int]:
    k = str(a.kind or "rotating")
    if k == "full_day":
        phase = 0
    elif k == "windowed":
        phase = 1
    else:
        phase = 2
    return (int(a.day), phase, int(a.calendar_block), int(a.slot))


def truncate_reindex_assignments(
    records: Sequence[AssignmentRecord], replay_days: int
) -> List[AssignmentRecord]:
    if replay_days <= 0:
        raise ValueError("replay_days must be positive")
    if not records:
        return []
    max_d = max(int(a.day) for a in records)
    span = max_d + 1
    if replay_days >= span:
        return [replace(a) for a in records]
    cut = max_d - replay_days + 1
    out: List[AssignmentRecord] = []
    for a in records:
        if int(a.day) < cut:
            continue
        out.append(replace(a, day=int(a.day) - cut))
    return out


def _meta_float_eq(a: Any, b: Any) -> bool:
    return abs(float(a) - float(b)) <= 1e-9


def validate_checkpoint_document(
    doc: Dict[str, Any],
    zone: ZoneConfig,
    zones_path: Path,
    slots_eff: int,
    block_hours: float,
    blocks_pd: int,
    args: Any,
) -> None:
    fv = int(doc.get("format_version", -1))
    if fv not in (CHECKPOINT_FORMAT_VERSION, CHECKPOINT_FORMAT_VERSION_LEGACY):
        raise SystemExit(
            f"Checkpoint format_version must be {CHECKPOINT_FORMAT_VERSION} or "
            f"{CHECKPOINT_FORMAT_VERSION_LEGACY}, got {doc.get('format_version')!r}"
        )
    cur = build_checkpoint_run_meta(zone, zones_path, slots_eff, block_hours, args)
    prev = doc.get("run_meta")
    if not isinstance(prev, dict):
        raise SystemExit("Checkpoint missing run_meta object")
    diffs: List[str] = []
    doc_b = doc.get("blocks_per_day")
    if doc_b is not None and int(doc_b) != int(blocks_pd):
        diffs.append(f"  blocks_per_day: checkpoint={doc_b!r} current={blocks_pd}")
    doc_y = doc.get("slots_per_block")
    if doc_y is not None and int(doc_y) != int(slots_eff):
        diffs.append(f"  slots_per_block: checkpoint={doc_y!r} current={slots_eff}")
    for key in sorted(set(cur.keys()) | set(prev.keys())):
        if key not in prev:
            diffs.append(f"  missing in checkpoint: {key}")
            continue
        if key not in cur:
            diffs.append(f"  extra in checkpoint: {key}")
            continue
        cv, pv = cur[key], prev[key]
        if key in ("band_relative", "shift_hours", "min_consecutive_free_hours", "total_hours_slack"):
            if not _meta_float_eq(cv, pv):
                diffs.append(f"  {key}: file={pv!r} current={cv!r}")
        elif cv != pv:
            diffs.append(f"  {key}: file={pv!r} current={cv!r}")
    if str(prev.get("zones_sha256", "")) != cur["zones_sha256"]:
        diffs.append(
            f"  zones_sha256: checkpoint={prev.get('zones_sha256')!r} "
            f"current_zones_file={cur['zones_sha256']!r}"
        )
    zyaml = doc.get("zones_yaml")
    if isinstance(zyaml, str) and zyaml and str(prev.get("zones_sha256", "")):
        if _sha256_bytes(zyaml.encode("utf-8")) != str(prev["zones_sha256"]):
            diffs.append("  zones_yaml embedded in checkpoint does not match checkpoint zones_sha256")
    if diffs:
        raise SystemExit("Checkpoint run_meta does not match current run:\n" + "\n".join(diffs))


def read_checkpoint_json(path: Path) -> Dict[str, Any]:
    p = Path(path)
    if not p.is_file():
        raise SystemExit(f"Checkpoint not found: {p}")
    doc = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise SystemExit("Checkpoint root must be a JSON object")
    return doc


def write_checkpoint_json(path: Path, doc: Dict[str, Any]) -> None:
    Path(path).write_text(json.dumps(doc, indent=2, sort_keys=True), encoding="utf-8")


def build_checkpoint_document(
    *,
    zone: ZoneConfig,
    zones_path: Path,
    zones_yaml_text: str,
    run_meta: Dict[str, Any],
    assignments: Sequence[AssignmentRecord],
    num_days: int,
    blocks_pd: int,
    slots_eff: int,
    seed: Optional[int] = None,
    rng_state: Optional[Tuple[Any, ...]] = None,
    rng_state_at: str = "after_prefix_sim_complete",
    suffix_nonrot: Optional[Sequence[AssignmentRecord]] = None,
    target_horizon: Optional[int] = None,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {
        "format_version": CHECKPOINT_FORMAT_VERSION,
        "saved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run_meta": run_meta,
        "blocks_per_day": int(blocks_pd),
        "slots_per_block": int(slots_eff),
        "num_days": int(num_days),
        "zones_yaml": zones_yaml_text,
        "assignments": [assignment_record_to_dict(a) for a in assignments],
    }
    if seed is not None:
        doc["seed"] = int(seed)
    if rng_state is not None:
        doc["rng_state"] = rng_state_to_json(rng_state)
        doc["rng_state_at"] = str(rng_state_at)
    if suffix_nonrot:
        doc["suffix_nonrot"] = [
            assignment_record_to_dict(a) for a in suffix_nonrot
        ]
    if target_horizon is not None:
        doc["target_horizon"] = int(target_horizon)
    return doc


def replay_checkpoint_assignments(
    records: Sequence[AssignmentRecord],
    *,
    soldiers: List[Soldier],
    busy: np.ndarray,
    busy_rot: np.ndarray,
    daily_raw_loc: np.ndarray,
    daily_raw_time: np.ndarray,
    zone: ZoneConfig,
    block_hours: float,
    total_days: int,
) -> None:
    """Replay saved assignments into busy tensors and soldier fairness counters (no picks)."""
    sh = float(block_hours)
    B = calendar_blocks_per_day(sh)
    days = int(total_days)
    plan_start = DEFAULT_PLAN_DAY_START_HOUR
    loc_w = zone.loc_weights
    time_w = zone.time_weights
    ordered = sorted(records, key=checkpoint_replay_sort_key)
    for a in ordered:
        k = str(a.kind or "rotating")
        s = soldiers[a.soldier_idx]
        day = int(a.day)
        if k == "rotating":
            b = int(a.calendar_block)
            loc_i, time_j = int(a.loc_i), int(a.time_j)
            weight = float(a.weight)
            rh = float(a.raw_hours)
            s.add_assignment(loc_i, time_j, weight, rh)
            busy[day, s.idx, b] = True
            busy_rot[day, s.idx, b] = True
            daily_raw_loc[day, s.idx, loc_i] += rh
            daily_raw_time[day, s.idx, time_j] += rh
        elif k == "full_day":
            loc_i = int(a.loc_i)
            sidx = int(a.slot)
            tid = zone.location_type_ids[loc_i]
            cfg = zone.full_day_specs[tid]
            sh0, sh1 = int(cfg["start_h"]), int(cfg["end_h"])
            rest_after = float(cfg["rest_after"])
            L0, span = _linear_busy_span_duty_hours_plus_rest(
                day,
                B,
                sh,
                sh0,
                sh1,
                half_open=False,
                rest_after_h=rest_after,
                plan_start_hour=plan_start,
            )
            lw = loc_w[loc_i]
            wm = float(cfg["weight_mult"])
            raw_active = float(sh1 - sh0 + 1)
            for h in range(sh0, sh1 + 1):
                tj = time_category_for_hour(h, zone)
                tw = time_w[tj]
                wpart = lw * tw * wm
                s.add_assignment(loc_i, tj, wpart, 1.0)
            _busy_span_set(busy, s.idx, L0, span, B, days)
            daily_raw_loc[day, s.idx, loc_i] += raw_active
            for h in range(sh0, sh1 + 1):
                tj = time_category_for_hour(h, zone)
                daily_raw_time[day, s.idx, tj] += 1.0
        elif k == "full_day_team":
            loc_i = int(a.loc_i)
            tid = zone.location_type_ids[loc_i]
            cfg = zone.full_day_team_specs[tid]
            sh0, sh1 = int(cfg["start_h"]), int(cfg["end_h"])
            rest_after = float(cfg["rest_after"])
            L0, span = _linear_busy_span_duty_hours_plus_rest(
                day,
                B,
                sh,
                sh0,
                sh1,
                half_open=False,
                rest_after_h=rest_after,
                plan_start_hour=plan_start,
            )
            lw = loc_w[loc_i]
            wm = float(cfg["weight_mult"])
            raw_active = float(sh1 - sh0 + 1)
            for h in range(sh0, sh1 + 1):
                tj = time_category_for_hour(h, zone)
                tw = time_w[tj]
                wpart = lw * tw * wm
                s.add_assignment(loc_i, tj, wpart, 1.0)
            _busy_span_set(busy, s.idx, L0, span, B, days)
            daily_raw_loc[day, s.idx, loc_i] += raw_active
            for h in range(sh0, sh1 + 1):
                tj = time_category_for_hour(h, zone)
                daily_raw_time[day, s.idx, tj] += 1.0
        elif k == "windowed":
            loc_i = int(a.loc_i)
            sidx = int(a.slot)
            tid = zone.location_type_ids[loc_i]
            wins = zone.windowed_specs[tid]
            rest_h = float(zone.windowed_rest_hours.get(tid, 6.0))
            lw = loc_w[loc_i]
            wdef: Optional[Dict[str, Any]] = None
            wname = (a.window_name or "").strip()
            if wname:
                for wd in wins:
                    if str(wd.get("name", "")).strip() == wname:
                        wdef = wd
                        break
            if wdef is None:
                for wd in wins:
                    b0c, b1c = _duty_blocks_half_open_wall_hours(
                        sh, int(wd["h0"]), int(wd["h1_excl"])
                    )
                    if b0c == int(a.win_start_block) and b1c == int(a.win_end_block):
                        wdef = wd
                        break
            if wdef is None and len(wins) == 1:
                wdef = wins[0]
            if wdef is None:
                raise ValueError(
                    f"checkpoint replay: cannot resolve windowed spec slot={sidx} day={day} name={a.window_name!r}"
                )
            h0, h1x = int(wdef["h0"]), int(wdef["h1_excl"])
            wm = float(wdef["weight_mult"])
            raw_active = float(max(0, h1x - h0))
            L0, span = _linear_busy_span_duty_hours_plus_rest(
                day, B, sh, h0, h1x, half_open=True, rest_after_h=rest_h
            )
            for h in range(h0, h1x):
                tj = time_category_for_hour(h, zone)
                tw = time_w[tj]
                wpart = lw * tw * wm
                s.add_assignment(loc_i, tj, wpart, 1.0)
            _busy_span_set(busy, s.idx, L0, span, B, days)
            daily_raw_loc[day, s.idx, loc_i] += raw_active
            for h in range(h0, h1x):
                tj = time_category_for_hour(h, zone)
                daily_raw_time[day, s.idx, tj] += 1.0
        else:
            raise ValueError(f"checkpoint replay: unknown kind {k!r}")


def expected_assignment_count(
    zone: ZoneConfig,
    days: int,
    blocks_pd: int,
    slots_per_block: int,
    anchor: Optional[datetime] = None,
    plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
) -> int:
    if len(zone.slot_patterns) != slots_per_block:
        raise ValueError("slots_per_block does not match loaded zone.slot_patterns length")
    total = 0
    for d in range(days):
        for sidx in range(slots_per_block):
            if _slot_disabled_for_day(zone, sidx, d, anchor, plan_start_hour):
                continue
            pat = zone.slot_patterns[sidx]
            n_req = _soldiers_required(zone, sidx)
            if pat == "rotating":
                total += n_req * blocks_pd
            elif pat == "full_day":
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                cfg = zone.full_day_specs[tid]
                total += max(1, int(cfg.get("headcount", 1)))
            elif pat == "windowed_slots":
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                total += max(1, int(zone.windowed_headcount.get(tid, 1)))
            elif pat == "full_day_team":
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                cfg = zone.full_day_team_specs[tid]
                total += int(cfg["headcount"])
    return int(total)


def validate_shift_hours(block_hours: float) -> float:
    """Return block_hours if it is one of the allowed calendar block sizes (2, 3, or 4)."""
    h = float(block_hours)
    if h not in ALLOWED_SHIFT_HOURS:
        allowed = ", ".join(str(int(x)) for x in sorted(ALLOWED_SHIFT_HOURS))
        raise ValueError(f"shift_hours must be {allowed} (got {block_hours!r})")
    return h


def calendar_blocks_per_day(block_hours: float) -> int:
    """Number of consecutive shifts that tile a 24 h day."""
    validate_shift_hours(block_hours)
    if block_hours <= 0:
        raise ValueError("block_hours must be positive")
    q = 24.0 / block_hours
    n = int(round(q))
    if abs(n * block_hours - 24.0) > 1e-5:
        raise ValueError(
            f"24 must divide evenly by block_hours (got block_hours={block_hours!r}, 24/h={q})"
        )
    return n


def time_category_for_hour(h: int, zone: ZoneConfig) -> int:
    h = int(h) % 24
    for j in range(zone.n_time):
        lo, hi = zone.time_hour_from[j], zone.time_hour_to[j]
        if lo <= h <= hi:
            return j
    raise ValueError(
        f"Hour {h} is not covered by any time_zones from_hour..to_hour; fix zones YAML"
    )


def time_band_clock_spans_hours(zone: ZoneConfig) -> np.ndarray:
    """
    Inclusive wall-clock span of each YAML time band in one 24 h day (integer hours).

    Used to normalize raw guard hours so wide bands (e.g. Day 12–23) are not
    confounded with narrow bands (e.g. Morning 6–11) when comparing exposure.
    """
    out = np.zeros(zone.n_time, dtype=np.float64)
    for j in range(zone.n_time):
        lo, hi = zone.time_hour_from[j], zone.time_hour_to[j]
        out[j] = float(hi - lo + 1)
        if out[j] <= 0:
            raise ValueError(f"time_zones[{j}] has invalid from_hour..to_hour span")
    return out


def heatmap_time_fraction_by_row(raw_time_per_soldier: np.ndarray) -> np.ndarray:
    """``raw_time[s,j] / sum_j raw_time[s,j]`` — each soldier’s time rows sum to 1."""
    row_sum = np.sum(raw_time_per_soldier, axis=1, keepdims=True)
    out = np.zeros_like(raw_time_per_soldier, dtype=np.float64)
    np.divide(
        raw_time_per_soldier,
        row_sum,
        out=out,
        where=row_sum > 1e-12,
    )
    return out


def heatmap_time_fraction_by_row_daily(daily_raw_time: np.ndarray) -> np.ndarray:
    """Per (day, soldier): raw hours in band / that day’s total guard hours for that soldier."""
    row_sum = np.sum(daily_raw_time, axis=2, keepdims=True)
    out = np.zeros_like(daily_raw_time, dtype=np.float64)
    np.divide(daily_raw_time, row_sum, out=out, where=row_sum > 1e-12)
    return out


def format_block_window(start_hour: int, block_hours: float) -> str:
    sh = int(start_hour) % 24
    bh = float(block_hours)
    if abs(bh - round(bh)) < 1e-9:
        eh = sh + int(round(bh))
        if eh <= 24:
            return f"{sh:02d}:00–{eh:02d}:00"
        return f"{sh:02d}:00–{(eh % 24):02d}:00 (+1d)"
    return f"{sh:02d}:00 (+{bh:g} h)"


def parse_plan_day_start(s: str) -> int:
    """Parse HH:MM (whole hours only; minutes must be 00). Default 05:00."""
    s = (s or "").strip()
    if not s:
        return DEFAULT_PLAN_DAY_START_HOUR
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError(f"plan_day_start: expected HH:MM, got {s!r}")
    h = int(parts[0].strip())
    m = int(parts[1].strip())
    if h < 0 or h > 23:
        raise ValueError(f"plan_day_start: hour must be 0–23, got {parts[0]!r}")
    if m != 0:
        raise ValueError(f"plan_day_start: minutes must be 00, got {parts[1]!r}")
    return h


def block_start_hour(plan_start: int, block: int, shift_hours: float) -> int:
    return (int(plan_start) + int(block * shift_hours)) % 24


def _soldier_avail(availability: Any, soldier_idx: int, day: int, check: Any) -> bool:
    """If availability checker is set, run check(); otherwise allow."""
    if availability is None:
        return True
    return bool(check())


def _soldier_avail_wall(
    availability: Any, soldier_idx: int, day: int, h0: int, h1: int
) -> bool:
    return _soldier_avail(
        availability,
        soldier_idx,
        day,
        lambda: availability.avail_duty_wall_hours(soldier_idx, day, h0, h1),
    )


def _soldier_avail_rotating(
    availability: Any,
    soldier_idx: int,
    day: int,
    block: int,
    plan_start: int,
    shift_hours: float,
) -> bool:
    return _soldier_avail(
        availability,
        soldier_idx,
        day,
        lambda: availability.avail_rotating_block(
            soldier_idx, day, block, plan_start, shift_hours
        ),
    )


_WEEKDAY_INDEX = {name.lower(): i for i, name in enumerate(
    ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
)}


def _parse_disabled_weekdays(raw: Any) -> Tuple[int, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("disabled_weekdays must be a list")
    seen: set[int] = set()
    out: List[int] = []
    for item in raw:
        key = str(item).strip().lower()
        if key not in _WEEKDAY_INDEX:
            raise ValueError(f"invalid weekday name {item!r} (use sunday..saturday)")
        i = _WEEKDAY_INDEX[key]
        if i not in seen:
            seen.add(i)
            out.append(i)
    return tuple(sorted(out))


def _weekday_for_anchor_plan_day(anchor: datetime, plan_day: int) -> int:
    return (anchor.weekday() + 1 + plan_day) % 7  # datetime: Mon=0; plan uses Sun=0


def _weekday_at_plan_day_start(
    anchor: datetime, plan_day: int, plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR
) -> int:
    """Weekday (Sun=0) when plan day ``plan_day`` begins at plan_start_hour UTC."""
    ps = int(plan_start_hour) % 24
    start = anchor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=plan_day)
    start = start.replace(hour=ps)
    return (start.weekday() + 1) % 7


def _slot_disabled_for_day(
    zone: ZoneConfig,
    sidx: int,
    day: int,
    anchor: Optional[datetime],
    plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
) -> bool:
    if anchor is None:
        return False
    loc_i = zone.slot_location_indices[sidx]
    tid = zone.location_type_ids[loc_i]
    wds = zone.disabled_weekdays.get(tid)
    if not wds:
        return False
    wd = _weekday_at_plan_day_start(anchor, day, plan_start_hour)
    return wd in wds


def _soldiers_required(zone: ZoneConfig, sidx: int) -> int:
    if sidx < len(zone.slot_soldiers_required):
        n = int(zone.slot_soldiers_required[sidx])
        return max(1, n)
    return 1


def _sorted_type_quotas(quotas: Dict[str, int], type_codes: Sequence[str]) -> List[Tuple[str, int]]:
    if not quotas:
        return []
    roster_count: Dict[str, int] = {}
    for tc in type_codes:
        roster_count[str(tc).strip()] = roster_count.get(str(tc).strip(), 0) + 1

    def sort_key(item: Tuple[str, int]) -> Tuple[int, int, str]:
        code, q = item
        return (-q, roster_count.get(code, 0), code)

    return sorted(quotas.items(), key=sort_key)


def _soldier_type_code(type_codes: Optional[Sequence[str]], idx: int) -> str:
    if not type_codes or idx < 0 or idx >= len(type_codes):
        return ""
    return str(type_codes[idx]).strip()


def _pick_soldiers_for_slot(
    n: int,
    pool_base,
    loc_i: int,
    time_mid: int,
    deltas_loc: np.ndarray,
    deltas_time: np.ndarray,
    deltas_g: np.ndarray,
    rng: random.Random,
    *,
    band_relative: float,
    balance_total_hours: bool,
    total_hours_slack: float,
    prefix_key=None,
) -> List[Soldier]:
    assigned: List[Soldier] = []
    for _ in range(n):
        pool = pool_base(assigned)
        if not pool:
            raise ValueError(f"need {n} soldiers, have {len(assigned)} available")
        chosen = pick_soldier(
            pool,
            loc_i,
            time_mid,
            deltas_loc,
            deltas_time,
            deltas_g,
            rng,
            band_relative=band_relative,
            balance_total_hours=balance_total_hours,
            total_hours_slack=total_hours_slack,
            prefix_key=prefix_key,
        )
        assigned.append(chosen)
    return assigned


def _fill_full_day_team_post(
    zone: ZoneConfig,
    day: int,
    sidx: int,
    loc_i: int,
    cfg: Dict[str, Any],
    soldiers: List[Soldier],
    type_codes: Optional[Sequence[str]],
    busy: np.ndarray,
    daily_raw_loc: np.ndarray,
    daily_raw_time: np.ndarray,
    deltas_loc: np.ndarray,
    deltas_time: np.ndarray,
    deltas_g: np.ndarray,
    B: int,
    sh: float,
    days: int,
    rng: random.Random,
    *,
    plan_start_hour: int,
    band_relative: float,
    balance_total_hours: bool,
    total_hours_slack: float,
    availability: Any,
    assignments: List[AssignmentRecord],
) -> None:
    sh0, sh1 = int(cfg["start_h"]), int(cfg["end_h"])
    rest_after = float(cfg["rest_after"])
    L0, span = _linear_busy_span_duty_hours_plus_rest(
        day,
        B,
        sh,
        sh0,
        sh1,
        half_open=False,
        rest_after_h=rest_after,
        plan_start_hour=plan_start_hour,
    )
    lw = zone.loc_weights[loc_i]
    wm = float(cfg["weight_mult"])
    raw_active = float(sh1 - sh0 + 1)
    b0, b1 = _duty_blocks_inclusive_wall_hours(sh, sh0, sh1)
    duty_w = b1 - b0 + 1
    time_mid = time_category_for_hour((sh0 + sh1) // 2, zone)
    headcount = int(cfg["headcount"])
    quotas: Dict[str, int] = dict(cfg.get("type_quotas") or {})

    assigned: List[Soldier] = []
    deltas_loc[:] = 0.0
    deltas_time[:] = 0.0
    deltas_g[:] = 0.0

    def pick_n(n: int, type_filter: str) -> None:
        nonlocal assigned
        for pick in range(n):
            pool = [
                s
                for s in soldiers
                if s not in assigned
                and (not type_filter or _soldier_type_code(type_codes, s.idx) == type_filter)
                and not _any_busy_span(busy, s.idx, L0, span, B, days)
                and _soldier_avail_wall(availability, s.idx, day, sh0, sh1 + 1)
            ]
            if not pool:
                if type_filter:
                    raise ValueError(
                        f"full_day_team: need {n} type {type_filter}, have {pick} available "
                        f"on day {day + 1} slot {sidx + 1}"
                    )
                raise ValueError(
                    f"full_day_team: cannot fill {n - pick} generic seats on day {day + 1} slot {sidx + 1}"
                )
            chosen = pick_soldier(
                pool,
                loc_i,
                time_mid,
                deltas_loc,
                deltas_time,
                deltas_g,
                rng,
                band_relative=band_relative,
                balance_total_hours=balance_total_hours,
                total_hours_slack=total_hours_slack,
            )
            assigned.append(chosen)

    for code, q in _sorted_type_quotas(quotas, type_codes or ()):
        pick_n(q, code)
    remaining = headcount - len(assigned)
    if remaining > 0:
        pick_n(remaining, "")

    for chosen in assigned:
        tot_w = 0.0
        for h in range(sh0, sh1 + 1):
            tj = time_category_for_hour(h, zone)
            tw = zone.time_weights[tj]
            wpart = lw * tw * wm
            tot_w += wpart
            chosen.add_assignment(loc_i, tj, wpart, 1.0)
        _busy_span_set(busy, chosen.idx, L0, span, B, days)
        daily_raw_loc[day, chosen.idx, loc_i] += raw_active
        for h in range(sh0, sh1 + 1):
            tj = time_category_for_hour(h, zone)
            daily_raw_time[day, chosen.idx, tj] += 1.0
        assignments.append(
            AssignmentRecord(
                day=day,
                calendar_block=b0,
                start_hour=int(b0 * sh),
                slot=sidx,
                soldier_idx=chosen.idx,
                loc_i=loc_i,
                time_j=time_mid,
                weight=tot_w,
                raw_hours=raw_active,
                kind="full_day_team",
                rowspan=duty_w,
                win_start_block=b0,
                win_end_block=b1,
                window_name=None,
                linear_busy_span_blocks=span,
            )
        )


def parse_slot_location_indices(
    data: Dict[str, Any],
    slots_per_block: int,
    loc_id_to_idx: Dict[str, int],
) -> Tuple[Tuple[int, ...], Tuple[str, ...], Tuple[int, ...]]:
    """
    YAML ``slots`` or ``slot_locations``: exactly ``slots_per_block`` entries in order
    (slot 1 .. slot y). Each entry is either ``location_id: <id>`` mapping or a plain string id.
    Returns (location indices, display name per slot — empty string if absent).
    """
    raw = data.get("slots") or data.get("slot_locations")
    if raw is None:
        raise ValueError(
            "YAML must define 'slots' (or 'slot_locations'): a list of exactly "
            f"{slots_per_block} entries for concurrent slots 1..{slots_per_block}, each "
            "with 'location_id' matching a location id, or a plain list of location id strings."
        )
    if not isinstance(raw, list):
        raise ValueError("'slots' / 'slot_locations' must be a list")
    if len(raw) != slots_per_block:
        raise ValueError(
            f"YAML slots list has length {len(raw)} but -y (concurrent slots) is {slots_per_block}. "
            f"Define exactly {slots_per_block} slot entries."
        )
    out: List[int] = []
    names: List[str] = []
    n_req: List[int] = []
    for i, entry in enumerate(raw):
        req = 1
        if isinstance(entry, str):
            lid = entry.strip()
            disp = ""
        elif isinstance(entry, dict):
            lid = str(entry.get("location_id", entry.get("id", ""))).strip()
            disp = str(entry.get("full_name", "")).strip()
            if not disp:
                disp = str(entry.get("name", "")).strip()
            if "soldiers_required" in entry:
                req = int(entry["soldiers_required"])
                if req < 1:
                    raise ValueError(f"slots[{i}]: soldiers_required must be >= 1")
        else:
            raise ValueError(f"slots[{i}] must be a string or a mapping with location_id")
        if not lid:
            raise ValueError(f"slots[{i}]: missing location_id")
        if lid not in loc_id_to_idx:
            raise ValueError(
                f"slots[{i}]: unknown location_id {lid!r} (known: {', '.join(sorted(loc_id_to_idx))})"
            )
        out.append(loc_id_to_idx[lid])
        names.append(disp)
        n_req.append(req)
    return tuple(out), tuple(names), tuple(n_req)


def _parse_hhmm_clock(s: str) -> int:
    """Hour 0..23, or 24 meaning end-of-day exclusive sentinel for window parsing."""
    p = str(s).strip().split(":")
    h = int(p[0])
    m = int(p[1]) if len(p) > 1 else 0
    if m != 0:
        raise ValueError(f"Time {s!r} must align to whole hours for shift grid")
    if h == 24:
        return 24
    if not (0 <= h <= 23):
        raise ValueError(f"Hour out of range in {s!r}")
    return h


def _window_half_open_hours(start_s: str, end_s: str) -> Tuple[int, int]:
    """Wall-clock window [h0, h1_excl) in integer hours; end 24:00 → h1_excl=24."""
    h0 = _parse_hhmm_clock(start_s)
    es = str(end_s).strip()
    if es in ("24:00", "24:0", "24"):
        return h0, 24
    h1 = _parse_hhmm_clock(end_s)
    if h1 == 24:
        return h0, 24
    return h0, h1


def _parse_inclusive_full_day_hours(start_s: str, end_s: str) -> Tuple[int, int]:
    """Full-day active hours inclusive (both ends on 0..23)."""
    lo = _parse_hhmm_clock(start_s)
    hi = _parse_hhmm_clock(end_s)
    if lo == 24 or hi == 24:
        raise ValueError(f"full_day start/end must be 0..23, got {start_s!r}..{end_s!r}")
    return lo, hi


def _migrate_legacy_zone_yaml_to_v2(
    data: Dict[str, Any],
    *,
    shift_hours_override: Optional[float],
    default_shift_hours: float,
) -> Dict[str, Any]:
    """Upgrade pre-v2 YAML (no ``slots_types`` / schema < 2) to schema v2 in memory."""
    out = dict(data)
    stypes = out.get("slots_types")
    if not (isinstance(stypes, list) and len(stypes) > 0):
        out["slots_types"] = [
            {"id": LEGACY_ROT_TYPE_ID, "name": "Rotating", "pattern": "rotating"}
        ]
    if out.get("zone_loc") is not None:
        loc_key = "zone_loc"
    elif out.get("locations") is not None:
        loc_key = "locations"
    else:
        loc_key = "location_zones"
    locs = out.get(loc_key)
    if isinstance(locs, list):
        new_locs: List[Any] = []
        for row in locs:
            if isinstance(row, dict):
                r = dict(row)
                if not str(r.get("type", "")).strip():
                    r["type"] = LEGACY_ROT_TYPE_ID
                new_locs.append(r)
            else:
                new_locs.append(row)
        out[loc_key] = new_locs
    if shift_hours_override is not None:
        sh = validate_shift_hours(float(shift_hours_override))
    else:
        sh = validate_shift_hours(float(out.get("shift_hours", default_shift_hours)))
    out["schema_version"] = 2
    out["shift_hours"] = sh
    return out


def _zone_loc_list(data: Dict[str, Any]) -> Any:
    return data.get("zone_loc") or data.get("locations") or data.get("location_zones")


def _load_zone_config(
    data: Dict[str, Any], slots_per_block: int, shift_hours_override: Optional[float]
) -> ZoneConfig:
    locs = _zone_loc_list(data)
    tzs = data.get("time_zones")
    stypes = data.get("slots_types")
    if locs is None or tzs is None:
        raise ValueError("YAML must contain 'zone_loc' (or legacy 'locations') and 'time_zones' lists")
    if not isinstance(locs, list) or not locs:
        raise ValueError("zone_loc must be a non-empty list")
    if not isinstance(tzs, list) or not tzs:
        raise ValueError("time_zones must be a non-empty list")
    if not isinstance(stypes, list) or not stypes:
        raise ValueError("zones YAML requires slots_types (non-empty list)")

    type_map: Dict[str, Dict[str, Any]] = {}
    full_day_specs: Dict[str, Dict[str, Any]] = {}
    full_day_team_specs: Dict[str, Dict[str, Any]] = {}
    disabled_wd: Dict[str, Tuple[int, ...]] = {}
    windowed_specs: Dict[str, List[Dict[str, Any]]] = {}
    windowed_rest: Dict[str, float] = {}
    windowed_headcount: Dict[str, int] = {}

    for row in stypes:
        if not isinstance(row, dict):
            raise ValueError("each slots_types entry must be a mapping")
        tid = str(row.get("id", "")).strip()
        pat = str(row.get("pattern", "")).strip()
        if not tid:
            raise ValueError("slots_types entry missing id")
        if pat not in ("rotating", "full_day", "full_day_team", "windowed_slots"):
            raise ValueError(f"slots_types[{tid!r}]: unknown pattern {pat!r}")
        type_map[tid] = {"pattern": pat, "raw": row}
        if row.get("disabled_weekdays") is not None:
            disabled_wd[tid] = tuple(_parse_disabled_weekdays(row["disabled_weekdays"]))
        if pat == "full_day":
            cfg = row.get("config") or {}
            if not isinstance(cfg, dict):
                raise ValueError(f"full_day {tid!r}: config must be a mapping")
            sh0, sh1 = _parse_inclusive_full_day_hours(str(cfg["start"]), str(cfg["end"]))
            hc = int(cfg.get("headcount", 1))
            if hc < 1:
                raise ValueError(f"full_day {tid!r}: headcount must be >= 1")
            full_day_specs[tid] = {
                "start_h": sh0,
                "end_h": sh1,
                "rest_after": float(cfg.get("rest_after_hours", cfg.get("rest_after", 6))),
                "weight_mult": float(
                    cfg.get("weight_multiplier", cfg.get("weight_mult", cfg.get("w_mult", 1.0)))
                ),
                "headcount": hc,
            }
        elif pat == "full_day_team":
            cfg = row.get("config") or {}
            if not isinstance(cfg, dict):
                raise ValueError(f"full_day_team {tid!r}: config must be a mapping")
            sh0, sh1 = _parse_inclusive_full_day_hours(str(cfg["start"]), str(cfg["end"]))
            rest_after = float(cfg.get("rest_after_hours", cfg.get("rest_after", 6)))
            if rest_after < 0:
                raise ValueError(f"full_day_team {tid!r}: rest_after_hours must be >= 0")
            hc = int(cfg.get("headcount", 0))
            if hc < 1:
                raise ValueError(f"full_day_team {tid!r}: headcount must be >= 1")
            quotas_raw = cfg.get("type_quotas") or {}
            if quotas_raw is not None and not isinstance(quotas_raw, dict):
                raise ValueError(f"full_day_team {tid!r}: type_quotas must be a mapping")
            quotas: Dict[str, int] = {}
            sum_q = 0
            for k, v in (quotas_raw or {}).items():
                code = str(k).strip()
                if not code or code == "*":
                    raise ValueError(f"full_day_team {tid!r}: invalid type_quotas key {k!r}")
                q = int(v)
                if q < 1:
                    raise ValueError(f"full_day_team {tid!r}: type_quotas[{code!r}] must be >= 1")
                quotas[code] = q
                sum_q += q
            if sum_q > hc:
                raise ValueError(
                    f"full_day_team {tid!r}: sum(type_quotas)={sum_q} exceeds headcount={hc}"
                )
            full_day_team_specs[tid] = {
                "start_h": sh0,
                "end_h": sh1,
                "rest_after": rest_after,
                "weight_mult": float(
                    cfg.get("weight_multiplier", cfg.get("weight_mult", cfg.get("w_mult", 1.0)))
                ),
                "headcount": hc,
                "type_quotas": quotas,
            }
        elif pat == "windowed_slots":
            cfg = row.get("config") or {}
            slots_w = cfg.get("slots") or []
            if not isinstance(slots_w, list) or not slots_w:
                raise ValueError(f"windowed_slots {tid!r}: config.slots must be a non-empty list")
            wl: List[Dict[str, Any]] = []
            for sw in slots_w:
                if not isinstance(sw, dict):
                    raise ValueError("windowed config.slots entries must be mappings")
                h0, h1x = _window_half_open_hours(str(sw["start"]), str(sw["end"]))
                wl.append(
                    {
                        "name": str(sw.get("name", "")).strip(),
                        "h0": h0,
                        "h1_excl": h1x,
                        "weight_mult": float(sw.get("weight_multiplier", sw.get("weight_mult", 1.0))),
                    }
                )
            hc = int(cfg.get("headcount", 1))
            if hc < 1:
                raise ValueError(f"windowed_slots {tid!r}: headcount must be >= 1")
            windowed_specs[tid] = wl
            windowed_headcount[tid] = hc
            windowed_rest[tid] = float(row.get("rest_after_hours", row.get("rest_after", 6.0)))
        # rotating: no extra specs

    def parse_zone_row_typed(row: Any, kind: str) -> Tuple[str, str, str, float, str]:
        if not isinstance(row, dict):
            raise ValueError(f"Each {kind} entry must be a mapping")
        zid = str(row.get("id", "")).strip()
        short = str(row.get("name", zid)).strip()
        full = str(row.get("full_name", short)).strip() or short
        w = float(row["weight"])
        if not zid:
            raise ValueError(f"{kind} entry missing id")
        lt = str(row.get("type", "")).strip()
        if not lt:
            raise ValueError(f"zone_loc {zid!r}: missing 'type' (slots_types id)")
        if lt not in type_map:
            raise ValueError(f"zone_loc {zid!r}: unknown type {lt!r}")
        return zid, short, full, w, lt

    lp = [parse_zone_row_typed(locs[i], "zone_loc") for i in range(len(locs))]
    loc_id_to_idx = {lp[i][0]: i for i in range(len(lp))}
    slot_loc, slot_names, slot_n_req = parse_slot_location_indices(data, slots_per_block, loc_id_to_idx)

    slot_patterns: List[str] = []
    for sidx in range(slots_per_block):
        li = slot_loc[sidx]
        ltid = lp[li][4]
        slot_patterns.append(str(type_map[ltid]["pattern"]))

    sh_yaml = float(data.get("shift_hours", BLOCK_HOURS_DEFAULT))
    if shift_hours_override is not None:
        sh_eff = validate_shift_hours(float(shift_hours_override))
    else:
        sh_eff = validate_shift_hours(sh_yaml)
    calendar_blocks_per_day(sh_eff)

    default_from = (0, 6, 12)
    default_to = (5, 11, 23)
    t_from: List[int] = []
    t_to: List[int] = []
    tp_ids: List[str] = []
    tp_names: List[str] = []
    tp_w: List[float] = []
    for i, row in enumerate(tzs):
        if not isinstance(row, dict):
            raise ValueError("Each time_zone entry must be a mapping")
        zid = str(row.get("id", "")).strip()
        name = str(row.get("name", zid)).strip()
        w = float(row["weight"])
        if not zid:
            raise ValueError("time_zone entry missing id")
        di = min(i, len(default_from) - 1)
        t_from.append(int(row.get("from_hour", default_from[di])))
        t_to.append(int(row.get("to_hour", default_to[di])))
        tp_ids.append(zid)
        tp_names.append(name)
        tp_w.append(w)

    return ZoneConfig(
        loc_ids=tuple(x[0] for x in lp),
        loc_names=tuple(x[1] for x in lp),
        loc_full_names=tuple(x[2] for x in lp),
        loc_weights=tuple(x[3] for x in lp),
        time_ids=tuple(tp_ids),
        time_names=tuple(tp_names),
        time_weights=tuple(tp_w),
        time_hour_from=tuple(t_from),
        time_hour_to=tuple(t_to),
        slot_location_indices=slot_loc,
        schema_version=int(data.get("schema_version", 2)),
        shift_hours=sh_eff,
        slot_patterns=tuple(slot_patterns),
        slot_display_names=slot_names,
        location_type_ids=tuple(x[4] for x in lp),
        full_day_specs=full_day_specs,
        full_day_team_specs=full_day_team_specs,
        windowed_specs=windowed_specs,
        windowed_rest_hours=windowed_rest,
        windowed_headcount=windowed_headcount,
        disabled_weekdays=disabled_wd,
        slot_soldiers_required=slot_n_req,
    )


def load_zone_config(
    path: Path,
    slots_per_block: int,
    *,
    shift_hours_override: Optional[float] = None,
    default_shift_hours: float = BLOCK_HOURS_DEFAULT,
) -> ZoneConfig:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("zones YAML must be a mapping at top level")
    if int(data.get("schema_version", 1)) < 2 or not data.get("slots_types"):
        data = _migrate_legacy_zone_yaml_to_v2(
            data,
            shift_hours_override=shift_hours_override,
            default_shift_hours=default_shift_hours,
        )
    return _load_zone_config(data, slots_per_block, shift_hours_override)


def resolve_zones_path(arg: str) -> Path:
    p = Path(arg)
    if p.is_file():
        return p.resolve()
    script_dir = Path(__file__).resolve().parent
    cand = script_dir / arg
    if cand.is_file():
        return cand
    return p.resolve()


def yaml_slots_list_length(zones_data: Dict[str, Any]) -> Optional[int]:
    """Return ``len(slots)`` (or ``slot_locations``) from zones YAML, or ``None`` if absent."""
    raw = zones_data.get("slots") or zones_data.get("slot_locations")
    if isinstance(raw, list):
        return len(raw)
    return None


def resolve_slots_per_block_for_run(
    *,
    slots_arg: Optional[int],
    zones_data: Dict[str, Any],
    zones_path: Path,
) -> int:
    """
    ``-y`` / ``--slots`` must equal the number of ``slots`` rows in the zones file when that list exists.

    If ``slots_arg`` is ``None``, use the YAML list length (the list must be present).
    """
    yaml_n = yaml_slots_list_length(zones_data)
    if slots_arg is None:
        if yaml_n is None:
            raise SystemExit(
                f"{zones_path.name}: no 'slots' or 'slot_locations' list; pass -y/--slots explicitly."
            )
        return yaml_n
    if yaml_n is not None and slots_arg != yaml_n:
        raise SystemExit(
            f"{zones_path.name} defines {yaml_n} concurrent slots (length of top-level 'slots'); "
            f"you passed -y {slots_arg}. Use -y {yaml_n}, or omit -y/--slots to use the file's count."
        )
    return slots_arg


def roster_keys(num_soldiers: int) -> List[str]:
    return [f"s{i}" for i in range(int(num_soldiers))]


def type_codes_for_roster(keys: Sequence[str], id_to_type: Dict[str, str]) -> List[str]:
    return [str(id_to_type.get(k, "")).strip() for k in keys]


def load_roster_type_codes_yaml(path: Path, keys: Sequence[str]) -> List[str]:
    """
    Read ``type_code`` by soldier id from roster YAML and return values in ``keys`` order.

    Supports both UI export shape (``soldiers: [ ... ]``) and legacy nested
    shape (``soldiers: { soldiers: [ ... ] }``).
    """
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("roster YAML must be a mapping at top level")
    raw_soldiers = data.get("soldiers")
    rows: Optional[List[Any]] = None
    if isinstance(raw_soldiers, list):
        rows = raw_soldiers
    elif isinstance(raw_soldiers, dict):
        nested = raw_soldiers.get("soldiers")
        if isinstance(nested, list):
            rows = nested
    if rows is None:
        raise ValueError("roster YAML must include soldiers list")
    id_to_type: Dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id", "")).strip()
        if not sid:
            sid = str(row.get("key", "")).strip()
        tc = str(row.get("type_code", "")).strip()
        if sid and tc and tc != "<nil>":
            id_to_type[sid] = tc
    return type_codes_for_roster(keys, id_to_type)


@dataclass
class Soldier:
    idx: int
    available_hours: float
    w_loc: np.ndarray
    w_time: np.ndarray
    raw_loc: np.ndarray
    raw_time: np.ndarray
    w_global: float = 0.0

    def loc_scores(self, loc_w: Sequence[float], time_w: Sequence[float]) -> np.ndarray:
        den = max(self.available_hours, 1e-9)
        return self.w_loc / den

    def time_scores(self, loc_w: Sequence[float], time_w: Sequence[float]) -> np.ndarray:
        den = max(self.available_hours, 1e-9)
        return self.w_time / den

    def effective_loc_scores(self, dloc_vec: np.ndarray) -> np.ndarray:
        den = max(self.available_hours, 1e-9)
        return (self.w_loc + dloc_vec) / den

    def effective_time_scores(self, dtime_vec: np.ndarray) -> np.ndarray:
        den = max(self.available_hours, 1e-9)
        return (self.w_time + dtime_vec) / den

    def effective_global(self, dg: float) -> float:
        den = max(self.available_hours, 1e-9)
        return (self.w_global + dg) / den

    def add_assignment(
        self, loc_i: int, time_j: int, weight: float, raw_shift_hours: float
    ) -> None:
        self.w_global += weight
        self.w_loc[loc_i] += weight
        self.w_time[time_j] += weight
        self.raw_loc[loc_i] += raw_shift_hours
        self.raw_time[time_j] += raw_shift_hours

    def total_raw_guard_hours(self) -> float:
        return float(np.sum(self.raw_loc))


def make_soldier(idx: int, hours: float, n_loc: int, n_time: int) -> Soldier:
    return Soldier(
        idx=idx,
        available_hours=hours,
        w_loc=np.zeros(n_loc, dtype=np.float64),
        w_time=np.zeros(n_time, dtype=np.float64),
        raw_loc=np.zeros(n_loc, dtype=np.float64),
        raw_time=np.zeros(n_time, dtype=np.float64),
    )


def hybrid_sort_key(
    s: Soldier,
    loc_i: int,
    time_j: int,
    deltas_loc: np.ndarray,
    deltas_time: np.ndarray,
    dg: float,
) -> Tuple[float, float, float, float, float, int]:
    """
    hybrid_rel ordering: slot location, global weighted load, this block's time category,
    mean time score, raw hours, idx.
    """
    dloc = deltas_loc[s.idx]
    dtime = deltas_time[s.idx]
    eloc = s.effective_loc_scores(dloc)
    etime = s.effective_time_scores(dtime)
    eg = s.effective_global(dg)
    return (
        eloc[loc_i],
        eg,
        etime[time_j],
        float(np.mean(etime)),
        s.total_raw_guard_hours(),
        s.idx,
    )


def _eff_loc_time(
    s: Soldier,
    loc_i: int,
    time_j: int,
    deltas_loc: np.ndarray,
    deltas_time: np.ndarray,
) -> Tuple[float, float]:
    den = max(s.available_hours, 1e-9)
    loc = (s.w_loc[loc_i] + deltas_loc[s.idx, loc_i]) / den
    tim = (s.w_time[time_j] + deltas_time[s.idx, time_j]) / den
    return loc, tim


def _apply_total_hours_balance(
    pool: List[Soldier],
    rng: random.Random,
    *,
    balance_total_hours: bool,
    total_hours_slack: float,
) -> Soldier:
    if not balance_total_hours:
        return rng.choice(pool)
    min_raw = min(s.total_raw_guard_hours() for s in pool)
    cap = min_raw + max(total_hours_slack, 0.0)
    pool3 = [s for s in pool if s.total_raw_guard_hours() <= cap + 1e-9]
    if not pool3:
        pool3 = pool
    return rng.choice(pool3)


def _band_upper_relative_only(best: float, band_relative: float) -> float:
    return best * (1.0 + band_relative)


def pick_soldier(
    candidates: List[Soldier],
    loc_i: int,
    time_j: int,
    deltas_loc: np.ndarray,
    deltas_time: np.ndarray,
    deltas_g: np.ndarray,
    rng: random.Random,
    *,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    prefix_key: Optional[Callable[[Soldier], Tuple[Any, ...]]] = None,
    tie_break_key: Optional[Callable[[Soldier], Tuple[Any, ...]]] = None,
) -> Soldier:
    """hybrid_rel: relative bands on location and time scores; see module docstring."""
    if not candidates:
        raise ValueError("no candidates")

    def eff_loc(s: Soldier) -> float:
        return _eff_loc_time(s, loc_i, time_j, deltas_loc, deltas_time)[0]

    def eff_time(s: Soldier) -> float:
        return _eff_loc_time(s, loc_i, time_j, deltas_loc, deltas_time)[1]

    def sort_key(s: Soldier) -> Tuple[Any, ...]:
        h = hybrid_sort_key(
            s, loc_i, time_j, deltas_loc, deltas_time, float(deltas_g[s.idx])
        )
        if tie_break_key is None:
            mid: Tuple[Any, ...] = h
        else:
            mid = h[:-1] + tuple(tie_break_key(s)) + (h[-1],)
        if prefix_key is None:
            return mid
        return tuple(prefix_key(s)) + mid

    ranked = sorted(candidates, key=sort_key)

    best_loc = eff_loc(ranked[0])
    upper_loc = _band_upper_relative_only(best_loc, band_relative)
    pool1 = [s for s in ranked if eff_loc(s) <= upper_loc + 1e-15]

    best_time = min(eff_time(s) for s in pool1)
    upper_time = _band_upper_relative_only(best_time, band_relative)
    pool2 = [s for s in pool1 if eff_time(s) <= upper_time + 1e-15]

    return _apply_total_hours_balance(
        pool2, rng, balance_total_hours=balance_total_hours, total_hours_slack=total_hours_slack
    )


def _rest_blocks_aligned(rest_after_h: float, sh: float) -> int:
    if rest_after_h <= 0:
        return 0
    rest_al = float(math.ceil(rest_after_h / sh) * sh)
    return int(round(rest_al / sh))


def _duty_blocks_inclusive_wall_hours(sh: float, h0: int, h1_incl: int) -> Tuple[int, int]:
    """Calendar block indices (0 .. B-1 per day) covering inclusive wall hours ``[h0, h1_incl]``."""
    sh_i = int(sh)
    b0 = int(h0) // sh_i
    b1 = int(h1_incl) // sh_i
    return b0, b1


def _duty_blocks_half_open_wall_hours(sh: float, h0: int, h1_excl: int) -> Tuple[int, int]:
    """Block indices covering duty window ``[h0, h1_excl)`` in wall-clock hours."""
    if h1_excl <= int(h0):
        sh_i = int(sh)
        b0 = int(h0) // sh_i
        return b0, b0
    sh_i = int(sh)
    b0 = int(h0) // sh_i
    b1 = (int(h1_excl) - 1) // sh_i
    return b0, b1


def _linear_busy_span_duty_hours_plus_rest(
    day: int,
    B: int,
    sh: float,
    h_duty0: int,
    h_duty1_incl_or_excl: int,
    *,
    half_open: bool,
    rest_after_h: float,
    plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
) -> Tuple[int, int]:
    """Linear (day,block) index of first busy block and span length.

    Simpler policy: extend duty end by ``rest_after_h`` in wall-clock hours first, then
    map the resulting half-open window to calendar blocks once. This avoids over-padding
    from separately aligning duty and rest.
    """
    _ = half_open  # unified end+rest mapping.
    end_excl = int(math.floor(float(h_duty1_incl_or_excl) + float(rest_after_h) + 1e-9))
    if end_excl <= int(h_duty0):
        end_excl = int(h_duty0) + 1
    sh_i = int(sh)
    # Map wall-clock hours onto plan-day block grid (block 0 starts at plan_start_hour).
    start_rel = (int(h_duty0) - int(plan_start_hour)) % 24
    dur_h = int(end_excl) - int(h_duty0)
    if dur_h <= 0:
        dur_h = 1
    end_rel = start_rel + dur_h
    b0 = start_rel // sh_i
    b1 = (end_rel - 1) // sh_i
    span = b1 - b0 + 1
    L0 = day * B + b0
    return L0, span


def _busy_span_set(
    busy: np.ndarray, soldier: int, L0: int, span_blocks: int, B: int, days: int
) -> None:
    max_l = days * B
    for k in range(span_blocks):
        L = L0 + k
        if L >= max_l:
            break
        d, b = divmod(L, B)
        busy[d, soldier, b] = True


def _any_busy_span(
    busy: np.ndarray, soldier: int, L0: int, span_blocks: int, B: int, days: int
) -> bool:
    max_l = days * B
    for k in range(span_blocks):
        L = L0 + k
        if L >= max_l:
            break
        d, b = divmod(L, B)
        if busy[d, soldier, b]:
            return True
    return False


def _soldier_day_blocks_clear(
    soldier_idx: int,
    day: int,
    B: int,
    busy: np.ndarray,
    k_rest: int,
    blocks_pd: int,
) -> bool:
    for b in range(B):
        if soldier_must_rest_this_block(soldier_idx, day, b, blocks_pd, k_rest):
            return False
        if busy[day, soldier_idx, b]:
            return False
    return True


# Backtracking limits for all-rotating + shift-cooldown.
_ROTATING_COOLDOWN_DFS_MAX_NODES = 12_000_000
_ROTATING_COOLDOWN_DFS_MAX_COMBINATIONS = 8000


def _rotating_slot_indices(zone: ZoneConfig) -> List[int]:
    return [i for i, p in enumerate(zone.slot_patterns) if p == "rotating"]


def _rotating_duty_blocks_in_draft(
    draft_rot: np.ndarray, soldier_idx: int, *, day: Optional[int] = None
) -> int:
    """Count rotating duty blocks already set in ``draft_rot`` (optionally one plan day)."""
    if day is None:
        return int(np.sum(draft_rot[:, soldier_idx, :]))
    return int(np.sum(draft_rot[day, soldier_idx, :]))


def _rotating_combination_sort_key(
    draft_rot: np.ndarray, day: int, comb: Sequence[Soldier]
) -> Tuple[int, int, int]:
    """
    Order DFS combinations for load spread: lower max/sum duty first; when tied,
  prefer higher roster indices so extra soldiers (e.g. s12+) are not left idle.
    """
    loads = [_rotating_duty_blocks_in_draft(draft_rot, s.idx) for s in comb]
    return (max(loads), sum(loads), -sum(s.idx for s in comb))


def _iter_rotating_combinations_fair(
    cands: Sequence[Soldier], n_rot: int, draft_rot: np.ndarray, day: int
) -> Iterable[Tuple[Soldier, ...]]:
    combs = list(combinations(cands, n_rot))
    combs.sort(key=lambda c: _rotating_combination_sort_key(draft_rot, day, c))
    return combs


def _rotating_eligible_for_mask(
    soldiers: Sequence[Soldier],
    draft_rot: np.ndarray,
    busy: np.ndarray,
    day: int,
    b: int,
    blocks_pd: int,
    k_rest: int,
    max_consecutive_duty_blocks: int,
    x_cool: int,
    availability: Any = None,
    plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    shift_hours: float = 4.0,
) -> List[Soldier]:
    out: List[Soldier] = []
    for s in soldiers:
        if soldier_must_rest_this_block(s.idx, day, b, blocks_pd, k_rest):
            continue
        if busy[day, s.idx, b] or draft_rot[day, s.idx, b]:
            continue
        if (
            max_consecutive_duty_blocks > 0
            and consecutive_duty_blocks_before(draft_rot, day, b, s.idx, blocks_pd)
            >= max_consecutive_duty_blocks
        ):
            continue
        if x_cool > 0:
            gap = gap_free_blocks_since_last_duty_before_assign(
                draft_rot, day, b, s.idx, blocks_pd
            )
            if gap < x_cool and gap < LARGE_LINEAR_GAP:
                continue
        if not _soldier_avail_rotating(
            availability, s.idx, day, b, plan_start_hour, shift_hours
        ):
            continue
        out.append(s)
    return out


def _dfs_rotating_only_mask(
    draft_rot: np.ndarray,
    busy: np.ndarray,
    soldiers: Sequence[Soldier],
    *,
    L: int,
    days: int,
    blocks_pd: int,
    n_rot: int,
    k_rest: int,
    max_consecutive_duty_blocks: int,
    x_cool: int,
    nodes: List[int],
    availability: Any = None,
    plan_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    shift_hours: float = 4.0,
) -> bool:
    """Fill ``draft_rot`` with exactly ``n_rot`` soldiers on duty per (day, block)."""
    if L >= days * blocks_pd:
        return True
    day, b = divmod(L, blocks_pd)
    cands = _rotating_eligible_for_mask(
        soldiers,
        draft_rot,
        busy,
        day,
        b,
        blocks_pd,
        k_rest,
        max_consecutive_duty_blocks,
        x_cool,
        availability,
        plan_start_hour,
        shift_hours,
    )
    if len(cands) < n_rot:
        return False
    nodes[0] += 1
    if nodes[0] > _ROTATING_COOLDOWN_DFS_MAX_NODES:
        return False
    for comb in _iter_rotating_combinations_fair(cands, n_rot, draft_rot, day):
        for s in comb:
            draft_rot[day, s.idx, b] = True
        bad = False
        if max_consecutive_duty_blocks > 0:
            for s in comb:
                run_here = 1 + consecutive_duty_blocks_before(
                    draft_rot, day, b, s.idx, blocks_pd
                )
                if run_here > max_consecutive_duty_blocks:
                    bad = True
                    break
        if not bad and _dfs_rotating_only_mask(
            draft_rot,
            busy,
            soldiers,
            L=L + 1,
            days=days,
            blocks_pd=blocks_pd,
            n_rot=n_rot,
            k_rest=k_rest,
            max_consecutive_duty_blocks=max_consecutive_duty_blocks,
            x_cool=x_cool,
            nodes=nodes,
            availability=availability,
            plan_start_hour=plan_start_hour,
            shift_hours=shift_hours,
        ):
            return True
        for s in comb:
            draft_rot[day, s.idx, b] = False
    return False


def advance_rng_to_split_boundary(
    num_soldiers: int,
    slots_per_block: int,
    horizon_days: int,
    split_day: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    prefix_assignments: Sequence[AssignmentRecord],
    *,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    min_consecutive_free_hours: float = MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
    max_consecutive_duty_blocks: int = MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
    min_free_shifts_after_duty: int = 0,
) -> List[AssignmentRecord]:
    """
    Advance ``rng`` to the point in ``run_simulation`` just before rotating fill on ``split_day``.
    Returns non-rotating assignment rows for days ``split_day .. horizon-1`` (to replay on extend).
    """
    if split_day < 1 or horizon_days < split_day:
        return []
    sh = float(block_hours)
    plan_start = int(plan_day_start_hour)
    B = calendar_blocks_per_day(sh)
    blocks_pd = B
    days = horizon_days
    nl, nt = zone.n_loc, zone.n_time
    soldiers = [make_soldier(i, 0.0, nl, nt) for i in range(num_soldiers)]
    busy = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    busy_rot = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    daily_raw_loc = np.zeros((days, num_soldiers, nl), dtype=np.float64)
    daily_raw_time = np.zeros((days, num_soldiers, nt), dtype=np.float64)
    nonrot_prefix = _checkpoint_nonrotating_records(prefix_assignments)
    replay_checkpoint_assignments(
        nonrot_prefix,
        soldiers=soldiers,
        busy=busy,
        busy_rot=busy_rot,
        daily_raw_loc=daily_raw_loc,
        daily_raw_time=daily_raw_time,
        zone=zone,
        block_hours=sh,
        total_days=days,
    )
    suffix_nonrot: List[AssignmentRecord] = []
    soldiers, busy = _scratch_simulate_nonrot_passes(
        num_soldiers,
        slots_per_block,
        horizon_days,
        zone,
        block_hours,
        rng,
        plan_day_start_hour=plan_start,
        availability=availability,
        anchor=anchor,
        type_codes=type_codes,
        band_relative=band_relative,
        balance_total_hours=balance_total_hours,
        total_hours_slack=total_hours_slack,
        passes=("team", "full_day", "windowed"),
        start_day=split_day,
        soldiers=soldiers,
        busy=busy,
        collect_assignments=suffix_nonrot,
    )
    consume_rng_rotating_fill_days(
        num_soldiers,
        slots_per_block,
        horizon_days,
        split_day,
        zone,
        block_hours,
        rng,
        soldiers=soldiers,
        busy=busy,
        plan_day_start_hour=plan_start,
        availability=availability,
        anchor=anchor,
        band_relative=band_relative,
        balance_total_hours=balance_total_hours,
        total_hours_slack=total_hours_slack,
        min_consecutive_free_hours=min_consecutive_free_hours,
        max_consecutive_duty_blocks=max_consecutive_duty_blocks,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        type_codes=type_codes,
    )
    return suffix_nonrot


def _checkpoint_nonrotating_records(
    records: Sequence[AssignmentRecord],
) -> List[AssignmentRecord]:
    return [a for a in records if str(a.kind or "rotating") != "rotating"]


def _scratch_simulate_nonrot_passes(
    num_soldiers: int,
    slots_per_block: int,
    days: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    *,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    passes: Tuple[str, ...] = ("team", "full_day", "windowed"),
    start_day: int = 0,
    soldiers: Optional[List[Soldier]] = None,
    busy: Optional[np.ndarray] = None,
    collect_assignments: Optional[List[AssignmentRecord]] = None,
) -> Tuple[List[Soldier], np.ndarray]:
    """Run non-rotating passes on scratch tensors; returns ``(soldiers, busy)``."""
    sh = float(block_hours)
    plan_start = int(plan_day_start_hour)
    B = calendar_blocks_per_day(sh)
    nl, nt = zone.n_loc, zone.n_time
    if soldiers is None:
        soldiers = [make_soldier(i, 0.0, nl, nt) for i in range(num_soldiers)]
    if busy is None:
        busy = np.zeros((days, num_soldiers, B), dtype=np.bool_)
    daily_raw_loc = np.zeros((days, num_soldiers, nl), dtype=np.float64)
    daily_raw_time = np.zeros((days, num_soldiers, nt), dtype=np.float64)
    deltas_loc = np.zeros((num_soldiers, nl), dtype=np.float64)
    deltas_time = np.zeros((num_soldiers, nt), dtype=np.float64)
    deltas_g = np.zeros(num_soldiers, dtype=np.float64)
    scratch_asn: List[AssignmentRecord] = (
        collect_assignments if collect_assignments is not None else []
    )
    loc_w = zone.loc_weights
    time_w = zone.time_weights
    do_team = "team" in passes
    do_full = "full_day" in passes
    do_window = "windowed" in passes
    d0 = max(0, int(start_day))

    if do_team:
        for day in range(d0, days):
            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            for sidx in range(slots_per_block):
                if zone.slot_patterns[sidx] != "full_day_team":
                    continue
                if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                    continue
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                cfg = zone.full_day_team_specs[tid]
                _fill_full_day_team_post(
                    zone,
                    day,
                    sidx,
                    loc_i,
                    cfg,
                    soldiers,
                    type_codes,
                    busy,
                    daily_raw_loc,
                    daily_raw_time,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    B,
                    sh,
                    days,
                    rng,
                    plan_start_hour=plan_start,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                    availability=availability,
                    assignments=scratch_asn,
                )

    if do_full:
        for day in range(d0, days):
            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            for sidx in range(slots_per_block):
                if zone.slot_patterns[sidx] != "full_day":
                    continue
                if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                    continue
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                cfg = zone.full_day_specs[tid]
                sh0, sh1 = int(cfg["start_h"]), int(cfg["end_h"])
                rest_after = float(cfg["rest_after"])
                L0, span = _linear_busy_span_duty_hours_plus_rest(
                    day,
                    B,
                    sh,
                    sh0,
                    sh1,
                    half_open=False,
                    rest_after_h=rest_after,
                    plan_start_hour=plan_start,
                )
                lw = loc_w[loc_i]
                wm = float(cfg["weight_mult"])
                raw_active = float(sh1 - sh0 + 1)
                b0, b1 = _duty_blocks_inclusive_wall_hours(sh, sh0, sh1)
                time_mid = time_category_for_hour((sh0 + sh1) // 2, zone)
                n_req = max(1, int(cfg.get("headcount", 1)))

                def pool_fn(assigned: List[Soldier]) -> List[Soldier]:
                    return [
                        s
                        for s in soldiers
                        if s not in assigned
                        and not _any_busy_span(busy, s.idx, L0, span, B, days)
                        and _soldier_avail_wall(availability, s.idx, day, sh0, sh1 + 1)
                    ]

                deltas_loc[:] = 0.0
                deltas_time[:] = 0.0
                deltas_g[:] = 0.0
                chosen_list = _pick_soldiers_for_slot(
                    n_req,
                    pool_fn,
                    loc_i,
                    time_mid,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    rng,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                )
                for chosen in chosen_list:
                    for h in range(sh0, sh1 + 1):
                        tj = time_category_for_hour(h, zone)
                        tw = time_w[tj]
                        wpart = lw * tw * wm
                        chosen.add_assignment(loc_i, tj, wpart, 1.0)
                    _busy_span_set(busy, chosen.idx, L0, span, B, days)

    if do_window:
        for day in range(d0, days):
            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            for sidx in range(slots_per_block):
                if zone.slot_patterns[sidx] != "windowed_slots":
                    continue
                if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                    continue
                loc_i = zone.slot_location_indices[sidx]
                tid = zone.location_type_ids[loc_i]
                wins = zone.windowed_specs[tid]
                rest_h = float(zone.windowed_rest_hours.get(tid, 6.0))
                lw = loc_w[loc_i]
                best = None
                for wi, wdef in enumerate(wins):
                    h0, h1x = int(wdef["h0"]), int(wdef["h1_excl"])
                    wm = float(wdef["weight_mult"])
                    raw_active = float(max(0, h1x - h0))
                    if raw_active <= 0:
                        continue
                    L0w, spanw = _linear_busy_span_duty_hours_plus_rest(
                        day,
                        B,
                        sh,
                        h0,
                        h1x,
                        half_open=True,
                        rest_after_h=rest_h,
                        plan_start_hour=plan_start,
                    )
                    pool = [
                        s
                        for s in soldiers
                        if not _any_busy_span(busy, s.idx, L0w, spanw, B, days)
                        and _soldier_avail_wall(availability, s.idx, day, h0, h1x)
                    ]
                    if not pool:
                        continue
                    deltas_loc[:] = 0.0
                    deltas_time[:] = 0.0
                    deltas_g[:] = 0.0
                    h_mid = h0 if h1x <= h0 + 1 else (h0 + h1x - 1) // 2
                    time_mid = time_category_for_hour(h_mid, zone)
                    cand = pick_soldier(
                        pool,
                        loc_i,
                        time_mid,
                        deltas_loc,
                        deltas_time,
                        deltas_g,
                        rng,
                        band_relative=band_relative,
                        balance_total_hours=balance_total_hours,
                        total_hours_slack=total_hours_slack,
                    )
                    key = hybrid_sort_key(
                        cand, loc_i, time_mid, deltas_loc, deltas_time, float(deltas_g[cand.idx])
                    )
                    wname = str(wdef.get("name", f"w{wi}"))
                    cand_rank = (key, wi)
                    if best is None or cand_rank < best[0]:
                        tot_w = 0.0
                        for h in range(h0, h1x):
                            tj = time_category_for_hour(h, zone)
                            tw = time_w[tj]
                            tot_w += lw * tw * wm
                        best = (cand_rank, wi, cand, wdef, tot_w, wname)
                if best is None:
                    raise RestConstraintError(
                        f"windowed (rng advance): cannot fill day {day + 1} slot {sidx + 1}"
                    )
                _wi, chosen, wdef, tot_w, wname = best[1], best[2], best[3], best[4], best[5]
                h0, h1x = int(wdef["h0"]), int(wdef["h1_excl"])
                wm = float(wdef["weight_mult"])
                L0, span = _linear_busy_span_duty_hours_plus_rest(
                    day, B, sh, h0, h1x, half_open=True, rest_after_h=rest_h, plan_start_hour=plan_start
                )
                for h in range(h0, h1x):
                    tj = time_category_for_hour(h, zone)
                    tw = time_w[tj]
                    chosen.add_assignment(loc_i, tj, lw * tw * wm, 1.0)
                _busy_span_set(busy, chosen.idx, L0, span, B, days)

    return soldiers, busy


def consume_rng_for_nonrot_days(
    num_soldiers: int,
    slots_per_block: int,
    nonrot_days: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    *,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    passes: Tuple[str, ...] = ("team", "full_day", "windowed"),
) -> None:
    """Advance ``rng`` through selected non-rotating passes (same order as ``run_simulation``)."""
    if nonrot_days < 1:
        return
    _scratch_simulate_nonrot_passes(
        num_soldiers,
        slots_per_block,
        nonrot_days,
        zone,
        block_hours,
        rng,
        plan_day_start_hour=plan_day_start_hour,
        availability=availability,
        anchor=anchor,
        type_codes=type_codes,
        band_relative=band_relative,
        balance_total_hours=balance_total_hours,
        total_hours_slack=total_hours_slack,
        passes=passes,
    )


def consume_rng_rotating_fill_days(
    num_soldiers: int,
    slots_per_block: int,
    horizon_days: int,
    fill_through_day: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    *,
    soldiers: List[Soldier],
    busy: np.ndarray,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    min_consecutive_free_hours: float = MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
    max_consecutive_duty_blocks: int = MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
    min_free_shifts_after_duty: int = 0,
) -> None:
    """Advance ``rng`` through rotating DFS (no draws) then fill for days ``0 .. fill_through_day-1``."""
    if fill_through_day < 1 or horizon_days < fill_through_day:
        return
    sh = float(block_hours)
    plan_start = int(plan_day_start_hour)
    B = calendar_blocks_per_day(sh)
    blocks_pd = B
    days = horizon_days
    nl, nt = zone.n_loc, zone.n_time
    loc_w = zone.loc_weights
    time_w = zone.time_weights
    busy_rot = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    deltas_loc = np.zeros((num_soldiers, nl), dtype=np.float64)
    deltas_time = np.zeros((num_soldiers, nt), dtype=np.float64)
    deltas_g = np.zeros(num_soldiers, dtype=np.float64)
    rot_slot_indices = _rotating_slot_indices(zone)
    k_rest = consecutive_free_blocks_needed(sh, min_consecutive_free_hours)
    x_cool = min_free_shifts_after_duty
    if (
        x_cool > 0
        and min_consecutive_free_hours > 0
        and float(x_cool) * sh + 1e-9 >= float(min_consecutive_free_hours)
        and len(rot_slot_indices) == slots_per_block
    ):
        k_rest = 0
    k_rest_mask = k_rest if len(rot_slot_indices) == slots_per_block else 0
    dr = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    dfs_nodes = [0]
    if not (
        x_cool > 0
        and len(rot_slot_indices) > 0
        and math.comb(num_soldiers, len(rot_slot_indices))
        <= _ROTATING_COOLDOWN_DFS_MAX_COMBINATIONS
        and _dfs_rotating_only_mask(
            dr,
            busy,
            soldiers,
            L=0,
            days=days,
            blocks_pd=blocks_pd,
            n_rot=len(rot_slot_indices),
            k_rest=k_rest_mask,
            max_consecutive_duty_blocks=max_consecutive_duty_blocks,
            x_cool=x_cool,
            nodes=dfs_nodes,
            availability=availability,
            plan_start_hour=plan_start,
            shift_hours=sh,
        )
    ):
        return
    for day in range(fill_through_day):
        for b in range(blocks_pd):
            start_h = block_start_hour(plan_start, b, sh)
            time_j = time_category_for_hour(start_h, zone)
            tw = time_w[time_j]
            in_block = [s for s in soldiers if dr[day, s.idx, b]]
            assigned: List[Soldier] = []
            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            rot_pf = (
                _rotating_prefix_key(busy, busy_rot, day, b, blocks_pd, days, k_rest_mask)
                if x_cool > 0
                else None
            )
            for sidx in rot_slot_indices:
                if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                    continue
                loc_i = zone.slot_location_indices[sidx]
                lw = loc_w[loc_i]
                weight = sh * lw * tw
                n_req = _soldiers_required(zone, sidx)

                def pool_fn_r(already: List[Soldier]) -> List[Soldier]:
                    return [
                        s for s in in_block if s not in assigned and s not in already
                    ]

                _pick_soldiers_for_slot(
                    n_req,
                    pool_fn_r,
                    loc_i,
                    time_j,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    rng,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                    prefix_key=rot_pf,
                )


def _frozen_rotating_lookup(
    records: Sequence[AssignmentRecord],
    through_day: int,
) -> Dict[Tuple[int, int, int], AssignmentRecord]:
    out: Dict[Tuple[int, int, int], AssignmentRecord] = {}
    for a in records:
        if int(a.day) >= through_day:
            continue
        if str(a.kind or "rotating") != "rotating":
            continue
        out[(int(a.day), int(a.calendar_block), int(a.slot))] = a
    return out


def _replay_frozen_rot_soldier_weights(
    records: Sequence[AssignmentRecord],
    *,
    soldiers: List[Soldier],
    zone: ZoneConfig,
    block_hours: float,
) -> None:
    """Update soldier fairness counters for prefix rotating rows without touching ``busy``."""
    sh = float(block_hours)
    for a in records:
        if str(a.kind or "rotating") != "rotating":
            continue
        s = soldiers[int(a.soldier_idx)]
        loc_i, time_j = int(a.loc_i), int(a.time_j)
        weight, rh = float(a.weight), float(a.raw_hours)
        if rh <= 0:
            rh = sh
        s.add_assignment(loc_i, time_j, weight, rh)


def _apply_frozen_rot_busy(
    a: AssignmentRecord,
    *,
    busy: np.ndarray,
    busy_rot: np.ndarray,
) -> None:
    day = int(a.day)
    sidx = int(a.soldier_idx)
    b = int(a.calendar_block)
    busy[day, sidx, b] = True
    busy_rot[day, sidx, b] = True


def _append_frozen_rotating_assignment(
    a: AssignmentRecord,
    *,
    soldiers: List[Soldier],
    busy: np.ndarray,
    busy_rot: np.ndarray,
    daily_raw_loc: np.ndarray,
    daily_raw_time: np.ndarray,
    zone: ZoneConfig,
    block_hours: float,
    days: int,
    assignments: List[AssignmentRecord],
) -> None:
    sh = float(block_hours)
    B = calendar_blocks_per_day(sh)
    s = soldiers[int(a.soldier_idx)]
    day = int(a.day)
    b = int(a.calendar_block)
    loc_i, time_j = int(a.loc_i), int(a.time_j)
    weight, rh = float(a.weight), float(a.raw_hours)
    if rh <= 0:
        rh = sh
    s.add_assignment(loc_i, time_j, weight, rh)
    busy[day, s.idx, b] = True
    busy_rot[day, s.idx, b] = True
    daily_raw_loc[day, s.idx, loc_i] += rh
    daily_raw_time[day, s.idx, time_j] += rh
    assignments.append(replace(a))


def run_simulation(
    num_soldiers: int,
    slots_per_block: int,
    days: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    min_consecutive_free_hours: float = MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    max_consecutive_duty_blocks: int = MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
    min_free_shifts_after_duty: int = 0,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    checkpoint_prefix: Optional[Sequence[AssignmentRecord]] = None,
    checkpoint_prefix_days: int = 0,
    checkpoint_suffix_nonrot: Optional[Sequence[AssignmentRecord]] = None,
    witness: Optional[SimWitnessCapture] = None,
    witness_rot_fill_from_day: Optional[int] = None,
) -> Tuple[
    List[Soldier],
    np.ndarray,
    np.ndarray,
    List[AssignmentRecord],
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    SimulationStats,
]:
    if num_soldiers < slots_per_block:
        raise ValueError("need soldiers >= slots per block (concurrent guards)")
    sh = float(block_hours)
    plan_start = int(plan_day_start_hour)
    B = calendar_blocks_per_day(sh)
    blocks_pd = B
    n_rot = sum(1 for p in zone.slot_patterns if p == "rotating")
    if n_rot > 0:
        assert_rest_feasible_counting(
            num_soldiers, blocks_pd, n_rot, sh, min_consecutive_free_hours
        )

    nl = zone.n_loc
    nt = zone.n_time
    soldiers = [make_soldier(i, 0.0, nl, nt) for i in range(num_soldiers)]
    for day in range(days):
        for i, s in enumerate(soldiers):
            if availability is None:
                s.available_hours += 24.0
            else:
                bh, ah = availability.fairness_hours(i, day)
                s.available_hours += bh + ah

    loc_w = zone.loc_weights
    time_w = zone.time_weights
    busy = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    busy_rot = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
    daily_raw_loc = np.zeros((days, num_soldiers, nl), dtype=np.float64)
    daily_raw_time = np.zeros((days, num_soldiers, nt), dtype=np.float64)
    deltas_loc = np.zeros((num_soldiers, nl), dtype=np.float64)
    deltas_time = np.zeros((num_soldiers, nt), dtype=np.float64)
    deltas_g = np.zeros(num_soldiers, dtype=np.float64)
    assignments: List[AssignmentRecord] = []
    cp_days = int(checkpoint_prefix_days)
    rot_fill_from = (
        int(witness_rot_fill_from_day)
        if witness_rot_fill_from_day is not None
        else 0
    )
    frozen_rot: Dict[Tuple[int, int, int], AssignmentRecord] = {}
    checkpoint_suffix_stored: List[AssignmentRecord] = []
    if checkpoint_prefix and cp_days > 0:
        suffix_nonrot = list(checkpoint_suffix_nonrot or ())
        # Witness extend may supply an empty suffix (all-rotating zones); do not re-simulate.
        if not suffix_nonrot and witness_rot_fill_from_day is None:
            suffix_nonrot = advance_rng_to_split_boundary(
                num_soldiers,
                slots_per_block,
                days,
                cp_days,
                zone,
                sh,
                rng,
                checkpoint_prefix,
                plan_day_start_hour=plan_start,
                availability=availability,
                anchor=anchor,
                type_codes=type_codes,
                band_relative=band_relative,
                balance_total_hours=balance_total_hours,
                total_hours_slack=total_hours_slack,
                min_consecutive_free_hours=min_consecutive_free_hours,
                max_consecutive_duty_blocks=max_consecutive_duty_blocks,
                min_free_shifts_after_duty=min_free_shifts_after_duty,
            )
        checkpoint_suffix_stored = list(suffix_nonrot)
        # Non-rotating rows only for busy replay (rotating prefix replayed after DFS when extending).
        nonrot_prefix = _checkpoint_nonrotating_records(checkpoint_prefix)
        replay_rows: Sequence[AssignmentRecord] = list(nonrot_prefix) + list(suffix_nonrot)
        replay_checkpoint_assignments(
            replay_rows,
            soldiers=soldiers,
            busy=busy,
            busy_rot=busy_rot,
            daily_raw_loc=daily_raw_loc,
            daily_raw_time=daily_raw_time,
            zone=zone,
            block_hours=sh,
            total_days=days,
        )
        if rot_fill_from <= 0:
            frozen_rot = _frozen_rotating_lookup(checkpoint_prefix, cp_days)
    k_rest = consecutive_free_blocks_needed(sh, min_consecutive_free_hours)
    stats = SimulationStats()
    x_cool = min_free_shifts_after_duty
    # All-rotating: if rotating cooldown gap (x_cool * shift_hours) already meets the consecutive
    # free-hours target, skip the fixed k-block sleep arc to avoid double-counting the same off time.
    if (
        x_cool > 0
        and min_consecutive_free_hours > 0
        and float(x_cool) * sh + 1e-9 >= float(min_consecutive_free_hours)
        and n_rot == slots_per_block
    ):
        k_rest = 0

    for day in range(days):
        if cp_days > 0:
            continue
        deltas_loc[:] = 0.0
        deltas_time[:] = 0.0
        deltas_g[:] = 0.0
        for sidx in range(slots_per_block):
            if zone.slot_patterns[sidx] != "full_day_team":
                continue
            if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                continue
            loc_i = zone.slot_location_indices[sidx]
            tid = zone.location_type_ids[loc_i]
            cfg = zone.full_day_team_specs[tid]
            _fill_full_day_team_post(
                zone,
                day,
                sidx,
                loc_i,
                cfg,
                soldiers,
                type_codes,
                busy,
                daily_raw_loc,
                daily_raw_time,
                deltas_loc,
                deltas_time,
                deltas_g,
                B,
                sh,
                days,
                rng,
                plan_start_hour=plan_start,
                band_relative=band_relative,
                balance_total_hours=balance_total_hours,
                total_hours_slack=total_hours_slack,
                availability=availability,
                assignments=assignments,
            )

    for day in range(days):
        if cp_days > 0:
            continue
        deltas_loc[:] = 0.0
        deltas_time[:] = 0.0
        deltas_g[:] = 0.0
        for sidx in range(slots_per_block):
            if zone.slot_patterns[sidx] != "full_day":
                continue
            if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                continue
            loc_i = zone.slot_location_indices[sidx]
            tid = zone.location_type_ids[loc_i]
            cfg = zone.full_day_specs[tid]
            sh0, sh1 = int(cfg["start_h"]), int(cfg["end_h"])
            rest_after = float(cfg["rest_after"])
            L0, span = _linear_busy_span_duty_hours_plus_rest(
                day,
                B,
                sh,
                sh0,
                sh1,
                half_open=False,
                rest_after_h=rest_after,
                plan_start_hour=plan_start,
            )
            lw = loc_w[loc_i]
            wm = float(cfg["weight_mult"])
            raw_active = float(sh1 - sh0 + 1)
            b0, b1 = _duty_blocks_inclusive_wall_hours(sh, sh0, sh1)
            duty_w = b1 - b0 + 1
            time_mid = time_category_for_hour((sh0 + sh1) // 2, zone)
            n_req = max(1, int(cfg.get("headcount", 1)))

            def pool_fn(assigned: List[Soldier]) -> List[Soldier]:
                return [
                    s
                    for s in soldiers
                    if s not in assigned
                    and not _any_busy_span(busy, s.idx, L0, span, B, days)
                    and _soldier_avail_wall(availability, s.idx, day, sh0, sh1 + 1)
                ]

            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            try:
                chosen_list = _pick_soldiers_for_slot(
                    n_req,
                    pool_fn,
                    loc_i,
                    time_mid,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    rng,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                )
            except ValueError as e:
                raise RestConstraintError(
                    f"full_day: cannot fill day {day + 1} slot {sidx + 1} ({zone.loc_ids[loc_i]}): {e}"
                ) from e
            for chosen in chosen_list:
                tot_w = 0.0
                for h in range(sh0, sh1 + 1):
                    tj = time_category_for_hour(h, zone)
                    tw = time_w[tj]
                    wpart = lw * tw * wm
                    tot_w += wpart
                    chosen.add_assignment(loc_i, tj, wpart, 1.0)
                _busy_span_set(busy, chosen.idx, L0, span, B, days)
                daily_raw_loc[day, chosen.idx, loc_i] += raw_active
                for h in range(sh0, sh1 + 1):
                    tj = time_category_for_hour(h, zone)
                    daily_raw_time[day, chosen.idx, tj] += 1.0
                assignments.append(
                    AssignmentRecord(
                        day=day,
                        calendar_block=b0,
                        start_hour=int(b0 * sh),
                        slot=sidx,
                        soldier_idx=chosen.idx,
                        loc_i=loc_i,
                        time_j=time_mid,
                        weight=tot_w,
                        raw_hours=raw_active,
                        kind="full_day",
                        rowspan=duty_w,
                        win_start_block=b0,
                        win_end_block=b1,
                        window_name=None,
                        linear_busy_span_blocks=span,
                    )
                )

    for day in range(days):
        if cp_days > 0:
            continue
        deltas_loc[:] = 0.0
        deltas_time[:] = 0.0
        deltas_g[:] = 0.0
        for sidx in range(slots_per_block):
            if zone.slot_patterns[sidx] != "windowed_slots":
                continue
            if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                continue
            loc_i = zone.slot_location_indices[sidx]
            tid = zone.location_type_ids[loc_i]
            wins = zone.windowed_specs[tid]
            rest_h = float(zone.windowed_rest_hours.get(tid, 6.0))
            lw = loc_w[loc_i]
            best: Optional[Tuple[Tuple[Any, ...], int, Soldier, Dict[str, Any], float, str]] = None
            for wi, wdef in enumerate(wins):
                h0, h1x = int(wdef["h0"]), int(wdef["h1_excl"])
                wm = float(wdef["weight_mult"])
                raw_active = float(max(0, h1x - h0))
                if raw_active <= 0:
                    continue
                L0w, spanw = _linear_busy_span_duty_hours_plus_rest(
                    day,
                    B,
                    sh,
                    h0,
                    h1x,
                    half_open=True,
                    rest_after_h=rest_h,
                    plan_start_hour=plan_start,
                )
                pool = [
                    s
                    for s in soldiers
                    if not _any_busy_span(busy, s.idx, L0w, spanw, B, days)
                    and _soldier_avail_wall(availability, s.idx, day, h0, h1x)
                ]
                if not pool:
                    continue
                deltas_loc[:] = 0.0
                deltas_time[:] = 0.0
                deltas_g[:] = 0.0
                h_mid = h0 if h1x <= h0 + 1 else (h0 + h1x - 1) // 2
                time_mid = time_category_for_hour(h_mid, zone)
                cand = pick_soldier(
                    pool,
                    loc_i,
                    time_mid,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    rng,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                )
                key = hybrid_sort_key(
                    cand, loc_i, time_mid, deltas_loc, deltas_time, float(deltas_g[cand.idx])
                )
                cand_rank = (key, wi)
                if best is None or cand_rank < best[0]:
                    tot_w = 0.0
                    for h in range(h0, h1x):
                        tj = time_category_for_hour(h, zone)
                        tw = time_w[tj]
                        tot_w += lw * tw * wm
                    best = (cand_rank, wi, cand, wdef, tot_w, str(wdef.get("name", f"w{wi}")))
            if best is None:
                raise RestConstraintError(
                    f"windowed: cannot fill day {day + 1} slot {sidx + 1} ({zone.loc_ids[loc_i]})."
                )
            _wi, _cand, wdef, tot_w, wname = best[1], best[2], best[3], best[4], best[5]
            h0, h1x = int(wdef["h0"]), int(wdef["h1_excl"])
            wm = float(wdef["weight_mult"])
            raw_active = float(max(0, h1x - h0))
            L0, span = _linear_busy_span_duty_hours_plus_rest(
                day,
                B,
                sh,
                h0,
                h1x,
                half_open=True,
                rest_after_h=rest_h,
                plan_start_hour=plan_start,
            )
            n_req = max(1, int(zone.windowed_headcount.get(tid, 1)))
            time_mid = time_category_for_hour(h0, zone)
            if h1x > h0 + 1:
                time_mid = time_category_for_hour((h0 + h1x - 1) // 2, zone)

            def pool_fn_w(assigned: List[Soldier]) -> List[Soldier]:
                return [
                    s
                    for s in soldiers
                    if s not in assigned
                    and not _any_busy_span(busy, s.idx, L0, span, B, days)
                    and _soldier_avail_wall(availability, s.idx, day, h0, h1x)
                ]

            deltas_loc[:] = 0.0
            deltas_time[:] = 0.0
            deltas_g[:] = 0.0
            try:
                chosen_list = _pick_soldiers_for_slot(
                    n_req,
                    pool_fn_w,
                    loc_i,
                    time_mid,
                    deltas_loc,
                    deltas_time,
                    deltas_g,
                    rng,
                    band_relative=band_relative,
                    balance_total_hours=balance_total_hours,
                    total_hours_slack=total_hours_slack,
                )
            except ValueError as e:
                raise RestConstraintError(
                    f"windowed: cannot fill day {day + 1} slot {sidx + 1}: {e}"
                ) from e
            b0, b1 = _duty_blocks_half_open_wall_hours(sh, h0, h1x)
            for chosen in chosen_list:
                for h in range(h0, h1x):
                    tj = time_category_for_hour(h, zone)
                    tw = time_w[tj]
                    wpart = lw * tw * wm
                    chosen.add_assignment(loc_i, tj, wpart, 1.0)
                _busy_span_set(busy, chosen.idx, L0, span, B, days)
                daily_raw_loc[day, chosen.idx, loc_i] += raw_active
                for h in range(h0, h1x):
                    tj = time_category_for_hour(h, zone)
                    daily_raw_time[day, chosen.idx, tj] += 1.0
                assignments.append(
                    AssignmentRecord(
                        day=day,
                        calendar_block=b0,
                        start_hour=int(b0 * sh),
                        slot=sidx,
                        soldier_idx=chosen.idx,
                        loc_i=loc_i,
                        time_j=time_category_for_hour(h0, zone),
                        weight=float(tot_w),
                        raw_hours=raw_active,
                        kind="windowed",
                        rowspan=max(1, b1 - b0 + 1),
                        win_start_block=b0,
                        win_end_block=b1,
                        window_name=wname or None,
                        linear_busy_span_blocks=span,
                    )
                )

    rot_slot_indices = _rotating_slot_indices(zone)
    k_rest_mask = k_rest if len(rot_slot_indices) == slots_per_block else 0
    dfs_rot_ok = False
    rotating_dfs_tried = False
    if (
        x_cool > 0
        and len(rot_slot_indices) > 0
        and math.comb(num_soldiers, len(rot_slot_indices)) <= _ROTATING_COOLDOWN_DFS_MAX_COMBINATIONS
    ):
        rotating_dfs_tried = True
        dr = np.zeros((days, num_soldiers, blocks_pd), dtype=np.bool_)
        dfs_nodes = [0]
        if _dfs_rotating_only_mask(
            dr,
            busy,
            soldiers,
            L=0,
            days=days,
            blocks_pd=blocks_pd,
            n_rot=len(rot_slot_indices),
            k_rest=k_rest_mask,
            max_consecutive_duty_blocks=max_consecutive_duty_blocks,
            x_cool=x_cool,
            nodes=dfs_nodes,
            availability=availability,
            plan_start_hour=plan_day_start_hour,
            shift_hours=sh,
        ):
            np.copyto(busy_rot, dr)
            dfs_rot_ok = True
            if rot_fill_from > 0 and checkpoint_prefix:
                rot_prefix = [
                    replace(a)
                    for a in checkpoint_prefix
                    if str(a.kind or "rotating") == "rotating"
                    and int(a.day) < rot_fill_from
                ]
                if rot_prefix:
                    replay_checkpoint_assignments(
                        rot_prefix,
                        soldiers=soldiers,
                        busy=busy,
                        busy_rot=busy_rot,
                        daily_raw_loc=daily_raw_loc,
                        daily_raw_time=daily_raw_time,
                        zone=zone,
                        block_hours=sh,
                        total_days=days,
                    )
            for day in range(days):
                if rot_fill_from > 0 and day < rot_fill_from:
                    continue
                for b in range(blocks_pd):
                    start_h = block_start_hour(plan_start, b, sh)
                    time_j = time_category_for_hour(start_h, zone)
                    tw = time_w[time_j]
                    in_block = [s for s in soldiers if dr[day, s.idx, b]]
                    assigned: List[Soldier] = []
                    deltas_loc[:] = 0.0
                    deltas_time[:] = 0.0
                    deltas_g[:] = 0.0
                    rot_pf = (
                        _rotating_prefix_key(
                            busy, busy_rot, day, b, blocks_pd, days, k_rest_mask
                        )
                        if x_cool > 0
                        else None
                    )
                    for sidx in rot_slot_indices:
                        if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                            continue
                        if cp_days > 0 and day < cp_days:
                            fa = frozen_rot.get((day, b, sidx))
                            if fa is not None:
                                assigned.append(soldiers[int(fa.soldier_idx)])
                            continue
                        loc_i = zone.slot_location_indices[sidx]
                        lw = loc_w[loc_i]
                        weight = sh * lw * tw
                        n_req = _soldiers_required(zone, sidx)

                        def pool_fn_r(already: List[Soldier]) -> List[Soldier]:
                            return [
                                s
                                for s in in_block
                                if s not in assigned and s not in already
                            ]

                        try:
                            chosen_list = _pick_soldiers_for_slot(
                                n_req,
                                pool_fn_r,
                                loc_i,
                                time_j,
                                deltas_loc,
                                deltas_time,
                                deltas_g,
                                rng,
                                band_relative=band_relative,
                                balance_total_hours=balance_total_hours,
                                total_hours_slack=total_hours_slack,
                                prefix_key=rot_pf,
                            )
                        except ValueError as e:
                            raise RestConstraintError(
                                f"rotating DFS fill day {day + 1} block {b + 1} slot {sidx + 1}: {e}"
                            ) from e
                        for chosen in chosen_list:
                            assigned.append(chosen)
                            chosen.add_assignment(loc_i, time_j, weight, sh)
                            busy[day, chosen.idx, b] = True
                            daily_raw_loc[day, chosen.idx, loc_i] += sh
                            daily_raw_time[day, chosen.idx, time_j] += sh
                            deltas_loc[chosen.idx, loc_i] += weight
                            deltas_time[chosen.idx, time_j] += weight
                            deltas_g[chosen.idx] += weight
                            assignments.append(
                                AssignmentRecord(
                                    day=day,
                                    calendar_block=b,
                                    start_hour=start_h,
                                    slot=sidx,
                                    soldier_idx=chosen.idx,
                                    loc_i=loc_i,
                                    time_j=time_j,
                                    weight=weight,
                                    raw_hours=sh,
                                    kind="rotating",
                                    rowspan=1,
                                    win_start_block=b,
                                    win_end_block=b,
                                    window_name=None,
                                )
                            )
                _maybe_capture_witness_rng(witness, day, rng)

    if not dfs_rot_ok:
        if rot_fill_from > 0 and checkpoint_prefix:
            rot_prefix = [
                replace(a)
                for a in checkpoint_prefix
                if str(a.kind or "rotating") == "rotating" and int(a.day) < rot_fill_from
            ]
            if rot_prefix:
                replay_checkpoint_assignments(
                    rot_prefix,
                    soldiers=soldiers,
                    busy=busy,
                    busy_rot=busy_rot,
                    daily_raw_loc=daily_raw_loc,
                    daily_raw_time=daily_raw_time,
                    zone=zone,
                    block_hours=sh,
                    total_days=days,
                )
        for day in range(days):
            if rot_fill_from > 0 and day < rot_fill_from:
                continue
            for b in range(blocks_pd):
                start_h = block_start_hour(plan_start, b, sh)
                time_j = time_category_for_hour(start_h, zone)
                tw = time_w[time_j]
                assigned: List[Soldier] = []
                deltas_loc[:] = 0.0
                deltas_time[:] = 0.0
                deltas_g[:] = 0.0
                rot_pf = (
                    _rotating_prefix_key(
                        busy, busy_rot, day, b, blocks_pd, days, k_rest_mask
                    )
                    if x_cool > 0
                    else None
                )
                for sidx in range(slots_per_block):
                    if zone.slot_patterns[sidx] != "rotating":
                        continue
                    if _slot_disabled_for_day(zone, sidx, day, anchor, plan_start):
                        continue
                    if cp_days > 0 and day < cp_days:
                        fa = frozen_rot.get((day, b, sidx))
                        if fa is not None:
                            assigned.append(soldiers[int(fa.soldier_idx)])
                        continue
                    loc_i = zone.slot_location_indices[sidx]
                    lw = loc_w[loc_i]
                    weight = sh * lw * tw
                    n_req = _soldiers_required(zone, sidx)

                    def pool_fn_rot(already: List[Soldier]) -> List[Soldier]:
                        base_pool = [
                            s
                            for s in soldiers
                            if s not in assigned
                            and s not in already
                            and not soldier_must_rest_this_block(
                                s.idx, day, b, blocks_pd, k_rest_mask
                            )
                            and not busy[day, s.idx, b]
                            and (
                                max_consecutive_duty_blocks <= 0
                                or consecutive_duty_blocks_before(
                                    busy_rot, day, b, s.idx, blocks_pd
                                )
                                < max_consecutive_duty_blocks
                            )
                            and _soldier_avail_rotating(
                                availability, s.idx, day, b, plan_start, sh
                            )
                        ]
                        if x_cool > 0:
                            stats.shift_cooldown_pool_iterations += 1
                            filt = []
                            for s in base_pool:
                                gap = gap_free_blocks_since_last_duty_before_assign(
                                    busy_rot, day, b, s.idx, blocks_pd
                                )
                                if gap >= x_cool or gap >= LARGE_LINEAR_GAP:
                                    filt.append(s)
                                else:
                                    stats.shift_cooldown_exclusions += 1
                            return filt
                        return base_pool

                    try:
                        chosen_list = _pick_soldiers_for_slot(
                            n_req,
                            pool_fn_rot,
                            loc_i,
                            time_j,
                            deltas_loc,
                            deltas_time,
                            deltas_g,
                            rng,
                            band_relative=band_relative,
                            balance_total_hours=balance_total_hours,
                            total_hours_slack=total_hours_slack,
                            prefix_key=rot_pf,
                        )
                    except ValueError as e:
                        extra = ""
                        if rotating_dfs_tried and not dfs_rot_ok:
                            extra = (
                                " Rotating DFS found no feasible mask; "
                                "relax --days, --min-consecutive-free-hours, "
                                "--min-free-shifts-after-duty, or add soldiers."
                            )
                        raise RestConstraintError(
                            f"rotating: cannot fill day {day + 1} block {b + 1} slot {sidx + 1}: {e}"
                            + extra
                        ) from e
                    for chosen in chosen_list:
                        assigned.append(chosen)
                        chosen.add_assignment(loc_i, time_j, weight, sh)
                        busy[day, chosen.idx, b] = True
                        busy_rot[day, chosen.idx, b] = True
                        daily_raw_loc[day, chosen.idx, loc_i] += sh
                        daily_raw_time[day, chosen.idx, time_j] += sh
                        deltas_loc[chosen.idx, loc_i] += weight
                        deltas_time[chosen.idx, time_j] += weight
                        deltas_g[chosen.idx] += weight
                        assignments.append(
                            AssignmentRecord(
                                day=day,
                                calendar_block=b,
                                start_hour=start_h,
                                slot=sidx,
                                soldier_idx=chosen.idx,
                                loc_i=loc_i,
                                time_j=time_j,
                                weight=weight,
                                raw_hours=sh,
                                kind="rotating",
                                rowspan=1,
                                win_start_block=b,
                                win_end_block=b,
                                window_name=None,
                            )
                        )
            _maybe_capture_witness_rng(witness, day, rng)

    raw_loc_mat = np.stack([s.raw_loc for s in soldiers], axis=0)
    raw_time_mat = np.stack([s.raw_time for s in soldiers], axis=0)
    Z = np.zeros((num_soldiers, nl + nt), dtype=np.float64)
    tot_row = np.sum(raw_loc_mat, axis=1, keepdims=True)
    np.divide(raw_loc_mat, tot_row, out=Z[:, :nl], where=tot_row > 1e-12)
    Z[:, nl:] = heatmap_time_fraction_by_row(raw_time_mat)

    Z_day = np.zeros((days, num_soldiers, nl + nt), dtype=np.float64)
    time_day_norm = heatmap_time_fraction_by_row_daily(daily_raw_time)
    for d in range(days):
        for s in range(num_soldiers):
            tot_d = float(np.sum(daily_raw_loc[d, s]))
            if tot_d <= 0:
                continue
            Z_day[d, s, :nl] = daily_raw_loc[d, s] / tot_d
            Z_day[d, s, nl:] = time_day_norm[d, s, :]

    Z_avg = np.zeros((num_soldiers, nl + nt), dtype=np.float64)
    for s in range(num_soldiers):
        rows = [Z_day[d, s] for d in range(days) if float(np.sum(daily_raw_loc[d, s])) > 1e-9]
        if rows:
            Z_avg[s] = np.mean(np.stack(rows, axis=0), axis=0)

    if cp_days > 0 and checkpoint_prefix:
        new_only = [a for a in assignments if int(a.day) >= cp_days]
        assignments = sorted(
            [replace(a) for a in checkpoint_prefix]
            + [replace(a) for a in checkpoint_suffix_stored]
            + new_only,
            key=checkpoint_replay_sort_key,
        )

    max_free = compute_max_consecutive_free_hours(busy, sh)
    validate_schedule_rest(
        max_free, min_consecutive_free_hours, assignments=assignments
    )
    validate_max_consecutive_duty(busy_rot, max_consecutive_duty_blocks)
    stats.shift_cooldown_violations_post = count_shift_cooldown_violations(busy_rot, x_cool)
    if stats.shift_cooldown_violations_post > 0:
        raise RestConstraintError(
            f"Internal: shift-cooldown violations after build: {stats.shift_cooldown_violations_post}"
        )

    return soldiers, Z, max_free, assignments, Z_day, Z_avg, daily_raw_loc, daily_raw_time, stats


def run_simulation_checkpoint_extend(
    num_soldiers: int,
    slots_per_block: int,
    prefix_assignments: Sequence[AssignmentRecord],
    prefix_days: int,
    extend_days: int,
    zone: ZoneConfig,
    block_hours: float,
    rng: random.Random,
    min_consecutive_free_hours: float = MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    max_consecutive_duty_blocks: int = MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
    min_free_shifts_after_duty: int = 0,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
    *,
    witness_rng_state: Optional[Tuple[Any, ...]] = None,
    witness_suffix_nonrot: Optional[Sequence[AssignmentRecord]] = None,
) -> Tuple[
    List[Soldier],
    np.ndarray,
    np.ndarray,
    List[AssignmentRecord],
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    SimulationStats,
]:
    """
    Replay ``prefix_assignments`` (days ``0 .. prefix_days-1``), then simulate through
    ``prefix_days + extend_days`` using the same code path as ``run_simulation``.
    """
    if extend_days < 1:
        raise ValueError("extend_days must be >= 1 for checkpoint extension")
    prefix_list = list(prefix_assignments)
    blocks_pd = calendar_blocks_per_day(float(block_hours))
    exp_pre = expected_assignment_count(zone, prefix_days, blocks_pd, slots_per_block)
    if len(prefix_list) != exp_pre:
        raise ValueError(
            f"checkpoint prefix: got {len(prefix_list)} assignments, expected {exp_pre} "
            f"for prefix_days={prefix_days}"
        )
    if not any(p == "full_day_team" for p in zone.slot_patterns):
        build_schedule_compare_matrix(
            prefix_list, prefix_days, blocks_pd, slots_per_block
        )
    total_days = int(prefix_days) + int(extend_days)
    if witness_rng_state is not None:
        rng.setstate(witness_rng_state)
    if witness_rng_state is not None and witness_suffix_nonrot is not None:
        suffix_nonrot = [replace(a) for a in witness_suffix_nonrot]
    else:
        suffix_nonrot = advance_rng_to_split_boundary(
            num_soldiers,
            slots_per_block,
            total_days,
            int(prefix_days),
            zone,
            block_hours,
            rng,
            prefix_list,
            plan_day_start_hour=plan_day_start_hour,
            availability=availability,
            anchor=anchor,
            type_codes=type_codes,
            band_relative=band_relative,
            balance_total_hours=balance_total_hours,
            total_hours_slack=total_hours_slack,
            min_consecutive_free_hours=min_consecutive_free_hours,
            max_consecutive_duty_blocks=max_consecutive_duty_blocks,
            min_free_shifts_after_duty=min_free_shifts_after_duty,
        )
    rot_from = int(prefix_days) if witness_rng_state is not None else None
    return run_simulation(
        num_soldiers,
        slots_per_block,
        total_days,
        zone,
        block_hours,
        rng,
        min_consecutive_free_hours=min_consecutive_free_hours,
        balance_total_hours=balance_total_hours,
        total_hours_slack=total_hours_slack,
        max_consecutive_duty_blocks=max_consecutive_duty_blocks,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=band_relative,
        plan_day_start_hour=plan_day_start_hour,
        availability=availability,
        anchor=anchor,
        type_codes=type_codes,
        checkpoint_prefix=prefix_list,
        checkpoint_prefix_days=int(prefix_days),
        checkpoint_suffix_nonrot=suffix_nonrot,
        witness_rot_fill_from_day=rot_from,
    )



def compute_max_consecutive_free_hours(busy: np.ndarray, block_hours: float) -> np.ndarray:
    """Longest consecutive off-duty stretch within each calendar day, with midnight wrap."""
    days, n_s, n_blocks = busy.shape
    out = np.zeros((days, n_s), dtype=np.float64)
    B = n_blocks
    for d in range(days):
        for s in range(n_s):
            row = busy[d, s]
            if not np.any(row):
                out[d, s] = B * block_hours
                continue
            doubled = np.concatenate([row, row])
            run = 0
            best = 0
            for j in range(2 * B):
                if not doubled[j]:
                    run += 1
                    if run > B:
                        run = B
                    if run > best:
                        best = run
                else:
                    run = 0
            out[d, s] = best * block_hours
    return out


def heatmap_std_summary(Z: np.ndarray) -> Tuple[float, float, np.ndarray]:
    flat = Z.ravel()
    if flat.size < 2:
        std_all = 0.0
    else:
        std_all = float(np.std(flat, ddof=1))

    n = Z.shape[0]
    if n < 2:
        std_per_slot = np.zeros(Z.shape[1], dtype=np.float64)
        min_std_slot = 0.0
    else:
        std_per_slot = np.std(Z, axis=0, ddof=1)
        min_std_slot = float(np.min(std_per_slot))

    return std_all, min_std_slot, std_per_slot


def fairness_metrics(Z: np.ndarray, soldiers: Sequence[Soldier]) -> Dict[str, float]:
    """
    Aggregate fairness numbers for reporting / band sweeps.

    Primary spread metric: std of all entries in the combined location+time share matrix ``Z``
    (same basis as heatmap captions). Secondary: std of total **raw** guard hours across soldiers.
    ``fairness_score`` = std_all + 0.25 * std_raw (lower is better; weights are heuristic).
    """
    std_all, min_std_slot, _ = heatmap_std_summary(Z)
    raw = np.array([s.total_raw_guard_hours() for s in soldiers], dtype=np.float64)
    n = len(raw)
    std_raw = float(np.std(raw, ddof=1)) if n > 1 else 0.0
    spread = float(raw.max() - raw.min()) if n else 0.0
    fairness_score = std_all + 0.25 * std_raw
    return {
        "std_all_z": std_all,
        "min_std_slot_z": min_std_slot,
        "std_raw_hours": std_raw,
        "raw_hours_spread": spread,
        "fairness_score": fairness_score,
    }


def run_simulation_best_of(
    *,
    trials: int,
    base_seed: Optional[int],
    num_soldiers: int,
    slots_per_block: int,
    days: int,
    zone: ZoneConfig,
    block_hours: float,
    min_consecutive_free_hours: float = MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
    balance_total_hours: bool = True,
    total_hours_slack: float = 0.0,
    max_consecutive_duty_blocks: int = MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
    min_free_shifts_after_duty: int = 0,
    band_relative: float = BAND_RELATIVE_DEFAULT,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    availability: Any = None,
    anchor: Optional[datetime] = None,
    type_codes: Optional[Sequence[str]] = None,
) -> Tuple[
    Tuple[
        List[Soldier],
        np.ndarray,
        np.ndarray,
        List[AssignmentRecord],
        np.ndarray,
        np.ndarray,
        np.ndarray,
        np.ndarray,
        SimulationStats,
    ],
    Dict[str, Any],
]:
    """
    Pick the trial with lowest ``fairness_score``.

    - ``trials == 1``: one ``run_simulation`` (``Random()`` if no seed, else ``Random(seed)``).
    - ``trials > 1``: score ``trials`` runs with seeds ``S, S+1, …``; remember only the winning
      seed, then **one** final ``run_simulation(Random(winning_seed))`` to build the returned
      schedule (same outcome as that trial if the builder is deterministic from the RNG).
    """
    if trials < 1:
        raise ValueError("trials must be >= 1")
    if trials > 1 and base_seed is None:
        raise ValueError("trials > 1 requires an explicit integer base_seed (--seed)")

    kw = dict(
        num_soldiers=num_soldiers,
        slots_per_block=slots_per_block,
        days=days,
        zone=zone,
        block_hours=block_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        balance_total_hours=balance_total_hours,
        total_hours_slack=total_hours_slack,
        max_consecutive_duty_blocks=max_consecutive_duty_blocks,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=band_relative,
        plan_day_start_hour=plan_day_start_hour,
        availability=availability,
        anchor=anchor,
        type_codes=type_codes,
    )

    if trials == 1:
        if base_seed is None:
            rng_t = random.Random()
            seed_used: Optional[int] = None
        else:
            seed_used = int(base_seed)
            rng_t = random.Random(seed_used)
        pack = run_simulation(**kw, rng=rng_t)
        fm = fairness_metrics(pack[1], pack[0])
        meta: Dict[str, Any] = {
            "trials_run": 1,
            "trial_index": 0,
            "trial_seed": seed_used,
            "final_rng_state": rng_t.getstate(),
            "fairness": fm,
        }
        return pack, meta

    best_score = float("inf")
    best_trial = 0
    best_seed_used = int(base_seed)

    for t in range(trials):
        seed_t = int(base_seed) + t
        rng_t = random.Random(seed_t)
        pack_t = run_simulation(**kw, rng=rng_t)
        fm = fairness_metrics(pack_t[1], pack_t[0])
        score = float(fm["fairness_score"])
        if score < best_score:
            best_score = score
            best_trial = t
            best_seed_used = seed_t

    pack = run_simulation(**kw, rng=random.Random(best_seed_used))
    fm = fairness_metrics(pack[1], pack[0])
    meta = {
        "trials_run": trials,
        "trial_index": best_trial,
        "trial_seed": best_seed_used,
        "fairness": fm,
    }
    return pack, meta


def _figure_to_png_bytes(fig: "plt.Figure") -> bytes:
    plt, _, _ = _get_matplotlib()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _png_data_uri(png_bytes: bytes) -> str:
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def export_html_to_pdf(html_path: Path, pdf_path: Path) -> None:
    """
    Render ``html_path`` to PDF using WeasyPrint (optional dependency).

    Charts in the report use data-URI images, so no extra asset paths are required.
    """
    try:
        from weasyprint import HTML
    except ImportError as e:  # pragma: no cover
        raise SystemExit(
            "PDF export needs WeasyPrint: pip install weasyprint\n"
            "On macOS you may need: brew install pango cairo gdk-pixbuf libffi"
        ) from e

    html_path = html_path.resolve()
    pdf_path = pdf_path.resolve()
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    HTML(filename=str(html_path), base_url=str(html_path.parent)).write_pdf(str(pdf_path))
    print(f"Wrote PDF report: {pdf_path}")


def build_heatmap_figure(
    Z: np.ndarray,
    title: str,
    column_labels: Optional[List[str]] = None,
    subtitle: str = "",
    xlabel: str = (
        "Locations & time: each row sums to 100% (share of that soldier’s raw guard hours)"
    ),
) -> Tuple["plt.Figure", str, str]:
    plt, Normalize, _Patch = _get_matplotlib()
    std_all, min_std_slot, std_per_slot = heatmap_std_summary(Z)
    ncols = Z.shape[1]
    if column_labels is None or len(column_labels) != ncols:
        column_labels = [f"z{i}" for i in range(ncols)]

    per_slot_str = ", ".join(f"{column_labels[j].split(chr(10))[0]}={std_per_slot[j]:.4f}" for j in range(ncols))

    fig, ax = plt.subplots(figsize=(12, max(4, 0.35 * Z.shape[0] + 3.2)))

    line1 = (
        f"std all values (sample, ddof=1, n={Z.size}) = {std_all:.4f}   |   "
        f"min std across slots (columns) = {min_std_slot:.4f}"
    )
    line2 = f"std per slot (across soldiers): {per_slot_str}"
    fig.text(0.5, 0.97, line1, ha="center", va="top", fontsize=9)
    fig.text(0.5, 0.935, line2, ha="center", va="top", fontsize=8, color="0.25")
    if subtitle:
        fig.text(0.5, 0.895, subtitle, ha="center", va="top", fontsize=8, color="0.35")

    norm = Normalize(vmin=float(np.min(Z)), vmax=float(np.max(Z)) if np.max(Z) > 0 else 1.0)
    im = ax.imshow(Z, aspect="auto", cmap="magma", norm=norm)

    ax.set_xticks(range(ncols))
    ax.set_xticklabels(column_labels, rotation=0, fontsize=8)
    ax.set_yticks(range(Z.shape[0]))
    ax.set_yticklabels([f"S{i}" for i in range(Z.shape[0])])
    ax.set_xlabel(xlabel)
    ax.set_ylabel("Soldier")
    ax.set_title(title, pad=12)

    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Fraction (0–1)")

    mid = (norm.vmax + norm.vmin) / 2
    for i in range(Z.shape[0]):
        for j in range(ncols):
            ax.text(
                j,
                i,
                f"{100.0 * Z[i, j]:.1f}%",
                ha="center",
                va="center",
                color="white" if Z[i, j] > mid else "black",
                fontsize=7,
            )

    fig.tight_layout(rect=[0, 0, 1, 0.84])
    return fig, line1, line2


def build_avg_zone_lines_figure(
    avg_daily_hours: np.ndarray,
    zone_labels: List[str],
    title: str,
    ylabel: str,
) -> Tuple["plt.Figure", str, str]:
    """Line chart: one series per zone, X = soldiers, Y = mean raw hours per calendar day in that zone."""
    plt, _, _ = _get_matplotlib()
    n_s, n_z = avg_daily_hours.shape
    fig, ax = plt.subplots(figsize=(max(8.0, 0.45 * n_s + 3), 5.2))
    x = np.arange(n_s, dtype=np.float64)
    cmap = plt.get_cmap("tab10")
    for zi in range(n_z):
        short = zone_labels[zi].split("\n")[0] if zi < len(zone_labels) else f"z{zi}"
        ax.plot(
            x,
            avg_daily_hours[:, zi],
            marker="o",
            markersize=4,
            label=short,
            color=cmap(zi % 10),
        )
    ax.set_xticks(x)
    ax.set_xticklabels([f"S{i}" for i in range(n_s)])
    ax.set_xlabel("Soldier")
    ax.set_ylabel(ylabel)
    ax.set_title(title, fontsize=10)
    ax.legend(loc="best", fontsize=8, ncol=min(3, max(1, n_z)))
    ax.grid(axis="both", alpha=0.3)
    fig.tight_layout()
    if n_s > 1:
        std_per = np.std(avg_daily_hours, axis=0, ddof=1)
        parts = [
            f"{zone_labels[j].split(chr(10))[0] if j < len(zone_labels) else f'z{j}'}={std_per[j]:.3f}"
            for j in range(n_z)
        ]
        line1 = "Std (across soldiers) of mean daily raw hours per zone: " + ", ".join(parts)
    else:
        line1 = "Single soldier: std across soldiers N/A."
    line2 = ylabel
    return fig, line1, line2


def build_max_free_figure(
    max_free: np.ndarray,
    title: str,
    block_hours: float,
    num_blocks: int = 6,
) -> "plt.Figure":
    plt, _, _ = _get_matplotlib()
    days, n_s = max_free.shape
    fig, ax = plt.subplots(figsize=(max(10.0, days * 0.42), 6.5))
    xbase = np.arange(days, dtype=np.float64)
    width = 0.8 / max(n_s, 1)
    cmap = plt.get_cmap("tab20")
    for s in range(n_s):
        offset = (s - (n_s - 1) / 2.0) * width
        ax.bar(
            xbase + offset,
            max_free[:, s],
            width=width * 0.92,
            label=f"S{s}",
            color=cmap(s % 20),
        )

    full_day_free = num_blocks * block_hours
    ax.axhline(full_day_free, color="0.55", ls=":", lw=1.2)
    ax.text(
        days - 0.5,
        full_day_free * 1.02,
        f"No guard all day ({full_day_free:g} h)",
        ha="right",
        va="bottom",
        fontsize=8,
        color="0.35",
    )

    ax.set_xlabel("Day")
    ax.set_ylabel("Max consecutive free time (hours)")
    ax.set_title(f"Per day, per soldier: longest contiguous off-duty span\n{title}")
    ax.set_xticks(xbase)
    ax.set_xticklabels([str(i + 1) for i in range(days)])
    ax.set_ylim(0, max(float(np.max(max_free)) * 1.12, full_day_free * 1.08))
    ax.grid(axis="y", alpha=0.35)
    ax.legend(
        title="Soldier",
        ncol=min(6, max(1, n_s)),
        fontsize=8,
        title_fontsize=9,
        loc="upper right",
    )

    fig.tight_layout()
    return fig


def build_mean_free_bar_figure(
    mean_free: np.ndarray,
    min_free: np.ndarray,
    max_free: np.ndarray,
    title: str,
) -> "plt.Figure":
    plt, _, _ = _get_matplotlib()
    n = mean_free.shape[0]
    if min_free.shape != (n,) or max_free.shape != (n,):
        raise ValueError("min_free and max_free must match mean_free length")
    fig, ax = plt.subplots(figsize=(9.5, max(3.5, 0.35 * n + 1.5)))
    y = np.arange(n)
    xerr = np.vstack([mean_free - min_free, max_free - mean_free])
    ax.barh(
        y,
        mean_free,
        xerr=xerr,
        color="steelblue",
        height=0.6,
        capsize=2.5,
        error_kw={"linewidth": 1.1, "ecolor": "0.25"},
    )
    ax.set_yticks(y)
    ax.set_yticklabels([f"S{i}" for i in range(n)])
    ax.set_xlabel("Max consecutive free (h): bar = mean/day; whiskers = min–max across days")
    ax.set_title(title)
    ax.grid(axis="x", alpha=0.35)
    xmax = float(np.max(max_free) * 1.08) if n else 1.0
    ax.set_xlim(0, max(xmax, float(np.max(mean_free) * 1.05), 1e-6))
    for i in range(n):
        ax.text(
            max_free[i] + 0.02 * (ax.get_xlim()[1] or 1),
            i,
            f"{mean_free[i]:.1f} ({min_free[i]:.1f}–{max_free[i]:.1f})",
            va="center",
            fontsize=7.5,
            color="0.2",
        )
    fig.tight_layout()
    return fig


def build_soldier_timeline_figure(
    busy: np.ndarray,
    block_hours: float,
    title: str,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
    unavail: Optional[np.ndarray] = None,
) -> "plt.Figure":
    """
    One horizontal lane per soldier: red = **posted duty** in that block, green = off post and
    assignable, yellow = away/sick/training (not assignable). YAML ``rest_after`` padding is
    not shown as red here. X-axis is hours along the plan-day timeline (0 = plan day start).
    """
    plt, _, Patch = _get_matplotlib()

    days, n_s, blocks_pd = busy.shape
    total_h = days * 24.0
    fig_h = max(4.0, 0.38 * n_s + 2.2)
    fig, ax = plt.subplots(figsize=(min(24, max(12, days * 0.45)), fig_h))
    red, green, yellow = "#c62828", "#2e7d32", "#f9a825"
    for s in range(n_s):
        y_pos = n_s - 1 - s
        y0 = y_pos - 0.36
        h = 0.72
        red_segs: List[Tuple[float, float]] = []
        green_segs: List[Tuple[float, float]] = []
        yellow_segs: List[Tuple[float, float]] = []
        for d in range(days):
            for b in range(blocks_pd):
                x0 = d * 24.0 + b * block_hours
                if busy[d, s, b]:
                    red_segs.append((x0, block_hours))
                elif unavail is not None and unavail[d, s, b]:
                    yellow_segs.append((x0, block_hours))
                else:
                    green_segs.append((x0, block_hours))
        if green_segs:
            ax.broken_barh(green_segs, (y0, h), facecolors=green, edgecolors="white", linewidth=0.3)
        if yellow_segs:
            ax.broken_barh(yellow_segs, (y0, h), facecolors=yellow, edgecolors="white", linewidth=0.3)
        if red_segs:
            ax.broken_barh(red_segs, (y0, h), facecolors=red, edgecolors="white", linewidth=0.3)

    ax.set_yticks(range(n_s))
    ax.set_yticklabels([f"S{i}" for i in range(n_s - 1, -1, -1)])
    ax.set_xlim(0, total_h)
    ax.set_ylim(-0.55, n_s - 0.45)
    ps = int(plan_day_start_hour) % 24
    ax.set_xlabel(f"Plan-day timeline (h=0 at {ps:02d}:00 wall clock)")
    ax.set_title(
        f"Per-soldier schedule (green = off post, yellow = away/sick, red = posted duty)\n{title}",
        fontsize=10,
    )
    ax.grid(axis="x", alpha=0.25, linestyle=":")
    legend_el = [
        Patch(facecolor=green, edgecolor="white", label="Off post"),
        Patch(facecolor=red, edgecolor="white", label="Posted duty"),
    ]
    if unavail is not None:
        legend_el.insert(1, Patch(facecolor=yellow, edgecolor="white", label="Away / sick"))
    ax.legend(handles=legend_el, loc="upper right", fontsize=8)
    step = 4
    for off in range(0, int(total_h) + 1, step):
        ax.text(
            off,
            n_s - 0.08,
            f"{(ps + off) % 24:02d}:00",
            fontsize=6,
            ha="center",
            va="top",
            color="0.35",
        )
    for d in range(1, days):
        ax.axvline(d * 24.0, color="0.55", lw=0.8, ls="--", alpha=0.6)
    fig.tight_layout()
    return fig


def build_day_schedule_matrix_html(
    assignments: Sequence[AssignmentRecord],
    days: int,
    blocks_pd: int,
    slots_per_block: int,
    block_hours: float,
    zone: ZoneConfig,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
) -> str:
    """Per day: rows = time shift, columns = Slot 1..y, cell = soldier id (rowspan for full_day / windowed)."""
    lookup_rot: Dict[Tuple[int, int, int], str] = {}
    merged: Dict[Tuple[int, int], Tuple[str, int, int]] = {}
    for a in assignments:
        k = getattr(a, "kind", "rotating") or "rotating"
        if k == "rotating":
            lookup_rot[(a.day, a.calendar_block, a.slot)] = f"S{a.soldier_idx}"
        elif k in ("full_day", "windowed"):
            merged[(a.day, a.slot)] = (
                f"S{a.soldier_idx}",
                int(a.rowspan),
                int(a.calendar_block),
            )

    def esc(x: object) -> str:
        return html_module.escape(str(x))

    sections: List[str] = []
    for d in range(days):
        skip = [0] * slots_per_block
        heads: List[str] = []
        for j in range(slots_per_block):
            li = zone.slot_location_indices[j]
            if j < len(zone.slot_display_names) and zone.slot_display_names[j]:
                slot_lab = zone.slot_display_names[j]
            else:
                slot_lab = zone.loc_names[li]
            heads.append(
                f"<th>Slot {j + 1}<br/><small>{esc(slot_lab)} ({esc(zone.loc_ids[li])})</small></th>"
            )
        heads_s = "".join(heads)
        rows: List[str] = []
        plan_start = int(plan_day_start_hour)
        for b in range(blocks_pd):
            sh = block_start_hour(plan_start, b, block_hours)
            win = format_block_window(sh, block_hours)
            tds: List[str] = []
            for j in range(slots_per_block):
                if skip[j] > 0:
                    skip[j] -= 1
                    continue
                if (d, j) in merged:
                    lab, rs, sb = merged[(d, j)]
                    if b == sb:
                        tds.append(f'<td rowspan="{rs}">{esc(lab)}</td>')
                        skip[j] = rs - 1
                    else:
                        tds.append("<td>—</td>")
                else:
                    tds.append(f"<td>{esc(lookup_rot.get((d, b, j), '—'))}</td>")
            rows.append(f"<tr><th>{esc(win)}</th>{''.join(tds)}</tr>")
        sections.append(
            f"<h3 id='matrix-day-{d + 1}'>Day {d + 1} — schedule matrix (time × slot)</h3>\n"
            "<div class='scroll'><table>\n"
            f"<thead><tr><th>Time shift</th>{heads_s}</tr></thead>\n"
            f"<tbody>{''.join(rows)}</tbody></table></div>\n"
        )
    return "\n".join(sections)


def write_html_report(
    path: str,
    title: str,
    heatmap_loc_png: bytes,
    heatmap_time_png: bytes,
    avg_heatmap_loc_png: bytes,
    avg_heatmap_time_png: bytes,
    zone_lines_loc_png: bytes,
    zone_lines_time_png: bytes,
    avg_zone_lines_loc_png: bytes,
    avg_zone_lines_time_png: bytes,
    bars_png: bytes,
    mean_free_bars_png: bytes,
    soldier_timeline_png: bytes,
    zone: ZoneConfig,
    zones_path: str,
    soldiers: List[Soldier],
    Z_avg: np.ndarray,
    max_free: np.ndarray,
    min_free_per_soldier: np.ndarray,
    mean_free_per_soldier: np.ndarray,
    max_free_per_soldier: np.ndarray,
    assignments: List[AssignmentRecord],
    block_hours: float,
    calendar_blocks_per_day: int,
    days: int,
    slots_per_block: int,
    min_consecutive_free_hours: float,
    max_consecutive_duty_blocks: int,
    seed: Optional[int],
    line1_h_loc: str,
    line2_h_loc: str,
    line1_h_time: str,
    line2_h_time: str,
    line1_a_loc: str,
    line2_a_loc: str,
    line1_a_time: str,
    line2_a_time: str,
    line1_zl: str,
    line2_zl: str,
    line1_zt: str,
    line2_zt: str,
    line1_al: str,
    line2_al: str,
    line1_at: str,
    line2_at: str,
    sim_stats: SimulationStats,
    min_free_shifts_after_duty: int,
    zone_viz: str,
    plan_day_start_hour: int = DEFAULT_PLAN_DAY_START_HOUR,
) -> None:
    col_labels = zone.heatmap_column_labels()
    nl = zone.n_loc
    nt = zone.n_time
    loc_labels = col_labels[:nl]
    time_labels = col_labels[nl:]
    asn_per_day = expected_assignment_count(zone, 1, calendar_blocks_per_day, slots_per_block)
    show_lines = zone_viz in ("lines", "both")
    show_heat = zone_viz in ("heatmap", "both")

    def esc(x: object) -> str:
        return html_module.escape(str(x))

    # Zone config table
    zcfg_rows = []
    for i in range(nl):
        zcfg_rows.append(
            f"<tr><td>location</td><td>{esc(zone.loc_ids[i])}</td>"
            f"<td>{esc(zone.loc_names[i])}</td><td>{zone.loc_weights[i]:.4f}</td></tr>"
        )
    for si in range(len(zone.slot_location_indices)):
        li = zone.slot_location_indices[si]
        pat_s = ""
        if zone.slot_patterns and si < len(zone.slot_patterns):
            pat_s = f" [{zone.slot_patterns[si]}]"
        zcfg_rows.append(
            f"<tr><td>slot {si + 1}</td><td colspan='2'>{esc(zone.loc_ids[li])} — {esc(zone.loc_names[li])}{esc(pat_s)}</td>"
            f"<td>—</td></tr>"
        )
    for j in range(nt):
        hr = f"{zone.time_hour_from[j]}–{zone.time_hour_to[j]} h"
        zcfg_rows.append(
            f"<tr><td>time category</td><td>{esc(zone.time_ids[j])}</td>"
            f"<td>{esc(zone.time_names[j])} ({esc(hr)})</td><td>{zone.time_weights[j]:.4f}</td></tr>"
        )

    # Per-day schedule tables
    by_day: Dict[int, List[AssignmentRecord]] = defaultdict(list)
    for a in assignments:
        by_day[a.day].append(a)
    day_sections: List[str] = []
    for d in range(days):
        rows = sorted(by_day.get(d, []), key=lambda x: (x.calendar_block, x.slot))
        trs = []
        for a in rows:
            win = format_block_window(a.start_hour, block_hours)
            trs.append(
                "<tr>"
                f"<td>{d + 1}</td>"
                f"<td>{a.calendar_block + 1}</td>"
                f"<td>{esc(win)}</td>"
                f"<td>{esc(zone.time_names[a.time_j])}</td>"
                f"<td>{esc(zone.loc_names[a.loc_i])}</td>"
                f"<td>{a.slot + 1}</td>"
                f"<td>S{a.soldier_idx}</td>"
                f"<td>{a.raw_hours:.2f}</td>"
                f"<td>{a.weight:.4f}</td>"
                "</tr>"
            )
        ncol = 9
        body = "".join(trs) if trs else f"<tr><td colspan='{ncol}'>No assignments</td></tr>"
        day_sections.append(
            f"<h3 id='day-{d+1}'>Day {d + 1}</h3>\n<div class='scroll'><table>\n"
            "<thead><tr><th>Day</th><th>Block #</th><th>Local window</th><th>Time category</th>"
            "<th>Location</th><th>Slot</th><th>Soldier</th><th>Hours (raw)</th><th>Weight</th></tr></thead>\n"
            f"<tbody>{body}</tbody></table></div>\n"
        )
    all_day_html = "\n".join(day_sections)

    duty_lookup: Dict[Tuple[int, int, int], AssignmentRecord] = {}
    for a in assignments:
        for bb in assignment_occupied_blocks(a, calendar_blocks_per_day):
            duty_lookup[(a.soldier_idx, a.day, bb)] = a

    soldier_sections: List[str] = []
    num_soldiers_list = len(soldiers)
    n_blocks_total = calendar_blocks_per_day * days
    for sidx in range(num_soldiers_list):
        trs_s: List[str] = []
        plan_start = int(plan_day_start_hour)
        for d in range(days):
            for b in range(calendar_blocks_per_day):
                start_h = block_start_hour(plan_start, b, block_hours)
                time_j = time_category_for_hour(start_h, zone)
                win = format_block_window(start_h, block_hours)
                key = (sidx, d, b)
                if key in duty_lookup:
                    a = duty_lookup[key]
                    trs_s.append(
                        "<tr>"
                        f"<td>{d + 1}</td>"
                        f"<td>{b + 1}</td>"
                        f"<td>{esc(win)}</td>"
                        f"<td>{esc(zone.time_names[a.time_j])}</td>"
                        f"<td>{esc(zone.loc_names[a.loc_i])}</td>"
                        f"<td>{a.slot + 1}</td>"
                        f"<td>{a.raw_hours:.2f}</td>"
                        f"<td>{a.weight:.4f}</td>"
                        "</tr>"
                    )
                else:
                    trs_s.append(
                        "<tr class='duty-free'>"
                        f"<td>{d + 1}</td>"
                        f"<td>{b + 1}</td>"
                        f"<td>{esc(win)}</td>"
                        f"<td>{esc(zone.time_names[time_j])}</td>"
                        f"<td>FREE</td>"
                        f"<td>—</td>"
                        f"<td>{block_hours:.2f}</td>"
                        f"<td>—</td>"
                        "</tr>"
                    )
        ncol_s = 8
        body_s = "".join(trs_s) if trs_s else f"<tr><td colspan='{ncol_s}'>No rows</td></tr>"
        soldier_sections.append(
            f"<h3 id='soldier-{sidx}'>Soldier S{sidx}</h3>\n<div class='scroll'><table>\n"
            "<thead><tr><th>Day</th><th>Block #</th><th>Local window</th><th>Time category</th>"
            "<th>Location</th><th>Slot</th><th>Hours</th><th>Weight</th></tr></thead>\n"
            f"<tbody>{body_s}</tbody></table></div>\n"
        )
    all_soldier_html = "\n".join(soldier_sections)

    def zone_table_html(Zm: np.ndarray, labels: List[str]) -> str:
        z_rows = []
        for i in range(Zm.shape[0]):
            cells = "".join(f"<td>{100.0 * Zm[i, j]:.2f}%</td>" for j in range(Zm.shape[1]))
            z_rows.append(f"<tr><th>{esc(f'S{i}')}</th>{cells}</tr>")
        zh = "".join(f"<th>{esc(c.split(chr(10))[0])}</th>" for c in labels)
        return (
            f"<table><thead><tr><th>Soldier</th>{zh}</tr></thead>"
            f"<tbody>{''.join(z_rows)}</tbody></table>"
        )

    span_t = time_band_clock_spans_hours(zone)
    span_cells = ", ".join(
        f"{zone.time_ids[j]}={span_t[j]:.0f}h" for j in range(nt)
    )

    sum_rows = []
    for s in soldiers:
        den = max(s.available_hours, 1e-9)
        gscore = s.w_global / den
        raw_tot = s.total_raw_guard_hours()
        rl = ", ".join(f"{s.raw_loc[k]:.1f}" for k in range(nl))
        tot_t = float(np.sum(s.raw_time))
        if tot_t > 1e-12:
            rt = ", ".join(f"{100.0 * float(s.raw_time[k]) / tot_t:.2f}%" for k in range(nt))
        else:
            rt = ", ".join("—" for _ in range(nt))
        mn_f = min_free_per_soldier[s.idx]
        mf = mean_free_per_soldier[s.idx]
        mx_f = max_free_per_soldier[s.idx]
        sum_rows.append(
            "<tr>"
            f"<td>{esc(f'S{s.idx}')}</td>"
            f"<td>{raw_tot:.2f}</td>"
            f"<td>{gscore:.4f}</td>"
            f"<td>{esc(rl)}</td>"
            f"<td>{esc(rt)}</td>"
            f"<td>{mn_f:.2f}</td>"
            f"<td>{mf:.2f}</td>"
            f"<td>{mx_f:.2f}</td>"
            "</tr>"
        )

    mf_header = "".join(f"<th>{esc(f'S{j}')}</th>" for j in range(max_free.shape[1]))
    mf_rows = []
    for d in range(max_free.shape[0]):
        cells = "".join(f"<td>{max_free[d, j]:.2f}</td>" for j in range(max_free.shape[1]))
        mf_rows.append(f"<tr><th>{d + 1}</th>{cells}</tr>")

    avg_tbl_loc = zone_table_html(Z_avg[:, :nl], loc_labels)
    avg_tbl_time = zone_table_html(Z_avg[:, nl:], time_labels)
    seed_s = esc(seed) if seed is not None else "—"

    matrix_html = build_day_schedule_matrix_html(
        assignments,
        days,
        calendar_blocks_per_day,
        slots_per_block,
        block_hours,
        zone,
        plan_day_start_hour=plan_day_start_hour,
    )
    matrix_toc = " ".join(
        f"<a href='#matrix-day-{d + 1}'>Day {d + 1} matrix</a>" for d in range(days)
    )
    matrix_block = (
        "<h2>Schedule matrix by day (time × slot)</h2>\n"
        "<p>Rows: calendar shift. Columns: slot number with YAML location in the header. Cell: soldier on duty.</p>\n"
        f"<p class=\"toc\">{matrix_toc}</p>\n"
        f"{matrix_html}"
    )

    def zone_dual_section(
        title: str,
        para: str,
        show_l: bool,
        show_h: bool,
        l1l: str,
        l2l: str,
        png_l: bytes,
        l1h: str,
        l2h: str,
        png_h: bytes,
    ) -> str:
        parts = [f"<h2>{esc(title)}</h2>", f"<p>{esc(para)}</p>"]
        if show_l:
            parts.append(f'<ul class="stats"><li>{esc(l1l)}</li><li>{esc(l2l)}</li></ul>')
            parts.append(f'<p><img src="{_png_data_uri(png_l)}" alt="lines" /></p>')
        if show_h:
            parts.append(f'<ul class="stats"><li>{esc(l1h)}</li><li>{esc(l2h)}</li></ul>')
            parts.append(f'<p><img src="{_png_data_uri(png_h)}" alt="heatmap" /></p>')
        return "\n  ".join(parts)

    full_loc_html = zone_dual_section(
        "Full period — locations",
        "Line chart: mean raw guard hours per calendar day in each post. Heatmap (optional): each row sums to 100% across posts.",
        show_lines,
        show_heat,
        line1_zl,
        line2_zl,
        zone_lines_loc_png,
        line1_h_loc,
        line2_h_loc,
        heatmap_loc_png,
    )
    full_time_html = zone_dual_section(
        "Full period — time bands",
        "Line chart: mean raw hours per day in each YAML time category. Heatmap (optional): each row = % of soldier’s raw hours in Night/Morning/Day.",
        show_lines,
        show_heat,
        line1_zt,
        line2_zt,
        zone_lines_time_png,
        line1_h_time,
        line2_h_time,
        heatmap_time_png,
    )
    avg_loc_html = zone_dual_section(
        "Average daily — locations (mean over days with duty)",
        "Line chart: same metric averaged only on days the soldier had a shift. Heatmap: mean of daily location shares.",
        show_lines,
        show_heat,
        line1_al,
        line2_al,
        avg_zone_lines_loc_png,
        line1_a_loc,
        line2_a_loc,
        avg_heatmap_loc_png,
    )
    avg_time_html = zone_dual_section(
        "Average daily — time bands (mean over days with duty)",
        "Line chart: mean raw hours per day in each band on duty days. Heatmap: mean of daily time-band fractions.",
        show_lines,
        show_heat,
        line1_at,
        line2_at,
        avg_zone_lines_time_png,
        line1_a_time,
        line2_a_time,
        avg_heatmap_time_png,
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{esc(title)}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 1.5rem; max-width: 1280px; color: #1a1a1a; }}
    h1 {{ font-size: 1.25rem; }}
    h2 {{ font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }}
    h3 {{ font-size: 0.95rem; margin-top: 1.25rem; }}
    table {{ border-collapse: collapse; margin: 0.75rem 0; font-size: 0.85rem; }}
    th, td {{ border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: right; }}
    th:first-child, td:first-child {{ text-align: left; }}
    thead th {{ background: #f4f4f4; }}
    .scroll {{ overflow-x: auto; }}
    .stats {{ background: #f9f9f9; padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.9rem; }}
    .stats li {{ margin: 0.25rem 0; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; }}
    .param td:first-child {{ font-weight: 600; width: 14rem; }}
    nav.toc a {{ margin-right: 0.75rem; font-size: 0.85rem; }}
    tr.duty-free td:nth-child(5) {{ font-weight: 600; color: #1b5e20; }}
  </style>
</head>
<body>
  <h1>Guard scheduler simulation report</h1>
  <p>{esc(title)}</p>

  <h2>Run parameters</h2>
  <table class="param">
    <tr><td>Zones YAML</td><td>{esc(zones_path)}</td></tr>
    <tr><td>Days</td><td>{days}</td></tr>
    <tr><td>Soldiers</td><td>{len(soldiers)}</td></tr>
    <tr><td>Concurrent slots / calendar block (-y)</td><td>{slots_per_block}</td></tr>
    <tr><td>Zones schema_version</td><td>{zone.schema_version}</td></tr>
    <tr><td>Shift hours (calendar block length)</td><td>{block_hours}</td></tr>
    <tr><td>Calendar blocks / day (24 ÷ block hours)</td><td>{calendar_blocks_per_day}</td></tr>
    <tr><td>Assignments / day</td><td>{asn_per_day}</td></tr>
    <tr><td>Min consecutive free (per soldier / day)</td><td>{min_consecutive_free_hours:g} h</td></tr>
    <tr><td>Max consecutive duty blocks</td><td>{esc(max_consecutive_duty_blocks)} (0 = no cap)</td></tr>
    <tr><td>Min free shifts after duty</td><td>{min_free_shifts_after_duty} (rotating slots only: free calendar blocks between rotating duties; 0 = off)</td></tr>
    <tr><td>Zone charts (--zone-viz)</td><td>{esc(zone_viz)}</td></tr>
    <tr><td>Shift-cooldown: rotating slot fills checked</td><td>{sim_stats.shift_cooldown_pool_iterations}</td></tr>
    <tr><td>Shift-cooldown: exclusions from rotating pool</td><td>{sim_stats.shift_cooldown_exclusions}</td></tr>
    <tr><td>Shift-cooldown: post-build violations (rotating)</td><td>{sim_stats.shift_cooldown_violations_post}</td></tr>
    <tr><td>RNG seed</td><td>{seed_s}</td></tr>
  </table>

  <h2>Zones (from YAML)</h2>
  <div class="scroll">
  <table>
    <thead><tr><th>Kind</th><th>Id</th><th>Name</th><th>Weight</th></tr></thead>
    <tbody>{''.join(zcfg_rows)}</tbody>
  </table>
  </div>

  <h2>Schedule by day</h2>
  <p>Each row is one guard shift. There are <strong>{calendar_blocks_per_day}</strong> blocks per day
  (24 ÷ {block_hours:g} h). This run has <strong>{asn_per_day}</strong> assignment rows per day
  (rotating, full_day, and windowed slot patterns).</p>
  <p class="toc">Jump:
  {' '.join(f"<a href='#day-{d+1}'>Day {d+1}</a>" for d in range(days))}
  </p>
  {all_day_html}

  {matrix_block}

  <h2>Schedule by soldier</h2>
  <p>Each block of each day for that soldier: post name when <strong>serving</strong>, or <strong>FREE</strong> when off duty.
  <strong>{n_blocks_total}</strong> rows per soldier ({calendar_blocks_per_day} blocks/day × {days} days).</p>
  <p class="toc">Jump:
  {' '.join(f"<a href='#soldier-{s}'>S{s}</a>" for s in range(num_soldiers_list))}
  </p>
  {all_soldier_html}

  <h2>Soldier timelines (full simulation)</h2>
  <p><strong>Green</strong> = free, <strong>red</strong> = on duty. X-axis is hours from the start of day 1; dashed lines are midnight between simulation days.</p>
  <p><img src="{_png_data_uri(soldier_timeline_png)}" alt="Per-soldier duty timeline" /></p>

  {full_loc_html}

  {full_time_html}

  <h2>Max consecutive free time (per day)</h2>
  <p><img src="{_png_data_uri(bars_png)}" alt="Free time bars" /></p>

  <h2>Soldier summary + consecutive free time</h2>
  <p><strong>Max consecutive free</strong> columns: min / mean / max over simulation days (hours per day).</p>
  <p><strong>Time bands column:</strong> percent of that soldier’s <strong>total raw guard hours</strong>
  in Night / Morning / Day (sums to 100%). YAML spans (for reference): {esc(span_cells)}.</p>
  <div class="scroll">
  <table>
    <thead>
      <tr>
        <th>Soldier</th>
        <th>Total raw guard h</th>
        <th>Global score (weighted)</th>
        <th>Raw h by loc</th>
        <th>Time bands (% of soldier raw hours)</th>
        <th>Min max free (h/day)</th>
        <th>Mean max free (h/day)</th>
        <th>Max max free (h/day)</th>
      </tr>
    </thead>
    <tbody>{''.join(sum_rows)}</tbody>
  </table>
  </div>

  <h2>Max consecutive free — numeric (day × soldier)</h2>
  <div class="scroll">
  <table>
    <thead><tr><th>Day</th>{mf_header}</tr></thead>
    <tbody>{''.join(mf_rows)}</tbody>
  </table>
  </div>

  {avg_loc_html}
  <div class="scroll">{avg_tbl_loc}</div>

  {avg_time_html}
  <div class="scroll">{avg_tbl_time}</div>

  <h2>Summary — max consecutive free per soldier (mean with min–max)</h2>
  <p>Horizontal bar = daily mean; whiskers = min and max across days. Text: <code>mean (min–max)</code> hours.</p>
  <p><img src="{_png_data_uri(mean_free_bars_png)}" alt="Mean min max free time per soldier" /></p>

  <p style="margin-top:2rem;font-size:0.8rem;color:#666;">Generated by guard_scheduler_sim.py</p>
</body>
</html>
"""
    Path(path).write_text(html, encoding="utf-8")
    print(f"Wrote HTML report: {path}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--scenario",
        type=str,
        default=None,
        metavar="PATH",
        help="Scenario YAML (testdata/scenarios/*.yaml): zones, days, seed, status rows",
    )
    p.add_argument(
        "--anchor-date",
        type=str,
        default=None,
        help="Plan anchor YYYY-MM-DD for scenario status (default: scenario sim.anchor_date or 2026-05-27)",
    )
    p.add_argument(
        "--check-expect",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="With --scenario, validate expect.* from the YAML (default: on)",
    )
    p.add_argument(
        "--availability-only",
        action="store_true",
        help="With --scenario, compile availability and exit (no schedule run)",
    )
    p.add_argument("-x", "--soldiers", type=int, default=None, help="Number of soldiers")
    p.add_argument(
        "-y",
        "--slots",
        type=int,
        default=None,
        metavar="Y",
        help=(
            "Concurrent slots per calendar block; must match the number of rows in zones YAML "
            "'slots' (or 'slot_locations'). Omit to use that count automatically when the list exists."
        ),
    )
    p.add_argument(
        "-d",
        "--days",
        type=int,
        default=None,
        required=False,
        help=(
            "Simulation days for a cold run. With --load-state, use --extend-days instead "
            "(or pass the same value here as the number of new days after replay)."
        ),
    )
    p.add_argument(
        "--zones",
        type=str,
        default="zones.yaml",
        help="YAML with locations and time_zones (default: zones.yaml)",
    )
    p.add_argument(
        "--roster",
        type=str,
        default=None,
        metavar="PATH",
        help="Roster YAML for soldier type_code[] (UI export or legacy nested shape).",
    )
    p.add_argument("--seed", type=int, default=None, help="RNG seed (optional)")
    p.add_argument(
        "-o",
        "--output",
        type=str,
        default="guard_sim_heatmap.png",
        help="Base path for location heatmap PNG; time heatmap uses *_time suffix",
    )
    p.add_argument("--bars-output", type=str, default=None, help="Bars PNG path")
    p.add_argument("--html-output", type=str, default="guard_sim_report.html", help="HTML report path")
    p.add_argument(
        "--json-output",
        type=str,
        default=None,
        metavar="PATH",
        help=(
            "Write per-day schedule matrix JSON (keys day0..day{n-1}, each with "
            "'matrix' [block][slot] → soldier index) for tooling / cross-language checks."
        ),
    )
    p.add_argument(
        "--pdf",
        action="store_true",
        help="Also export the HTML report as PDF (same path as --html-output with .pdf suffix)",
    )
    p.add_argument(
        "--pdf-output",
        type=str,
        default=None,
        metavar="PATH",
        help="Export HTML report to this PDF path (overrides --pdf destination if both set)",
    )
    p.add_argument("--no-png", action="store_true", help="Skip standalone PNG files")
    p.add_argument("--no-html", action="store_true", help="Skip HTML report")
    p.add_argument(
        "--shift-hours",
        type=float,
        default=None,
        metavar="H",
        help=(
            "Calendar block length in hours for this run (must be 2, 3, or 4). "
            "Overrides zones YAML ``shift_hours``. Omit to use the zones file value; legacy v1 "
            f"zones without ``shift_hours`` default to {BLOCK_HOURS_DEFAULT:g} h when upgrading."
        ),
    )
    p.add_argument(
        "--min-consecutive-free-hours",
        type=float,
        default=MIN_CONSECUTIVE_FREE_HOURS_DEFAULT,
        help=(
            "Each soldier must have at least this many consecutive off-duty hours every day "
            f"(default: {MIN_CONSECUTIVE_FREE_HOURS_DEFAULT:g}). "
            "All-rotating zones: if --min-free-shifts-after-duty×--shift-hours is already ≥ this "
            "value, the extra fixed sleep arc is skipped so one gap satisfies both (still verified "
            "after the build)."
        ),
    )
    p.add_argument(
        "--no-total-hours-balance",
        action="store_true",
        help="Disable total raw-hours balancing (revert to fairness band + random only)",
    )
    p.add_argument(
        "--total-hours-balance-slack",
        type=float,
        default=0.0,
        metavar="H",
        help=(
            "When balancing total raw hours, allow picking soldiers up to H hours above the "
            "pool minimum (default: 0 = strict minimum). Slightly looser preserves band diversity."
        ),
    )
    p.add_argument(
        "--max-consecutive-duty-blocks",
        type=int,
        default=MAX_CONSECUTIVE_DUTY_BLOCKS_DEFAULT,
        metavar="N",
        help=(
            "A soldier may work at most N calendar blocks in a row without a free block "
            "(default: 2 ⇒ no third consecutive duty block). Use 0 to disable."
        ),
    )
    p.add_argument(
        "--min-free-shifts-after-duty",
        type=int,
        default=0,
        metavar="X",
        help=(
            "Between **rotating** calendar blocks only: require X consecutive off blocks (on the "
            "rotating duty mask) before the same soldier can take another rotating shift, in linear "
            "simulation time. full_day and windowed_slots are unaffected. Example: X=2 with 3 h blocks. "
            "0 disables."
        ),
    )
    p.add_argument(
        "--zone-viz",
        type=str,
        choices=("lines", "heatmap", "both"),
        default="lines",
        help="HTML zone charts: line chart (mean raw h/day), heatmap, or both (default: lines)",
    )
    p.add_argument(
        "--plan-day-start",
        type=str,
        default=DEFAULT_PLAN_DAY_START,
        metavar="HH:MM",
        help=(
            "Wall-clock hour when each 24h plan day begins (whole hours only, default 05:00). "
            "Shifts the rotating block grid; full_day and windowed_slots keep YAML wall hours."
        ),
    )
    p.add_argument(
        "--band-relative",
        type=float,
        default=BAND_RELATIVE_DEFAULT,
        metavar="R",
        help=(
            "hybrid_rel slack: keep candidates with loc/time score ≤ best×(1+R). "
            f"Default {BAND_RELATIVE_DEFAULT}."
        ),
    )
    p.add_argument(
        "--sweep-band-relative",
        type=str,
        default=None,
        metavar="LIST",
        help=(
            "Comma-separated R values; runs one simulation per R with the same --seed, prints "
            "fairness metrics, picks best by fairness_score (= std_all(Z)+0.25*std_raw_hours), then exits "
            "(no PNG/HTML). With --sim-trials N, each R scores N seeds then replays the best (--seed required if N>1)."
        ),
    )
    p.add_argument(
        "--save-state",
        type=str,
        default=None,
        metavar="PATH",
        help="After simulation, write checkpoint JSON (run_meta + assignments + zones_yaml) to PATH.",
    )
    p.add_argument(
        "--load-state",
        type=str,
        default=None,
        metavar="PATH",
        help="Load checkpoint JSON; replay prefix then simulate --extend-days new days (greedy rotating only).",
    )
    p.add_argument(
        "--extend-days",
        type=int,
        default=None,
        metavar="N",
        help="With --load-state: number of new calendar days after replay (or omit and use -d).",
    )
    p.add_argument(
        "--replay-days",
        type=int,
        default=None,
        metavar="N",
        help="With --load-state: replay only the last N days from the file (reindexed to start at day 0).",
    )
    p.add_argument(
        "--sim-trials",
        type=int,
        default=1,
        metavar="N",
        help=(
            "Score N full simulations (RNG seeds S, S+1, … from --seed), keep the best fairness_score, "
            "then replay once with that winning seed for outputs. Default 1. Requires --seed when N>1. "
            "The winning seed alone reproduces the same schedule with --sim-trials 1 and the same flags."
        ),
    )
    args = p.parse_args()

    sim_anchor: Optional[datetime] = None
    if args.anchor_date:
        sim_anchor = datetime.strptime(args.anchor_date, "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )

    scenario_avail: Any = None
    scenario_doc: Any = None
    if args.scenario:
        from scenario_loader import (
            build_checker,
            check_expectations,
            compile_day_availability,
            load_scenario_file,
            parse_plan_day_start_hour,
            resolve_scenario_times,
            roster as scenario_roster,
        )

        sc_path = Path(args.scenario)
        scenario_doc = load_scenario_file(sc_path)
        anchor = scenario_doc.default_anchor()
        if args.anchor_date:
            anchor = datetime.strptime(args.anchor_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        sim_anchor = anchor
        if scenario_doc.status_only:
            scenario_doc.sim["plan_day_start"] = args.plan_day_start
        resolve_scenario_times(scenario_doc, anchor)
        if args.days is None:
            if scenario_doc.days > 0:
                args.days = scenario_doc.days
            elif scenario_doc.status_only:
                raise SystemExit(
                    "-d/--days is required with schema_version 2 status-only scenario"
                )
        elif scenario_doc.status_only:
            scenario_doc.sim["days"] = args.days
        if args.soldiers is None:
            args.soldiers = scenario_doc.infer_soldier_count(12)
        if args.slots is None and scenario_doc.slots_per_block > 0:
            args.slots = scenario_doc.slots_per_block
        if args.seed is None and scenario_doc.seed:
            args.seed = scenario_doc.seed
        if not scenario_doc.status_only and args.zones == "zones.yaml":
            args.zones = str(scenario_doc.resolve_zones_path(sc_path))
        if not scenario_doc.status_only and args.plan_day_start == DEFAULT_PLAN_DAY_START:
            if scenario_doc.plan_day_start:
                args.plan_day_start = scenario_doc.plan_day_start
        roster_ids = scenario_roster(args.soldiers)
        chk = build_checker(scenario_doc, roster_ids, num_days=args.days)
        if args.check_expect:
            check_expectations(scenario_doc, chk, assignments=None, roster_ids=roster_ids)
        if len(scenario_doc.resolved) > 0:
            scenario_avail = chk
        print(
            f"Scenario: {scenario_doc.name}  anchor={scenario_doc.anchor.date()}  "
            f"status_rows={len(scenario_doc.resolved)}",
            file=sys.stderr,
        )
        if args.availability_only:
            import json

            out: Dict[str, Any] = {}
            ps = parse_plan_day_start_hour(scenario_doc.plan_day_start)
            n_scenario_days = args.days if args.days is not None else max(1, scenario_doc.days)
            for d in range(n_scenario_days):
                cal = (scenario_doc.anchor + timedelta(days=d)).strftime("%Y-%m-%d")
                day = compile_day_availability(
                    scenario_doc.anchor, d, ps, roster_ids, scenario_doc.resolved
                )
                out[cal] = {
                    "avail_full": day.avail_full,
                    "avail_partial": day.avail_partial,
                    "avail_absent": day.avail_absent,
                    "summary": {
                        "full": day.full,
                        "absent_full": day.absent_full,
                        "absent_partial": day.absent_partial,
                    },
                }
            print(json.dumps(out, indent=2))
            raise SystemExit(0)

    if args.soldiers is None:
        raise SystemExit("-x/--soldiers is required unless using --scenario")

    if args.load_state:
        if args.sweep_band_relative is not None:
            raise SystemExit("--load-state cannot be combined with --sweep-band-relative")
        if args.sim_trials > 1:
            raise SystemExit("--load-state requires --sim-trials 1")
        ext_ck = args.extend_days if args.extend_days is not None else args.days
        if ext_ck is None or ext_ck < 1:
            raise SystemExit(
                "--load-state requires --extend-days N (>=1) or -d N for how many new days to simulate"
            )
        if args.extend_days is not None and args.days is not None and args.extend_days != args.days:
            raise SystemExit(
                "--load-state: use only one of --extend-days and -d (they differ; pick one extension length)"
            )
    else:
        if args.days is None:
            raise SystemExit("-d/--days is required unless using --load-state")

    if args.sim_trials < 1:
        raise SystemExit("--sim-trials must be >= 1")
    if args.sim_trials > 1 and args.seed is None:
        raise SystemExit("--sim-trials > 1 requires an explicit integer --seed")

    if (args.pdf or args.pdf_output) and args.no_html:
        raise SystemExit("PDF export requires the HTML report (do not use --no-html with --pdf / --pdf-output).")

    zones_path = resolve_zones_path(args.zones)
    if not zones_path.is_file():
        raise SystemExit(f"Zones file not found: {zones_path}")
    raw_zone = yaml.safe_load(zones_path.read_text(encoding="utf-8"))
    if not isinstance(raw_zone, dict):
        raise SystemExit("Zones YAML must be a mapping at the top level")
    slots_eff = resolve_slots_per_block_for_run(
        slots_arg=args.slots,
        zones_data=raw_zone,
        zones_path=zones_path,
    )
    if args.slots is None:
        print(
            f"Concurrent slots: {slots_eff} (from {zones_path.name} len(slots)); "
            "pass -y only to override or to match a file without a slots list."
        )
    zone = load_zone_config(
        zones_path,
        slots_eff,
        shift_hours_override=args.shift_hours,
        default_shift_hours=BLOCK_HOURS_DEFAULT,
    )
    block_hours_eff = float(zone.shift_hours)
    plan_day_start_hour = parse_plan_day_start(args.plan_day_start)
    blocks_pd = calendar_blocks_per_day(block_hours_eff)
    type_codes: Optional[List[str]] = None
    if args.roster:
        try:
            type_codes = load_roster_type_codes_yaml(
                Path(args.roster), roster_keys(int(args.soldiers))
            )
        except Exception as e:
            raise SystemExit(f"Roster types: {e}") from e

    if args.sweep_band_relative is not None:
        raw_vals = [x.strip() for x in args.sweep_band_relative.split(",") if x.strip()]
        if not raw_vals:
            raise SystemExit("--sweep-band-relative needs a comma-separated list of floats")
        br_list: List[float] = []
        for x in raw_vals:
            v = float(x)
            if v < 0.0:
                raise SystemExit(f"--sweep-band-relative: need R >= 0, got {v}")
            br_list.append(v)

        print(
            f"Sweep band-relative: values={br_list} | hybrid_rel | sim_trials={args.sim_trials} | "
            f"seed={args.seed} | soldiers={args.soldiers} slots={slots_eff} days={args.days}"
        )
        print(
            "band_rel | std_all(Z) | min_std_col(Z) | std_raw_h | raw_spread_h | fairness_score | "
            "win_trial | win_seed"
        )
        rows_out: List[Tuple[float, Dict[str, float], Dict[str, Any]]] = []
        for br in br_list:
            try:
                (pack, meta) = run_simulation_best_of(
                    trials=args.sim_trials,
                    base_seed=args.seed,
                    num_soldiers=args.soldiers,
                    slots_per_block=slots_eff,
                    days=args.days,
                    zone=zone,
                    block_hours=block_hours_eff,
                    min_consecutive_free_hours=args.min_consecutive_free_hours,
                    balance_total_hours=not args.no_total_hours_balance,
                    total_hours_slack=args.total_hours_balance_slack,
                    max_consecutive_duty_blocks=args.max_consecutive_duty_blocks,
                    min_free_shifts_after_duty=args.min_free_shifts_after_duty,
                    band_relative=br,
                    plan_day_start_hour=plan_day_start_hour,
                    anchor=sim_anchor,
                    type_codes=type_codes,
                )
            except RestConstraintError as e:
                print(f"ERROR at band_relative={br}: {e}", file=sys.stderr)
                raise SystemExit(1) from e
            fm = meta["fairness"]
            rows_out.append((br, fm, meta))
            ws = meta["trial_seed"]
            ws_s = "—" if ws is None else str(ws)
            print(
                f"{br:>8.4f} | {fm['std_all_z']:.6f} | {fm['min_std_slot_z']:.6f} | "
                f"{fm['std_raw_hours']:.4f} | {fm['raw_hours_spread']:.2f} | {fm['fairness_score']:.6f} | "
                f"{meta['trial_index'] + 1:>9d} | {ws_s:>8}"
            )
        bi = min(range(len(rows_out)), key=lambda i: rows_out[i][1]["fairness_score"])
        best_br, best_fm, best_meta = rows_out[bi]
        wss = best_meta["trial_seed"]
        wss_disp = "—" if wss is None else str(wss)
        print(
            "\nBest by fairness_score (= std_all(Z) + 0.25 * std_raw_hours; lower is better): "
            f"band_relative={best_br} → fairness_score={best_fm['fairness_score']:.6f} "
            f"(std_all_Z={best_fm['std_all_z']:.6f}, std_raw_h={best_fm['std_raw_hours']:.4f}); "
            f"win_trial={best_meta['trial_index'] + 1}/{args.sim_trials}, win_seed={wss_disp}"
        )
        raise SystemExit(0)

    try:
        if args.load_state:
            doc = read_checkpoint_json(Path(args.load_state))
            if not isinstance(doc.get("assignments"), list):
                raise SystemExit("Checkpoint missing assignments array")
            asn_ck = [assignment_record_from_dict(x) for x in doc["assignments"]]
            if args.replay_days is not None:
                asn_ck = truncate_reindex_assignments(asn_ck, int(args.replay_days))
            if not asn_ck:
                raise SystemExit("--load-state: checkpoint has no assignments after optional truncate")
            prefix_days = max(int(a.day) for a in asn_ck) + 1
            extend_days = int(
                args.extend_days if args.extend_days is not None else (args.days or 0)
            )
            validate_checkpoint_document(
                doc, zone, zones_path, slots_eff, block_hours_eff, blocks_pd, args
            )
            witness_rng: Optional[Tuple[Any, ...]] = None
            witness_suffix: Optional[List[AssignmentRecord]] = None
            if isinstance(doc.get("rng_state"), dict):
                witness_rng = rng_state_from_json(doc["rng_state"])
            if isinstance(doc.get("suffix_nonrot"), list):
                witness_suffix = [
                    assignment_record_from_dict(x) for x in doc["suffix_nonrot"]
                ]
            th = doc.get("target_horizon")
            if th is not None and int(th) != prefix_days + extend_days:
                raise SystemExit(
                    f"checkpoint target_horizon={th!r} != prefix_days+extend_days="
                    f"{prefix_days + extend_days}"
                )
            rng_ck = random.Random(args.seed) if args.seed is not None else random.Random()
            if witness_rng is not None:
                rng_ck.setstate(witness_rng)
            pack = run_simulation_checkpoint_extend(
                num_soldiers=args.soldiers,
                slots_per_block=slots_eff,
                prefix_assignments=asn_ck,
                prefix_days=prefix_days,
                extend_days=extend_days,
                zone=zone,
                block_hours=block_hours_eff,
                rng=rng_ck,
                min_consecutive_free_hours=args.min_consecutive_free_hours,
                balance_total_hours=not args.no_total_hours_balance,
                total_hours_slack=args.total_hours_balance_slack,
                max_consecutive_duty_blocks=args.max_consecutive_duty_blocks,
                min_free_shifts_after_duty=args.min_free_shifts_after_duty,
                band_relative=args.band_relative,
                plan_day_start_hour=plan_day_start_hour,
                anchor=sim_anchor,
                type_codes=type_codes,
                witness_rng_state=witness_rng,
                witness_suffix_nonrot=witness_suffix,
            )
            args.days = prefix_days + extend_days
            fm = fairness_metrics(pack[1], pack[0])
            sim_meta = {"fairness": fm, "trial_seed": args.seed, "trial_index": 0}
        else:
            pack, sim_meta = run_simulation_best_of(
                trials=args.sim_trials,
                base_seed=args.seed,
                num_soldiers=args.soldiers,
                slots_per_block=slots_eff,
                days=int(args.days),
                zone=zone,
                block_hours=block_hours_eff,
                min_consecutive_free_hours=args.min_consecutive_free_hours,
                balance_total_hours=not args.no_total_hours_balance,
                total_hours_slack=args.total_hours_balance_slack,
                max_consecutive_duty_blocks=args.max_consecutive_duty_blocks,
                min_free_shifts_after_duty=args.min_free_shifts_after_duty,
                band_relative=args.band_relative,
                plan_day_start_hour=plan_day_start_hour,
                availability=scenario_avail,
                anchor=sim_anchor,
                type_codes=type_codes,
            )
        (
            soldiers,
            Z,
            max_free,
            assignments,
            Z_day,
            Z_avg,
            daily_raw_loc,
            daily_raw_time,
            sim_stats,
        ) = pack
    except RestConstraintError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(1) from e
    n_asn = len(assignments)
    expect = expected_assignment_count(zone, args.days, blocks_pd, slots_eff, anchor=sim_anchor)
    if n_asn != expect:
        raise RuntimeError(f"internal: assignment count {n_asn} != expected {expect}")
    if args.scenario and args.check_expect and scenario_doc is not None:
        from scenario_loader import build_checker, check_expectations, roster as scenario_roster

        roster_ids = scenario_roster(args.soldiers)
        chk = build_checker(scenario_doc, roster_ids)
        try:
            check_expectations(
                scenario_doc, chk, assignments=assignments, roster_ids=roster_ids
            )
            print("Scenario expectations: OK", file=sys.stderr)
        except AssertionError as e:
            print(f"ERROR: scenario expect: {e}", file=sys.stderr)
            raise SystemExit(1) from e
    if args.save_state:
        ck_meta = build_checkpoint_run_meta(zone, zones_path, slots_eff, block_hours_eff, args)
        ck_doc = build_checkpoint_document(
            zone=zone,
            zones_path=zones_path,
            zones_yaml_text=zones_path.read_text(encoding="utf-8"),
            run_meta=ck_meta,
            assignments=assignments,
            num_days=int(args.days),
            blocks_pd=blocks_pd,
            slots_eff=slots_eff,
            seed=args.seed,
            rng_state=sim_meta.get("final_rng_state"),
        )
        ck_out = Path(args.save_state)
        write_checkpoint_json(ck_out, ck_doc)
        print(f"Wrote checkpoint: {ck_out}")
    asn_day = expected_assignment_count(zone, 1, blocks_pd, slots_eff, anchor=sim_anchor)
    print(
        f"Schedule: {args.days} days × {asn_day} assignments/day "
        f"= {n_asn} shift rows (schema_version={zone.schema_version})"
    )
    raw_totals = np.array([s.total_raw_guard_hours() for s in soldiers], dtype=np.float64)
    print(
        f"Raw guard hours per soldier: min={raw_totals.min():.1f} max={raw_totals.max():.1f} "
        f"spread={raw_totals.max() - raw_totals.min():.1f} "
        f"std={float(np.std(raw_totals, ddof=1)) if len(raw_totals) > 1 else 0.0:.2f}"
    )
    fm = sim_meta["fairness"]
    print(
        f"Fairness: std_all(Z)={fm['std_all_z']:.5f} min_col_std={fm['min_std_slot_z']:.5f} "
        f"std_raw_h={fm['std_raw_hours']:.3f} fairness_score={fm['fairness_score']:.5f} "
        f"(hybrid_rel, band_rel={args.band_relative:g})"
    )
    if args.sim_trials > 1:
        ts = sim_meta["trial_seed"]
        assert ts is not None
        print(
            f"multi-trial: scored {args.sim_trials} runs (seeds {args.seed}..{args.seed + args.sim_trials - 1}); "
            f"best trial {sim_meta['trial_index'] + 1} (winning seed {ts}); "
            f"replayed that seed once for outputs; fairness_score={sim_meta['fairness']['fairness_score']:.5f}. "
            f"Reproduce: add --seed {ts} --sim-trials 1 (same other arguments)."
        )
    if args.min_free_shifts_after_duty > 0:
        print(
            f"Shift cooldown (--min-free-shifts-after-duty={args.min_free_shifts_after_duty}, rotating only): "
            f"pool_iterations={sim_stats.shift_cooldown_pool_iterations}, "
            f"soldier_exclusions={sim_stats.shift_cooldown_exclusions}, "
            f"post_violations={sim_stats.shift_cooldown_violations_post}"
        )

    if args.json_output:
        jm: Dict[str, Any] = {
            "band_relative": float(args.band_relative),
            "min_consecutive_free_hours": float(args.min_consecutive_free_hours),
            "min_free_shifts_after_duty": int(args.min_free_shifts_after_duty),
            "max_consecutive_duty_blocks": int(args.max_consecutive_duty_blocks),
            "balance_total_hours": not bool(args.no_total_hours_balance),
            "total_hours_balance_slack": float(args.total_hours_balance_slack),
            "sim_trials": int(args.sim_trials),
            "trial_seed": sim_meta.get("trial_seed"),
            "trial_index": sim_meta.get("trial_index"),
            "zones_path": str(zones_path),
        }
        write_schedule_compare_json(
            args.json_output,
            schedule_compare_json_document(
                zone,
                assignments,
                days=args.days,
                blocks_pd=blocks_pd,
                slots_per_block=slots_eff,
                block_hours=block_hours_eff,
                num_soldiers=args.soldiers,
                extra_meta=jm,
            ),
        )
        print(f"Wrote schedule JSON: {args.json_output}")

    min_free_sf = np.min(max_free, axis=0)
    mean_free = np.mean(max_free, axis=0)
    max_free_sf = np.max(max_free, axis=0)
    col_labels = zone.heatmap_column_labels()
    nl = zone.n_loc
    nt = zone.n_time
    loc_labels = col_labels[:nl]
    time_labels = col_labels[nl:]
    Z_loc = Z[:, :nl]
    Z_time = Z[:, nl:]
    Z_avg_loc = Z_avg[:, :nl]
    Z_avg_time = Z_avg[:, nl:]

    title = (
        f"{args.days}d — {args.soldiers} soldiers, {slots_eff} slots/block, "
        f"shift_hours={block_hours_eff:g}h, zones={zones_path.name}, hybrid_rel R={args.band_relative:g}"
    )
    if args.sim_trials > 1:
        ts = sim_meta["trial_seed"]
        ts_disp = "?" if ts is None else str(ts)
        title += f", best of {args.sim_trials} trials (win seed {ts_disp})"

    xlabel_loc = "Each row sums to 100%: share of soldier’s raw guard hours across posts."
    xlabel_time = (
        "Each row sums to 100%: share of soldier’s raw guard hours across Night/Morning/Day."
    )

    fig_h_loc, line1_h_loc, line2_h_loc = build_heatmap_figure(
        Z_loc,
        f"Full period — locations — {title}",
        column_labels=loc_labels,
        xlabel=xlabel_loc,
    )
    fig_h_time, line1_h_time, line2_h_time = build_heatmap_figure(
        Z_time,
        f"Full period — time bands — {title}",
        column_labels=time_labels,
        xlabel=xlabel_time,
    )
    heatmap_loc_png = _figure_to_png_bytes(fig_h_loc)
    heatmap_time_png = _figure_to_png_bytes(fig_h_time)

    fig_b = build_max_free_figure(max_free, title, block_hours_eff, num_blocks=blocks_pd)
    bars_png = _figure_to_png_bytes(fig_b)

    sub_avg = "Per day: same rules as full-period heatmap; mean over days with duty only"
    fig_avg_loc, line1_a_loc, line2_a_loc = build_heatmap_figure(
        Z_avg_loc,
        f"Mean daily — locations (avg over {args.days} days) — {title}",
        column_labels=loc_labels,
        subtitle=sub_avg,
        xlabel=xlabel_loc,
    )
    fig_avg_time, line1_a_time, line2_a_time = build_heatmap_figure(
        Z_avg_time,
        f"Mean daily — time bands (avg over {args.days} days) — {title}",
        column_labels=time_labels,
        subtitle=sub_avg,
        xlabel=xlabel_time,
    )
    avg_heatmap_loc_png = _figure_to_png_bytes(fig_avg_loc)
    avg_heatmap_time_png = _figure_to_png_bytes(fig_avg_time)

    avg_daily_loc = np.mean(daily_raw_loc, axis=0)
    avg_daily_time = np.mean(daily_raw_time, axis=0)
    fig_zl, line1_zl, line2_zl = build_avg_zone_lines_figure(
        avg_daily_loc,
        loc_labels,
        f"Full period — mean raw hours per day by location — {title}",
        "Mean raw guard hours per calendar day (h)",
    )
    fig_zt, line1_zt, line2_zt = build_avg_zone_lines_figure(
        avg_daily_time,
        time_labels,
        f"Full period — mean raw hours per day by time band — {title}",
        "Mean raw guard hours per calendar day (h)",
    )
    # Mean of per-day totals (only defined days); for line chart use same avg_daily_* as full for consistency
    avg_dday_loc = np.zeros_like(avg_daily_loc)
    avg_dday_time = np.zeros_like(avg_daily_time)
    for s in range(args.soldiers):
        mask = np.sum(daily_raw_loc[:, s, :], axis=1) > 1e-9
        if np.any(mask):
            avg_dday_loc[s] = np.mean(daily_raw_loc[mask, s, :], axis=0)
            avg_dday_time[s] = np.mean(daily_raw_time[mask, s, :], axis=0)
    fig_al, line1_al, line2_al = build_avg_zone_lines_figure(
        avg_dday_loc,
        loc_labels,
        f"Mean on duty days — raw hours/day by location — {title}",
        "Mean raw hours on days with ≥1 shift (h)",
    )
    fig_at, line1_at, line2_at = build_avg_zone_lines_figure(
        avg_dday_time,
        time_labels,
        f"Mean on duty days — raw hours/day by time band — {title}",
        "Mean raw hours on days with ≥1 shift (h)",
    )
    zone_lines_loc_png = _figure_to_png_bytes(fig_zl)
    zone_lines_time_png = _figure_to_png_bytes(fig_zt)
    avg_zone_lines_loc_png = _figure_to_png_bytes(fig_al)
    avg_zone_lines_time_png = _figure_to_png_bytes(fig_at)

    fig_mf = build_mean_free_bar_figure(
        mean_free,
        min_free_sf,
        max_free_sf,
        f"Max consecutive free per soldier (mean over {args.days} days; whiskers = min–max)\n{title}",
    )
    mean_free_bars_png = _figure_to_png_bytes(fig_mf)

    busy_tl = build_busy_tensor(
        assignments, args.days, args.soldiers, blocks_pd, include_yaml_rest=False
    )
    unavail_tl = None
    if scenario_avail is not None:
        from scenario_loader import build_unavail_timeline_tensor

        unavail_tl = build_unavail_timeline_tensor(
            scenario_avail,
            args.days,
            args.soldiers,
            blocks_pd,
            plan_day_start_hour,
            block_hours_eff,
        )
    fig_tl = build_soldier_timeline_figure(
        busy_tl,
        block_hours_eff,
        title,
        plan_day_start_hour=plan_day_start_hour,
        unavail=unavail_tl,
    )
    soldier_timeline_png = _figure_to_png_bytes(fig_tl)

    if not args.no_png:
        out_p = Path(args.output)
        loc_path = out_p
        time_path = out_p.with_name(f"{out_p.stem}_time{out_p.suffix}")
        loc_path.write_bytes(heatmap_loc_png)
        time_path.write_bytes(heatmap_time_png)
        print(f"Wrote location heatmap: {loc_path}")
        print(f"Wrote time heatmap: {time_path}")
        bars_path = args.bars_output
        if bars_path is None:
            bars_path = str(out_p.with_name(f"{out_p.stem}_max_free_bars{out_p.suffix}"))
        Path(bars_path).write_bytes(bars_png)
        print(f"Wrote max-consecutive-free bar chart: {bars_path}")
        avg_loc_path = out_p.with_name(f"{out_p.stem}_avg_daily_loc{out_p.suffix}")
        avg_time_path = out_p.with_name(f"{out_p.stem}_avg_daily_time{out_p.suffix}")
        avg_loc_path.write_bytes(avg_heatmap_loc_png)
        avg_time_path.write_bytes(avg_heatmap_time_png)
        print(f"Wrote average-daily location heatmap: {avg_loc_path}")
        print(f"Wrote average-daily time heatmap: {avg_time_path}")
        out_p.with_name(f"{out_p.stem}_loc_lines{out_p.suffix}").write_bytes(zone_lines_loc_png)
        out_p.with_name(f"{out_p.stem}_time_lines{out_p.suffix}").write_bytes(zone_lines_time_png)
        out_p.with_name(f"{out_p.stem}_avg_daily_loc_lines{out_p.suffix}").write_bytes(avg_zone_lines_loc_png)
        out_p.with_name(f"{out_p.stem}_avg_daily_time_lines{out_p.suffix}").write_bytes(avg_zone_lines_time_png)
        print(f"Wrote zone line charts (*_loc_lines, *_time_lines, *_avg_daily_*_lines)")
        mf_path = out_p.with_name(f"{out_p.stem}_mean_free_bars{out_p.suffix}")
        mf_path.write_bytes(mean_free_bars_png)
        print(f"Wrote mean/min/max free-time bars: {mf_path}")
        tl_path = out_p.with_name(f"{out_p.stem}_soldier_timelines{out_p.suffix}")
        tl_path.write_bytes(soldier_timeline_png)
        print(f"Wrote soldier timeline chart: {tl_path}")

    print("Full-period location heatmap stats:", line1_h_loc)
    print(line2_h_loc)
    print("Full-period time heatmap stats:", line1_h_time)
    print(line2_h_time)

    if not args.no_html and args.html_output:
        write_html_report(
            args.html_output,
            title,
            heatmap_loc_png,
            heatmap_time_png,
            avg_heatmap_loc_png,
            avg_heatmap_time_png,
            zone_lines_loc_png,
            zone_lines_time_png,
            avg_zone_lines_loc_png,
            avg_zone_lines_time_png,
            bars_png,
            mean_free_bars_png,
            soldier_timeline_png,
            zone,
            str(zones_path),
            soldiers,
            Z_avg,
            max_free,
            min_free_sf,
            mean_free,
            max_free_sf,
            assignments,
            block_hours_eff,
            blocks_pd,
            args.days,
            slots_eff,
            args.min_consecutive_free_hours,
            args.max_consecutive_duty_blocks,
            sim_meta["trial_seed"],
            line1_h_loc,
            line2_h_loc,
            line1_h_time,
            line2_h_time,
            line1_a_loc,
            line2_a_loc,
            line1_a_time,
            line2_a_time,
            line1_zl,
            line2_zl,
            line1_zt,
            line2_zt,
            line1_al,
            line2_al,
            line1_at,
            line2_at,
            sim_stats,
            args.min_free_shifts_after_duty,
            args.zone_viz,
            plan_day_start_hour=plan_day_start_hour,
        )
        if args.pdf_output:
            export_html_to_pdf(Path(args.html_output), Path(args.pdf_output))
        elif args.pdf:
            export_html_to_pdf(Path(args.html_output), Path(args.html_output).with_suffix(".pdf"))


if __name__ == "__main__":
    main()
