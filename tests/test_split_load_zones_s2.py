"""Split/load checkpoint parity for zones_s2.yaml + roaster1.yaml (18 soldiers, 5 slots).

Scenario 1: one cold run for ``end`` calendar days.
Scenario 2: prefix from scenario 1 + witness RNG/suffix, extend to ``end``.

Assignment history on ``0 .. end-1`` must match (Python + guardsim when built).
"""

from __future__ import annotations

import random
import subprocess
import tempfile
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "zones_s2.yaml"
ROSTER = ROOT / "roaster1.yaml"
GUARDSIM = ROOT / "bin" / "guardsim"

SOLDIERS = 18
SLOTS = 5
SEED = 42

SIM_KW = dict(
    min_consecutive_free_hours=6.0,
    min_free_shifts_after_duty=2,
    band_relative=0.2,
)


def _assignment_sig(
    recs: list[g.AssignmentRecord],
) -> list[tuple[int, int, int, int, str]]:
    return sorted(
        (
            int(a.day),
            int(a.calendar_block),
            int(a.slot),
            int(a.soldier_idx),
            str(getattr(a, "kind", "rotating") or "rotating"),
        )
        for a in recs
    )


def _load_zone_and_roster() -> tuple[g.ZoneConfig, list[str]]:
    zone = g.load_zone_config(ZONES, slots_per_block=SLOTS)
    type_codes = g.load_roster_type_codes_yaml(ROSTER, g.roster_keys(SOLDIERS))
    return zone, type_codes


def _run_cold_with_witness(
    end: int, split: int, seed: int, type_codes: list[str], *, anchor=None
) -> tuple[list[g.AssignmentRecord], g.SimWitnessCapture]:
    zone, _ = _load_zone_and_roster()
    witness = g.SimWitnessCapture(split_day=split)
    pack = g.run_simulation(
        SOLDIERS,
        SLOTS,
        end,
        zone,
        zone.shift_hours,
        random.Random(seed),
        type_codes=type_codes,
        witness=witness,
        anchor=anchor,
        **SIM_KW,
    )
    cold = list(pack[3])
    assert witness.captured and witness.rng_state is not None
    witness.suffix_nonrot = g.suffix_nonrot_from_assignments(cold, split)
    return cold, witness


def _run_split_load_witness(
    end: int,
    split: int,
    seed: int,
    type_codes: list[str],
    cold: list[g.AssignmentRecord],
    witness: g.SimWitnessCapture,
    *,
    anchor=None,
) -> list[g.AssignmentRecord]:
    zone, _ = _load_zone_and_roster()
    prefix = [a for a in cold if int(a.day) < split]
    pack = g.run_simulation_checkpoint_extend(
        SOLDIERS,
        SLOTS,
        prefix,
        split,
        end - split,
        zone,
        zone.shift_hours,
        random.Random(seed),
        type_codes=type_codes,
        witness_rng_state=witness.rng_state,
        witness_suffix_nonrot=witness.suffix_nonrot,
        anchor=anchor,
        **SIM_KW,
    )
    return list(pack[3])


def _trial_params(trial: int) -> tuple[int, int]:
    rng = random.Random(SEED + 1000 + trial)
    end = rng.randint(10, 30)
    split = rng.randint(5, min(20, end - 1))
    return end, split


@pytest.mark.parametrize("trial", range(10))
def test_split_load_prefix_days_match_cold(trial: int) -> None:
    _, type_codes = _load_zone_and_roster()
    end, split = _trial_params(trial)
    cold, witness = _run_cold_with_witness(end, split, SEED, type_codes)
    merged = _run_split_load_witness(end, split, SEED, type_codes, cold, witness)
    cold_pre = _assignment_sig([a for a in cold if int(a.day) < split])
    merged_pre = _assignment_sig([a for a in merged if int(a.day) < split])
    assert cold_pre == merged_pre


@pytest.mark.parametrize("trial", range(10))
def test_split_load_full_history_matches_cold(trial: int) -> None:
    _, type_codes = _load_zone_and_roster()
    end, split = _trial_params(trial)
    cold, witness = _run_cold_with_witness(end, split, SEED, type_codes)
    merged = _run_split_load_witness(end, split, SEED, type_codes, cold, witness)
    assert _assignment_sig(cold) == _assignment_sig(merged)


def test_hot_witness_roundtrip_extend() -> None:
    """Hot burst-days=1 produces a valid store for mixed zones (incremental != cold N-day)."""
    from datetime import datetime, timezone

    from hot_store import DEFAULT_HOT_STATE, load_hot_history, read_hot_store

    zone, type_codes = _load_zone_and_roster()
    end = 14
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    keys = g.roster_keys(SOLDIERS)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / DEFAULT_HOT_STATE.name
        pack, _ = g.run_simulation_hot(
            total_days=end,
            burst_days=1,
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
            anchor=anchor,
            type_codes=type_codes,
        )
        hot = list(pack[3])
        store = read_hot_store(path)
        assert len(store) == end
        blocks_pd = g.calendar_blocks_per_day(zone.shift_hours)
        exp = g.expected_assignment_count(
            zone, end, blocks_pd, SLOTS, anchor=anchor, plan_start_hour=5
        )
        assert len(hot) == exp
        prefix, days, cont, _ = load_hot_history(
            path, soldier_keys=keys, shift_hours=zone.shift_hours
        )
        assert days == end
        assert len(prefix) == exp
        assert cont is not None


@pytest.mark.skipif(not GUARDSIM.is_file(), reason="guardsim binary not built")
def test_guardsim_hot_cli() -> None:
    """guardsim -hot writes checkpoint.json and runs."""
    subprocess.run(
        ["go", "test", "./guardsched", "-run", "TestWitnessSplitLoadZonesS2"],
        check=True,
        cwd=ROOT,
    )
    subprocess.run(
        ["go", "build", "-o", str(GUARDSIM), "./cmd/guardsim"],
        check=True,
        cwd=ROOT,
    )
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [
                str(GUARDSIM),
                "-x",
                str(SOLDIERS),
                "-y",
                str(SLOTS),
                "-d",
                "3",
                "-hot",
                "-burst-days",
                "1",
                "-anchor-date",
                "2026-05-27",
                "--seed",
                str(SEED),
                "--min-consecutive-free-hours",
                "6",
                "--min-free-shifts-after-duty",
                "2",
                "--band-relative",
                "0.2",
                "--zones",
                str(ZONES),
                "--roster",
                str(ROSTER),
                "--json-output",
                "-",
                "--quiet",
            ],
            check=True,
            cwd=tmp,
        )
        assert (Path(tmp) / "checkpoint.json").is_file()
