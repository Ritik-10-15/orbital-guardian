"""
ai_insight.py
=============
Option C — AI / LLM insight engine for Orbital Guardian.

Architecture
------------
  1. generate_insight()  — calls OpenAI GPT-4o-mini with structured conjunction
                           data and returns a rich multi-sentence analysis.
                           Falls back to the rule-based _fallback_insight() if
                           OPENAI_API_KEY is not set or the call fails.

  2. EarlyWarningModel   — lightweight ML anomaly detector trained on the
                           conjunction feature vector [miss_km, rel_v, hours].
                           Uses Isolation Forest (scikit-learn).
                           No training data needed — it learns the "normal"
                           distribution from a synthetic baseline and flags
                           statistically unusual events.

  3. explain_anomaly()   — converts a raw anomaly score into a plain-English
                           explanation of *why* an event is unusual.

Dependencies
------------
  pip install openai scikit-learn numpy

Environment
-----------
  OPENAI_API_KEY  — set in backend/.env to enable LLM insights
                    leave blank to use rule-based fallback only
"""

from __future__ import annotations

import math
import os
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


# ---------------------------------------------------------------------------
# Data class for the full AI analysis result
# ---------------------------------------------------------------------------

@dataclass
class AIAnalysis:
    """
    Full AI analysis for one conjunction event.

    Fields
    ------
    insight         : Rich multi-sentence LLM or rule-based explanation
    anomaly_score   : 0–100  (100 = most anomalous / unusual event)
    is_anomaly      : True if the event is statistically unusual
    anomaly_reason  : Plain-English reason why the event is anomalous
    recommendation  : Concrete operator action recommendation
    source          : "openai" | "rule-based"
    """
    insight:        str
    anomaly_score:  float
    is_anomaly:     bool
    anomaly_reason: str
    recommendation: str
    source:         str


# ---------------------------------------------------------------------------
# Helper — orbit type from inclination + altitude
# ---------------------------------------------------------------------------

def _orbit_type(inclination_deg: float, altitude_km: float) -> str:
    if altitude_km < 500:
        return "Very Low Earth Orbit (VLEO)"
    if altitude_km < 2000:
        if 96 <= inclination_deg <= 100:
            return "Sun-Synchronous Orbit (SSO)"
        if inclination_deg < 30:
            return "Low-inclination LEO"
        return "Low Earth Orbit (LEO)"
    if altitude_km < 36000:
        return "Medium Earth Orbit (MEO)"
    return "Geostationary / GEO"


def _kinetic_energy_kj(rel_v_kms: float, mass_kg: float = 10.0) -> float:
    """Approximate kinetic energy of impact (kJ). Default debris mass = 10 kg."""
    v_ms = rel_v_kms * 1000
    return 0.5 * mass_kg * v_ms ** 2 / 1000


def _manoeuvre_delta_v(miss_km: float, hours: float, rel_v_kms: float) -> float:
    """
    Rough delta-V estimate (m/s) needed to increase miss distance by 2×.
    Simplified linearised model — good for order-of-magnitude guidance.
    """
    if hours <= 0 or rel_v_kms <= 0:
        return 999.0
    # Scale: smaller miss distance + less time = more delta-V needed
    dv = (2.0 * miss_km * 1000) / (hours * 3600) * (1 / max(rel_v_kms, 0.1))
    return round(min(dv, 200.0), 2)


# ---------------------------------------------------------------------------
# Rule-based fallback insight (no API key needed)
# ---------------------------------------------------------------------------

