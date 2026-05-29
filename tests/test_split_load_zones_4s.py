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


def test_checkpoint_v2_witness_roundtrip_extend() -> None:
    """Save v2 checkpoint with witness fields; load and extend matches cold."""
    zone = _load_zone()
    end, split = 14, 8
    cold, witness = _run_cold_with_witness(end, split, SEED)
    prefix = [a for a in cold if int(a.day) < split]
    B = g.calendar_blocks_per_day(zone.shift_hours)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ckpt.json"
        doc = g.build_checkpoint_document(
            zone=zone,
            zones_path=ZONES,
            zones_yaml_text=ZONES.read_text(encoding="utf-8"),
            run_meta={"shift_hours": zone.shift_hours, "seed": SEED},
            assignments=prefix,
            num_days=split,
            blocks_pd=B,
            slots_eff=SLOTS,
            seed=SEED,
            rng_state=witness.rng_state,
            suffix_nonrot=witness.suffix_nonrot,
            target_horizon=end,
        )
        g.write_checkpoint_json(path, doc)
        loaded = g.read_checkpoint_json(path)
        assert loaded["format_version"] == g.CHECKPOINT_FORMAT_VERSION
        asn = [g.assignment_record_from_dict(x) for x in loaded["assignments"]]
        rng_st = g.rng_state_from_json(loaded["rng_state"])
        suffix = [
            g.assignment_record_from_dict(x)
            for x in loaded.get("suffix_nonrot", [])
        ]
        pack = g.run_simulation_checkpoint_extend(
            SOLDIERS,
            SLOTS,
            asn,
            split,
            end - split,
            zone,
            zone.shift_hours,
            random.Random(SEED),
            witness_rng_state=rng_st,
            witness_suffix_nonrot=suffix,
            **SIM_KW,
        )
        merged = list(pack[3])
    assert _assignment_sig(cold) == _assignment_sig(merged)


def test_checkpoint_save_load_roundtrip() -> None:
    """Save/load checkpoint JSON preserves prefix assignments."""
    zone = _load_zone()
    end, split = 14, 7
    cold, _ = _run_cold_with_witness(end, split, SEED)
    prefix = [a for a in cold if int(a.day) < split]
    B = g.calendar_blocks_per_day(zone.shift_hours)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ckpt.json"
        doc = g.build_checkpoint_document(
            zone=zone,
            zones_path=ZONES,
            zones_yaml_text=ZONES.read_text(encoding="utf-8"),
            run_meta={"shift_hours": zone.shift_hours, "seed": SEED},
            assignments=prefix,
            num_days=split,
            blocks_pd=B,
            slots_eff=SLOTS,
        )
        g.write_checkpoint_json(path, doc)
        loaded = [g.assignment_record_from_dict(x) for x in g.read_checkpoint_json(path)["assignments"]]
    assert _assignment_sig(prefix) == _assignment_sig(loaded)


@pytest.mark.skipif(not GUARDSIM.is_file(), reason="guardsim binary not built")
def test_guardsim_v2_witness_extend_cli() -> None:
    """guardsim loads v2 checkpoint and extends; Go-Go parity in guardsched.TestWitnessSplitLoadZones4s."""
    import subprocess as sp

    sp.run(
        ["go", "test", "./guardsched", "-run", "TestWitnessSplitLoadZones4s"],
        check=True,
        cwd=ROOT,
    )
    zone = _load_zone()
    end, split = 14, 8
    cold, witness = _run_cold_with_witness(end, split, SEED)
    prefix = [a for a in cold if int(a.day) < split]
    B = g.calendar_blocks_per_day(zone.shift_hours)
    with tempfile.TemporaryDirectory() as tmp:
        ckpt = Path(tmp) / "prefix.json"
        doc = g.build_checkpoint_document(
            zone=zone,
            zones_path=ZONES,
            zones_yaml_text=ZONES.read_text(encoding="utf-8"),
            run_meta={"shift_hours": zone.shift_hours, "seed": SEED},
            assignments=prefix,
            num_days=split,
            blocks_pd=B,
            slots_eff=SLOTS,
            seed=SEED,
            rng_state=witness.rng_state,
            suffix_nonrot=witness.suffix_nonrot,
            target_horizon=end,
        )
        g.write_checkpoint_json(ckpt, doc)
        out = sp.run(
            [
                str(GUARDSIM),
                "-x",
                str(SOLDIERS),
                "-y",
                str(SLOTS),
                "-d",
                str(end - split),
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
                "--load-state",
                str(ckpt),
                "--extend-days",
                str(end - split),
                "--json-output",
                "-",
                "--quiet",
            ],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        import json

        payload = json.loads(out.stdout)
        assert payload.get("ok") is True
        rows = payload["assignments"]
        n_rot = sum(
            1
            for a in cold
            if int(a.day) >= split
            and str(getattr(a, "kind", "rotating") or "rotating") == "rotating"
        )
        assert len(rows) == n_rot
