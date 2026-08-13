"""
tests/test_risk_model.py
========================
Unit tests for risk_model.py — risk scoring engine.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from risk_model import (
    RiskAssessment,
    score_risk,
    score_events,
    _base_score,
    _velocity_score,
    _urgency_score,
    _tier,
    _format_hours,
)


# ---------------------------------------------------------------------------
# Component scoring functions
# ---------------------------------------------------------------------------

class TestBaseScore:
    def test_direct_hit_is_max(self):
        assert _base_score(0.0) == 55.0

    def test_negative_treated_as_zero(self):
        assert _base_score(-1.0) == 55.0

    def test_decreases_with_distance(self):
        assert _base_score(1.0) > _base_score(5.0) > _base_score(10.0)

    def test_large_distance_near_zero(self):
        assert _base_score(50.0) < 1.0

    def test_capped_at_55(self):
        assert _base_score(0.0) <= 55.0


class TestVelocityScore:
    def test_zero_velocity_is_zero(self):
        assert _velocity_score(0.0) == 0.0

    def test_negative_velocity_is_zero(self):
        assert _velocity_score(-1.0) == 0.0

    def test_increases_with_velocity(self):
        assert _velocity_score(5.0) > _velocity_score(1.0)
        assert _velocity_score(10.0) > _velocity_score(5.0)

    def test_capped_at_25(self):
        assert _velocity_score(1000.0) <= 25.0

    def test_max_leo_velocity(self):
        score = _velocity_score(15.0)
        assert 20.0 <= score <= 25.0


class TestUrgencyScore:
    def test_past_tca_is_max(self):
        assert _urgency_score(0.0) == 20.0

    def test_negative_hours_is_max(self):
        assert _urgency_score(-5.0) == 20.0

    def test_decreases_over_time(self):
        assert _urgency_score(6.0) > _urgency_score(24.0) > _urgency_score(72.0)

    def test_capped_at_20(self):
        assert _urgency_score(0.0) <= 20.0

    def test_72h_near_zero(self):
        assert _urgency_score(72.0) < 3.0


# ---------------------------------------------------------------------------
# Tier assignment
# ---------------------------------------------------------------------------

class TestTier:
    def test_critical(self):
        level, colour = _tier(85.0)
        assert level == "CRITICAL"
        assert colour == "#dc2626"

    def test_high(self):
        level, _ = _tier(65.0)
        assert level == "HIGH"

    def test_moderate(self):
        level, _ = _tier(40.0)
        assert level == "MODERATE"

    def test_low(self):
        level, _ = _tier(15.0)
        assert level == "LOW"

    def test_negligible(self):
        level, _ = _tier(5.0)
        assert level == "NEGLIGIBLE"

    def test_boundary_critical(self):
        assert _tier(80.0)[0] == "CRITICAL"
        assert _tier(79.9)[0] == "HIGH"

    def test_boundary_high(self):
        assert _tier(60.0)[0] == "HIGH"
        assert _tier(59.9)[0] == "MODERATE"

    def test_boundary_moderate(self):
        assert _tier(35.0)[0] == "MODERATE"
        assert _tier(34.9)[0] == "LOW"

    def test_boundary_low(self):
        assert _tier(10.0)[0] == "LOW"
        assert _tier(9.9)[0] == "NEGLIGIBLE"


# ---------------------------------------------------------------------------
# score_risk
# ---------------------------------------------------------------------------

class TestScoreRisk:
    def test_returns_risk_assessment(self):
        ra = score_risk(1.0, 7.5, 24.0)
        assert isinstance(ra, RiskAssessment)

    def test_score_in_range(self):
        for miss, vel, hrs in [(0.0, 15.0, 0.0), (10.0, 0.0, 72.0), (2.0, 5.0, 12.0)]:
            ra = score_risk(miss, vel, hrs)
            assert 0.0 <= ra.score <= 100.0, f"Score out of range: {ra.score}"

    def test_critical_event(self):
        ra = score_risk(miss_distance_km=0.05, relative_velocity_kms=12.0, hours_to_tca=0.5)
        assert ra.level == "CRITICAL"
        assert ra.score >= 80.0

    def test_negligible_event(self):
        ra = score_risk(miss_distance_km=15.0, relative_velocity_kms=0.5, hours_to_tca=72.0)
        assert ra.level == "NEGLIGIBLE"
        assert ra.score < 10.0

    def test_score_increases_with_closer_miss(self):
        ra_far   = score_risk(10.0, 7.5, 24.0)
        ra_close = score_risk(0.5,  7.5, 24.0)
        assert ra_close.score > ra_far.score

    def test_score_increases_with_higher_velocity(self):
        ra_slow = score_risk(2.0, 1.0, 24.0)
        ra_fast = score_risk(2.0, 12.0, 24.0)
        assert ra_fast.score > ra_slow.score

    def test_score_increases_with_less_time(self):
        ra_late  = score_risk(2.0, 7.5, 72.0)
        ra_early = score_risk(2.0, 7.5, 1.0)
        assert ra_early.score > ra_late.score

    def test_component_scores_present(self):
        ra = score_risk(1.0, 7.5, 24.0)
        assert "base"     in ra.component_scores
        assert "velocity" in ra.component_scores
        assert "urgency"  in ra.component_scores

    def test_component_scores_sum_approx_total(self):
        ra  = score_risk(1.0, 7.5, 24.0)
        cs  = ra.component_scores
        approx = cs["base"] + cs["velocity"] + cs["urgency"]
        assert abs(approx - ra.score) < 0.1

    def test_insight_not_empty(self):
        ra = score_risk(1.0, 7.5, 24.0, debris_name="TEST")
        assert len(ra.insight) > 10

    def test_insight_contains_debris_name(self):
        ra = score_risk(1.0, 7.5, 24.0, debris_name="MYOBJECT")
        assert "MYOBJECT" in ra.insight

    def test_colour_is_hex(self):
        ra = score_risk(1.0, 7.5, 24.0)
        assert ra.colour.startswith("#")
        assert len(ra.colour) == 7

    def test_level_matches_score(self):
        ra = score_risk(0.1, 12.0, 0.5)
        level_from_score, _ = _tier(ra.score)
        assert ra.level == level_from_score


# ---------------------------------------------------------------------------
# score_events (batch)
# ---------------------------------------------------------------------------

class TestScoreEvents:
    def test_empty_list(self):
        assert score_events([]) == []

    def test_returns_one_per_event(self):
        from conjunction import ConjunctionEvent
        from propagation import Propagator
        from datetime import datetime, timezone, timedelta

        ISS_TLE_LOCAL = __import__('propagation').TLE(
            name="ISS",
            line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
            line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
        )
        DEB_TLE_LOCAL = __import__('propagation').TLE(
            name="DEB",
            line1="1 99001U 00000A   24001.50000000  .00002182  00000-0  40000-4 0  9991",
            line2="2 99001  51.6416 247.4627 0006800 130.5360 325.0288 15.50377579 00001",
        )
        epoch = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        prop  = Propagator(ISS_TLE_LOCAL)
        sv    = prop.state_at(epoch)

        events = [
            ConjunctionEvent(
                spacecraft_tle=ISS_TLE_LOCAL,
                debris_tle=DEB_TLE_LOCAL,
                tca=epoch + timedelta(hours=i+1),
                miss_distance_km=float(i+1),
                sc_state=sv,
                debris_state=sv,
                relative_velocity_kms=7.5,
            )
            for i in range(3)
        ]
        assessments = score_events(events)
        assert len(assessments) == 3

    def test_mutates_risk_level(self):
        from conjunction import ConjunctionEvent
        from propagation import Propagator

        ISS_TLE_LOCAL = __import__('propagation').TLE(
            name="ISS",
            line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
            line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
        )
        DEB_TLE_LOCAL = __import__('propagation').TLE(
            name="DEB",
            line1="1 99001U 00000A   24001.50000000  .00002182  00000-0  40000-4 0  9991",
            line2="2 99001  51.6416 247.4627 0006800 130.5360 325.0288 15.50377579 00001",
        )
        from datetime import datetime, timezone, timedelta
        epoch = datetime(2024, 1, 1, 12, tzinfo=timezone.utc)
        prop  = Propagator(ISS_TLE_LOCAL)
        sv    = prop.state_at(epoch)

        ev = ConjunctionEvent(
            spacecraft_tle=ISS_TLE_LOCAL,
            debris_tle=DEB_TLE_LOCAL,
            tca=epoch + timedelta(hours=10),
            miss_distance_km=2.0,
            sc_state=sv,
            debris_state=sv,
            relative_velocity_kms=7.5,
        )
        assert ev.risk_level == "UNKNOWN"
        score_events([ev])
        assert ev.risk_level != "UNKNOWN"


# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------

class TestFormatHours:
    def test_zero(self):
        assert _format_hours(0) == "0 min"

    def test_minutes(self):
        result = _format_hours(0.5)
        assert "30 min" in result

    def test_hours_only(self):
        result = _format_hours(3.0)
        assert "3 h" in result

    def test_hours_and_minutes(self):
        result = _format_hours(2.5)
        assert "2 h" in result
        assert "30 min" in result

    def test_negative(self):
        result = _format_hours(-1.0)
        assert "past" in result
