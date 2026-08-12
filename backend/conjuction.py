"""
conjuction.py
=============
Conjunction analysis engine for Orbital Guardian.

A "conjunction" is a close approach between two space objects where the
miss-distance falls below a configurable screening threshold.  This module:

  1. Propagates a protected spacecraft and a catalog of debris objects
     over a look-ahead window using SGP4 (via propagation.py).
  2. Screens every debris object against the spacecraft at each common
     time step and flags events that breach the miss-distance threshold.
  3. For flagged events, refines the Time of Closest Approach (TCA) using
     a golden-section search over a narrow sub-window.
  4. Returns a list of ConjunctionEvent objects ready for risk scoring.

Dependencies:
    pip install sgp4 numpy

Units throughout:
    distance  – km
    time      – datetime (UTC) / timedelta
    velocity  – km/s
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple

import numpy as np

from propagation import (
    TLE,
    PropagationResult,
    StateVector,
    Propagator,
    propagate_batch,
)


# ---------------------------------------------------------------------------
# Constants & defaults
# ---------------------------------------------------------------------------

DEFAULT_SCREEN_KM: float = 5.0       # Initial screening threshold (km)
DEFAULT_STEP_SECONDS: float = 60.0   # Propagation time step (s)
DEFAULT_LOOKAHEAD_HOURS: float = 72.0  # How far ahead to search (hours)
REFINE_HALF_WINDOW_S: float = 120.0  # ±seconds around coarse TCA for refinement
REFINE_TOLERANCE_S: float = 0.5      # Golden-section convergence tolerance (s)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ConjunctionEvent:
    """
    Describes a single close-approach event between the protected spacecraft
    and one debris / catalog object.
    """
    spacecraft_tle: TLE          # Protected spacecraft
    debris_tle: TLE              # Threatening object

    tca: datetime                # Time of Closest Approach (UTC)
    miss_distance_km: float      # Minimum separation at TCA (km)

    sc_state: StateVector        # Spacecraft state at TCA
    debris_state: StateVector    # Debris state at TCA

    # Relative velocity magnitude (km/s) — filled after refinement
    relative_velocity_kms: float = 0.0

    # Risk level — set by the risk model after Pc calculation
    risk_level: str = "UNKNOWN"  # GREEN | YELLOW | RED

    # Probability of collision — filled by risk_model.py
    probability_of_collision: Optional[float] = None

    # ------------------------------------------------------------------ #
    @property
    def time_to_tca(self) -> timedelta:
        """Remaining time from now (UTC) to TCA."""
        return self.tca - datetime.now(timezone.utc)

    def __repr__(self) -> str:
        return (
            f"<ConjunctionEvent debris='{self.debris_tle.name}' "
            f"tca={self.tca.isoformat()} "
            f"miss={self.miss_distance_km:.3f} km "
            f"rel_v={self.relative_velocity_kms:.3f} km/s "
            f"risk={self.risk_level}>"
        )


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _miss_distance(sv1: StateVector, sv2: StateVector) -> float:
    """Euclidean separation (km) between two ECI state vectors."""
    return math.sqrt(
        sum((a - b) ** 2 for a, b in zip(sv1.position_km, sv2.position_km))
    )


def _relative_velocity(sv1: StateVector, sv2: StateVector) -> float:
    """Relative speed (km/s) between two ECI state vectors."""
    return math.sqrt(
        sum((a - b) ** 2 for a, b in zip(sv1.velocity_kms, sv2.velocity_kms))
    )


# ---------------------------------------------------------------------------
# Coarse screening
# ---------------------------------------------------------------------------

def _screen_pair(
    sc_result: PropagationResult,
    debris_result: PropagationResult,
    screen_km: float,
) -> List[int]:
    """
    Walk the common time grid and return indices where the miss-distance
    drops below *screen_km*.  Only one index per local minimum is returned
    (the minimum within each contiguous below-threshold window).

    Both propagation results must share the same time grid (same start,
    stop, and step).
    """
    sc_states = sc_result.states
    debris_states = debris_result.states
    n = min(len(sc_states), len(debris_states))

    distances = np.array(
        [_miss_distance(sc_states[i], debris_states[i]) for i in range(n)]
    )

    # Find local minima that are below the screen threshold
    flagged: List[int] = []
    below = distances < screen_km

    i = 0
    while i < n:
        if below[i]:
            # Start of a below-threshold window — find its local minimum
            j = i
            while j < n and below[j]:
                j += 1
            window_min_idx = int(np.argmin(distances[i:j])) + i
            flagged.append(window_min_idx)
            i = j
        else:
            i += 1

    return flagged


# ---------------------------------------------------------------------------
# TCA refinement  (golden-section search)
# ---------------------------------------------------------------------------

def _refine_tca(
    sc_prop: Propagator,
    debris_prop: Propagator,
    coarse_epoch: datetime,
    half_window_s: float = REFINE_HALF_WINDOW_S,
    tolerance_s: float = REFINE_TOLERANCE_S,
) -> Tuple[datetime, StateVector, StateVector, float]:
    """
    Use a golden-section search to find the precise TCA within
    [coarse_epoch - half_window_s, coarse_epoch + half_window_s].

    Returns
    -------
    (tca_epoch, sc_state_at_tca, debris_state_at_tca, miss_distance_km)
    """
    GOLDEN_RATIO = (math.sqrt(5) - 1) / 2  # ≈ 0.618

    def distance_at_offset(offset_s: float) -> float:
        epoch = coarse_epoch + timedelta(seconds=offset_s)
        sv_sc = sc_prop.state_at(epoch)
        sv_db = debris_prop.state_at(epoch)
        return _miss_distance(sv_sc, sv_db)

    a = -half_window_s
    b = half_window_s

    c = b - GOLDEN_RATIO * (b - a)
    d = a + GOLDEN_RATIO * (b - a)

    while abs(b - a) > tolerance_s:
        if distance_at_offset(c) < distance_at_offset(d):
            b = d
        else:
            a = c
        c = b - GOLDEN_RATIO * (b - a)
        d = a + GOLDEN_RATIO * (b - a)

    tca_offset_s = (a + b) / 2.0
    tca_epoch = coarse_epoch + timedelta(seconds=tca_offset_s)

    sc_state = sc_prop.state_at(tca_epoch)
    debris_state = debris_prop.state_at(tca_epoch)
    miss_km = _miss_distance(sc_state, debris_state)

    return tca_epoch, sc_state, debris_state, miss_km


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def find_conjunctions(
    spacecraft_tle: TLE,
    debris_tles: List[TLE],
    start: Optional[datetime] = None,
    lookahead_hours: float = DEFAULT_LOOKAHEAD_HOURS,
    step_seconds: float = DEFAULT_STEP_SECONDS,
    screen_km: float = DEFAULT_SCREEN_KM,
    refine: bool = True,
) -> List[ConjunctionEvent]:
    """
    Find all conjunction events between *spacecraft_tle* and every object
    in *debris_tles* over the look-ahead window.

    Parameters
    ----------
    spacecraft_tle  : TLE of the protected spacecraft.
    debris_tles     : List of TLEs for debris / catalog objects to screen.
    start           : Window start (UTC). Defaults to now.
    lookahead_hours : Length of the screening window in hours (default 72 h).
    step_seconds    : Propagation step in seconds (default 60 s).
    screen_km       : Miss-distance screening threshold in km (default 5 km).
    refine          : If True, refine each flagged event with golden-section
                      search.  Set False for speed in unit tests.

    Returns
    -------
    List of ConjunctionEvent, sorted by TCA (soonest first).
    """
    if start is None:
        start = datetime.now(timezone.utc)
    stop = start + timedelta(hours=lookahead_hours)

    # --- propagate spacecraft ---
    sc_prop = Propagator(spacecraft_tle)
    sc_result = sc_prop.propagate(start, stop, step_seconds)

    # --- propagate all debris objects in batch ---
    debris_results = propagate_batch(debris_tles, start, stop, step_seconds)

    events: List[ConjunctionEvent] = []

    for debris_tle, debris_result in zip(debris_tles, debris_results):
        if not debris_result.states:
            continue  # propagation failed (decayed object)

        # Coarse screen
        flagged_indices = _screen_pair(sc_result, debris_result, screen_km)

        for idx in flagged_indices:
            coarse_epoch = sc_result.states[idx].epoch

            if refine:
                debris_prop = Propagator(debris_tle)
                tca, sc_sv, db_sv, miss_km = _refine_tca(
                    sc_prop, debris_prop, coarse_epoch
                )
            else:
                sc_sv = sc_result.states[idx]
                db_sv = debris_result.states[idx]
                miss_km = _miss_distance(sc_sv, db_sv)
                tca = coarse_epoch

            rel_v = _relative_velocity(sc_sv, db_sv)

            event = ConjunctionEvent(
                spacecraft_tle=spacecraft_tle,
                debris_tle=debris_tle,
                tca=tca,
                miss_distance_km=miss_km,
                sc_state=sc_sv,
                debris_state=db_sv,
                relative_velocity_kms=rel_v,
            )
            events.append(event)

    # Sort by TCA — soonest threat first
    events.sort(key=lambda e: e.tca)
    return events


# ---------------------------------------------------------------------------
# Quick-start example
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import timezone

    # Protected spacecraft — ISS (ZARYA)
    spacecraft = TLE(
        name="ISS (ZARYA)",
        line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
        line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
    )

    # Simulated debris objects (slightly perturbed ISS TLEs for demo)
    debris_catalog: List[TLE] = [
        TLE(
            name="DEBRIS-A",
            line1="1 99001U 00000A   24001.50000000  .00002182  00000-0  40000-4 0  9991",
            line2="2 99001  51.6416 247.4627 0006800 130.5360 325.0288 15.50377579 00001",
        ),
        TLE(
            name="DEBRIS-B",
            line1="1 99002U 00000B   24001.50000000  .00002182  00000-0  40000-4 0  9992",
            line2="2 99002  51.6500 248.0000 0007000 131.0000 326.0000 15.50000000 00002",
        ),
    ]

    print("Running conjunction analysis over 72-hour window …")
    events = find_conjunctions(
        spacecraft_tle=spacecraft,
        debris_tles=debris_catalog,
        lookahead_hours=72,
        step_seconds=60,
        screen_km=10.0,
        refine=False,   # disable refinement for demo speed
    )

    if events:
        print(f"\nFound {len(events)} conjunction event(s):\n")
        for ev in events:
            print(f"  {ev}")
    else:
        print("\nNo conjunctions detected within the screening threshold.")