def _fallback_insight(
    debris_name: str,
    miss_km: float,
    rel_v_kms: float,
    hours: float,
    risk_score: float,
    risk_level: str,
    anomaly_score: float,
    is_anomaly: bool,
) -> str:
    """
    Rich rule-based insight — several sentences covering all key dimensions.
    Used when OpenAI is not configured.
    """
    ek  = _kinetic_energy_kj(rel_v_kms)
    dv  = _manoeuvre_delta_v(miss_km, hours, rel_v_kms)
    h   = int(hours)
    m   = int((hours - h) * 60)
    t   = f"{h}h {m}m" if m else f"{h}h"

    # Opening sentence — severity-dependent
    if risk_level == "CRITICAL":
        opening = (
            f"⛔ CRITICAL THREAT — '{debris_name}' is on a near-collision trajectory "
            f"with a predicted miss distance of only {miss_km:.3f} km."
        )
    elif risk_level == "HIGH":
        opening = (
            f"🔴 HIGH RISK — '{debris_name}' will make a dangerously close approach "
            f"at {miss_km:.3f} km miss distance in {t}."
        )
    elif risk_level == "MODERATE":
        opening = (
            f"🟡 MODERATE RISK — '{debris_name}' is projected to pass at {miss_km:.3f} km "
            f"in {t}, warranting close attention."
        )
    elif risk_level == "LOW":
        opening = (
            f"🟢 LOW RISK — '{debris_name}' will pass at {miss_km:.3f} km in {t}. "
            f"Currently within monitoring threshold."
        )
    else:
        opening = (
            f"🔵 NEGLIGIBLE — '{debris_name}' closest approach {miss_km:.3f} km in {t}. "
            f"No action required."
        )

    # Physics sentence
    physics = (
        f"Relative closing velocity is {rel_v_kms:.2f} km/s, corresponding to "
        f"an estimated impact energy of {ek:,.0f} kJ — "
        f"{'catastrophic fragmentation' if ek > 1_000_000 else 'severe structural damage' if ek > 100_000 else 'significant damage' if ek > 10_000 else 'localised damage'}."
    )

    # Manoeuvre sentence
    if risk_level in ("CRITICAL", "HIGH"):
        manoeuvre = (
            f"An avoidance manoeuvre of approximately {dv:.1f} m/s delta-V is estimated "
            f"to double the miss distance. {'Immediate action required — manoeuvre window closing.' if hours < 6 else 'Plan burn within the next few hours.'}"
        )
    elif risk_level == "MODERATE":
        manoeuvre = (
            f"A contingency burn of ~{dv:.1f} m/s could increase separation to a safe margin. "
            f"Recommend preparing manoeuvre plan within the next {t}."
        )
    else:
        manoeuvre = "No manoeuvre currently recommended — continue passive monitoring."

    # Anomaly flag
    anom_str = ""
    if is_anomaly:
        anom_str = (
            f" ⚠ Anomaly detected (score {anomaly_score:.0f}/100): "
            f"this event has an unusual combination of parameters compared to the current catalog."
        )

    return f"{opening} {physics} {manoeuvre}{anom_str}"


# ---------------------------------------------------------------------------
# OpenAI LLM insight
# ---------------------------------------------------------------------------

async def _openai_insight(
    debris_name: str,
    miss_km: float,
    rel_v_kms: float,
    hours: float,
    risk_score: float,
    risk_level: str,
    anomaly_score: float,
) -> Optional[str]:
    """
    Call GPT-4o-mini with structured conjunction data.
    Returns the insight string or None if the call fails.
    """
    try:
        from openai import AsyncOpenAI   # type: ignore[import]
        client = AsyncOpenAI(api_key=OPENAI_API_KEY)

        ek  = _kinetic_energy_kj(rel_v_kms)
        dv  = _manoeuvre_delta_v(miss_km, hours, rel_v_kms)

        prompt = f"""You are an expert spacecraft operations analyst at a mission control centre.
Analyse this conjunction event and write a concise 3-sentence operational briefing for the duty officer.

Conjunction Data:
- Debris object: {debris_name}
- Miss distance at TCA: {miss_km:.3f} km
- Relative closing velocity: {rel_v_kms:.2f} km/s
- Time to TCA: {hours:.1f} hours
- Risk score: {risk_score:.1f} / 100  ({risk_level})
- Estimated impact energy: {ek:,.0f} kJ
- Estimated delta-V for 2× miss distance: {dv:.1f} m/s
- Anomaly score: {anomaly_score:.0f} / 100

Write exactly 3 sentences:
1. Severity and key numbers
2. Physical threat assessment (energy, damage potential)
3. Recommended operator action with timing

Be direct, technical, and actionable. Do not use bullet points."""

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.3,
        )
        return response.choices[0].message.content
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Early Warning ML Model (Isolation Forest)
# ---------------------------------------------------------------------------

