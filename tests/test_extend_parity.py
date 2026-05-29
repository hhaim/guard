"""Parity: Go RunSimulationZoneConfigExtend vs Python run_simulation_checkpoint_extend."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "testdata" / "zones_s1_gate4.yaml"
GUARDSIM = ROOT / "bin" / "guardsim"


@pytest.fixture(scope="session")
def guardsim_bin() -> Path:
    subprocess.run(
        ["go", "build", "-o", str(GUARDSIM), "./cmd/guardsim"],
        cwd=ROOT,
        check=True,
    )
    return GUARDSIM


def _sig(assignments: list) -> list[tuple]:
    rows = []
    for a in assignments:
        rows.append(
            (
                int(a.day),
                int(a.calendar_block),
                int(a.slot),
                int(a.soldier_idx),
                str(getattr(a, "kind", "rotating") or "rotating"),
            )
        )
    return sorted(rows)


def _go_extend_signatures(
    guardsim: Path,
    *,
    prefix: list[g.AssignmentRecord],
    prefix_days: int,
    extend_days: int,
    seed: int,
    soldiers: int,
    slots: int,
) -> list[tuple]:
    import json
    import tempfile

    zone = g.load_zone_config(ZONES, slots_per_block=slots)
    doc = g.build_checkpoint_document(
        zone=zone,
        zones_path=ZONES,
        zones_yaml_text=ZONES.read_text(),
        run_meta={"shift_hours": zone.shift_hours},
        assignments=prefix,
        num_days=prefix_days,
        blocks_pd=g.calendar_blocks_per_day(zone.shift_hours),
        slots_eff=slots,
    )
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(doc, f)
        ckpt = f.name
    out = subprocess.run(
        [
            str(guardsim),
            "-zones",
            str(ZONES),
            "-x",
            str(soldiers),
            "-y",
            str(slots),
            "-load-state",
            ckpt,
            "-extend-days",
            str(extend_days),
            "-seed",
            str(seed),
            "-min-consecutive-free-hours",
            "6",
            "-min-free-shifts-after-duty",
            "2",
            "-band-relative",
            "0.2",
            "-json-output",
            "-",
            "-quiet",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(out.stdout)
    new = []
    for a in payload.get("assignments", []):
        new.append(
            (
                int(a["day"]),
                int(a["calendar_block"]),
                int(a["slot"]),
                int(a["soldier_idx"]),
                str(a.get("kind", "rotating") or "rotating"),
            )
        )
    return sorted(new)


def test_go_extend_matches_python_checkpoint_extend(guardsim_bin: Path) -> None:
    soldiers, slots, seed = 12, 4, 42
    zone = g.load_zone_config(ZONES, slots_per_block=slots)
    blocks_pd = g.calendar_blocks_per_day(zone.shift_hours)
    rng = __import__("random").Random(seed)
    _, _, _, prefix_all, *_ = g.run_simulation(
        num_soldiers=soldiers,
        slots_per_block=slots,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        rng=rng,
        min_consecutive_free_hours=6,
        min_free_shifts_after_duty=2,
        band_relative=0.2,
    )
    prefix_days = 1
    extend_days = 1
    py_rng = __import__("random").Random(seed)
    _, _, _, py_asn, *_ = g.run_simulation_checkpoint_extend(
        num_soldiers=soldiers,
        slots_per_block=slots,
        prefix_assignments=prefix_all,
        prefix_days=prefix_days,
        extend_days=extend_days,
        zone=zone,
        block_hours=zone.shift_hours,
        rng=py_rng,
        min_consecutive_free_hours=6,
        min_free_shifts_after_duty=2,
        band_relative=0.2,
    )
    py_new = _sig([a for a in py_asn if int(a.day) >= prefix_days])
    for a in py_new:
        # reindex to plan day 0
        pass
    py_new = sorted(
        (d - prefix_days, b, s, si, k) for d, b, s, si, k in py_new
    )

    go_new = _go_extend_signatures(
        guardsim_bin,
        prefix=prefix_all,
        prefix_days=prefix_days,
        extend_days=extend_days,
        seed=seed,
        soldiers=soldiers,
        slots=slots,
    )
    assert py_new == go_new, f"python={py_new[:5]}... go={go_new[:5]}..."


def test_prefix_last_block_cooldown_go_matches_gap_math(guardsim_bin: Path) -> None:
    """S0 on last rotating block of prefix day cannot take blocks 0-1 of extend day (Go extend)."""
    soldiers, slots = 12, 4
    zone = g.load_zone_config(ZONES, slots_per_block=slots)
    B = g.calendar_blocks_per_day(zone.shift_hours)
    last_b = B - 1
    prefix = [
        g.AssignmentRecord(
            day=0,
            calendar_block=last_b,
            start_hour=0,
            slot=0,
            soldier_idx=0,
            loc_i=0,
            time_j=0,
            weight=4.0,
            raw_hours=4.0,
            kind="rotating",
        )
    ]
    go_new = _go_extend_signatures(
        guardsim_bin,
        prefix=prefix,
        prefix_days=1,
        extend_days=1,
        seed=99,
        soldiers=soldiers,
        slots=slots,
    )
    for _d, b, _s, si, k in go_new:
        if si == 0 and k == "rotating" and b < 2:
            pytest.fail(f"go: S0 on block {b} violates cooldown")
    import numpy as np

    busy_rot = np.zeros((2, soldiers, B), dtype=bool)
    busy_rot[0, 0, last_b] = True
    assert g.gap_free_blocks_since_last_duty_before_assign(busy_rot, 1, 0, 0, B) == 0
    assert g.gap_free_blocks_since_last_duty_before_assign(busy_rot, 1, 1, 0, B) == 1

