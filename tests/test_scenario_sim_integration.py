"""
Integration tests: scenario status + zones_s1 scheduling (availability, midnight blocks, sim).

These go beyond summary-only checks — they run the full mixed-pattern simulator with an
AvailabilityChecker and assert every rotating assignment respects status windows.
"""

from __future__ import annotations

import random
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Sequence, Tuple

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import guard_scheduler_sim as sim  # noqa: E402
from scenario_loader import (  # noqa: E402
    AvailabilityChecker,
    StatusEntry,
    build_checker,
    check_expectations,
    compile_day_availability,
    load_scenario_file,
    resolve_scenario_times,
    roster,
)

SCENARIOS = ROOT / "testdata" / "scenarios"
ANCHOR = datetime(2026, 5, 27, tzinfo=timezone.utc)
PLAN_START = 5
SHIFT_H = 4.0
SLOTS = 4
SIM_KW = dict(
    min_consecutive_free_hours=6.0,
    min_free_shifts_after_duty=2,
    max_consecutive_duty_blocks=2,
    band_relative=0.2,
    plan_day_start_hour=PLAN_START,
)


@dataclass(frozen=True)
class BlockExpect:
    block: int
    s2_avail: bool
    min_pool: int


# partial_return: s2 away until 12:00 on plan day 0
PARTIAL_RETURN_BLOCKS: Tuple[BlockExpect, ...] = (
    BlockExpect(0, False, 11),
    BlockExpect(1, False, 11),
    BlockExpect(2, True, 12),
    BlockExpect(3, True, 12),
    BlockExpect(4, True, 12),  # 21:00–01:00 (midnight regression)
    BlockExpect(5, True, 12),  # 01:00–05:00
)


@pytest.fixture(scope="module")
def zones_s1() -> sim.ZoneConfig:
    return sim.load_zone_config(ROOT / "zones_s1.yaml", SLOTS)


def _blocks_pd() -> int:
    return sim.calendar_blocks_per_day(SHIFT_H)


def _prepare(
    path: Path | str,
    *,
    n_soldiers: int = 12,
    anchor: datetime = ANCHOR,
    days: int | None = None,
) -> Tuple[Any, AvailabilityChecker, List[str]]:
    sc = load_scenario_file(path)
    sc.sim.setdefault("plan_day_start", "05:00")
    if days is not None:
        sc.sim["days"] = days
    resolve_scenario_times(sc, anchor)
    ids = roster(n_soldiers)
    nd = int(sc.sim.get("days") or 1)
    return sc, build_checker(sc, ids, num_days=nd), ids


def _run(
    n_soldiers: int,
    days: int,
    zone: sim.ZoneConfig,
    chk: AvailabilityChecker,
    seed: int = 42,
) -> List[sim.AssignmentRecord]:
    *_, assignments, _, _, _, _, _ = sim.run_simulation(
        n_soldiers,
        SLOTS,
        days,
        zone,
        zone.shift_hours,
        random.Random(seed),
        availability=chk,
        **SIM_KW,
    )
    return assignments


def _rotating(assignments: Sequence[sim.AssignmentRecord]) -> List[sim.AssignmentRecord]:
    return [a for a in assignments if (a.kind or "rotating") == "rotating"]


def _assert_rotating_respects_checker(
    assignments: Sequence[sim.AssignmentRecord],
    chk: AvailabilityChecker,
) -> None:
    for a in _rotating(assignments):
        ok = chk.avail_rotating_block(
            a.soldier_idx, a.day, a.calendar_block, PLAN_START, SHIFT_H
        )
        assert ok, (
            f"s{a.soldier_idx} assigned rotating day={a.day} block={a.calendar_block} "
            f"but availability checker rejects that block"
        )


def _assert_soldier_not_rotating(
    assignments: Sequence[sim.AssignmentRecord], soldier_idx: int
) -> None:
    for a in _rotating(assignments):
        assert a.soldier_idx != soldier_idx, (
            f"s{soldier_idx} must not work rotating while absent; "
            f"got day={a.day} block={a.calendar_block}"
        )


def _count_pool(chk: AvailabilityChecker, n: int, day: int, block: int) -> int:
    return sum(1 for i in range(n) if chk.avail_rotating_block(i, day, block, PLAN_START, SHIFT_H))