class EarlyWarningModel:
    """
    Lightweight anomaly detector for conjunction events.

    Uses scikit-learn's IsolationForest trained on a synthetic baseline
    of "normal" conjunctions to flag statistically unusual events.

    Feature vector: [miss_km, rel_v_kms, hours_to_tca, risk_score]
    """

    def __init__(self) -> None:
        self._model = None
        self._fitted = False
        self._baseline: list = []

    def _ensure_fitted(self) -> None:
        """Fit model on first use with synthetic + observed baseline data."""
        if self._fitted:
            return
        try:
            from sklearn.ensemble import IsolationForest  # type: ignore[import]
        except ImportError:
            return  # scikit-learn not installed — anomaly detection disabled

        # Synthetic baseline: "normal" LEO conjunctions
        rng = np.random.default_rng(42)
        n   = 500
        baseline = np.column_stack([
            rng.exponential(scale=3.0,  size=n).clip(0.1, 50),   # miss_km
            rng.normal(loc=7.5,  scale=2.0, size=n).clip(0, 15), # rel_v_kms
            rng.uniform(12, 72,            size=n),               # hours_to_tca
            rng.uniform(5,  60,            size=n),               # risk_score
        ])

        # Add any observed events to the baseline for continual learning
        if self._baseline:
            obs = np.array(self._baseline)
            baseline = np.vstack([baseline, obs])

        self._model = IsolationForest(
            n_estimators=100,
            contamination=0.05,   # expect ~5% anomalies
            random_state=42,
        )
        self._model.fit(baseline)
        self._fitted = True

    def score(
        self,
        miss_km: float,
        rel_v_kms: float,
        hours: float,
        risk_score: float,
    ) -> tuple[float, bool]:
        """
        Score one event.

        Returns
        -------
        (anomaly_score_0_100, is_anomaly)
        """
        self._ensure_fitted()

        # Add to rolling baseline for continual learning
        self._baseline.append([miss_km, rel_v_kms, hours, risk_score])
        if len(self._baseline) > 200:
            self._baseline = self._baseline[-200:]

        if not self._fitted or self._model is None:
            # Fallback: simple threshold-based anomaly
            is_anom = miss_km < 0.5 or rel_v_kms > 13 or hours < 2
            score   = 80.0 if is_anom else 20.0
            return score, is_anom

        X     = np.array([[miss_km, rel_v_kms, hours, risk_score]])
        raw   = self._model.score_samples(X)[0]   # more negative = more anomalous
        # Normalise: typical range [-0.6, 0.1] → [0, 100]
        score = float(np.clip((raw + 0.6) / 0.7 * 100, 0, 100))
        score = 100 - score   # invert so high = anomalous
        is_anom = bool(self._model.predict(X)[0] == -1)
        return round(score, 1), is_anom

    def explain(
        self,
        miss_km: float,
        rel_v_kms: float,
        hours: float,
        risk_score: float,
        anomaly_score: float,
        is_anomaly: bool,
    ) -> str:
        """Return a plain-English explanation of the anomaly."""
        if not is_anomaly:
            return "Event parameters are within the normal distribution of LEO conjunctions."

        reasons = []
        if miss_km < 0.5:
            reasons.append(f"extremely close miss distance ({miss_km:.3f} km — top 1% of catalog)")
        if rel_v_kms > 12:
            reasons.append(f"unusually high closing velocity ({rel_v_kms:.1f} km/s)")
        if hours < 3:
            reasons.append(f"very short warning time ({hours:.1f} h to TCA)")
        if risk_score > 75:
            reasons.append(f"risk score ({risk_score:.0f}/100) well above typical range")
        if not reasons:
            reasons.append("unusual combination of parameters compared to catalog baseline")

        return (
            f"⚠ Statistical anomaly (score {anomaly_score:.0f}/100): "
            + "; ".join(reasons) + "."
        )


