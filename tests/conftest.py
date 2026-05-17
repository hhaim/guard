"""Test harness: non-interactive matplotlib before importing the simulator."""

from __future__ import annotations

import os

# Must run before pyplot is imported by guard_scheduler_sim
os.environ.setdefault("MPLBACKEND", "Agg")
