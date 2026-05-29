"""full_day_team fixture — mirror guardsched/full_day_team_test.go."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "testdata" / "full_day_team"

# Match guardsched/full_day_team_test.go RunSimulationZoneConfig args.
_SIM_KW = dict(
    min_consecutive_free_hours=6.0,
    max_consecutive_duty_blocks=2,
    min_free_shifts_after_duty=0,
    band_relative=0.2,
)


def _load_fixture() -> tuple[g.ZoneConfig, list[str]]:
    zone = g.load_zone_config(FIXTURE / "zones.yaml", slots_per_block=1)
    type_codes = g.load_roster_type_codes_yaml(FIXTURE / "roster.yaml", g.roster_keys(12))
    return zone, type_codes


def test_load_zone_config_full_day_team() -> None:
    zone, _ = _load_fixture()
    cfg = zone.full_day_team_specs["team_post"]
    assert cfg["headcount"] == 6
    assert cfg["type_quotas"]["A"] == 1
    assert cfg["type_quotas"]["B"] == 2
    assert cfg["type_quotas"]["C"] == 1


def test_run_simulation_full_day_team_assignment_count() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 12
    assert all(r.kind == "full_day_team" and r.slot == 0 for r in recs)


def test_run_simulation_full_day_team_type_quotas() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    for day in range(2):
        counts: dict[str, int] = {}
        for a in recs:
            if a.day != day:
                continue
            if 0 <= a.soldier_idx < len(type_codes):
                tc = type_codes[a.soldier_idx]
                counts[tc] = counts.get(tc, 0) + 1
        assert counts.get("A", 0) >= 1
        assert counts.get("B", 0) >= 2
        assert counts.get("C", 0) >= 1


def test_run_simulation_full_day_team_busy_tensor() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 6
    assert recs[0].linear_busy_span_blocks is not None
    assert recs[0].linear_busy_span_blocks > 0
