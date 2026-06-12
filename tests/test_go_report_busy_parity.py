"""Go guardsim assignments → Python/TS report busy tensor parity (timeline = soldier table)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parents[1]
ZONES = ROOT / "zones_next_day_full.yaml"
ROSTER = ROOT / "roaster1.yaml"
GUARDSIM = ROOT / "bin" / "guardsim"


@pytest.fixture(scope="session")
def guardsim_bin() -> Path:
    if not GUARDSIM.is_file():
        subprocess.run(
            ["go", "build", "-o", str(GUARDSIM), "./cmd/guardsim"],
            cwd=ROOT,
            check=True,
        )
    return GUARDSIM


def _run_guardsim_assignments(guardsim_bin: Path) -> list[dict[str, Any]]:
    cmd = [
        str(guardsim_bin),
        "-x",
        "22",
        "-y",
        "5",
        "-d",
        "2",
        "--zones",
        str(ZONES),
        "--seed",
        "42",
        "--min-consecutive-free-hours",
        "6",
        "--min-free-shifts-after-duty",
        "2",
        "--roster",
        str(ROSTER),
        "--json-output",
        "-",
        "--quiet",
    ]
    out = subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True)
    doc = json.loads(out.stdout)
    return doc["assignments"]


def test_go_json_busy_tensor_matches_python_report(guardsim_bin: Path) -> None:
    """API/Go path: linear_busy_span_blocks + calendar_block → same red bars as Python HTML."""
    go_raw = _run_guardsim_assignments(guardsim_bin)
    go_recs = [g.assignment_record_from_dict(a) for a in go_raw]

    zone = g.load_zone_config(ZONES, slots_per_block=5)
    B = g.calendar_blocks_per_day(zone.shift_hours)
    busy_tl = g.build_busy_tensor(go_recs, 2, 22, B, include_yaml_rest=True)
    lookup = g.build_linear_busy_block_lookup(go_recs, 2, B)

    soldier = 1  # UI Soldier S1 (soldier_idx 1)
    day, block = 0, 1  # plan day 1, block 2 (09:00–13:00)

    assert (soldier, day, block) in lookup
    assert lookup[(soldier, day, block)].loc_i == 2  # L kitchen team
    assert busy_tl[day, soldier, block]

    for key in lookup:
        assert busy_tl[key[1], key[0], key[2]], f"timeline red missing for {key}"

    busy_duty = g.build_busy_tensor(go_recs, 2, 22, B, include_yaml_rest=False)
    assert busy_duty[day, soldier, block]
