"""
Scenario YAML loader and plan-day availability (parity with guardsched/scenario.go + internal/availability).

Example::

    python3 guard_scheduler_sim.py --scenario testdata/scenarios/partial_return.yaml --availability-only
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

UTC = timezone.utc

STATUS_BASE = "base"
STATUS_AWAY = "away"
STATUS_SICK = "sick"
STATUS_TRAINING = "training"
STATUS_OTHER = "other"
STATUS_OUTING = "outing"

DEFAULT_ANCHOR = datetime(2026, 5, 27, tzinfo=UTC)
DEFAULT_PLAN_DAY_START = "05:00"


def normalize_status(s: str) -> str:
    s = (s or "").strip().lower()
    if s in ("", STATUS_BASE, "leave"):
        return STATUS_AWAY if s == "leave" else STATUS_BASE
    return s


@dataclass
class StatusEntry:
    soldier_id: str
    start_at: datetime
    end_at: Optional[datetime]
    status: str


@dataclass
class Interval:
    start: datetime
    end: datetime


@dataclass
class DaySoldiers:
    avail_full: List[str] = field(default_factory=list)
    avail_partial: Dict[str, List[List[str]]] = field(default_factory=dict)
    full: int = 0
    absent_full: int = 0
    absent_partial: int = 0


@dataclass
class Scenario:
    name: str
    schema_version: int
    sim: Dict[str, Any]
    zones: Dict[str, Any]
    status_rows: List[Dict[str, Any]]
    expect: Dict[str, Any]
    status_only: bool = False
    anchor: datetime = field(default_factory=lambda: DEFAULT_ANCHOR)
    resolved: List[StatusEntry] = field(default_factory=list)

    @property
    def days(self) -> int:
        d = int(self.sim.get("days") or 0)
        if self.status_only:
            return d
        return max(1, d)

    @property
    def seed(self) -> int:
        return int(self.sim.get("seed") or 0)

    @property
    def plan_day_start(self) -> str:
        return str(self.sim.get("plan_day_start") or DEFAULT_PLAN_DAY_START).strip() or DEFAULT_PLAN_DAY_START

    @property
    def slots_per_block(self) -> int:
        return int(self.zones.get("slots_per_block") or 0)

    def default_anchor(self) -> datetime:
        raw = str(self.sim.get("anchor_date") or "").strip()
        if not raw:
            return DEFAULT_ANCHOR
        return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=UTC)

    def infer_soldier_count(self, min_default: int = 12) -> int:
        n = int(self.sim.get("soldiers") or 0)
        if n > 0:
            return n
        max_idx = -1
        for row in self.status_rows:
            i = parse_soldier_index(str(row.get("soldier") or ""))
            if i is not None and i > max_idx:
                max_idx = i
        out = max_idx + 1
        return max(out, min_default)

    def resolve_zones_path(self, scenario_path: Path) -> Path:
        rel = str(self.zones.get("file") or "").strip()
        if not rel:
            raise ValueError("scenario zones.file is empty")
        p = Path(rel)
        if p.is_absolute():
            return p
        return (scenario_path.parent / p).resolve()


def is_status_only_doc(data: dict, schema_version: int) -> bool:
    zones = data.get("zones") or {}
    zones_file = ""
    if isinstance(zones, dict):
        zones_file = str(zones.get("file") or "").strip()
    return schema_version == 2 and not zones_file


def load_scenario_file(path: Path | str) -> Scenario:
    p = Path(path)
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("scenario root must be a mapping")
    schema_version = int(data.get("schema_version") or 1)
    status_only = is_status_only_doc(data, schema_version)
    name = str(data.get("name") or p.stem)
    if status_only and name == p.stem:
        name = "status-only"
    return Scenario(
        name=name,
        schema_version=schema_version,
        sim=dict(data.get("sim") or {}),
        zones=dict(data.get("zones") or {}),
        status_rows=list(data.get("status") or []),
        expect=dict(data.get("expect") or {}),
        status_only=status_only,
    )


def parse_plan_day_start_hour(s: str) -> int:
    s = (s or "").strip() or DEFAULT_PLAN_DAY_START
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError(f"plan_day_start: expected HH:MM, got {s!r}")
    h = int(parts[0])
    m = int(parts[1])
    if not (0 <= h <= 23):
        raise ValueError(f"plan_day_start: hour must be 0–23, got {h}")
    if m != 0:
        raise ValueError(f"plan_day_start: minutes must be 00, got {m}")
    return h


def parse_soldier_index(soldier_id: str) -> Optional[int]:
    m = re.fullmatch(r"s(\d+)", soldier_id.strip())
    if not m:
        return None
    return int(m.group(1))


def roster(n: int) -> List[str]:
    return [f"s{i}" for i in range(n)]


def plan_day_bounds(anchor: datetime, day_offset: int, plan_start_hour: int) -> Tuple[datetime, datetime]:
    anchor = anchor.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=UTC)
    d = anchor + timedelta(days=day_offset)
    start = d.replace(hour=plan_start_hour, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start, end


def _overlaps(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 < b1 and b0 < a1


def _union_intervals(intervals: List[Interval]) -> List[Interval]:
    if not intervals:
        return []
    intervals = sorted(intervals, key=lambda x: (x.start, x.end))
    out = [intervals[0]]
    for iv in intervals[1:]:
        last = out[-1]
        if iv.start <= last.end:
            if iv.end > last.end:
                last.end = iv.end
        else:
            out.append(iv)
    return out


def _subtract(window: Interval, blocked: List[Interval]) -> List[Interval]:
    blocked = _union_intervals(blocked)
    assignable = [Interval(window.start, window.end)]
    for b in blocked:
        nxt: List[Interval] = []
        for a in assignable:
            if not _overlaps(a.start, a.end, b.start, b.end):
                nxt.append(a)
                continue
            if a.start < b.start:
                nxt.append(Interval(a.start, min(b.start, a.end)))
            if b.end < a.end:
                nxt.append(Interval(max(b.end, a.start), a.end))
        assignable = [x for x in nxt if x.start < x.end]
        if not assignable:
            break
    return assignable


def _clip(iv: Interval, win_start: datetime, win_end: datetime) -> Optional[Interval]:
    s = max(iv.start, win_start)
    e = min(iv.end, win_end)
    if s >= e:
        return None
    return Interval(s, e)


def _blocked_for_soldier(
    entries: List[StatusEntry],
    soldier_id: str,
    win_start: datetime,
    win_end: datetime,
    open_end: datetime,
) -> List[Interval]:
    blocked: List[Interval] = []
    for e in entries:
        if e.soldier_id != soldier_id:
            continue
        st = normalize_status(e.status)
        if st == STATUS_BASE:
            continue
        end = e.end_at if e.end_at is not None else open_end
        iv = Interval(e.start_at.astimezone(UTC), end.astimezone(UTC))
        cl = _clip(iv, win_start, win_end)
        if cl:
            blocked.append(cl)
    return _union_intervals(blocked)


def _wall_hhmm(t: datetime) -> str:
    return t.strftime("%H:%M")


def compile_day_availability(
    anchor: datetime,
    day_offset: int,
    plan_start_hour: int,
    roster_ids: List[str],
    entries: List[StatusEntry],
) -> DaySoldiers:
    win_start, win_end = plan_day_bounds(anchor, day_offset, plan_start_hour)
    open_end = win_end + timedelta(days=3650)
    window = Interval(win_start, win_end)
    out = DaySoldiers()
    roster_set = {s for s in roster_ids if s}

    for sid in roster_ids:
        sid = sid.strip()
        if not sid:
            continue
        blocked = _blocked_for_soldier(entries, sid, win_start, win_end, open_end)
        assignable = _subtract(window, blocked)
        if not assignable:
            continue
        if (
            len(assignable) == 1
            and assignable[0].start <= win_start
            and assignable[0].end >= win_end
        ):
            out.avail_full.append(sid)
            continue
        pairs: List[List[str]] = []
        for a in assignable:
            pairs.append([_wall_hhmm(a.start), _wall_hhmm(a.end)])
        out.avail_partial[sid] = pairs

    out.avail_full.sort()
    out.full = len(out.avail_full)
    out.absent_partial = len(out.avail_partial)
    present = out.full + out.absent_partial
    out.absent_full = len(roster_set) - present
    if out.absent_full < 0:
        out.absent_full = 0
    return out


class AvailabilityChecker:
    """Gates assignment by duty-span ⊆ assignable windows per plan day."""

    def __init__(
        self,
        anchor: datetime,
        plan_start_hour: int,
        roster_ids: List[str],
        entries: List[StatusEntry],
        days: int,
    ) -> None:
        self.anchor = anchor.replace(tzinfo=UTC)
        self.plan_start_hour = plan_start_hour
        self.roster = list(roster_ids)
        self.entries = list(entries)
        self.days = days
        self._by_day: Dict[int, Dict[str, List[Interval]]] = {}
        for d in range(days):
            day = compile_day_availability(anchor, d, plan_start_hour, roster_ids, entries)
            m: Dict[str, List[Interval]] = {}
            ws, we = plan_day_bounds(anchor, d, plan_start_hour)
            for sid in day.avail_full:
                m[sid] = [Interval(ws, we)]
            for sid, pairs in day.avail_partial.items():
                ivs: List[Interval] = []
                for p in pairs:
                    if len(p) < 2:
                        continue
                    s = _parse_wall_on_plan_day(ws, p[0])
                    e = _parse_wall_on_plan_day(ws, p[1])
                    if e <= s:
                        e = e + timedelta(days=1)
                    ivs.append(Interval(s, e))
                m[sid] = ivs
            self._by_day[d] = m

    def compile_day(self, day_offset: int) -> DaySoldiers:
        return compile_day_availability(
            self.anchor, day_offset, self.plan_start_hour, self.roster, self.entries
        )

    def fairness_hours(self, soldier_idx: int, day: int) -> Tuple[float, float]:
        if soldier_idx < 0 or soldier_idx >= len(self.roster):
            return 0.0, 0.0
        sid = self.roster[soldier_idx]
        ws, we = plan_day_bounds(self.anchor, day, self.plan_start_hour)
        open_end = we + timedelta(days=3650)
        window = Interval(ws, we)
        blocked = _blocked_for_soldier(self.entries, sid, ws, we, open_end)
        assignable = _subtract(window, blocked)
        base_h = sum((a.end - a.start).total_seconds() / 3600.0 for a in assignable)
        away_h = 0.0
        for e in self.entries:
            if e.soldier_id != sid or normalize_status(e.status) != STATUS_AWAY:
                continue
            end = e.end_at if e.end_at is not None else open_end
            iv = Interval(e.start_at, end)
            cl = _clip(iv, ws, we)
            if cl:
                away_h += (cl.end - cl.start).total_seconds() / 3600.0
        return base_h, away_h

    def avail_idx(self, soldier_idx: int, day: int, duty_start: datetime, duty_end: datetime) -> bool:
        if soldier_idx < 0 or soldier_idx >= len(self.roster) or day < 0 or day >= self.days:
            return False
        if duty_start >= duty_end:
            return False
        sid = self.roster[soldier_idx]
        ivs = self._by_day.get(day, {}).get(sid)
        if not ivs:
            return False
        cur = duty_start
        while cur < duty_end:
            advanced = False
            for a in ivs:
                if cur < a.start or cur >= a.end:
                    continue
                end = min(a.end, duty_end)
                cur = end
                advanced = True
                break
            if not advanced:
                return False
        return True

    def avail_duty_wall_hours(self, soldier_idx: int, day: int, h0: int, h1: int) -> bool:
        """Duty span [h0, h1) on the plan-day calendar date (anchor+day), with midnight wrap."""
        anchor = self.anchor.replace(hour=0, minute=0, second=0, microsecond=0)
        cal = anchor + timedelta(days=day)
        start = cal.replace(hour=h0 % 24, minute=0, second=0, microsecond=0)
        if h0 >= 24:
            start = start + timedelta(days=h0 // 24)
        if h0 < self.plan_start_hour:
            start = start + timedelta(days=1)
        if h1 > h0:
            end = start + timedelta(hours=h1 - h0)
        else:
            end = start + timedelta(hours=(24 - h0) + h1)
        return self.avail_idx(soldier_idx, day, start, end)

    def avail_rotating_block(
        self, soldier_idx: int, day: int, block: int, plan_start_hour: int, shift_hours: float
    ) -> bool:
        win_start, _ = plan_day_bounds(self.anchor, day, plan_start_hour)
        start = win_start + timedelta(hours=block * shift_hours)
        end = start + timedelta(hours=shift_hours)
        return self.avail_idx(soldier_idx, day, start, end)


def block_start_hour(plan_start: int, block: int, shift_hours: float) -> int:
    h = plan_start + int(block * shift_hours)
    return h % 24


def _parse_wall_on_plan_day(plan_day_start: datetime, hhmm: str) -> datetime:
    t = datetime.strptime(hhmm, "%H:%M")
    base = plan_day_start.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
    if t.hour * 60 + t.minute < plan_day_start.hour * 60 + plan_day_start.minute:
        base = base + timedelta(days=1)
    return base


def resolve_scenario_times(sc: Scenario, anchor: Optional[datetime] = None) -> None:
    anchor = (anchor or sc.default_anchor()).replace(tzinfo=UTC)
    sc.anchor = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    plan_start = parse_plan_day_start_hour(sc.plan_day_start)
    resolved: List[StatusEntry] = []

    for row in sc.status_rows:
        st = normalize_status(str(row.get("state") or ""))
        if st == STATUS_BASE:
            continue
        soldier = str(row.get("soldier") or "").strip()
        from_t: Optional[datetime] = None
        until_t: Optional[datetime] = None

        if row.get("whole_plan_day") and row.get("plan_day") is not None:
            pd = int(row["plan_day"])
            from_t, until_t = plan_day_bounds(sc.anchor, pd, plan_start)
        elif row.get("from") and row.get("until"):
            from_t = _resolve_time(sc.anchor, plan_start, row["from"], is_end=False)
            until_t = _resolve_time(sc.anchor, plan_start, row["until"], is_end=True)
        elif row.get("until_plan_day") is not None and row.get("until_time"):
            from_t = sc.anchor - timedelta(days=365)
            until_t = _resolve_wall(sc.anchor, int(row["until_plan_day"]), str(row["until_time"]))
        else:
            raise ValueError(f"status {soldier}: need from/until or whole_plan_day")

        resolved.append(
            StatusEntry(
                soldier_id=soldier,
                start_at=from_t,
                end_at=until_t,
                status=st,
            )
        )
    sc.resolved = resolved


def _resolve_time(anchor: datetime, plan_start: int, spec: Any, is_end: bool) -> datetime:
    if not isinstance(spec, dict):
        raise ValueError("time spec must be a mapping")
    day = int(spec.get("plan_day_end" if is_end and spec.get("plan_day_end") else "plan_day") or 0)
    return _resolve_wall(anchor, day, str(spec.get("time") or "05:00"))


def _resolve_wall(anchor: datetime, plan_day: int, hhmm: str) -> datetime:
    h = parse_plan_day_start_hour(hhmm)
    cal = anchor + timedelta(days=plan_day)
    return cal.replace(hour=h, minute=0, second=0, microsecond=0, tzinfo=UTC)


def build_checker(
    sc: Scenario, roster_ids: List[str], num_days: Optional[int] = None
) -> AvailabilityChecker:
    plan_start = parse_plan_day_start_hour(sc.plan_day_start)
    nd = num_days if num_days is not None else sc.days
    if nd < 1:
        nd = 1
    return AvailabilityChecker(sc.anchor, plan_start, roster_ids, sc.resolved, nd)


def check_expectations(
    sc: Scenario,
    checker: AvailabilityChecker,
    assignments: Optional[List[Any]] = None,
    roster_ids: Optional[List[str]] = None,
) -> None:
    roster_ids = roster_ids or checker.roster
    for exp in sc.expect.get("availability") or []:
        if not isinstance(exp, dict):
            continue
        pd = int(exp.get("plan_day") or 0)
        summary = exp.get("summary") or {}
        day = checker.compile_day(pd)
        want = (
            int(summary.get("full", -1)),
            int(summary.get("absent_full", -1)),
            int(summary.get("absent_partial", -1)),
        )
        got = (day.full, day.absent_full, day.absent_partial)
        if got != want:
            raise AssertionError(
                f"plan_day {pd} availability: got full={got[0]} absent_full={got[1]} "
                f"absent_partial={got[2]}, want full={want[0]} absent_full={want[1]} "
                f"absent_partial={want[2]}"
            )

    if assignments is None:
        return
    idx_map = {sid: i for i, sid in enumerate(roster_ids)}
    for f in sc.expect.get("assignments", {}).get("forbid") or []:
        if not isinstance(f, dict):
            continue
        sid = str(f.get("soldier") or "")
        idx = idx_map.get(sid)
        if idx is None:
            continue
        for a in assignments:
            if int(a.day) != int(f.get("plan_day", 0)):
                continue
            if int(a.soldier_idx) != idx:
                continue
            kind = str(getattr(a, "kind", "rotating") or "rotating")
            if f.get("kind") and kind != f.get("kind"):
                continue
            if f.get("block") is not None and int(a.calendar_block) != int(f["block"]):
                continue
            if f.get("slot") is not None and int(a.slot) != int(f["slot"]):
                continue
            raise AssertionError(f"forbidden assignment: {f}")


def main(argv: Optional[List[str]] = None) -> int:
    """Lightweight CLI: compile scenario availability without importing guard_scheduler_sim."""
    import argparse
    import json
    import sys

    p = argparse.ArgumentParser(description="Compile scenario YAML availability (no schedule run)")
    p.add_argument("scenario", type=str, help="Path to scenario YAML")
    p.add_argument("--anchor-date", type=str, default=None)
    args = p.parse_args(argv)
    sc = load_scenario_file(args.scenario)
    anchor = sc.default_anchor()
    if args.anchor_date:
        anchor = datetime.strptime(args.anchor_date, "%Y-%m-%d").replace(tzinfo=UTC)
    resolve_scenario_times(sc, anchor)
    ids = roster(sc.infer_soldier_count(12))
    chk = build_checker(sc, ids)
    check_expectations(sc, chk, assignments=None, roster_ids=ids)
    ps = parse_plan_day_start_hour(sc.plan_day_start)
    out: Dict[str, Any] = {}
    for d in range(sc.days):
        cal = (sc.anchor + timedelta(days=d)).strftime("%Y-%m-%d")
        day = compile_day_availability(sc.anchor, d, ps, ids, sc.resolved)
        out[cal] = {
            "avail_full": day.avail_full,
            "avail_partial": day.avail_partial,
            "summary": {
                "full": day.full,
                "absent_full": day.absent_full,
                "absent_partial": day.absent_partial,
            },
        }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
