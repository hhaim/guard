"""Split/load checkpoint parity for zones_4s.yaml (12 soldiers, 4 gate slots).

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
ZONES = ROOT / "zones_4s.yaml"
GUARDSIM = ROOT / "bin" / "guardsim"

SOLDIERS = 12
SLOTS = 4
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


def _load_zone() -> g.ZoneConfig:
    return g.load_zone_config(ZONES, slots_per_block=SLOTS)


def _run_cold_with_witness(
    end: int, split: int, seed: int
) -> tuple[list[g.AssignmentRecord], g.SimWitnessCapture]:
    zone = _load_zone()
    witness = g.SimWitnessCapture(split_day=split)
    pack = g.run_simulation(
        SOLDIERS,
        SLOTS,
        end,
        zone,
        zone.shift_hours,
        random.Random(seed),
        witness=witness,
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
    cold: list[g.AssignmentRecord],
    witness: g.SimWitnessCapture,
) -> list[g.AssignmentRecord]:
    zone = _load_zone()
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
        witness_rng_state=witness.rng_state,
        witness_suffix_nonrot=witness.suffix_nonrot,
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
    end, split = _trial_params(trial)
    cold, witness = _run_cold_with_witness(end, split, SEED)
    merged = _run_split_load_witness(end, split, SEED, cold, witness)
    cold_pre = _assignment_sig([a for a in cold if int(a.day) < split])
    merged_pre = _assignment_sig([a for a in merged if int(a.day) < split])
    assert cold_pre == merged_pre


@pytest.mark.parametrize("trial", range(10))
def test_split_load_full_history_matches_cold(trial: int) -> None:
    end, split = _trial_params(trial)
    cold, witness = _run_cold_with_witness(end, split, SEED)
    merged = _run_split_load_witness(end, split, SEED, cold, witness)
    assert _assignment_sig(cold) == _assignment_sig(merged)


def test_hot_witness_roundtrip_extend() -> None:
    """Hot burst-days=1 reload from disk matches witness extend."""
    from datetime import datetime, timezone

    from hot_store import DEFAULT_HOT_STATE

    zone = _load_zone()
    end, split = 14, 8
    cold, witness = _run_cold_with_witness(end, split, SEED)
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
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
            type_codes=None,
        )
        hot = list(pack[3])
    merged = _run_split_load_witness(end, split, SEED, cold, witness)
    assert _assignment_sig(cold) == _assignment_sig(hot)
    assert _assignment_sig(merged) == _assignment_sig(hot)


@pytest.mark.skipif(not GUARDSIM.is_file(), reason="guardsim binary not built")
def test_guardsim_hot_cli() -> None:
    """guardsim -hot writes checkpoint.json and runs."""
    subprocess.run(
        ["go", "test", "./guardsched", "-run", "TestWitnessSplitLoadZones4s"],
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
                "--json-output",
                "-",
                "--quiet",
            ],
            check=True,
            cwd=tmp,
        )
        assert (Path(tmp) / "checkpoint.json").is_file()
