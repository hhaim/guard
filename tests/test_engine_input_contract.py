"""Engine and assignment JSON contract: UI DB path vs simulator checkpoint/API."""

from __future__ import annotations

from pathlib import Path

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent

# Assignment fields the simulator emits (checkpoint / API before soldier_id).
SIM_ASSIGNMENT_CORE_KEYS = frozenset({
    "day",
    "calendar_block",
    "start_hour",
    "slot",
    "soldier_idx",
    "loc_i",
    "time_j",
    "weight",
    "raw_hours",
    "kind",
    "rowspan",
    "win_start_block",
    "win_end_block",
    "window_name",
    "linear_busy_span_blocks",
})

# UI/API per-assignment rows add soldier_id (see guardsched.AssignmentRecordsToJSON).
UI_ASSIGNMENT_EXTRA_KEYS = frozenset({"soldier_id"})


def test_sim_assignment_dict_keys_match_ui_contract() -> None:
    """Simulator rows use the same core fields as UI schedule.plan assignments (+ soldier_id in API)."""
    rec = g.AssignmentRecord(
        day=0,
        calendar_block=1,
        start_hour=8,
        slot=0,
        soldier_idx=2,
        loc_i=1,
        time_j=0,
        weight=4.5,
        raw_hours=4.0,
        kind="rotating",
        rowspan=1,
        win_start_block=1,
        win_end_block=1,
        window_name="morning",
        linear_busy_span_blocks=3,
    )
    d = g.assignment_record_to_dict(rec)
    assert set(d.keys()) <= SIM_ASSIGNMENT_CORE_KEYS
    keys = [f"s{i}" for i in range(4)]

    # UI/API adds soldier_id (see guardsched.AssignmentRecordsToJSON in Go tests).
    api_style = dict(d)
    api_style["soldier_id"] = keys[2]
    assert set(api_style.keys()) <= SIM_ASSIGNMENT_CORE_KEYS | UI_ASSIGNMENT_EXTRA_KEYS


def test_plan_doc_continuation_has_witness_fields() -> None:
    """PlanDoc continuation (hot store / DB) carries witness fields for extend."""
    from hot_store import build_plan_continuation

    cont = build_plan_continuation(
        rng_state=(3, tuple(range(624)), None),
        horizon_days=10,
        all_records=[],
        prefix_days=8,
        segment_days=2,
        seed=42,
        suffix_nonrot=[],
    )
    assert cont["format_version"] == g.CHECKPOINT_FORMAT_VERSION
    assert "rng_state" in cont
    assert cont["rng_state"]["version"] == 3
    assert len(cont["rng_state"]["state"]) == 624
