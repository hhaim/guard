"""Plan / history UI (React) soldier table weights match Go sim + zones YAML."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
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


def test_plan_ui_soldier_span_weights_from_go_assignments(
    guardsim_bin: Path, tmp_path: Path, web_node_modules: None
) -> None:
    """
    PlanDocView / Stats history use ScheduleResultsReport → buildSoldierBlockRows (TS).
    Verify L span rows show duty+rest weights (not em dash) for Go-produced assignments.
    """
    go_json = tmp_path / "assign.json"
    subprocess.run(
        [
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
            str(go_json),
            "--quiet",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    script = WEB / "scripts" / "verify-plan-soldier-weight.ts"
    proc = subprocess.run(
        [
            "npx",
            "--yes",
            "tsx",
            str(script),
            str(ZONES),
            str(go_json),
        ],
        cwd=WEB,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        pytest.fail(
            f"plan UI weight check failed:\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    data = json.loads(proc.stdout.strip())
    assert data["soldier_idx"] == 1
    assert data["kitchen_team_wm"] == pytest.approx(1.1)
    # Day band block (13:00): 4 × 1.0 × 1.0 × 1.1
    assert data["day_block_weight"] == pytest.approx(4.4)
    # Morning block (09:00): 4 × 1.0 × 0.9 × 1.1
    assert data["morning_block_weight"] == pytest.approx(3.96)
    assert data["morning_row"]["weight"] == "3.9600"
    assert data["day_row"]["weight"] == "4.4000"
    assert data["morning_row"]["rest"] is True
    assert data["morning_row"]["location"] == "L"
