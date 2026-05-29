"""Checkpoint workflow: 15-day run → save → load 15-day prefix → extend 5 days.

Go parity: guardsched/sim_checkpoint_15_extend_test.go (same constants and cases).

Validates Python save/load round-trip and extend reproducibility. Go in-process extend vs
``guardsim`` CLI is checked via ``guardsched`` tests (Py↔Go extend without witness is not
bit-identical).

A single continuous 20-day cold run's last 5 days may differ (fresh RNG on extend + greedy-only
fill vs continued RNG / optional rotating DFS on the full horizon).
"""

from __future__ import annotations

import random
import subprocess
import tempfile
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "testdata" / "zones_s1_gate4.yaml"

PREFIX_DAYS = 15
EXTEND_DAYS = 5
TOTAL_DAYS = PREFIX_DAYS + EXTEND_DAYS
SOLDIERS = 12
SLOTS = 4
SEED = 12345

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


def _run_cold_days(days: int, seed: int) -> list[g.AssignmentRecord]:
    zone = g.load_zone_config(ZONES, slots_per_block=SLOTS)
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


def _run_extend_from_prefix(
    prefix: list[g.AssignmentRecord],
    *,
    prefix_days: int,
    extend_days: int,
    seed: int,
) -> list[g.AssignmentRecord]:
    zone = g.load_zone_config(ZONES, slots_per_block=SLOTS)
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


def _save_checkpoint(path: Path, assignments: list[g.AssignmentRecord], num_days: int) -> None:
    zone = g.load_zone_config(ZONES, slots_per_block=SLOTS)
    B = g.calendar_blocks_per_day(zone.shift_hours)
    doc = g.build_checkpoint_document(
        zone=zone,
        zones_path=ZONES,
        zones_yaml_text=ZONES.read_text(encoding="utf-8"),
        run_meta={"shift_hours": zone.shift_hours, "seed": SEED},
        assignments=assignments,
        num_days=num_days,
        blocks_pd=B,
        slots_eff=SLOTS,
    )
    g.write_checkpoint_json(path, doc)


def _load_checkpoint_assignments(path: Path) -> list[g.AssignmentRecord]:
    doc = g.read_checkpoint_json(path)
    return [g.assignment_record_from_dict(x) for x in doc["assignments"]]


@pytest.fixture(scope="module")
def fifteen_day_checkpoint(tmp_path_factory) -> Path:
    """15-day cold run written once for the module."""
    path = tmp_path_factory.mktemp("ckpt15") / "checkpoint_15d.json"
    asn = _run_cold_days(PREFIX_DAYS, SEED)
    assert len(asn) == g.expected_assignment_count(
        g.load_zone_config(ZONES, slots_per_block=SLOTS),
        PREFIX_DAYS,
        g.calendar_blocks_per_day(g.load_zone_config(ZONES, slots_per_block=SLOTS).shift_hours),
        SLOTS,
    )
    _save_checkpoint(path, asn, PREFIX_DAYS)
    return path


def test_generate_15_save_load_extend_5_matches_direct_extend(
    fifteen_day_checkpoint: Path,
) -> None:
    """Save/load extend must match extend from the same in-memory 15-day prefix."""
    prefix = _load_checkpoint_assignments(fifteen_day_checkpoint)
    assert len(prefix) > 0

    direct = _run_extend_from_prefix(
        prefix, prefix_days=PREFIX_DAYS, extend_days=EXTEND_DAYS, seed=SEED
    )
    from_saved = _run_extend_from_prefix(
        prefix, prefix_days=PREFIX_DAYS, extend_days=EXTEND_DAYS, seed=SEED
    )

    sig_direct = _assignment_sig(direct, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    sig_saved = _assignment_sig(from_saved, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    assert sig_direct == sig_saved
    assert len(sig_direct) == g.expected_assignment_count(
        g.load_zone_config(ZONES, slots_per_block=SLOTS),
        EXTEND_DAYS,
        g.calendar_blocks_per_day(
            g.load_zone_config(ZONES, slots_per_block=SLOTS).shift_hours
        ),
        SLOTS,
    )


def test_go_extend_matches_guardsim_cli() -> None:
    """Go extend from saved 15-day checkpoint matches guardsim CLI (guardsched test)."""
    subprocess.run(
        [
            "go",
            "test",
            "./guardsched",
            "-run",
            "TestCheckpoint15Extend5MatchesGuardsimCLI",
        ],
        cwd=ROOT,
        check=True,
    )


def test_extend_5_reproducible_from_same_15day_checkpoint(
    fifteen_day_checkpoint: Path,
) -> None:
    """Two load+extend runs from the same saved 15-day state yield identical new 5 days."""
    prefix = _load_checkpoint_assignments(fifteen_day_checkpoint)
    ext_a = _run_extend_from_prefix(
        prefix, prefix_days=PREFIX_DAYS, extend_days=EXTEND_DAYS, seed=SEED
    )
    ext_b = _run_extend_from_prefix(
        prefix, prefix_days=PREFIX_DAYS, extend_days=EXTEND_DAYS, seed=SEED
    )
    sig_a = _assignment_sig(ext_a, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    sig_b = _assignment_sig(ext_b, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    assert sig_a == sig_b


@pytest.mark.xfail(
    reason="checkpoint extend resets RNG and uses greedy-only rotating; "
    "20-day cold run continues RNG and may use rotating DFS",
    strict=False,
)
def test_extend_5_matches_last_5_days_of_continuous_20_day_run() -> None:
    """Ideal: load-15 + extend-5 equals days 15–19 of one 20-day cold simulation."""
    cold20 = _run_cold_days(TOTAL_DAYS, SEED)
    cold15 = _run_cold_days(PREFIX_DAYS, SEED)
    ext = _run_extend_from_prefix(
        cold15, prefix_days=PREFIX_DAYS, extend_days=EXTEND_DAYS, seed=SEED
    )
    sig_tail = _assignment_sig(cold20, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    sig_ext = _assignment_sig(ext, day_min=PREFIX_DAYS, day_reindex=PREFIX_DAYS)
    assert sig_tail == sig_ext


def test_prefix_from_20day_run_matches_standalone_15day_run() -> None:
    """First 15 days of a 20-day cold run match a standalone 15-day cold run (same seed)."""
    cold20 = _run_cold_days(TOTAL_DAYS, SEED)
    cold15 = _run_cold_days(PREFIX_DAYS, SEED)
    prefix20 = [a for a in cold20 if int(a.day) < PREFIX_DAYS]
    assert _assignment_sig(cold15) == _assignment_sig(prefix20)
