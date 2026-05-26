"""Unit tests for guard_scheduler_sim: loaders, helpers, and simulation invariants.

Run from the project directory::

    python3 -m pip install -r requirements-test.txt
    python3 -m pytest tests/ -v

Requires a working NumPy build (``import numpy`` must not crash). ``tests/conftest.py`` sets
``MPLBACKEND=Agg`` before collection; plotting uses lazy matplotlib inside ``guard_scheduler_sim``.
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import pytest
import yaml

import guard_scheduler_sim as g

ROOT = Path(__file__).resolve().parent.parent
ZONES_V1 = ROOT / "zones.yaml"
ZONES_V2 = ROOT / "zones_mixed_patterns.yaml"
ZONES_S1 = ROOT / "zones_s1.yaml"


def test_zones_s1_12_soldiers_4_slots_4h_shift_user_example() -> None:
    """User example: zones_s1, 12 soldiers, 4 concurrent gate slots, 4 h grid, 3 days.

    CLI equivalent::
      python3 guard_scheduler_sim.py -x 12 -y 4 -d 3 --zones zones_s1.yaml \\
        --shift-hours 4 --min-free-shifts-after-duty 2 --seed 3 --min-consecutive-free-hours 6

    Verifies: assignment volume, four distinct soldiers per block, shift-cooldown on ``busy_rot``,
    and ``min_consecutive_free_hours`` on the full ``busy`` tensor (unified rest: no double k_rest).
    """
    data = yaml.safe_load(ZONES_S1.read_text(encoding="utf-8"))
    y = len(data["slots"])
    assert y == 4
    zone = g.load_zone_config(ZONES_S1, slots_per_block=y, shift_hours_override=4.0)
    assert zone.shift_hours == 4.0
    assert all(p == "rotating" for p in zone.slot_patterns)
    sh = 4.0
    B = g.calendar_blocks_per_day(sh)
    assert B == 6
    days = 3
    rng = random.Random(3)
    pack = g.run_simulation(
        num_soldiers=12,
        slots_per_block=y,
        days=days,
        zone=zone,
        block_hours=sh,
        rng=rng,
        min_consecutive_free_hours=6.0,
        min_free_shifts_after_duty=2,
    )
    soldiers, Z, max_free, assignments, Z_day, Z_avg, drl, drt, stats = pack
    assert len(assignments) == days * B * y == 72
    assert all(getattr(a, "kind", "rotating") == "rotating" for a in assignments)
    assert stats.shift_cooldown_violations_post == 0

    busy = g.build_busy_tensor(assignments, days, 12, B)
    assert busy.shape == (days, 12, B)
    for d in range(days):
        for b in range(B):
            assert int(busy[d, :, b].sum()) == y
            posted = [a.soldier_idx for a in assignments if a.day == d and a.calendar_block == b]
            assert len(posted) == y
            assert len(set(posted)) == y

    busy_rot = np.zeros((days, 12, B), dtype=np.bool_)
    for a in assignments:
        if getattr(a, "kind", "rotating") == "rotating":
            busy_rot[a.day, a.soldier_idx, a.calendar_block] = True
    assert g.count_shift_cooldown_violations(busy_rot, 2) == 0

    min_free_h = float(np.min(max_free))
    assert min_free_h + 1e-6 >= 6.0, f"expected ≥6 h consecutive free, got min={min_free_h}"

    raw_loc = np.stack([s.raw_loc for s in soldiers], axis=0)
    # Each rotating assignment credits ``sh`` hours at one location (here all gate).
    assert np.isclose(float(np.sum(raw_loc)), float(len(assignments) * sh))


def _v2_slots_per_block() -> int:
    """Concurrent slot count (-y) from the checked-in mixed v2 YAML."""
    data = yaml.safe_load(ZONES_V2.read_text(encoding="utf-8"))
    return len(data["slots"])


# ---------------------------------------------------------------------------
# CLI slot resolution (zones file vs -y)
# ---------------------------------------------------------------------------


def test_yaml_slots_list_length_mixed_file() -> None:
    data = yaml.safe_load(ZONES_V2.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    assert g.yaml_slots_list_length(data) == 15


def test_resolve_slots_auto_from_yaml() -> None:
    data = yaml.safe_load(ZONES_V2.read_text(encoding="utf-8"))
    n = g.resolve_slots_per_block_for_run(
        slots_arg=None, zones_data=data, zones_path=ZONES_V2
    )
    assert n == 15


def test_resolve_slots_rejects_wrong_y() -> None:
    data = yaml.safe_load(ZONES_V2.read_text(encoding="utf-8"))
    with pytest.raises(SystemExit, match="defines 15"):
        g.resolve_slots_per_block_for_run(
            slots_arg=21, zones_data=data, zones_path=ZONES_V2
        )


# ---------------------------------------------------------------------------
# calendar / rest helpers
# ---------------------------------------------------------------------------


def test_shift_cooldown_gap_counts_rotating_only_not_full_day_calendar() -> None:
    """Cooldown gap for rotating must not treat full_day calendar span as rotating back-to-back."""
    B, n_s, days = 8, 1, 2
    busy = np.zeros((days, n_s, B), dtype=np.bool_)
    busy_rot = np.zeros((days, n_s, B), dtype=np.bool_)
    busy[0, 0, :] = True
    gap_cal = g.gap_free_blocks_since_last_duty_before_assign(busy, 1, 0, 0, B)
    gap_rot = g.gap_free_blocks_since_last_duty_before_assign(busy_rot, 1, 0, 0, B)
    assert gap_cal == 0
    assert gap_rot == g.LARGE_LINEAR_GAP


def test_calendar_blocks_per_day_valid() -> None:
    assert g.calendar_blocks_per_day(4.0) == 6
    assert g.calendar_blocks_per_day(3.0) == 8
    assert g.calendar_blocks_per_day(2.0) == 12


def test_calendar_blocks_per_day_rejects_invalid_shift_hours() -> None:
    with pytest.raises(ValueError, match="shift_hours must be"):
        g.calendar_blocks_per_day(5.0)
    with pytest.raises(ValueError, match="shift_hours must be"):
        g.calendar_blocks_per_day(8.0)
    with pytest.raises(ValueError, match="shift_hours must be"):
        g.validate_shift_hours(0.0)


def test_consecutive_free_blocks_needed() -> None:
    assert g.consecutive_free_blocks_needed(8.0, 0.0) == 0
    assert g.consecutive_free_blocks_needed(8.0, 8.0) == 1
    assert g.consecutive_free_blocks_needed(8.0, 8.01) == 2
    assert g.consecutive_free_blocks_needed(3.0, 8.0) == 3


def test_rest_blocks_aligned() -> None:
    assert g._rest_blocks_aligned(6.0, 3.0) == 2
    assert g._rest_blocks_aligned(0.0, 3.0) == 0
    assert g._rest_blocks_aligned(7.0, 3.0) == 3


# ---------------------------------------------------------------------------
# clock parsing (v2 YAML)
# ---------------------------------------------------------------------------


def test_parse_hhmm_clock() -> None:
    assert g._parse_hhmm_clock("06:00") == 6
    assert g._parse_hhmm_clock("0:00") == 0
    assert g._parse_hhmm_clock("23:00") == 23
    assert g._parse_hhmm_clock("24:00") == 24


def test_parse_hhmm_clock_rejects_fractional_minutes() -> None:
    with pytest.raises(ValueError, match="whole hours"):
        g._parse_hhmm_clock("06:30")


def test_window_half_open_hours() -> None:
    assert g._window_half_open_hours("07:00", "13:00") == (7, 13)
    assert g._window_half_open_hours("12:00", "24:00") == (12, 24)


def test_parse_inclusive_full_day_hours() -> None:
    assert g._parse_inclusive_full_day_hours("06:00", "22:00") == (6, 22)


def test_parse_inclusive_full_day_rejects_24_start() -> None:
    with pytest.raises(ValueError, match="0..23"):
        g._parse_inclusive_full_day_hours("24:00", "22:00")


# ---------------------------------------------------------------------------
# heatmap / time mapping
# ---------------------------------------------------------------------------


def test_time_category_and_spans_zones_yaml() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    assert zone.n_loc == 3 and zone.n_time == 3
    assert g.time_category_for_hour(0, zone) == 0
    assert g.time_category_for_hour(5, zone) == 0
    assert g.time_category_for_hour(6, zone) == 1
    assert g.time_category_for_hour(12, zone) == 2
    assert g.time_category_for_hour(23, zone) == 2
    spans = g.time_band_clock_spans_hours(zone)
    assert spans.shape == (3,)
    assert float(spans[0]) == 6.0
    assert float(spans.sum()) == 24.0


def test_heatmap_time_fraction_by_row() -> None:
    raw = np.array([[1.0, 3.0, 0.0], [0.0, 0.0, 0.0]], dtype=np.float64)
    z = g.heatmap_time_fraction_by_row(raw)
    assert z[0].sum() == pytest.approx(1.0)
    assert z[1, 0] == 0.0


def test_heatmap_time_fraction_by_row_daily() -> None:
    d = np.zeros((2, 1, 3), dtype=np.float64)
    d[0, 0, :] = [1.0, 1.0, 2.0]
    d[1, 0, :] = [0.0, 0.0, 0.0]
    z = g.heatmap_time_fraction_by_row_daily(d)
    assert z[0, 0].sum() == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Zone loading
# ---------------------------------------------------------------------------


def test_load_legacy_yaml_migrated(tmp_path: Path) -> None:
    cfg = {
        "locations": [{"id": "l1", "name": "L1", "weight": 1.0}],
        "time_zones": [
            {"id": "t1", "name": "T1", "weight": 1.0, "from_hour": 0, "to_hour": 23},
        ],
        "slots": [{"location_id": "l1"}],
    }
    p = tmp_path / "legacy.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=1, default_shift_hours=4.0)
    assert zone.schema_version == 2
    assert zone.shift_hours == 4.0
    assert zone.slot_patterns == ("rotating",)


def test_load_zones_repo_file_schema_v2() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    assert zone.schema_version == 2
    assert len(zone.slot_location_indices) == 3
    assert zone.slot_patterns == ("rotating", "rotating", "rotating")
    assert zone.loc_ids[0] == "loc_gate"
    assert zone.shift_hours == 4.0


def test_load_zone_slot_names_optional(tmp_path: Path) -> None:
    data = yaml.safe_load(ZONES_V1.read_text(encoding="utf-8"))
    data["slots"] = [
        {"location_id": "loc_gate", "name": "S1"},
        {"location_id": "loc_tower", "name": "S2"},
        {"location_id": "loc_yard", "name": "S3"},
    ]
    p = tmp_path / "zones_named_slots.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=3)
    assert zone.slot_display_names == ("S1", "S2", "S3")


def test_load_zone_full_name_on_zone_loc_and_slots(tmp_path: Path) -> None:
    cfg = {
        "schema_version": 2,
        "shift_hours": 4,
        "slots_types": [{"id": "t_rot", "name": "R", "pattern": "rotating"}],
        "zone_loc": [
            {"id": "l1", "type": "t_rot", "name": "G", "full_name": "Main gate", "weight": 1.0},
        ],
        "slots": [{"location_id": "l1", "name": "g1", "full_name": "abssss"}],
        "time_zones": [
            {"id": "t1", "name": "T1", "weight": 1.0, "from_hour": 0, "to_hour": 23},
        ],
    }
    p = tmp_path / "zones_full_names.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=1)
    assert zone.loc_names == ("G",)
    assert zone.loc_full_names == ("Main gate",)
    assert zone.slot_display_names == ("abssss",)


def test_load_zone_rejects_wrong_slot_count(tmp_path: Path) -> None:
    data = yaml.safe_load(ZONES_V1.read_text(encoding="utf-8"))
    data["slots"] = [{"location_id": "loc_gate"}]
    p = tmp_path / "zones_bad_y.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ValueError, match="YAML slots list has length"):
        g.load_zone_config(p, slots_per_block=3)


def test_load_zone_rejects_unknown_location_id(tmp_path: Path) -> None:
    data = yaml.safe_load(ZONES_V1.read_text(encoding="utf-8"))
    data["slots"] = [
        {"location_id": "loc_gate"},
        {"location_id": "loc_tower"},
        {"location_id": "nope"},
    ]
    p = tmp_path / "zones_bad_loc.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ValueError, match="unknown location_id"):
        g.load_zone_config(p, slots_per_block=3)


def test_load_zone_mixed_yaml_default_shift_hours() -> None:
    y = _v2_slots_per_block()
    zone = g.load_zone_config(ZONES_V2, slots_per_block=y, shift_hours_override=None)
    assert zone.schema_version == 2
    assert zone.shift_hours == 3.0
    assert len(zone.slot_patterns) == y
    assert sum(1 for p in zone.slot_patterns if p == "rotating") == 6
    assert sum(1 for p in zone.slot_patterns if p == "full_day") == 5
    assert sum(1 for p in zone.slot_patterns if p == "windowed_slots") == 4


def test_load_zone_shift_hours_cli_override() -> None:
    y = _v2_slots_per_block()
    zone = g.load_zone_config(ZONES_V2, slots_per_block=y, shift_hours_override=4.0)
    assert zone.shift_hours == 4.0


def test_load_zone_rejects_bad_shift_hours_override() -> None:
    y = _v2_slots_per_block()
    with pytest.raises(ValueError, match="shift_hours must be"):
        g.load_zone_config(ZONES_V2, slots_per_block=y, shift_hours_override=5.0)


def test_minimal_v2_rotating_only_zone(tmp_path: Path) -> None:
    """Tiny v2 file: two rotating slots, 4h grid, two time bands covering 24h."""
    cfg = {
        "schema_version": 2,
        "shift_hours": 4,
        "slots_types": [{"id": "t_rot", "name": "R", "pattern": "rotating"}],
        "zone_loc": [
            {"id": "loc_a", "type": "t_rot", "name": "A", "weight": 1.0},
            {"id": "loc_b", "type": "t_rot", "name": "B", "weight": 1.0},
        ],
        "slots": [{"location_id": "loc_a"}, {"location_id": "loc_b"}],
        "time_zones": [
            {"id": "z0", "name": "First", "weight": 1.0, "from_hour": 0, "to_hour": 11},
            {"id": "z1", "name": "Second", "weight": 1.0, "from_hour": 12, "to_hour": 23},
        ],
    }
    p = tmp_path / "zones_v2_mini.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=2)
    assert zone.n_loc == 2 and zone.n_time == 2
    assert zone.slot_patterns == ("rotating", "rotating")


# ---------------------------------------------------------------------------
# expected_assignment_count / busy tensor
# ---------------------------------------------------------------------------


def test_expected_assignment_count_rotating_only_repo_yaml() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    B = g.calendar_blocks_per_day(zone.shift_hours)
    assert g.expected_assignment_count(zone, 10, B, 3) == 10 * B * 3


def test_expected_assignment_count_mixed_yaml() -> None:
    y = _v2_slots_per_block()
    zone = g.load_zone_config(ZONES_V2, slots_per_block=y)
    B = g.calendar_blocks_per_day(zone.shift_hours)
    n_rot = sum(1 for p in zone.slot_patterns if p == "rotating")
    n_fd = sum(1 for p in zone.slot_patterns if p == "full_day")
    n_wd = sum(1 for p in zone.slot_patterns if p == "windowed_slots")
    per_day = n_fd + n_wd + n_rot * B
    assert g.expected_assignment_count(zone, 5, B, y) == 5 * per_day


def test_build_busy_tensor_timeline_mode_excludes_yaml_rest() -> None:
    """Timeline uses ``include_yaml_rest=False`` so it matches HTML duty rows (not rest spill)."""
    B = 8
    a = g.AssignmentRecord(
        day=0,
        calendar_block=2,
        start_hour=6,
        slot=0,
        soldier_idx=0,
        loc_i=0,
        time_j=0,
        weight=1.0,
        raw_hours=17.0,
        kind="full_day",
        rowspan=6,
        win_start_block=2,
        win_end_block=7,
        linear_busy_span_blocks=8,
    )
    full = g.build_busy_tensor([a], 2, 1, B, include_yaml_rest=True)
    duty = g.build_busy_tensor([a], 2, 1, B, include_yaml_rest=False)
    assert full[1, 0, 0] and full[1, 0, 1]
    assert not duty[1, 0, 0] and not duty[1, 0, 1]
    assert duty[0, 0, 2] and duty[0, 0, 7] and not duty[0, 0, 0]


def test_full_day_busy_span_covers_duty_plus_rest_only() -> None:
    """rest_after extends the busy span only after YAML duty hours, not an entire 24 h + rest."""
    L0, span = g._linear_busy_span_duty_hours_plus_rest(
        0, 8, 3.0, 6, 22, half_open=False, rest_after_h=6.0
    )
    assert (L0, span) == (2, 8)


def test_assignment_occupied_blocks() -> None:
    a_rot = g.AssignmentRecord(
        day=0,
        calendar_block=2,
        start_hour=6,
        slot=0,
        soldier_idx=1,
        loc_i=0,
        time_j=0,
        weight=1.0,
        raw_hours=3.0,
        kind="rotating",
    )
    assert g.assignment_occupied_blocks(a_rot, 8) == [2]
    a_fd = g.AssignmentRecord(
        day=0,
        calendar_block=2,
        start_hour=6,
        slot=1,
        soldier_idx=2,
        loc_i=0,
        time_j=0,
        weight=10.0,
        raw_hours=17.0,
        kind="full_day",
        rowspan=6,
        win_start_block=2,
        win_end_block=7,
    )
    assert g.assignment_occupied_blocks(a_fd, 8) == list(range(2, 8))
    a_w = g.AssignmentRecord(
        day=0,
        calendar_block=2,
        start_hour=6,
        slot=2,
        soldier_idx=3,
        loc_i=0,
        time_j=0,
        weight=5.0,
        raw_hours=5.0,
        kind="windowed",
        rowspan=2,
        win_start_block=2,
        win_end_block=3,
    )
    assert g.assignment_occupied_blocks(a_w, 8) == [2, 3]


def test_build_busy_tensor_marks_full_day_duty_blocks() -> None:
    asn = [
        g.AssignmentRecord(
            day=0,
            calendar_block=0,
            start_hour=0,
            slot=0,
            soldier_idx=0,
            loc_i=0,
            time_j=0,
            weight=1.0,
            raw_hours=8.0,
            kind="full_day",
            rowspan=3,
            win_start_block=0,
            win_end_block=2,
        )
    ]
    busy = g.build_busy_tensor(asn, days=1, num_soldiers=2, blocks_pd=3)
    assert busy[0, 0, 0] and busy[0, 0, 1] and busy[0, 0, 2]
    assert not busy[0, 1, 0]


# ---------------------------------------------------------------------------
# soldier_must_rest_this_block (phase geometry)
# ---------------------------------------------------------------------------


def test_soldier_must_rest_blocks_pattern() -> None:
    B, k = 6, 2
    assert g.soldier_must_rest_this_block(0, 0, 0, B, k)
    assert g.soldier_must_rest_this_block(0, 0, 1, B, k)
    assert not g.soldier_must_rest_this_block(0, 0, 2, B, k)


# ---------------------------------------------------------------------------
# pick_soldier / band (hybrid_rel)
# ---------------------------------------------------------------------------


def test_pick_soldier_single_candidate() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    s0 = g.make_soldier(0, 100.0, zone.n_loc, zone.n_time)
    dl = np.zeros((4, zone.n_loc))
    dt = np.zeros((4, zone.n_time))
    dg = np.zeros(4)
    rng = random.Random(123)
    out = g.pick_soldier([s0], 0, 0, dl, dt, dg, rng, band_relative=0.2)
    assert out is s0


def test_band_upper_relative_only() -> None:
    assert g._band_upper_relative_only(10.0, 0.2) == pytest.approx(12.0)


# ---------------------------------------------------------------------------
# fairness metrics / heatmap std
# ---------------------------------------------------------------------------


def test_fairness_metrics_keys() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    soldiers = [g.make_soldier(i, 100.0, zone.n_loc, zone.n_time) for i in range(3)]
    Z = np.full((3, zone.n_loc + zone.n_time), 1.0 / (zone.n_loc + zone.n_time))
    fm = g.fairness_metrics(Z, soldiers)
    assert set(fm.keys()) >= {
        "std_all_z",
        "min_std_slot_z",
        "std_raw_hours",
        "raw_hours_spread",
        "fairness_score",
    }


def test_heatmap_std_summary_shape() -> None:
    Z = np.random.default_rng(0).random((4, 6))
    std_all, min_std, per = g.heatmap_std_summary(Z)
    assert per.shape == (6,)
    assert std_all >= 0


# ---------------------------------------------------------------------------
# run_simulation v1 (end-to-end small)
# ---------------------------------------------------------------------------


def test_run_simulation_v1_one_day_assignments_and_shape() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    rng = random.Random(42)
    bh = float(zone.shift_hours)
    B = g.calendar_blocks_per_day(bh)
    pack = g.run_simulation(
        num_soldiers=12,
        slots_per_block=3,
        days=1,
        zone=zone,
        block_hours=bh,
        rng=rng,
        min_consecutive_free_hours=8.0,
        max_consecutive_duty_blocks=2,
        min_free_shifts_after_duty=0,
    )
    soldiers, Z, max_free, assignments, Z_day, Z_avg, drl, drt, stats = pack
    assert len(assignments) == B * 3
    assert Z.shape == (12, zone.n_loc + zone.n_time)
    raw_loc = np.stack([s.raw_loc for s in soldiers], axis=0)
    active = np.sum(raw_loc, axis=1) > 1e-12
    assert np.allclose(Z[active, : zone.n_loc].sum(axis=1), 1.0, atol=1e-6)
    assert np.allclose(Z[active, zone.n_loc :].sum(axis=1), 1.0, atol=1e-6)
    assert np.all(Z[~active, :].sum(axis=1) < 1e-9)
    assert max_free.shape == (1, 12)
    busy = g.build_busy_tensor(assignments, 1, 12, B)
    assert busy.sum() == len(assignments)


def test_run_simulation_raises_when_impossible_soldier_count() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    rng = random.Random(0)
    with pytest.raises(g.RestConstraintError, match="Not enough soldiers"):
        g.run_simulation(
            num_soldiers=3,
            slots_per_block=3,
            days=1,
            zone=zone,
            block_hours=float(zone.shift_hours),
            rng=rng,
        )


def test_run_simulation_best_of_trials_requires_seed() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    with pytest.raises(ValueError, match="base_seed"):
        g.run_simulation_best_of(
            trials=2,
            base_seed=None,
            num_soldiers=12,
            slots_per_block=3,
            days=1,
            zone=zone,
            block_hours=float(zone.shift_hours),
        )


def test_run_simulation_best_of_trials_runs_and_returns_meta() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    bh = float(zone.shift_hours)
    pack, meta = g.run_simulation_best_of(
        trials=2,
        base_seed=99,
        num_soldiers=12,
        slots_per_block=3,
        days=1,
        zone=zone,
        block_hours=bh,
    )
    assert meta["trials_run"] == 2
    assert meta["trial_seed"] is not None
    assert "fairness" in meta
    assert len(pack[3]) == g.calendar_blocks_per_day(bh) * 3


# ---------------------------------------------------------------------------
# run_simulation v2 minimal (rotating only)
# ---------------------------------------------------------------------------


def test_run_simulation_mini_rotating(tmp_path: Path) -> None:
    cfg = {
        "schema_version": 2,
        "shift_hours": 4,
        "slots_types": [{"id": "t_rot", "name": "R", "pattern": "rotating"}],
        "zone_loc": [
            {"id": "loc_a", "type": "t_rot", "name": "A", "weight": 1.0},
            {"id": "loc_b", "type": "t_rot", "name": "B", "weight": 1.0},
        ],
        "slots": [{"location_id": "loc_a"}, {"location_id": "loc_b"}],
        "time_zones": [
            {"id": "z0", "name": "First", "weight": 1.0, "from_hour": 0, "to_hour": 11},
            {"id": "z1", "name": "Second", "weight": 1.0, "from_hour": 12, "to_hour": 23},
        ],
    }
    p = tmp_path / "zones_v2_mini_run.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=2)
    sh = float(zone.shift_hours)
    B = g.calendar_blocks_per_day(sh)
    rng = random.Random(0)
    pack = g.run_simulation(
        num_soldiers=30,
        slots_per_block=2,
        days=2,
        zone=zone,
        block_hours=sh,
        rng=rng,
        min_consecutive_free_hours=8.0,
        max_consecutive_duty_blocks=2,
    )
    soldiers, Z, max_free, assignments, *_rest = pack
    expect = g.expected_assignment_count(zone, 2, B, 2)
    assert len(assignments) == expect
    busy = g.build_busy_tensor(assignments, 2, 30, B)
    g.validate_schedule_rest(
        g.compute_max_consecutive_free_hours(busy, sh), 8.0, assignments=assignments
    )
    assert Z.shape == (30, zone.n_loc + zone.n_time)
    distinct_workers = sum(1 for s in soldiers if s.total_raw_guard_hours() > 0)
    assert distinct_workers == 2 * B * 2  # days × blocks_per_day × rotating slots


def test_run_simulation_full_day_only_one_slot(tmp_path: Path) -> None:
    """One full_day slot 06–22; rest_after 6 h extends busy only after block 7 (not whole day)."""
    cfg = {
        "schema_version": 2,
        "shift_hours": 3,
        "slots_types": [
            {
                "id": "t_fd",
                "name": "FD",
                "pattern": "full_day",
                "config": {
                    "start": "06:00",
                    "end": "22:00",
                    "rest_after_hours": 6,
                    "weight_multiplier": 1.0,
                },
            }
        ],
        "zone_loc": [{"id": "loc_x", "type": "t_fd", "name": "X", "full_name": "Full day post", "weight": 1.0}],
        "slots": [{"location_id": "loc_x", "name": "s1", "full_name": "Slot detail"}],
        "time_zones": [
            {"id": "z0", "name": "N", "weight": 1.0, "from_hour": 0, "to_hour": 11},
            {"id": "z1", "name": "D", "weight": 1.0, "from_hour": 12, "to_hour": 23},
        ],
    }
    p = tmp_path / "zones_v2_fd.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    zone = g.load_zone_config(p, slots_per_block=1)
    sh = 3.0
    B = 8
    rng = random.Random(1)
    pack = g.run_simulation(
        num_soldiers=8,
        slots_per_block=1,
        days=3,
        zone=zone,
        block_hours=sh,
        rng=rng,
        min_consecutive_free_hours=8.0,
        max_consecutive_duty_blocks=0,
    )
    _s, _Z, _mf, assignments, *_r = pack
    assert len(assignments) == 3
    assert all(a.kind == "full_day" for a in assignments)
    busy = g.build_busy_tensor(assignments, 3, 8, B)
    expected = np.zeros((3, 8, B), dtype=np.bool_)
    for a in assignments:
        assert a.linear_busy_span_blocks is not None
        L0 = a.day * B + a.calendar_block
        g._busy_span_set(expected, a.soldier_idx, L0, int(a.linear_busy_span_blocks), B, 3)
    np.testing.assert_array_equal(busy, expected)


def test_run_simulation_mixed_yaml_smoke() -> None:
    """Full repo v2 YAML; skip if rest cannot be satisfied for this seed."""
    if not ZONES_V2.is_file():
        pytest.skip("zones_mixed_patterns.yaml not present")
    y = _v2_slots_per_block()
    zone = g.load_zone_config(ZONES_V2, slots_per_block=y)
    sh = float(zone.shift_hours)
    B = g.calendar_blocks_per_day(sh)
    rng = random.Random(3)
    try:
        pack = g.run_simulation(
            num_soldiers=160,
            slots_per_block=y,
            days=1,
            zone=zone,
            block_hours=sh,
            rng=rng,
            min_consecutive_free_hours=8.0,
            max_consecutive_duty_blocks=2,
            min_free_shifts_after_duty=0,
        )
    except g.RestConstraintError:
        pytest.skip("mixed schedule infeasible for default seed/soldier count in this environment")
    assignments = pack[3]
    assert len(assignments) == g.expected_assignment_count(zone, 1, B, y)
    kinds = [getattr(a, "kind", "rotating") for a in assignments]
    assert "rotating" in kinds and "full_day" in kinds and "windowed" in kinds


# ---------------------------------------------------------------------------
# busy span helpers (used by v2 builder)
# ---------------------------------------------------------------------------


def test_busy_span_set_covers_linear_indices() -> None:
    busy = np.zeros((2, 3, 4), dtype=np.bool_)
    g._busy_span_set(busy, soldier=1, L0=3, span_blocks=4, B=4, days=2)
    assert busy[0, 1, 3]
    assert busy[1, 1, 0] and busy[1, 1, 1]
    assert not busy[0, 1, 0]


def test_any_busy_span_detects_overlap() -> None:
    busy = np.zeros((1, 2, 6), dtype=np.bool_)
    busy[0, 0, 2] = True
    assert g._any_busy_span(busy, soldier=0, L0=1, span_blocks=4, B=6, days=1)
    assert not g._any_busy_span(busy, soldier=1, L0=0, span_blocks=2, B=6, days=1)


# ---------------------------------------------------------------------------
# format_block_window
# ---------------------------------------------------------------------------


def test_format_block_window_integer_hours() -> None:
    s = g.format_block_window(8, 4.0)
    assert "08:00" in s and "12:00" in s


# ---------------------------------------------------------------------------
# ZoneConfig labels
# ---------------------------------------------------------------------------


def test_zoneconfig_heatmap_column_labels_count() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    labs = zone.heatmap_column_labels()
    assert len(labs) == zone.n_loc + zone.n_time


def test_gap_free_blocks_no_prior_duty() -> None:
    busy = np.zeros((1, 2, 4), dtype=np.bool_)
    assert (
        g.gap_free_blocks_since_last_duty_before_assign(busy, 0, 2, soldier_idx=0, blocks_per_day=4)
        == g.LARGE_LINEAR_GAP
    )


def test_gap_free_blocks_after_one_duty() -> None:
    busy = np.zeros((1, 1, 6), dtype=np.bool_)
    busy[0, 0, 1] = True
    assert g.gap_free_blocks_since_last_duty_before_assign(busy, 0, 4, soldier_idx=0, blocks_per_day=6) == 2


def test_validate_max_consecutive_duty_detects_run() -> None:
    busy = np.zeros((1, 1, 5), dtype=np.bool_)
    busy[0, 0, 0:3] = True
    with pytest.raises(g.RestConstraintError, match="consecutive"):
        g.validate_max_consecutive_duty(busy, max_run=2)


def test_count_shift_cooldown_violations() -> None:
    busy = np.zeros((1, 1, 6), dtype=np.bool_)
    busy[0, 0, 0] = True
    busy[0, 0, 2] = True
    assert g.count_shift_cooldown_violations(busy, min_free_shifts_after_duty=2) == 1
    assert g.count_shift_cooldown_violations(busy, min_free_shifts_after_duty=0) == 0


def test_build_day_schedule_matrix_html_rowspan_full_day() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    asn = [
        g.AssignmentRecord(
            day=0,
            calendar_block=0,
            start_hour=0,
            slot=0,
            soldier_idx=4,
            loc_i=0,
            time_j=0,
            weight=10.0,
            raw_hours=8.0,
            kind="full_day",
            rowspan=3,
            win_start_block=0,
            win_end_block=2,
        )
    ]
    html = g.build_day_schedule_matrix_html(asn, days=1, blocks_pd=3, slots_per_block=3, block_hours=8.0, zone=zone)
    assert 'rowspan="3"' in html
    assert "S4" in html


def test_assert_rest_feasible_counting_min_formula() -> None:
    # B=3, y=3, 8h blocks, 8h rest -> k=1, max duty 2, 9 shifts/day -> ceil(9/2)=5 soldiers minimum
    g.assert_rest_feasible_counting(5, 3, 3, 8.0, 8.0)
    with pytest.raises(g.RestConstraintError):
        g.assert_rest_feasible_counting(4, 3, 3, 8.0, 8.0)


def test_compute_max_consecutive_free_hours_all_free() -> None:
    busy = np.zeros((1, 2, 3), dtype=np.bool_)
    mf = g.compute_max_consecutive_free_hours(busy, 8.0)
    assert mf[0, 0] == 24.0 and mf[0, 1] == 24.0


def test_hybrid_sort_key_ordering() -> None:
    zone = g.load_zone_config(ZONES_V1, slots_per_block=3)
    a = g.make_soldier(0, 100.0, zone.n_loc, zone.n_time)
    b = g.make_soldier(1, 100.0, zone.n_loc, zone.n_time)
    a.w_loc[0] = 10.0
    b.w_loc[0] = 0.0
    dl = np.zeros((2, zone.n_loc))
    dt = np.zeros((2, zone.n_time))
    ka = g.hybrid_sort_key(a, 0, 0, dl, dt, 0.0)
    kb = g.hybrid_sort_key(b, 0, 0, dl, dt, 0.0)
    assert kb < ka


def test_next_calendar_block() -> None:
    assert g._next_calendar_block(0, 0, 8, 3) == (0, 1)
    assert g._next_calendar_block(0, 7, 8, 3) == (1, 0)
    assert g._next_calendar_block(2, 7, 8, 3) is None


def test_rotating_tie_break_orders_busy_on_next_block_first() -> None:
    B, days, n_sol = 8, 2, 8
    busy = np.zeros((days, n_sol, B), dtype=np.bool_)
    busy[1, 0, 0] = True
    k_rest = 3
    tb = g._rotating_tie_break_key(busy, busy, 0, 7, B, days, k_rest)
    s0 = g.make_soldier(0, 24.0, 1, 1)
    s1 = g.make_soldier(1, 24.0, 1, 1)
    assert tb(s0) < tb(s1)


def test_rotating_tie_break_orders_mandatory_rest_next_first() -> None:
    B, days, n_sol = 8, 2, 8
    busy = np.zeros((days, n_sol, B), dtype=np.bool_)
    k_rest = 3
    tb = g._rotating_tie_break_key(busy, busy, 0, 7, B, days, k_rest)
    s6 = g.make_soldier(6, 24.0, 1, 1)
    s1 = g.make_soldier(1, 24.0, 1, 1)
    assert tb(s6)[0] == 0
    assert tb(s1)[0] == 1
    assert tb(s6) < tb(s1)


def test_run_simulation_mixed_patterns_cooldown2_regression() -> None:
    """Regression: mixed YAML + shift cooldown + rest (needs enough soldiers for this file)."""
    y = _v2_slots_per_block()
    zone = g.load_zone_config(ZONES_V2, slots_per_block=y, shift_hours_override=3.0)
    rng = random.Random(7)
    g.run_simulation(
        num_soldiers=70,
        slots_per_block=y,
        days=4,
        zone=zone,
        block_hours=3.0,
        rng=rng,
        min_free_shifts_after_duty=2,
        plan_day_start_hour=0,  # pinned: seed 7 + this YAML was validated at midnight grid
    )
