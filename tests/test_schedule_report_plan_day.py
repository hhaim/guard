"""Report windows and timelines must respect --plan-day-start (not midnight block grid)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import guard_scheduler_sim as g  # noqa: E402

ZONES_S1_GATE4 = ROOT / "testdata" / "zones_s1_gate4.yaml"
PLAN_START = 5


def test_block_windows_plan_day_start_s1() -> None:
    """Block grid for zones_s1 (4h shifts, start 05:00): b0=05–09, b5=01–05 next day."""
    zone = g.load_zone_config(ZONES_S1_GATE4, 4)
    sh = zone.shift_hours
    blocks = g.calendar_blocks_per_day(sh)
    wins = [g.format_block_window(g.block_start_hour(PLAN_START, b, sh), sh) for b in range(blocks)]
    assert wins[0] == "05:00–09:00"
    assert wins[5] == "01:00–05:00"
    assert wins != [g.format_block_window(int(b * sh), sh) for b in range(blocks)]


def test_day_schedule_matrix_html_plan_day_start() -> None:
    zone = g.load_zone_config(ZONES_S1_GATE4, 4)
    html = g.build_day_schedule_matrix_html(
        [],
        days=1,
        blocks_pd=g.calendar_blocks_per_day(zone.shift_hours),
        slots_per_block=4,
        block_hours=zone.shift_hours,
        zone=zone,
        plan_day_start_hour=PLAN_START,
    )
    assert "05:00–09:00" in html
    assert "01:00–05:00" in html
    assert "00:00–04:00" not in html


def test_build_soldier_timeline_figure_accepts_plan_start() -> None:
    pytest.importorskip("matplotlib")
    import matplotlib.pyplot as plt
    import numpy as np

    busy = np.zeros((1, 2, 6), dtype=bool)
    busy[0, 0, 2] = True
    fig = g.build_soldier_timeline_figure(
        busy, 4.0, "test", plan_day_start_hour=PLAN_START
    )
    assert fig is not None
    plt.close(fig)