# Singleton model instance
_early_warning = EarlyWarningModel()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_insight(
    debris_name:   str,
    miss_km:       float,
    rel_v_kms:     float,
    hours:         float,
    risk_score:    float,
    risk_level:    str,
) -> AIAnalysis:
    """
    Generate a full AI analysis for one conjunction event.

    Uses OpenAI GPT-4o-mini if OPENAI_API_KEY is configured,
    otherwise falls back to rich rule-based insights.

    Parameters
    ----------
    debris_name   : Object name
    miss_km       : Miss distance at TCA (km)
    rel_v_kms     : Relative velocity (km/s)
    hours         : Hours to TCA
    risk_score    : 0–100 numeric risk score
    risk_level    : NEGLIGIBLE | LOW | MODERATE | HIGH | CRITICAL

    Returns
    -------
    AIAnalysis
    """
    # ── Anomaly detection ─────────────────────────────────────
    anomaly_score, is_anomaly = _early_warning.score(
        miss_km, rel_v_kms, hours, risk_score
    )
    anomaly_reason = _early_warning.explain(
        miss_km, rel_v_kms, hours, risk_score, anomaly_score, is_anomaly
    )

    # ── Recommendation ────────────────────────────────────────
    dv = _manoeuvre_delta_v(miss_km, hours, rel_v_kms)
    if risk_level == "CRITICAL":
        recommendation = f"Execute avoidance manoeuvre immediately (~{dv:.1f} m/s). Notify flight director."
    elif risk_level == "HIGH":
        recommendation = f"Prepare burn of ~{dv:.1f} m/s within {max(1, int(hours/2))}h. Await flight director approval."
    elif risk_level == "MODERATE":
        recommendation = f"Model contingency burn (~{dv:.1f} m/s). Review at next conjunction update."
    else:
        recommendation = "No manoeuvre required. Monitor at standard cadence."

    # ── LLM insight (or rule-based fallback) ─────────────────
    source  = "rule-based"
    insight = None

    if OPENAI_API_KEY and OPENAI_API_KEY != "your_openai_key_here":
        insight = await _openai_insight(
            debris_name, miss_km, rel_v_kms, hours,
            risk_score, risk_level, anomaly_score
        )
        if insight:
            source = "openai"

    if not insight:
        insight = _fallback_insight(
            debris_name, miss_km, rel_v_kms, hours,
            risk_score, risk_level, anomaly_score, is_anomaly
        )

    return AIAnalysis(
        insight=insight,
        anomaly_score=anomaly_score,
        is_anomaly=is_anomaly,
        anomaly_reason=anomaly_reason,
        recommendation=recommendation,
        source=source,
    )


async def batch_generate_insights(events: list) -> list[AIAnalysis]:
    """
    Generate AI analysis for a list of ConjunctionEvent objects.
    Runs sequentially to respect OpenAI rate limits.
    """
    import asyncio
    results = []
    for ev in events:
        hours = max(0.0, ev.time_to_tca.total_seconds() / 3600.0)
        analysis = await generate_insight(
            debris_name=ev.debris_tle.name,
            miss_km=ev.miss_distance_km,
            rel_v_kms=ev.relative_velocity_kms,
            hours=hours,
            risk_score=ev.probability_of_collision * 100 if ev.probability_of_collision else 0,
            risk_level=ev.risk_level,
        )
        results.append(analysis)
        if len(events) > 5:
            await asyncio.sleep(0.1)   # gentle rate-limit
    return results
