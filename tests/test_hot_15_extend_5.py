"""Hot store workflow: incremental --hot burst-days=1 matches direct extend."""

from __future__ import annotations

import random
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g
from hot_store import load_hot_history, read_hot_store

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "testdata" / "zones_s1_gate4.yaml"

PREFIX_DAYS = 15
EXTEND_DAYS = 5
TOTAL_DAYS = PREFIX_DAYS + EXTEND_DAYS
SOLDIERS = 12
SLOTS = 4
SEED = 12345
ANCHOR = datetime(2026, 5, 27, tzinfo=timezone.utc)

SIM_KW = dict(
    min_consecutive_free_hours=6.0,
    min_free_shifts_after_duty=2,
    band_relative=0.2,
)


def _assignment_sig(
    recs: list[g.AssignmentRecord],
    *,
    day_min: int = 0,
    day_reindex: int = 0,
) -> list[tuple[int, int, int, int, str]]:
    rows: list[tuple[int, int, int, int, str]] = []
    for a in recs:
        if int(a.day) < day_min:
            continue
        rows.append(
            (
                int(a.day) - day_reindex,
                int(a.calendar_block),
                int(a.slot),
                int(a.soldier_idx),
                str(getattr(a, "kind", "rotating") or "rotating"),
            )
        )
    return sorted(rows)


def _zone() -> g.ZoneConfig:
    return g.load_zone_config(ZONES, slots_per_block=SLOTS)


def _run_cold_days(days: int, seed: int) -> list[g.AssignmentRecord]:
    zone = _zone()
    pack = g.run_simulation(
        SOLDIERS,
        SLOTS,
        days,
        zone,
        zone.shift_hours,
        random.Random(seed),
        **SIM_KW,
    )
    return list(pack[3])


def _run_hot(total_days: int, burst_days: int, path: Path) -> list[g.AssignmentRecord]:
    zone = _zone()
    pack, _ = g.run_simulation_hot(
        total_days=total_days,
        burst_days=burst_days,
        state_path=path,
        num_soldiers=SOLDIERS,
        slots_per_block=SLOTS,
        zone=zone,
        block_hours=zone.shift_hours,
        base_seed=SEED,
        sim_trials=1,
        min_consecutive_free_hours=6.0,
        balance_total_hours=True,
        total_hours_slack=0.0,
        max_consecutive_duty_blocks=2,
        min_free_shifts_after_duty=2,
        band_relative=0.2,
        plan_day_start_hour=5,
        availability=None,
        anchor=ANCHOR,
        type_codes=None,
    )
    return list(pack[3])


def _run_extend_from_prefix(
    prefix: list[g.AssignmentRecord],
    *,
    prefix_days: int,
    extend_days: int,
    seed: int,
) -> list[g.AssignmentRecord]:
    zone = _zone()
    pack = g.run_simulation_checkpoint_extend(
        SOLDIERS,
        SLOTS,
        prefix,
        prefix_days,
        extend_days,
        zone,
        zone.shift_hours,
        random.Random(seed),
        **SIM_KW,
    )
    return list(pack[3])


def test_hot_store_has_one_plan_per_calendar_day() -> None:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "checkpoint.json"
        _run_hot(4, 1, path)
        store = read_hot_store(path)
        assert len(store) == 4
        assert "2026-05-27" in store
        assert "2026-05-30" in store
        for cal, plan in store.items():
            assert plan["days"] == 1
            assert plan["anchor_date"] == cal
            for row in plan["assignments"]:
                assert int(row["day"]) == 0


def test_hot_burst_one_matches_single_cold_burst() -> None:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "checkpoint.json"
        hot = _run_hot(PREFIX_DAYS, PREFIX_DAYS, path)
        cold = _run_cold_days(PREFIX_DAYS, SEED)
        assert _assignment_sig(hot) == _assignment_sig(cold)


def test_hot_incremental_20_days_extend_tail() -> None:
    """Hot burst-days=1 for 20 days; last 5 days match witness extend from cold prefix."""
    cold15 = _run_cold_days(PREFIX_DAYS, SEED)
    witness = g.SimWitnessCapture(split_day=PREFIX_DAYS)
    zone = _zone()
    g.run_simulation(
        SOLDIERS,
        SLOTS,
        PREFIX_DAYS,
        zone,
        zone.shift_hours,
        random.Random(SEED),
        witness=witness,
        **SIM_KW,
    )
    witness.suffix_nonrot = g.suffix_nonrot_from_assignments(cold15, PREFIX_DAYS)
    assert witness.rng_state is not None
    direct_ext = g.run_simulation_checkpoint_extend(
        SOLDIERS,
        SLOTS,
        cold15,
        PREFIX_DAYS,
        EXTEND_DAYS,
        zone,
        zone.shift_hours,
        random.Random(SEED),
        witness_rng_state=witness.rng_state,
        witness_suffix_nonrot=witness.suffix_nonrot,
        **SIM_KW,
    )
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "checkpoint.json"
        hot = _run_hot(TOTAL_DAYS, 1, path)
    sig_direct = _assignment_sig(list(direct_ext[3]), day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    sig_hot = _assignment_sig(hot, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    assert sig_direct == sig_hot


def test_hot_history_reload_matches_store() -> None:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "checkpoint.json"
        _run_hot(PREFIX_DAYS, 1, path)
        zone = _zone()
        keys = g.roster_keys(SOLDIERS)
        prefix, days, cont, last = load_hot_history(
            path, soldier_keys=keys, shift_hours=zone.shift_hours
        )
        assert days == PREFIX_DAYS
        expected_last = (ANCHOR + __import__("datetime").timedelta(days=PREFIX_DAYS - 1)).strftime(
            "%Y-%m-%d"
        )
        assert last == expected_last
        assert cont is not None
        assert len(prefix) > 0


def test_go_hot_matches_guardsim_cli() -> None:
    subprocess.run(
        ["go", "test", "./guardsched", "-run", "TestHot15Extend5MatchesGuardsimCLI"],
        cwd=ROOT,
        check=True,
    )
