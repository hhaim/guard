"""Full day 09:00–09:00 (24h) + rest_after_hours 4 → rotating only from 13:00 next plan day."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "testdata" / "full_day_09_rest4"


def _load_zone():
    return g.load_zone_config(FIXTURE / "zones.yaml", slots_per_block=4)


def _type_codes(n: int = 6) -> list[str]:
    return g.load_roster_type_codes_yaml(FIXTURE / "roster.yaml", g.roster_keys(n))


def test_linear_busy_span_full_day_0909_rest4() -> None:
    L0, span = g._linear_busy_span_duty_hours_plus_rest(
        0, 6, 4.0, 9, 9, half_open=False, rest_after_h=4.0, plan_start_hour=5
    )
    assert (L0, span) == (1, 7)


def test_full_day_0909_rotating_blocked_until_13() -> None:
    zone = _load_zone()
    type_codes = _type_codes()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    plan_start = 5
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=7,
        num_soldiers=6,
        slots_per_block=4,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        min_consecutive_free_hours=0.0,
        max_consecutive_duty_blocks=0,
        min_free_shifts_after_duty=0,
        band_relative=0.2,
        plan_day_start_hour=plan_start,
        anchor=anchor,
        type_codes=type_codes,
    )
    recs = pack[3]
    post_slot = 3
    full_day_soldier = None
    for a in recs:
        if a.day == 0 and a.slot == post_slot and a.kind == "full_day":
            full_day_soldier = a.soldier_idx
            break
    assert full_day_soldier is not None

    # Blocks 0–1 are 05:00–13:00; first rotating block is 13:00–17:00 (index 2).
    for a in recs:
        if a.day != 1 or a.kind != "rotating" or a.soldier_idx != full_day_soldier:
            continue
        assert a.calendar_block >= 2, (
            f"soldier {full_day_soldier} rotating day 1 block {a.calendar_block} "
            f"before 13:00 block"
        )

    assert any(
        a.day == 1
        and a.kind == "rotating"
        and g.block_start_hour(plan_start, a.calendar_block, zone.shift_hours) == 13
        for a in recs
    )
