"""Test harness: non-interactive matplotlib before importing the simulator."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

# Must run before pyplot is imported by guard_scheduler_sim
os.environ.setdefault("MPLBACKEND", "Agg")

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


@pytest.fixture(scope="session")
def web_node_modules() -> None:
    """Install web/ deps when missing (plan UI pytest runs tsx against src/lib)."""
    marker = WEB / "node_modules" / "yaml"
    if marker.is_dir():
        return
    npm = shutil.which("npm")
    if not npm:
        pytest.skip("npm required to install web/ deps for plan UI tests")
    subprocess.run([npm, "ci"], cwd=WEB, check=True)
