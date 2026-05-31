"""Production-faithful per-day PlanDoc store for ``--hot`` simulation (checkpoint.json)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from guard_scheduler_sim import (
    CHECKPOINT_FORMAT_VERSION,
    AssignmentRecord,
    assignment_record_from_dict,
    assignment_record_to_dict,
    replace,
    rng_state_from_json,
    rng_state_to_json,
    suffix_nonrot_from_assignments,
)

PLAN_FORMAT_VERSION = 1
DEFAULT_HOT_STATE = Path("checkpoint.json")


def assignment_records_to_json(
    records: Sequence[AssignmentRecord], soldier_keys: Sequence[str]
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in records:
        d = assignment_record_to_dict(a)
        si = int(a.soldier_idx)
        if 0 <= si < len(soldier_keys):
            d["soldier_id"] = soldier_keys[si]
        out.append(d)
    return out


def records_from_assignment_json(
    assigns: Sequence[Dict[str, Any]], soldier_keys: Sequence[str]
) -> List[AssignmentRecord]:
    idx = {k: i for i, k in enumerate(soldier_keys)}
    out: List[AssignmentRecord] = []
    for m in assigns:
        si = int(m.get("soldier_idx", 0))
        sid = m.get("soldier_id")
        if isinstance(sid, str) and sid in idx:
            si = idx[sid]
        rec = assignment_record_from_dict({**m, "soldier_idx": si})
        out.append(rec)
    return out


def _calendar_date(anchor: datetime, day_offset: int) -> str:
    return (anchor + timedelta(days=int(day_offset))).strftime("%Y-%m-%d")


def split_plan_by_date(
    *,
    anchor: datetime,
    shift_hours: float,
    records: Sequence[AssignmentRecord],
    day_offset: int = 0,
) -> List[Tuple[str, Dict[str, Any]]]:
    """Split segment assignments (relative days 0..) into one PlanDoc per calendar date."""
    by_date: Dict[str, List[Dict[str, Any]]] = {}
    for a in records:
        rel = int(a.day)
        cal = _calendar_date(anchor, day_offset + rel)
        cp = assignment_record_to_dict(replace(a, day=0))
        by_date.setdefault(cal, []).append(cp)
    dates = sorted(by_date.keys())
    out: List[Tuple[str, Dict[str, Any]]] = []
    for cal in dates:
        out.append(
            (
                cal,
                {
                    "format_version": PLAN_FORMAT_VERSION,
                    "anchor_date": cal,
                    "days": 1,
                    "shift_hours": float(shift_hours),
                    "assignments": by_date[cal],
                },
            )
        )
    return out


def build_plan_continuation(
    *,
    rng_state: Tuple[Any, ...],
    horizon_days: int,
    all_records: Sequence[AssignmentRecord],
    prefix_days: int,
    segment_days: int,
    seed: Optional[int] = None,
    suffix_nonrot: Optional[Sequence[AssignmentRecord]] = None,
) -> Dict[str, Any]:
    split = int(prefix_days) + int(segment_days)
    if suffix_nonrot is None:
        suffix = suffix_nonrot_from_assignments(all_records, split)
    else:
        suffix = list(suffix_nonrot)
    cont: Dict[str, Any] = {
        "format_version": CHECKPOINT_FORMAT_VERSION,
        "num_days": int(horizon_days),
        "rng_state": rng_state_to_json(rng_state),
        "suffix_nonrot": [assignment_record_to_dict(a) for a in suffix],
    }
    if split > 0:
        cont["target_horizon"] = split
    if seed is not None:
        cont["seed"] = int(seed)
    return cont


def continuation_to_witness(
    cont: Optional[Dict[str, Any]],
) -> Tuple[Optional[Tuple[Any, ...]], Optional[List[AssignmentRecord]]]:
    if not cont or not isinstance(cont.get("rng_state"), dict):
        return None, None
    rng_st = rng_state_from_json(cont["rng_state"])
    suffix: Optional[List[AssignmentRecord]] = None
    if isinstance(cont.get("suffix_nonrot"), list):
        suffix = [assignment_record_from_dict(x) for x in cont["suffix_nonrot"]]
    return rng_st, suffix


def clear_hot_store(path: Path = DEFAULT_HOT_STATE) -> None:
    p = Path(path)
    if p.is_file():
        p.unlink()


def read_hot_store(path: Path = DEFAULT_HOT_STATE) -> Dict[str, Dict[str, Any]]:
    p = Path(path)
    if not p.is_file():
        return {}
    doc = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("hot store root must be a JSON object")
    out: Dict[str, Dict[str, Any]] = {}
    for k, v in doc.items():
        if isinstance(v, dict):
            out[str(k)] = v
    return out


def write_hot_store(path: Path, store: Dict[str, Dict[str, Any]]) -> None:
    Path(path).write_text(
        json.dumps(store, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def load_hot_history(
    path: Path,
    *,
    soldier_keys: Sequence[str],
    shift_hours: float,
) -> Tuple[List[AssignmentRecord], int, Optional[Dict[str, Any]], Optional[str]]:
    """
    Load saved plan days in calendar order; replay assignments with day reindex.

    Returns (prefix_records, prefix_days, continuation_from_last_day, last_date_key).
    """
    store = read_hot_store(path)
    if not store:
        return [], 0, None, None
    dates = sorted(store.keys())
    prefix: List[AssignmentRecord] = []
    last_plan: Optional[Dict[str, Any]] = None
    last_date: Optional[str] = None
    for i, cal in enumerate(dates):
        plan = store[cal]
        sh = plan.get("shift_hours")
        if sh not in (None, 0) and float(sh) != float(shift_hours):
            raise ValueError(
                f"plan {cal} shift_hours={sh} != expected {shift_hours}"
            )
        assigns = plan.get("assignments")
        if not isinstance(assigns, list):
            continue
        part = records_from_assignment_json(assigns, soldier_keys)
        for rec in part:
            prefix.append(replace(rec, day=i))
        last_plan = plan
        last_date = cal
    cont = None
    if last_plan is not None:
        c = last_plan.get("continuation")
        if isinstance(c, dict):
            cont = c
    return prefix, len(dates), cont, last_date


def append_hot_segment(
    path: Path,
    *,
    anchor: datetime,
    shift_hours: float,
    segment: Sequence[AssignmentRecord],
    day_offset: int,
    continuation: Optional[Dict[str, Any]],
    soldier_keys: Sequence[str],
) -> None:
    """Append new calendar-day PlanDocs; set continuation on the last new day only."""
    store = read_hot_store(path)
    plans = split_plan_by_date(
        anchor=anchor,
        shift_hours=shift_hours,
        records=segment,
        day_offset=day_offset,
    )
    if not plans:
        return
    for i, (cal, plan) in enumerate(plans):
        assigns = assignment_records_to_json(
            [assignment_record_from_dict(a) for a in plan["assignments"]],
            soldier_keys,
        )
        plan["assignments"] = assigns
        if i == len(plans) - 1 and continuation is not None:
            plan["continuation"] = continuation
        if cal in store:
            raise ValueError(f"hot store already has plan for {cal}")
        store[cal] = plan
    write_hot_store(path, store)
