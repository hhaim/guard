"""Soldier HTML report shows full_day duty+rest blocks (not only FREE)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "testdata" / "full_day_09_rest4"


def test_build_linear_busy_block_lookup_covers_rest_on_next_day() -> None:
    zone = g.load_zone_config(FIXTURE / "zones.yaml", slots_per_block=4)
    type_codes = g.load_roster_type_codes_yaml(FIXTURE / "roster.yaml", g.roster_keys(6))
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
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
        plan_day_start_hour=5,
        anchor=anchor,
        type_codes=type_codes,
    )
    recs = pack[3]
    B = g.calendar_blocks_per_day(zone.shift_hours)
    lookup = g.build_linear_busy_block_lookup(recs, 2, B)
    full_day_soldier = next(
        a.soldier_idx for a in recs if a.day == 0 and a.kind == "full_day"
    )
    # Day 2 (index 1): first blocks still in rest after 09–09 + 4h (span continues from anchor block 1).
    assert (full_day_soldier, 1, 0) in lookup
    assert (full_day_soldier, 1, 1) in lookup
    assert lookup[(full_day_soldier, 1, 1)].loc_i == lookup[(full_day_soldier, 0, 1)].loc_i
    # Span anchor must match simulator (09:00 = block index 1 on plan day starting 05:00).
    fd = next(a for a in recs if a.kind == "full_day" and a.day == 0)
    assert fd.calendar_block == 1
    assert (full_day_soldier, 0, 1) in lookup


def test_soldier_html_span_row_slot_em_dash(tmp_path: Path) -> None:
    """Duty+rest span rows: Location L, Slot —, 4.00 h, Weight —."""
    import re
    import subprocess
    import sys

    out = tmp_path / "report.html"
    root = Path(__file__).resolve().parents[1]
    subprocess.run(
        [
            sys.executable,
            str(root / "guard_scheduler_sim.py"),
            "-x",
            "22",
            "-y",
            "5",
            "-d",
            "2",
            "--seed",
            "42",
            "--min-consecutive-free-hours",
            "6",
            "--zones",
            str(root / "zones_next_day_full.yaml"),
            "--min-free-shifts-after-duty",
            "2",
            "--roster",
            str(root / "roaster1.yaml"),
            "--html-output",
            str(out),
        ],
        cwd=str(root),
        check=True,
        capture_output=True,
    )
    html = out.read_text(encoding="utf-8")
    m = re.search(r"id='soldier-1'.*?</table>", html, re.DOTALL)
    assert m is not None
    chunk = m.group(0)
    assert re.search(
        r"<td>1</td><td>2</td>.*?<td>L</td><td>—</td><td>4\.00</td><td>3\.9600</td>",
        chunk,
    )
    assert re.search(
        r"<td>1</td><td>3</td>.*?<td>L</td><td>—</td><td>4\.00</td><td>4\.4000</td>",
        chunk,
    )


def test_assignment_calendar_block_weight_kitchen_team() -> None:
    zone = g.load_zone_config(ROOT / "zones_next_day_full.yaml", slots_per_block=5)
    type_codes = g.load_roster_type_codes_yaml(ROOT / "roaster1.yaml", g.roster_keys(22))
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=22,
        slots_per_block=5,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        min_consecutive_free_hours=6.0,
        max_consecutive_duty_blocks=0,
        min_free_shifts_after_duty=2,
        band_relative=0.2,
        type_codes=type_codes,
    )
    a = next(
        x
        for x in pack[3]
        if x.soldier_idx == 1 and x.kind == "full_day_team"
    )
    assert g.pattern_weight_multiplier(zone, a) == pytest.approx(1.1)
    # Day band (13:00 block index 2): 4h × 1.0 × 1.0 × 1.1 = 4.4
    assert g.assignment_calendar_block_weight(zone, a, 2, zone.shift_hours, 5) == pytest.approx(
        4.4
    )
    # Morning band (09:00 block index 1): 4h × 1.0 × 0.9 × 1.1 = 3.96
    assert g.assignment_calendar_block_weight(zone, a, 1, zone.shift_hours, 5) == pytest.approx(
        3.96
    )


def test_timeline_busy_matches_span_lookup() -> None:
    """Timeline red bars cover exactly the linear busy span used by soldier tables."""
    zone = g.load_zone_config(FIXTURE / "zones.yaml", slots_per_block=4)
    type_codes = g.load_roster_type_codes_yaml(FIXTURE / "roster.yaml", g.roster_keys(6))
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    B = g.calendar_blocks_per_day(zone.shift_hours)
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
        plan_day_start_hour=5,
        anchor=anchor,
        type_codes=type_codes,
    )
    assignments = pack[3]
    span_lookup = g.build_linear_busy_block_lookup(assignments, 2, B)
    busy_tl = g.build_busy_tensor(assignments, 2, 6, B, include_yaml_rest=True)
    for (s, d, b) in span_lookup:
        assert busy_tl[d, s, b], f"timeline must be red for span block S{s + 1} d{d + 1} b{b + 1}"
