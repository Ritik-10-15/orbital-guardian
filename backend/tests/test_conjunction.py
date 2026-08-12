"""
tests/test_conjunction.py
=========================
Unit tests for conjuction.py — conjunction detection engine.
"""

import sys
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from propagation import TLE, StateVector
from conjuction import (
    ConjunctionEvent,
    _miss_distance,
    _relative_velocity,
    _screen_pair,
    find_conjunctions,
)
from propagation import Propagator

# ---------------------------------------------------------------------------
# Shared TLEs
# ---------------------------------------------------------------------------

ISS_TLE = TLE(
    name="ISS (ZARYA)",
    line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
    line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
)

# Slightly perturbed — same epoch, tiny eccentricity difference
CLOSE_DEBRIS = TLE(
    name="CLOSE-DEBRIS",
    line1="1 99001U 00000A   24001.50000000  .00002182  00000-0  40000-4 0  9991",
    line2="2 99001  51.6416 247.4627 0006800 130.5360 325.0288 15.50377579 00001",
)

FAR_DEBRIS = TLE(
    name="FAR-DEBRIS",
    line1="1 99002U 00000B   24001.50000000  .00002182  00000-0  40000-4 0  9992",
    line2="2 99002  75.0000 200.0000 0010000 180.0000 180.0000 14.00000000 00002",
)

EPOCH = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

class TestMissDistance:
    def _sv(self, x, y, z):
        return StateVector(
            epoch=EPOCH,
            position_km=(x, y, z),
            velocity_kms=(0.0, 0.0, 0.0),
        )

    def test_zero_separation(self):
        sv = self._sv(1000, 2000, 3000)
        assert _miss_distance(sv, sv) == 0.0

    def test_known_distance(self):
        sv1 = self._sv(0, 0, 0)
        sv2 = self._sv(3, 4, 0)
        assert abs(_miss_distance(sv1, sv2) - 5.0) < 1e-10

    def test_symmetry(self):
        sv1 = self._sv(100, 200, 300)
        sv2 = self._sv(400, 500, 600)
        assert abs(_miss_distance(sv1, sv2) - _miss_distance(sv2, sv1)) < 1e-10

    def test_3d_distance(self):
        sv1 = self._sv(0, 0, 0)
        sv2 = self._sv(1, 1, 1)
        assert abs(_miss_distance(sv1, sv2) - math.sqrt(3)) < 1e-10


class TestRelativeVelocity:
    def _sv(self, vx, vy, vz):
        return StateVector(
            epoch=EPOCH,
            position_km=(0, 0, 0),
            velocity_kms=(vx, vy, vz),
        )

    def test_zero_relative(self):
        sv = self._sv(7.0, 0.0, 0.0)
        assert _relative_velocity(sv, sv) == 0.0

    def test_head_on(self):
        sv1 = self._sv(7.5, 0, 0)
        sv2 = self._sv(-7.5, 0, 0)
        assert abs(_relative_velocity(sv1, sv2) - 15.0) < 1e-10

    def test_symmetry(self):
        sv1 = self._sv(1, 2, 3)
        sv2 = self._sv(4, 5, 6)
        assert abs(_relative_velocity(sv1, sv2) - _relative_velocity(sv2, sv1)) < 1e-10


# ---------------------------------------------------------------------------
# ConjunctionEvent
# ---------------------------------------------------------------------------

class TestConjunctionEvent:
    def _make_event(self, hours_ahead=24):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        tca = now + timedelta(hours=hours_ahead)
        prop = Propagator(ISS_TLE)
        sv   = prop.state_at(EPOCH)
        return ConjunctionEvent(
            spacecraft_tle=ISS_TLE,
            debris_tle=CLOSE_DEBRIS,
            tca=tca,
            miss_distance_km=2.5,
            sc_state=sv,
            debris_state=sv,
            relative_velocity_kms=7.8,
        )

    def test_time_to_tca_positive(self):
        ev = self._make_event(hours_ahead=10)
        assert ev.time_to_tca.total_seconds() > 0

    def test_time_to_tca_past(self):
        ev = self._make_event(hours_ahead=-5)
        assert ev.time_to_tca.total_seconds() < 0

    def test_repr_contains_name(self):
        ev = self._make_event()
        assert "CLOSE-DEBRIS" in repr(ev)

    def test_default_risk_level(self):
        ev = self._make_event()
        assert ev.risk_level == "UNKNOWN"

    def test_default_pc_is_none(self):
        ev = self._make_event()
        assert ev.probability_of_collision is None


# ---------------------------------------------------------------------------
# find_conjunctions — integration smoke test
# ---------------------------------------------------------------------------

class TestFindConjunctions:
    def test_returns_list(self):
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[FAR_DEBRIS],
            start=EPOCH,
            lookahead_hours=2,
            step_seconds=60,
            screen_km=1000.0,   # wide screen to ensure at least some results
            refine=False,
        )
        assert isinstance(events, list)

    def test_empty_debris_catalog(self):
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[],
            start=EPOCH,
            lookahead_hours=1,
            refine=False,
        )
        assert events == []

    def test_events_sorted_by_tca(self):
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[CLOSE_DEBRIS, FAR_DEBRIS],
            start=EPOCH,
            lookahead_hours=2,
            step_seconds=60,
            screen_km=500.0,
            refine=False,
        )
        for i in range(len(events) - 1):
            assert events[i].tca <= events[i + 1].tca

    def test_no_self_conjunction(self):
        """Spacecraft against itself should yield 0 km miss — filtered or 0 events."""
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[ISS_TLE],
            start=EPOCH,
            lookahead_hours=1,
            step_seconds=60,
            screen_km=0.001,   # very tight threshold — should catch 0 km events
            refine=False,
        )
        # Either 0 events OR all events have miss distance ≈ 0
        for ev in events:
            assert ev.miss_distance_km < 1.0

    def test_miss_distance_positive(self):
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[CLOSE_DEBRIS],
            start=EPOCH,
            lookahead_hours=2,
            step_seconds=60,
            screen_km=500.0,
            refine=False,
        )
        for ev in events:
            assert ev.miss_distance_km >= 0.0

    def test_relative_velocity_positive(self):
        events = find_conjunctions(
            spacecraft_tle=ISS_TLE,
            debris_tles=[CLOSE_DEBRIS],
            start=EPOCH,
            lookahead_hours=2,
            step_seconds=60,
            screen_km=500.0,
            refine=False,
        )
        for ev in events:
            assert ev.relative_velocity_kms >= 0.0
