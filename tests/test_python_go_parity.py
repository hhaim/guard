"""Cross-check Go guardsim schedules against the Python reference simulator.

Builds ``bin/guardsim`` once per session. All-rotating zones (``zones_s1.yaml``) use the
canonical per-day matrix JSON; mixed zones compare sorted assignment tuples because not
every slot is staffed in every calendar block.

Run::

    python3 -m pytest tests/test_python_go_parity.py -v
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
ZONES_S1 = ROOT / "zones_s1.yaml"
ZONES_MIXED = ROOT / "zones_mixed_patterns.yaml"
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


def _day_matrices(doc: dict[str, Any]) -> list[list[list[int]]]:
    days = int(doc["meta"]["days"])
    return [doc[f"day{d}"]["matrix"] for d in range(days)]


def _assignment_signature_py(assignments: list[g.AssignmentRecord]) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    for a in assignments:
        rows.append(
            (
                int(a.day),
                int(a.calendar_block),
                int(a.slot),
                int(a.soldier_idx),
                str(getattr(a, "kind", "rotating") or "rotating"),
                int(a.win_start_block),
                int(a.win_end_block),
                str(a.window_name or ""),
            )
        )
    return sorted(rows)


def _assignment_signature_go(assignments: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    for a in assignments:
        rows.append(
            (
                int(a["day"]),
                int(a["calendar_block"]),
                int(a["slot"]),
                int(a["soldier_idx"]),
                str(a.get("kind", "rotating") or "rotating"),
                int(a.get("win_start_block", a["calendar_block"])),
                int(a.get("win_end_block", a["calendar_block"])),
                str(a.get("window_name") or ""),
            )
        )
    return sorted(rows)


def _run_python(
    zones_path: Path,
    *,
    soldiers: int,
    slots: int,
    days: int,
    seed: int,
    shift_hours: float | None,
    min_consecutive_free_hours: float,
    min_free_shifts_after_duty: int,
    band_relative: float,
    plan_day_start: str = "05:00",
) -> tuple[list[g.AssignmentRecord], g.ZoneConfig, int]:
    zone = g.load_zone_config(
        zones_path,
        slots_per_block=slots,
        shift_hours_override=shift_hours,
    )
    blocks_pd = g.calendar_blocks_per_day(zone.shift_hours)
    pack, _meta = g.run_simulation_best_of(
        trials=1,
        base_seed=seed,
        num_soldiers=soldiers,
        slots_per_block=slots,
        days=days,
        zone=zone,
        block_hours=zone.shift_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=band_relative,
        plan_day_start_hour=g.parse_plan_day_start(plan_day_start),
    )
    return pack[3], zone, blocks_pd


def _run_guardsim_json(
    guardsim_bin: Path,
    zones_path: Path,
    *,
    soldiers: int,
    slots: int,
    days: int,
    seed: int,
    shift_hours: float | None,
    min_consecutive_free_hours: float,
    min_free_shifts_after_duty: int,
    band_relative: float,
    compare_json: bool,
    plan_day_start: str = "05:00",
) -> dict[str, Any]:
    cmd = [
        str(guardsim_bin),
        "-x",
        str(soldiers),
        "-y",
        str(slots),
        "-d",
        str(days),
        "--zones",
        str(zones_path),
        "--seed",
        str(seed),
        "--sim-trials",
        "1",
        "--min-consecutive-free-hours",
        str(min_consecutive_free_hours),
        "--min-free-shifts-after-duty",
        str(min_free_shifts_after_duty),
        "--band-relative",
        str(band_relative),
        "--plan-day-start",
        plan_day_start,
        "--quiet",
    ]
    if compare_json:
        cmd.extend(["--compare-json", "-"])
    else:
        cmd.extend(["--json-output", "-"])
    if shift_hours is not None:
        sh = int(shift_hours) if shift_hours == int(shift_hours) else shift_hours
        cmd.extend(["--shift-hours", str(sh)])
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(
            f"guardsim failed (exit {proc.returncode}):\n{proc.stderr}\n{proc.stdout}"
        )
    return json.loads(proc.stdout)


MATRIX_CASES = [
    pytest.param(
        ZONES_S1,
        12,
        4,
        1,
        4.0,
        7,
        6.0,
        2,
        id="s1-12x4-d1-seed7",
    ),
    pytest.param(
        ZONES_S1,
        12,
        4,
        3,
        4.0,
        3,
        6.0,
        2,
        id="s1-12x4-d3-seed3",
    ),
    pytest.param(
        ZONES_S1,
        16,
        4,
        1,
        4.0,
        42,
        8.0,
        0,
        id="s1-16x4-d1-seed42",
    ),
]

ASSIGNMENT_CASES = [
    pytest.param(
        ZONES_MIXED,
        50,
        15,
        1,
        None,
        11,
        8.0,
        2,
        id="mixed-50x15-d1-seed11",
    ),
    pytest.param(
        ZONES_MIXED,
        50,
        15,
        2,
        None,
        7,
        6.0,
        2,
        id="mixed-50x15-d2-seed7",
    ),
]


@pytest.mark.parametrize(
    (
        "zones_path",
        "soldiers",
        "slots",
        "days",
        "shift_hours",
        "seed",
        "min_consecutive_free_hours",
        "min_free_shifts_after_duty",
    ),
    MATRIX_CASES,
)
def test_python_go_schedule_matrix_parity(
    guardsim_bin: Path,
    zones_path: Path,
    soldiers: int,
    slots: int,
    days: int,
    shift_hours: float | None,
    seed: int,
    min_consecutive_free_hours: float,
    min_free_shifts_after_duty: int,
) -> None:
    data = yaml.safe_load(zones_path.read_text(encoding="utf-8"))
    assert len(data["slots"]) == slots

    assignments, zone, blocks_pd = _run_python(
        zones_path,
        soldiers=soldiers,
        slots=slots,
        days=days,
        seed=seed,
        shift_hours=shift_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=0.2,
    )
    py_doc = g.schedule_compare_json_document(
        zone,
        assignments,
        days=days,
        blocks_pd=blocks_pd,
        slots_per_block=slots,
        block_hours=zone.shift_hours,
        num_soldiers=soldiers,
        extra_meta={"source": "python"},
    )
    go_doc = _run_guardsim_json(
        guardsim_bin,
        zones_path,
        soldiers=soldiers,
        slots=slots,
        days=days,
        seed=seed,
        shift_hours=shift_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=0.2,
        compare_json=True,
    )

    assert py_doc["format_version"] == go_doc["format_version"] == 1
    for key in ("days", "blocks_per_day", "slots", "soldiers"):
        assert py_doc["meta"][key] == go_doc["meta"][key], key
    assert _day_matrices(py_doc) == _day_matrices(go_doc)


@pytest.mark.parametrize(
    (
        "zones_path",
        "soldiers",
        "slots",
        "days",
        "shift_hours",
        "seed",
        "min_consecutive_free_hours",
        "min_free_shifts_after_duty",
    ),
    ASSIGNMENT_CASES,
)
def test_python_go_assignments_parity(
    guardsim_bin: Path,
    zones_path: Path,
    soldiers: int,
    slots: int,
    days: int,
    shift_hours: float | None,
    seed: int,
    min_consecutive_free_hours: float,
    min_free_shifts_after_duty: int,
) -> None:
    data = yaml.safe_load(zones_path.read_text(encoding="utf-8"))
    assert len(data["slots"]) == slots

    py_assignments, zone, blocks_pd = _run_python(
        zones_path,
        soldiers=soldiers,
        slots=slots,
        days=days,
        seed=seed,
        shift_hours=shift_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=0.2,
    )
    go_doc = _run_guardsim_json(
        guardsim_bin,
        zones_path,
        soldiers=soldiers,
        slots=slots,
        days=days,
        seed=seed,
        shift_hours=shift_hours,
        min_consecutive_free_hours=min_consecutive_free_hours,
        min_free_shifts_after_duty=min_free_shifts_after_duty,
        band_relative=0.2,
        compare_json=False,
    )

    expect = g.expected_assignment_count(zone, days, blocks_pd, slots)
    assert len(py_assignments) == expect
    assert go_doc["count"] == expect
    assert _assignment_signature_py(py_assignments) == _assignment_signature_go(
        go_doc["assignments"]
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
