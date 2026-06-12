"""full_day_team fixture — mirror guardsched/full_day_team_test.go."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "testdata" / "full_day_team"

# Match guardsched/full_day_team_test.go RunSimulationZoneConfig args.
_SIM_KW = dict(
    min_consecutive_free_hours=6.0,
    max_consecutive_duty_blocks=2,
    min_free_shifts_after_duty=0,
    band_relative=0.2,
)


def _load_fixture() -> tuple[g.ZoneConfig, list[str]]:
    zone = g.load_zone_config(FIXTURE / "zones.yaml", slots_per_block=1)
    type_codes = g.load_roster_type_codes_yaml(FIXTURE / "roster.yaml", g.roster_keys(12))
    return zone, type_codes


def test_load_zone_config_full_day_team() -> None:
    zone, _ = _load_fixture()
    cfg = zone.full_day_team_specs["team_post"]
    assert cfg["headcount"] == 6
    assert cfg["type_quotas"]["A"] == 1
    assert cfg["type_quotas"]["B"] == 2
    assert cfg["type_quotas"]["C"] == 1
    assert cfg.get("hours_factor", 1.0) == pytest.approx(1.0)


def test_iter_full_day_duty_hours_same_clock_is_24() -> None:
    hours = list(g._iter_full_day_duty_hours(9, 9))
    assert len(hours) == 24
    assert hours[0] == 9
    assert hours[-1] == 8


def test_full_day_team_hours_factor_scales_raw_hours_and_weight() -> None:
    """hours_factor credits a fraction of duty for fairness; busy span unchanged."""
    zone = g.load_zone_config(ROOT / "zones_next_day_full_v1.yaml", slots_per_block=5)
    assert zone.full_day_team_specs["kitchen_team_1"]["hours_factor"] == pytest.approx(0.33)
    type_codes = g.load_roster_type_codes_yaml(ROOT / "roaster1.yaml", g.roster_keys(22))
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=22,
        slots_per_block=5,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        min_consecutive_free_hours=6.0,
        max_consecutive_duty_blocks=0,
        min_free_shifts_after_duty=2,
        band_relative=0.2,
        type_codes=type_codes,
    )
    soldiers = pack[0]
    team = [a for a in pack[3] if a.kind == "full_day_team"]
    assert team
    a = team[0]
    assert a.raw_hours == pytest.approx(24.0 * 0.33)
    assert g.pattern_hours_factor(zone, a) == pytest.approx(0.33)
    # Day band block: 4h × 0.33 × 1.0 × 1.0 × 1.1
    assert g.assignment_calendar_block_weight(zone, a, 2, zone.shift_hours, 5) == pytest.approx(
        4 * 0.33 * 1.1
    )
    assert a.linear_busy_span_blocks is not None
    # Busy span still covers full duty window (not scaled by hours_factor).
    assert a.linear_busy_span_blocks >= g.calendar_blocks_per_day(zone.shift_hours)
    s = soldiers[team[0].soldier_idx]
    per_day = 24.0 * 0.33
    assert s.total_raw_guard_hours() == pytest.approx(per_day, rel=1e-6)
    assert s.raw_loc[2] == pytest.approx(per_day, rel=1e-6)


def test_run_simulation_full_day_team_assignment_count() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 12
    assert all(r.kind == "full_day_team" and r.slot == 0 for r in recs)


def test_run_simulation_full_day_team_type_quotas() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=2,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    for day in range(2):
        counts: dict[str, int] = {}
        for a in recs:
            if a.day != day:
                continue
            if 0 <= a.soldier_idx < len(type_codes):
                tc = type_codes[a.soldier_idx]
                counts[tc] = counts.get(tc, 0) + 1
        assert counts.get("A", 0) >= 1
        assert counts.get("B", 0) >= 2
        assert counts.get("C", 0) >= 1


def _pin_platoon_zone_yaml(tmp_path: Path) -> g.ZoneConfig:
    p = tmp_path / "zones.yaml"
    p.write_text(
        """
schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      pin_platoon: true
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
""",
        encoding="utf-8",
    )
    return g.load_zone_config(p, slots_per_block=1)


def test_load_zone_config_pin_platoon(tmp_path: Path) -> None:
    zone = _pin_platoon_zone_yaml(tmp_path)
    assert zone.full_day_team_specs["team"]["pin_platoon"] is True


def test_run_simulation_full_day_team_pin_platoon_same_platoon(tmp_path: Path) -> None:
    zone = _pin_platoon_zone_yaml(tmp_path)
    type_codes = ["A", "A", "A", "A"]
    platoon_codes = ["1", "1", "2", "2"]
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=7,
        num_soldiers=4,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        platoon_codes=platoon_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 2
    p0 = platoon_codes[recs[0].soldier_idx]
    p1 = platoon_codes[recs[1].soldier_idx]
    assert p0 and p0 == p1


def test_pin_platoon_partial_fallback_mixed_platoons(tmp_path: Path) -> None:
    """Strict single-platoon fill fails; optimistic prefer pulls quota seats from other platoons."""
    p = tmp_path / "zones.yaml"
    p.write_text(
        """
schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 3
      type_quotas: { A: 1, B: 2 }
      pin_platoon: true
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
""",
        encoding="utf-8",
    )
    zone = g.load_zone_config(p, slots_per_block=1)
    type_codes = ["A", "B", "B", "B"]
    platoon_codes = ["1", "1", "2", "2"]
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=11,
        num_soldiers=4,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        platoon_codes=platoon_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 3
    type_counts: dict[str, int] = {}
    platoons: set[str] = set()
    for a in recs:
        type_counts[type_codes[a.soldier_idx]] = type_counts.get(type_codes[a.soldier_idx], 0) + 1
        platoons.add(platoon_codes[a.soldier_idx])
    assert type_counts.get("A") == 1 and type_counts.get("B") == 2
    assert len(platoons) >= 2


def test_pin_platoon_global_infeasible(tmp_path: Path) -> None:
    p = tmp_path / "zones.yaml"
    p.write_text(
        """
schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      type_quotas: { A: 2 }
      pin_platoon: true
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
""",
        encoding="utf-8",
    )
    zone = g.load_zone_config(p, slots_per_block=1)
    type_codes = ["A", "B"]
    platoon_codes = ["1", "2"]
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        g.run_simulation_best_of(
            trials=1,
            base_seed=3,
            num_soldiers=2,
            slots_per_block=1,
            days=1,
            zone=zone,
            block_hours=zone.shift_hours,
            anchor=anchor,
            type_codes=type_codes,
            platoon_codes=platoon_codes,
            **_SIM_KW,
        )


def test_full_day_team_pick_pool_prefer_mode() -> None:
    import numpy as np

    soldiers = [g.make_soldier(i, 24.0, 1, 1) for i in range(3)]
    type_codes = ["A", "B", "B"]
    platoon_codes = ["1", "1", "2"]
    busy = np.zeros((1, 3, 6), dtype=bool)
    excl = frozenset()
    pool = g._full_day_team_pick_pool(
        soldiers,
        (),
        platoon_codes,
        "1",
        "prefer",
        "B",
        type_codes,
        excl,
        busy,
        0,
        6,
        6,
        1,
        0,
        9,
        17,
        None,
    )
    assert len(pool) == 1
    assert platoon_codes[pool[0].idx] == "1"


def test_pin_platoon_prefer_before_next_platoon_strict(tmp_path: Path) -> None:
    """Top-scored platoon strict-fails; prefer with same platoon before trying next platoon strict."""
    p = tmp_path / "zones.yaml"
    p.write_text(
        """
schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      pin_platoon: true
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
""",
        encoding="utf-8",
    )
    zone = g.load_zone_config(p, slots_per_block=1)
    type_codes = ["A", "A", "A"]
    platoon_codes = ["1", "1", "2"]
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=5,
        num_soldiers=3,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        platoon_codes=platoon_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 2
    assert any(platoon_codes[a.soldier_idx] == "1" for a in recs)


def test_pin_platoon_rotates_across_days_example(tmp_path: Path) -> None:
    """After a platoon serves carmel, quota-holder load should steer the next day elsewhere."""
    root = Path(__file__).resolve().parents[1]
    zone = g.load_zone_config(root / "zones-example.yaml", slots_per_block=10)
    roster_path = root / "roster-example.yaml"
    keys = g.roster_keys(79)
    import yaml

    data = yaml.safe_load(roster_path.read_text(encoding="utf-8"))
    id_to_type = {str(r["id"]): str(r.get("type_code", "")).strip() for r in data["soldiers"]}
    id_to_platoon = {str(r["id"]): str(r.get("platoon_code", "")).strip() for r in data["soldiers"]}
    type_codes = g.type_codes_for_roster(keys, id_to_type)
    platoon_codes = g.platoon_codes_for_roster(keys, id_to_platoon)

    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=79,
        slots_per_block=10,
        days=3,
        zone=zone,
        block_hours=zone.shift_hours,
        type_codes=type_codes,
        platoon_codes=platoon_codes,
        min_free_shifts_after_duty=2,
        min_consecutive_free_hours=6.0,
        max_consecutive_duty_blocks=2,
        band_relative=0.2,
    )
    recs = pack[3]
    s8_idx = 7  # carmel slot
    platoons = []
    for day in range(3):
        team = [keys[a.soldier_idx] for a in recs if a.day == day and a.slot == s8_idx]
        assert len(team) == 8
        platoons.append({id_to_platoon[k] for k in team})
        assert len(platoons[-1]) == 1, f"day {day + 1} mixed platoons: {platoons[-1]}"
    assert platoons[0] != platoons[1], f"expected platoon rotation day 2, got {platoons}"


def test_example_hot_day4_at_most_one_rotating_per_soldier(tmp_path: Path) -> None:
    """Mixed valero+gate zones: no soldier gets two rotating blocks same day."""
    import yaml
    from datetime import datetime, timezone

    root = Path(__file__).resolve().parents[1]
    zone = g.load_zone_config(root / "zones-example.yaml", slots_per_block=10)
    roster_path = root / "roster-example.yaml"
    keys = g.roster_keys(79)
    data = yaml.safe_load(roster_path.read_text(encoding="utf-8"))
    id_to_type = {str(r["id"]): str(r.get("type_code", "")).strip() for r in data["soldiers"]}
    id_to_platoon = {str(r["id"]): str(r.get("platoon_code", "")).strip() for r in data["soldiers"]}
    type_codes = g.type_codes_for_roster(keys, id_to_type)
    platoon_codes = g.platoon_codes_for_roster(keys, id_to_platoon)
    anchor = datetime(2026, 6, 1, tzinfo=timezone.utc)
    state = tmp_path / "checkpoint.json"
    pack, _ = g.run_simulation_hot(
        total_days=4,
        burst_days=1,
        state_path=state,
        num_soldiers=79,
        slots_per_block=10,
        zone=zone,
        block_hours=zone.shift_hours,
        base_seed=42,
        sim_trials=1,
        min_consecutive_free_hours=6.0,
        balance_total_hours=True,
        total_hours_slack=0.0,
        min_free_shifts_after_duty=2,
        max_consecutive_duty_blocks=2,
        band_relative=0.2,
        plan_day_start_hour=5,
        availability=None,
        anchor=anchor,
        type_codes=type_codes,
        platoon_codes=platoon_codes,
    )
    recs = pack[3]
    day = 3
    rot_by: dict[int, int] = {}
    loc_types: dict[int, set[str]] = {}
    for a in recs:
        if a.kind != "rotating" or a.day != day:
            continue
        rot_by[a.soldier_idx] = rot_by.get(a.soldier_idx, 0) + 1
        loc_types.setdefault(a.soldier_idx, set()).add(
            zone.location_type_ids[zone.slot_location_indices[a.slot]]
        )
    for sid, n in rot_by.items():
        assert n <= 1, f"soldier s{sid} has {n} rotating blocks on day {day + 1}"
        lt = loc_types[sid]
        assert not ({"valero", "rotating_slot"} <= lt), f"soldier s{sid} has valero+gate same day"


def test_pin_platoon_uniform_scarce_types_example_roster() -> None:
    """A=1 and G=2 in every platoon; H/D/F/E counts differ — only A and G score."""
    import yaml

    root = Path(__file__).resolve().parents[1]
    data = yaml.safe_load((root / "roster-example.yaml").read_text(encoding="utf-8"))
    keys = g.roster_keys(79)
    id_to_type = {str(r["id"]): str(r.get("type_code", "")).strip() for r in data["soldiers"]}
    id_to_platoon = {str(r["id"]): str(r.get("platoon_code", "")).strip() for r in data["soldiers"]}
    type_codes = g.type_codes_for_roster(keys, id_to_type)
    platoon_codes = g.platoon_codes_for_roster(keys, id_to_platoon)
    quotas = {"A": 1, "D": 1, "E": 3, "F": 1, "G": 1, "H": 1}
    uniform = g._pin_platoon_uniform_scarce_types(platoon_codes, type_codes, quotas)
    assert uniform == frozenset({"A", "G"})
    rotation = g._pin_platoon_rotation_types(platoon_codes, type_codes, quotas)
    assert "H" in rotation
    assert rotation >= frozenset({"A", "G", "H", "D", "F"})


def test_platoon_quota_load_cost_skips_non_uniform_and_vacation() -> None:
    """Cost uses rotation types; skip G when only one medic is eligible in platoon."""
    import numpy as np

    cfg = {"type_quotas": {"A": 1, "G": 1}}
    type_codes = ["A", "G", "G"]
    platoon_codes = ["1", "1", "1"]
    soldiers = [g.make_soldier(i, 24.0, 1, 1) for i in range(3)]
    deltas = np.zeros(3)
    soldiers[0].w_global = 4.0
    rotation = g._pin_platoon_rotation_types(platoon_codes, type_codes, cfg["type_quotas"])
    assert rotation == frozenset({"A", "G"})
    global_by = g._effective_loads_by_type(soldiers, type_codes, deltas)
    local_by = global_by
    cost, used = g._platoon_quota_load_cost(cfg, local_by, global_by, type_codes, rotation)
    assert used == ["A", "G"]

    # Only A in platoon slice: G uses global loads + cross-platoon penalty
    local_one = g._effective_loads_by_type(soldiers[:1], type_codes, deltas)
    cost2, used2 = g._platoon_quota_load_cost(cfg, local_one, global_by, type_codes, rotation)
    assert used2 == ["A", "G"]
    assert cost2 > soldiers[0].effective_global(0.0)


def test_platoon_quota_load_cost_H_local_beats_cross_platoon() -> None:
    """Platoon with the only available H should score better than platoons that must borrow H."""
    import numpy as np

    cfg = {"type_quotas": {"H": 1}}
    type_codes = ["H", "A", "A"]
    platoon_codes = ["1", "2", "2"]
    soldiers = [g.make_soldier(i, 24.0, 1, 1) for i in range(3)]
    deltas = np.zeros(3)
    global_by = g._effective_loads_by_type(soldiers, type_codes, deltas)
    rotation = g._pin_platoon_rotation_types(platoon_codes, type_codes, cfg["type_quotas"])
    local_p1 = g._effective_loads_by_type([soldiers[0]], type_codes, deltas)
    local_p2 = g._effective_loads_by_type(soldiers[1:], type_codes, deltas)
    cost_p1, _ = g._platoon_quota_load_cost(cfg, local_p1, global_by, type_codes, rotation)
    cost_p2, _ = g._platoon_quota_load_cost(cfg, local_p2, global_by, type_codes, rotation)
    assert cost_p1 < cost_p2


def test_run_simulation_full_day_team_busy_tensor() -> None:
    zone, type_codes = _load_fixture()
    anchor = datetime(2026, 5, 27, tzinfo=timezone.utc)
    pack, _ = g.run_simulation_best_of(
        trials=1,
        base_seed=42,
        num_soldiers=12,
        slots_per_block=1,
        days=1,
        zone=zone,
        block_hours=zone.shift_hours,
        anchor=anchor,
        type_codes=type_codes,
        **_SIM_KW,
    )
    recs = pack[3]
    assert len(recs) == 6
    assert recs[0].linear_busy_span_blocks is not None
    assert recs[0].linear_busy_span_blocks > 0