class TestPartialReturnAvailability:
    @pytest.mark.parametrize("exp", PARTIAL_RETURN_BLOCKS, ids=lambda e: f"block{e.block}")
    def test_block_pool_partial_return_fixture(self, exp: BlockExpect) -> None:
        _, chk, ids = _prepare(SCENARIOS / "partial_return.yaml")
        assert len(ids) == 12
        assert chk.avail_rotating_block(2, 0, exp.block, PLAN_START, SHIFT_H) is exp.s2_avail
        pool = _count_pool(chk, len(ids), 0, exp.block)
        assert pool >= exp.min_pool, f"block {exp.block}: pool={pool} want >={exp.min_pool}"

    def test_status_v2_root_matches_partial_return_compile(self) -> None:
        _, chk_fixture, _ = _prepare(SCENARIOS / "partial_return.yaml")
        _, chk_v2, _ = _prepare(ROOT / "status.yaml")
        d1 = chk_fixture.compile_day(0)
        d2 = chk_v2.compile_day(0)
        assert d1.full == d2.full == 11
        assert d1.absent_partial == d2.absent_partial == 1
        assert set(d1.avail_partial.keys()) == set(d2.avail_partial.keys()) == {"s2"}


class TestRunSimulationWithStatus:
    @pytest.mark.parametrize("n_soldiers", [12, 14, 16])
    def test_status_yaml_completes(self, zones_s1: sim.ZoneConfig, n_soldiers: int) -> None:
        _, chk, _ = _prepare(ROOT / "status.yaml", n_soldiers=n_soldiers)
        assignments = _run(n_soldiers, 1, zones_s1, chk)
        assert len(_rotating(assignments)) == _blocks_pd() * SLOTS
        _assert_rotating_respects_checker(assignments, chk)

    def test_partial_return_fixture_completes(self, zones_s1: sim.ZoneConfig) -> None:
        sc, chk, ids = _prepare(SCENARIOS / "partial_return.yaml")
        assignments = _run(len(ids), 1, zones_s1, chk, seed=int(sc.sim.get("seed") or 42))
        check_expectations(sc, chk, assignments=None, roster_ids=ids)
        _assert_rotating_respects_checker(assignments, chk)
        _assert_soldier_not_rotating(
            [a for a in assignments if a.calendar_block in (0, 1)], 2
        )

    def test_sick_full_day_never_rotating(self, zones_s1: sim.ZoneConfig) -> None:
        sc, chk, ids = _prepare(SCENARIOS / "sick_full_day.yaml")
        check_expectations(sc, chk, assignments=None, roster_ids=ids)
        # 12 roster with one sick is tight for cooldown+4 slots; 13+ reliably schedules in Python sim.
        n_run = 13
        chk_run = build_checker(sc, roster(n_run), num_days=1)
        assignments = _run(n_run, 1, zones_s1, chk_run, seed=42)
        _assert_soldier_not_rotating(assignments, 3)
        _assert_rotating_respects_checker(assignments, chk_run)

    def test_evening_outing_blocks_outing_window(self, zones_s1: sim.ZoneConfig) -> None:
        sc, chk, ids = _prepare(SCENARIOS / "evening_outing.yaml")
        check_expectations(sc, chk, assignments=None, roster_ids=ids)
        # s5 outing 20:00 – 01:00: afternoon block ok, late evening block not
        assert chk.avail_rotating_block(5, 0, 2, PLAN_START, SHIFT_H)
        assert not chk.avail_rotating_block(5, 0, 4, PLAN_START, SHIFT_H)
        assignments = _run(len(ids), 1, zones_s1, chk, seed=int(sc.sim.get("seed") or 7))
        _assert_rotating_respects_checker(assignments, chk)
        for a in _rotating(assignments):
            # Outing ends 01:00; block 5 (01:00–05:00) is valid. Blocks 3–4 overlap outing.
            if a.soldier_idx == 5 and a.calendar_block in (3, 4):
                pytest.fail(f"s5 assigned during outing block {a.calendar_block}")


