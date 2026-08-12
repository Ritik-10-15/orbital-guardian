"""
tests/test_propagation.py
=========================
Unit tests for propagation.py — SGP4 orbital propagator.
"""

import sys
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Ensure backend/ is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from propagation import TLE, StateVector, PropagationResult, Propagator, propagate_batch, eci_to_ecef

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

ISS_TLE = TLE(
    name="ISS (ZARYA)",
    line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
    line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
)

EPOCH = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# TLE dataclass
# ---------------------------------------------------------------------------

class TestTLE:
    def test_fields(self):
        assert ISS_TLE.name  == "ISS (ZARYA)"
        assert ISS_TLE.line1.startswith("1 ")
        assert ISS_TLE.line2.startswith("2 ")

    def test_line_length(self):
        assert len(ISS_TLE.line1) == 69
        assert len(ISS_TLE.line2) == 69


# ---------------------------------------------------------------------------
# StateVector
# ---------------------------------------------------------------------------

class TestStateVector:
    def test_altitude_km(self):
        # ECI position ~409 km above Earth's surface
        sv = StateVector(
            epoch=EPOCH,
            position_km=(6780.0, 0.0, 0.0),   # ~409 km alt
            velocity_kms=(0.0, 7.67, 0.0),
        )
        alt = sv.altitude_km
        assert 400 < alt < 420, f"Expected ~409 km, got {alt:.1f}"

    def test_speed_kms(self):
        sv = StateVector(
            epoch=EPOCH,
            position_km=(6780.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.67, 0.0),
        )
        assert abs(sv.speed_kms - 7.67) < 0.01

    def test_altitude_direct_hit(self):
        sv = StateVector(
            epoch=EPOCH,
            position_km=(6378.137, 0.0, 0.0),
            velocity_kms=(0.0, 0.0, 0.0),
        )
        assert abs(sv.altitude_km) < 0.1   # at Earth's surface


# ---------------------------------------------------------------------------
# Propagator — single state
# ---------------------------------------------------------------------------

class TestPropagatorStateAt:
    def setup_method(self):
        self.prop = Propagator(ISS_TLE)

    def test_returns_state_vector(self):
        sv = self.prop.state_at(EPOCH)
        assert isinstance(sv, StateVector)

    def test_position_is_tuple_of_3(self):
        sv = self.prop.state_at(EPOCH)
        assert len(sv.position_km) == 3

    def test_velocity_is_tuple_of_3(self):
        sv = self.prop.state_at(EPOCH)
        assert len(sv.velocity_kms) == 3

    def test_iss_altitude_in_range(self):
        sv = self.prop.state_at(EPOCH)
        alt = sv.altitude_km
        assert 350 < alt < 450, f"ISS altitude out of range: {alt:.1f} km"

    def test_iss_speed_in_range(self):
        sv = self.prop.state_at(EPOCH)
        spd = sv.speed_kms
        assert 7.0 < spd < 8.2, f"ISS speed out of range: {spd:.2f} km/s"

    def test_epoch_is_utc(self):
        sv = self.prop.state_at(EPOCH)
        assert sv.epoch.tzinfo is not None

    def test_naive_epoch_accepted(self):
        naive = datetime(2024, 1, 1, 12, 0, 0)  # no tzinfo
        sv    = self.prop.state_at(naive)
        assert isinstance(sv, StateVector)

    def test_bad_tle_raises(self):
        bad_tle = TLE(
            name="BAD",
            line1="1 00001U 00000A   00000.00000000  .00000000  00000-0  00000-0 0  9999",
            line2="2 00001 999.9999 000.0000 9999999 000.0000 000.0000 99.99999999 00000",
        )
        prop = Propagator(bad_tle)
        with pytest.raises(RuntimeError):
            prop.state_at(EPOCH)


# ---------------------------------------------------------------------------
# Propagator — time arc
# ---------------------------------------------------------------------------

class TestPropagatorPropagate:
    def setup_method(self):
        self.prop = Propagator(ISS_TLE)

    def test_returns_propagation_result(self):
        stop   = EPOCH + timedelta(minutes=10)
        result = self.prop.propagate(EPOCH, stop, step_seconds=60)
        assert isinstance(result, PropagationResult)

    def test_step_count(self):
        stop   = EPOCH + timedelta(minutes=5)
        result = self.prop.propagate(EPOCH, stop, step_seconds=60)
        assert len(result.states) == 6   # 0, 60, 120, 180, 240, 300 s

    def test_positions_shape(self):
        import numpy as np
        stop   = EPOCH + timedelta(minutes=3)
        result = self.prop.propagate(EPOCH, stop, step_seconds=60)
        pos    = result.positions
        assert pos.shape == (4, 3)

    def test_epochs_match_steps(self):
        stop   = EPOCH + timedelta(minutes=2)
        result = self.prop.propagate(EPOCH, stop, step_seconds=60)
        assert len(result.epochs) == 3

    def test_start_equals_stop(self):
        result = self.prop.propagate(EPOCH, EPOCH, step_seconds=60)
        assert len(result.states) == 1

    def test_one_full_orbit(self):
        """One ISS orbit (~92 min) should produce ~93 steps at 60 s."""
        stop   = EPOCH + timedelta(minutes=92)
        result = self.prop.propagate(EPOCH, stop, step_seconds=60)
        assert 90 <= len(result.states) <= 95


# ---------------------------------------------------------------------------
# Batch propagator
# ---------------------------------------------------------------------------

class TestPropagateBatch:
    def test_returns_one_result_per_tle(self):
        tles   = [ISS_TLE, ISS_TLE]
        stop   = EPOCH + timedelta(minutes=5)
        results = propagate_batch(tles, EPOCH, stop, step_seconds=60)
        assert len(results) == 2

    def test_empty_list(self):
        results = propagate_batch([], EPOCH, EPOCH + timedelta(minutes=1))
        assert results == []


# ---------------------------------------------------------------------------
# ECI → ECEF conversion
# ---------------------------------------------------------------------------

class TestEciToEcef:
    def test_returns_tuple_of_3(self):
        pos_ecef = eci_to_ecef((6780.0, 0.0, 0.0), EPOCH)
        assert len(pos_ecef) == 3

    def test_magnitude_preserved(self):
        """ECEF is a rotation of ECI — magnitude must be unchanged."""
        pos_eci  = (4000.0, 3000.0, 2500.0)
        pos_ecef = eci_to_ecef(pos_eci, EPOCH)
        mag_eci  = math.sqrt(sum(c**2 for c in pos_eci))
        mag_ecef = math.sqrt(sum(c**2 for c in pos_ecef))
        assert abs(mag_eci - mag_ecef) < 0.01, "Rotation should preserve magnitude"

    def test_zero_vector(self):
        pos_ecef = eci_to_ecef((0.0, 0.0, 0.0), EPOCH)
        assert all(abs(c) < 1e-10 for c in pos_ecef)
