"""
risk_model.py
=============
Risk scoring engine for Orbital Guardian.

Takes a ConjunctionEvent (miss distance, relative velocity, time to TCA)
and returns a RiskAssessment with:

  • A numeric score  0 – 100   (100 = certain collision)
  • A five-tier level: NEGLIGIBLE | LOW | MODERATE | HIGH | CRITICAL
  • A plain-English insight sentence ready for the UI / "AI insight" panel

Design principles
-----------------
• Deliberately isolated from conjunction.py — risk logic evolves independently.
• score_risk() internals can be swapped for a real ML model later; nothing
  else in the pipeline changes.
• Three input signals are used now; the architecture supports adding more
  (object size/mass, historical patterns, operator history, orbit type).

Scoring formula (rule-based, v1)
---------------------------------
  base_score    = f(miss_distance_km)          weight 0.55
  velocity_bonus= f(relative_velocity_kms)     weight 0.25
  urgency_bonus = f(hours_to_tca)              weight 0.20
  raw           = base + velocity_bonus + urgency_bonus   ← capped 0–100

Tier thresholds
---------------
  score ≥ 80  → CRITICAL
  score ≥ 60  → HIGH
  score ≥ 35  → MODERATE
  score ≥ 10  → LOW
  score  < 10 → NEGLIGIBLE

Units
-----
  distance  – km
  velocity  – km/s
  time      – hours
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, TYPE_CHECKING

# Avoid circular import — ConjunctionEvent is only needed for type hints
# and the score_event() convenience function.
if TYPE_CHECKING:
    from conjunction import ConjunctionEvent


# ---------------------------------------------------------------------------
# Tier definitions
# ---------------------------------------------------------------------------

TIERS = [
    # (min_score_inclusive, level_name, colour_hint)
    (80, "CRITICAL",   "#dc2626"),   # red-600
    (60, "HIGH",       "#ea580c"),   # orange-600
    (35, "MODERATE",   "#ca8a04"),   # yellow-600
    (10, "LOW",        "#16a34a"),   # green-600
    ( 0, "NEGLIGIBLE", "#2563eb"),   # blue-600
]


def _tier(score: float) -> tuple[str, str]:
    """Return (level_name, colour) for a given 0–100 score."""
    for min_score, name, colour in TIERS:
        if score >= min_score:
            return name, colour
    return "NEGLIGIBLE", "#2563eb"


# ---------------------------------------------------------------------------
# Output data class
# ---------------------------------------------------------------------------

@dataclass
class RiskAssessment:
    """
    Complete risk assessment for one conjunction event.

    Attributes
    ----------
    score               : float  — 0 (safe) to 100 (certain collision)
    level               : str    — NEGLIGIBLE | LOW | MODERATE | HIGH | CRITICAL
    colour              : str    — hex colour for UI badge
    insight             : str    — plain-English explanation sentence
    miss_distance_km    : float  — input mirror for convenience
    relative_velocity_kms : float
    hours_to_tca        : float
    component_scores    : dict   — breakdown: base / velocity / urgency
    """

    score: float
    level: str
    colour: str
    insight: str

    miss_distance_km: float
    relative_velocity_kms: float
    hours_to_tca: float

    component_scores: dict  # {"base": float, "velocity": float, "urgency": float}

    # ------------------------------------------------------------------ #
    def __repr__(self) -> str:
        return (
            f"<RiskAssessment level={self.level} score={self.score:.1f} "
            f"miss={self.miss_distance_km:.3f} km>"
        )


# ---------------------------------------------------------------------------
# Component scoring functions
# ---------------------------------------------------------------------------

def _base_score(miss_distance_km: float) -> float:
    """
    Convert miss distance → 0–55 base score.

    Curve: exponential decay so that:
      0.0 km  → 55  (direct hit)
      0.5 km  → ~50
      1.0 km  → ~44
      2.0 km  → ~33
      5.0 km  → ~10
      10+ km  →  ~0
    """
    if miss_distance_km <= 0:
        return 55.0
    # 55 × e^(-0.22 × d)  — tuned so 5 km ≈ 10, 10 km ≈ ~0
    return min(55.0, 55.0 * math.exp(-0.22 * miss_distance_km))


def _velocity_score(relative_velocity_kms: float) -> float:
    """
    Convert relative velocity → 0–25 bonus score.

    Higher closing speed → harder to manoeuvre in time → higher risk.
    Typical LEO relative velocities: 0 – 15 km/s.

      0   km/s → 0
      5   km/s → ~13
      10  km/s → ~21
      15+ km/s → 25
    """
    if relative_velocity_kms <= 0:
        return 0.0
    # Logarithmic: 25 × ln(1 + v) / ln(1 + 15)
    return min(25.0, 25.0 * math.log1p(relative_velocity_kms) / math.log1p(15.0))


def _urgency_score(hours_to_tca: float) -> float:
    """
    Convert time to TCA → 0–20 urgency score.

    Less time to act → higher urgency.
      0  h → 20  (imminent)
      6  h → ~18
      24 h → ~10
      72 h →  ~0
    """
    if hours_to_tca <= 0:
        return 20.0
    # Exponential decay: 20 × e^(-0.035 × h)
    return min(20.0, 20.0 * math.exp(-0.035 * hours_to_tca))


# ---------------------------------------------------------------------------
# Plain-English insight generator
# ---------------------------------------------------------------------------

def _build_insight(
    level: str,
    score: float,
    miss_km: float,
    rel_v: float,
    hours: float,
    debris_name: str,
) -> str:
    """
    Compose a human-readable insight sentence for the UI alert panel.

    The sentence structure varies by tier so it reads naturally at every
    severity level.  This is the "AI insight" layer — swap in an LLM call
    here later if desired without changing any surrounding logic.
    """
    dist_str = f"{miss_km:.2f} km"
    vel_str  = f"{rel_v:.1f} km/s"
    time_str = _format_hours(hours)

    if level == "CRITICAL":
        return (
            f"⛔ CRITICAL — '{debris_name}' will pass within {dist_str} "
            f"at {vel_str} in {time_str}. "
            f"Immediate avoidance manoeuvre is required."
        )
    elif level == "HIGH":
        return (
            f"🔴 HIGH RISK — '{debris_name}' closing to {dist_str} "
            f"at {vel_str} in {time_str}. "
            f"Plan a manoeuvre now; window is narrowing."
        )
    elif level == "MODERATE":
        return (
            f"🟡 MODERATE — '{debris_name}' predicted miss distance {dist_str} "
            f"in {time_str} at {vel_str}. "
            f"Monitor closely and prepare contingency burn."
        )
    elif level == "LOW":
        return (
            f"🟢 LOW — '{debris_name}' passes at {dist_str} in {time_str}. "
            f"No immediate action needed; continue monitoring."
        )
    else:  # NEGLIGIBLE
        return (
            f"🔵 NEGLIGIBLE — '{debris_name}' closest approach {dist_str} "
            f"in {time_str}. Risk is within acceptable limits."
        )


def _format_hours(hours: float) -> str:
    """Convert a float hours value to a readable string like '2 h 15 min'."""
    if hours < 0:
        return "the past"
    if hours < 1:
        mins = int(hours * 60)
        return f"{mins} min"
    h = int(hours)
    m = int((hours - h) * 60)
    if m == 0:
        return f"{h} h"
    return f"{h} h {m} min"


# ---------------------------------------------------------------------------
# Core scoring function
# ---------------------------------------------------------------------------

def score_risk(
    miss_distance_km: float,
    relative_velocity_kms: float,
    hours_to_tca: float,
    debris_name: str = "UNKNOWN",
) -> RiskAssessment:
    """
    Compute a RiskAssessment from raw conjunction metrics.

    This is the single function to replace when upgrading to ML.
    Everything else (API, UI, alerts) consumes RiskAssessment unchanged.

    Parameters
    ----------
    miss_distance_km      : Minimum separation at TCA (km).
    relative_velocity_kms : Closing speed at TCA (km/s).
    hours_to_tca          : Hours remaining until TCA.
    debris_name           : Name of the threatening object (for insight text).

    Returns
    -------
    RiskAssessment
    """
    base     = _base_score(miss_distance_km)
    velocity = _velocity_score(relative_velocity_kms)
    urgency  = _urgency_score(hours_to_tca)

    raw_score = base + velocity + urgency
    score = max(0.0, min(100.0, raw_score))  # clamp to [0, 100]

    level, colour = _tier(score)
    insight = _build_insight(level, score, miss_distance_km,
                             relative_velocity_kms, hours_to_tca, debris_name)

    return RiskAssessment(
        score=round(score, 2),
        level=level,
        colour=colour,
        insight=insight,
        miss_distance_km=miss_distance_km,
        relative_velocity_kms=relative_velocity_kms,
        hours_to_tca=hours_to_tca,
        component_scores={
            "base":     round(base, 2),
            "velocity": round(velocity, 2),
            "urgency":  round(urgency, 2),
        },
    )


# ---------------------------------------------------------------------------
# Convenience wrapper — scores a ConjunctionEvent in-place
# ---------------------------------------------------------------------------

def score_event(event: "ConjunctionEvent") -> RiskAssessment:
    """
    Score a ConjunctionEvent and write the results back onto it.

    After calling this, event.risk_level and event.probability_of_collision
    are populated and the RiskAssessment is returned for further use.

    Parameters
    ----------
    event : ConjunctionEvent from conjunction.py

    Returns
    -------
    RiskAssessment
    """
    hours = event.time_to_tca.total_seconds() / 3600.0

    assessment = score_risk(
        miss_distance_km=event.miss_distance_km,
        relative_velocity_kms=event.relative_velocity_kms,
        hours_to_tca=max(0.0, hours),
        debris_name=event.debris_tle.name,
    )

    # Write results back onto the event so downstream code (API, UI) can
    # read event.risk_level directly.
    event.risk_level = assessment.level
    # Normalise score to a pseudo-Pc in [0, 1] for the existing field.
    event.probability_of_collision = round(assessment.score / 100.0, 4)

    return assessment


# ---------------------------------------------------------------------------
# Batch scoring
# ---------------------------------------------------------------------------

def score_events(events: "List[ConjunctionEvent]") -> List[RiskAssessment]:
    """
    Score every event in a list in-place and return assessments in the same order.
    """
    return [score_event(ev) for ev in events]


# ---------------------------------------------------------------------------
# Quick-start example  (run: python backend/risk_model.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    scenarios = [
        # (label,            miss_km, rel_v_kms, hours_to_tca)
        ("Imminent hit",        0.05,     10.5,         0.5),
        ("High risk tonight",   0.80,      8.2,         4.0),
        ("Watch closely",       1.50,      5.0,        18.0),
        ("Monitor only",        3.00,      2.0,        48.0),
        ("Routine pass",        8.00,      1.0,        72.0),
    ]

    print(f"{'Scenario':<25} {'Score':>6}  {'Level':<12}  Insight\n" + "─" * 100)
    for label, miss, vel, hrs in scenarios:
        ra = score_risk(miss, vel, hrs, debris_name="TEST-DEBRIS")
        components = ra.component_scores
        print(
            f"{label:<25} {ra.score:>6.1f}  {ra.level:<12}  {ra.insight}"
        )
        print(
            f"  └─ base={components['base']:.1f}  "
            f"velocity={components['velocity']:.1f}  "
            f"urgency={components['urgency']:.1f}\n"
        )
