"""full_day hours_factor — mirror guardsched/full_day_hours_factor_test.go."""

from __future__ import annotations

import random
from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g

_KITCHEN_YAML = """schema_version: 2
shift_hours: 4
slots_types:
  - id: kitchen
    pattern: full_day
    config:
      start: "06:00"
      end: "22:00"
      hours_factor: 0.5
      weight_multiplier: 1.0
      headcount: 1
zone_loc:
  - { id: loc, type: kitchen, name: K, weight: 1.0 }
slots:
  - { location_id: loc, name: k1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
"""


def _kitchen_zone(tmp_path: Path) -> g.ZoneConfig:
    p = tmp_path / "zones.yaml"
    p.write_text(_KITCHEN_YAML, encoding="utf-8")
    return g.load_zone_config(p, slots_per_block=1)


def test_load_zone_config_full_day_hours_factor(tmp_path: Path) -> None:
    zone = _kitchen_zone(tmp_path)
    cfg = zone.full_day_specs["kitchen"]
    assert cfg["hours_factor"] == pytest.approx(0.5)


def test_run_simulation_full_day_hours_factor(tmp_path: Path) -> None:
    zone = _kitchen_zone(tmp_path)
    type_codes = ["E"]
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack = g.run_simulation(
        num_soldiers=4,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        rng=random.Random(42),
        min_consecutive_free_hours=6.0,
        balance_total_hours=True,
        band_relative=0.2,
        anchor=anchor,
        type_codes=type_codes,
    )
    recs = pack[3]
    assert len(recs) == 1
    a = recs[0]
    assert a.kind == "full_day"
    assert a.raw_hours == pytest.approx(17.0 * 0.5)
    assert g.pattern_hours_factor(zone, a) == pytest.approx(0.5)
    assert a.weight > 0