class TestMultiSoldierAndMultiDay:
    def test_two_overlapping_status_rows_compile(self) -> None:
        """s2 away until noon; s5 outing 20:00–01:00 — independent partial windows."""
        entries = [
            StatusEntry(
                soldier_id="s2",
                start_at=ANCHOR.replace(day=26, hour=5),
                end_at=ANCHOR.replace(hour=12),
                status="away",
            ),
            StatusEntry(
                soldier_id="s5",
                start_at=ANCHOR.replace(hour=20),
                end_at=ANCHOR.replace(day=28, hour=1),
                status="outing",
            ),
        ]
        ids = roster(12)
        chk = AvailabilityChecker(ANCHOR, PLAN_START, ids, entries, 2)
        d0 = chk.compile_day(0)
        assert d0.full == 10
        assert d0.absent_full == 0
        assert d0.absent_partial == 2
        assert "s2" in d0.avail_partial and "s5" in d0.avail_partial

    def test_two_plan_days_status_only_day_zero(self, zones_s1: sim.ZoneConfig) -> None:
        sc, chk, ids = _prepare(ROOT / "status.yaml", days=2)
        d1 = chk.compile_day(1)
        assert d1.full == 12 and d1.absent_partial == 0
        assignments = _run(len(ids), 2, zones_s1, chk)
        assert len(_rotating(assignments)) == 2 * _blocks_pd() * SLOTS
        _assert_rotating_respects_checker(assignments, chk)

    def test_multi_soldier_sim_completes(self, zones_s1: sim.ZoneConfig) -> None:
        entries = [
            StatusEntry(
                soldier_id="s2",
                start_at=ANCHOR.replace(day=26, hour=5),
                end_at=ANCHOR.replace(hour=12),
                status="away",
            ),
            StatusEntry(
                soldier_id="s5",
                start_at=ANCHOR.replace(hour=20),
                end_at=ANCHOR.replace(day=28, hour=1),
                status="outing",
            ),
            StatusEntry(
                soldier_id="s3",
                start_at=ANCHOR.replace(hour=5),
                end_at=ANCHOR.replace(day=28, hour=5),
                status="sick",
            ),
        ]
        ids = roster(14)
        chk = AvailabilityChecker(ANCHOR, PLAN_START, ids, entries, 1)
        d0 = chk.compile_day(0)
        assert d0.full == 11 and d0.absent_full == 1 and d0.absent_partial == 2
        assignments = _run(14, 1, zones_s1, chk, seed=123)
        _assert_rotating_respects_checker(assignments, chk)
        _assert_soldier_not_rotating(assignments, 3)
        for a in _rotating(assignments):
            if a.soldier_idx == 2 and a.calendar_block < 2:
                pytest.fail("s2 on morning block")
            if a.soldier_idx == 5 and a.calendar_block in (3, 4):
                pytest.fail("s5 on outing block")


class TestDFSAndRegression:
    def test_dfs_mask_exists_with_partial_return_checker(self) -> None:
        """Rotating DFS + availability must find a feasible mask (not empty night pools)."""
        _, chk, _ = _prepare(ROOT / "status.yaml")
        zone = sim.load_zone_config(ROOT / "zones_s1.yaml", SLOTS)
        soldiers = [sim.make_soldier(i, 24.0, zone.n_loc, zone.n_time) for i in range(12)]
        blocks = _blocks_pd()
        busy = sim.np.zeros((1, 12, blocks), dtype=bool)
        dr = sim.np.zeros((1, 12, blocks), dtype=bool)
        nodes = [0]
        ok = sim._dfs_rotating_only_mask(
            dr,
            busy,
            soldiers,
            L=0,
            days=1,
            blocks_pd=blocks,
            n_rot=SLOTS,
            k_rest=0,
            max_consecutive_duty_blocks=2,
            x_cool=2,
            nodes=nodes,
            availability=chk,
            plan_start_hour=PLAN_START,
            shift_hours=SHIFT_H,
        )
        assert ok, "DFS should find rotating mask with partial_return status"
        for b in range(blocks):
            on = [i for i in range(12) if dr[0, i, b]]
            assert len(on) == SLOTS, f"block {b}: duty count {len(on)}"
            for i in on:
                assert chk.avail_rotating_block(i, 0, b, PLAN_START, SHIFT_H)

    def test_compile_day_availability_direct(self) -> None:
        sc, _, ids = _prepare(SCENARIOS / "partial_return.yaml")
        day = compile_day_availability(
            sc.anchor, 0, PLAN_START, ids, sc.resolved
        )
        assert day.absent_partial == 1
        pairs = day.avail_partial["s2"][0]
        assert pairs[0] == "12:00"
        assert pairs[1] == "05:00"
