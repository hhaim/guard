"""Scenario YAML planner tests (parity with guardsched/scenario_test.go)."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scenario_loader import (  # noqa: E402
    build_checker,
    check_expectations,
    load_scenario_file,
    resolve_scenario_times,
    roster,
)

SCENARIOS = ROOT / "testdata" / "scenarios"
ANCHOR = datetime(2026, 5, 27, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "name",
    [
        "all_base_s1.yaml",
        "partial_return.yaml",
        "evening_outing.yaml",
        "sick_full_day.yaml",
    ],
)
def test_scenario_availability_summary(name: str) -> None:
    path = SCENARIOS / name
    sc = load_scenario_file(path)
    resolve_scenario_times(sc, ANCHOR)
    ids = roster(sc.infer_soldier_count(12))
    chk = build_checker(sc, ids)
    check_expectations(sc, chk, assignments=None, roster_ids=ids)


def test_rotating_blocks_after_midnight_with_status() -> None:
    sc = load_scenario_file(ROOT / "status.yaml")
    resolve_scenario_times(sc, ANCHOR)
    chk = build_checker(sc, roster(12), num_days=1)
    for block in (4, 5):
        assert chk.avail_rotating_block(2, 0, block, 5, 4.0)
        assert len([i for i in range(12) if chk.avail_rotating_block(i, 0, block, 5, 4.0)]) == 12
    assert not chk.avail_rotating_block(2, 0, 0, 5, 4.0)


def test_status_only_v2_root() -> None:
    path = ROOT / "status.yaml"
    sc = load_scenario_file(path)
    assert sc.status_only
    assert sc.schema_version == 2
    sc.sim["plan_day_start"] = "05:00"
    sc.sim["days"] = 1
    resolve_scenario_times(sc, ANCHOR)
    ids = roster(12)
    chk = build_checker(sc, ids, num_days=1)
    day = chk.compile_day(0)
    assert day.full == 11
    assert day.absent_partial == 1
    assert "s2" in day.avail_partial


def test_partial_return_morning_unavailable() -> None:
    from scenario_loader import AvailabilityChecker, StatusEntry, STATUS_AWAY

    entries = [
        StatusEntry(
            soldier_id="s2",
            start_at=ANCHOR.replace(day=26, hour=5),
            end_at=ANCHOR.replace(hour=12),
            status=STATUS_AWAY,
        )
    ]
    chk = AvailabilityChecker(ANCHOR, 5, roster(12), entries, 1)
    assert not chk.avail_rotating_block(2, 0, 0, 5, 4.0)
    assert chk.avail_rotating_block(2, 0, 2, 5, 4.0)
