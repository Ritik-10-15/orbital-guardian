"""
propagation.py
==============
Orbital propagation engine for Orbital Guardian.

Uses the SGP4 / SDP4 model (via the `sgp4` library) to propagate
Two-Line Element (TLE) sets forward in time and return Earth-Centred
Inertial (ECI) position / velocity state vectors.

Dependencies:
    pip install sgp4 numpy

Coordinate frame:
    ECI  - Earth-Centred Inertial (km, km/s)
    ECEF - Earth-Centred Earth-Fixed (km)  [optional helper]
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import List, Tuple

import numpy as np

# sgp4 >= 2.22  --  pip install sgp4
from sgp4.api import Satrec, jday  # type: ignore[import-untyped]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class TLE:
    """Represents a Two-Line Element set for a single space object."""
    name:  str   # Common / NORAD catalog name
    line1: str   # TLE line 1  (69 characters)
    line2: str   # TLE line 2  (69 characters)


@dataclass
class StateVector:
    """ECI position + velocity at a specific epoch."""
    epoch:        datetime                          # UTC epoch
    position_km:  Tuple[float, float, float]        # (x, y, z)  km
    velocity_kms: Tuple[float, float, float]        # (vx, vy, vz) km/s

    # ------------------------------------------------------------------ #
    @property
    def altitude_km(self) -> float:
        """
        Approximate geodetic altitude above the WGS-84 ellipsoid (km).
        Uses the ECI position magnitude minus Earth's mean radius.
        """
        EARTH_RADIUS_KM = 6378.137
        r = math.sqrt(sum(c ** 2 for c in self.position_km))
        return r - EARTH_RADIUS_KM

    @property
    def speed_kms(self) -> float:
        """Orbital speed magnitude (km/s)."""
        return math.sqrt(sum(v ** 2 for v in self.velocity_kms))


@dataclass
class PropagationResult:
    """Collection of state vectors produced by a propagation run."""
    tle:    TLE
    states: List[StateVector] = field(default_factory=list)

    # ------------------------------------------------------------------ #
    @property
    def positions(self) -> "np.ndarray":
        """Shape (N, 3) array of ECI positions in km."""
        return np.array([s.position_km for s in self.states])

    @property
    def epochs(self) -> List[datetime]:
        return [s.epoch for s in self.states]


# ---------------------------------------------------------------------------
# Core propagator
# ---------------------------------------------------------------------------

class Propagator:
    """
    Wraps the SGP4 Satrec model and provides convenient propagation helpers.

    Usage
    -----
    >>> tle = TLE("ISS", line1, line2)
    >>> prop = Propagator(tle)
    >>> result = prop.propagate(start, stop, step_seconds=60)
    """

    def __init__(self, tle: TLE) -> None:
        self.tle = tle
        self._sat: Satrec = Satrec.twoline2rv(tle.line1, tle.line2)

    # ------------------------------------------------------------------ #
    def state_at(self, epoch: datetime) -> StateVector:
        """
        Return the ECI state vector at a single UTC datetime.

        Raises
        ------
        RuntimeError
            If SGP4 reports a propagation error (e.g. decay / bad TLE).
        """
        epoch_utc = epoch.replace(tzinfo=timezone.utc) if epoch.tzinfo is None else epoch
        jd, fr = jday(
            epoch_utc.year,
            epoch_utc.month,
            epoch_utc.day,
            epoch_utc.hour,
            epoch_utc.minute,
            epoch_utc.second + epoch_utc.microsecond * 1e-6,
        )
        error_code, position, velocity = self._sat.sgp4(jd, fr)

        if error_code != 0:
            raise RuntimeError(
                f"SGP4 propagation error {error_code} for '{self.tle.name}' "
                f"at {epoch_utc.isoformat()}"
            )

        return StateVector(
            epoch=epoch_utc,
            position_km=tuple(position),    # type: ignore[arg-type]
            velocity_kms=tuple(velocity),   # type: ignore[arg-type]
        )

    # ------------------------------------------------------------------ #
    def propagate(
        self,
        start: datetime,
        stop: datetime,
        step_seconds: float = 60.0,
    ) -> PropagationResult:
        """
        Propagate the orbit from *start* to *stop* in equal time steps.

        Parameters
        ----------
        start        : UTC datetime for the first state vector.
        stop         : UTC datetime for the last state vector (inclusive).
        step_seconds : Time step between successive state vectors (default 60 s).

        Returns
        -------
        PropagationResult with one StateVector per step.
        """
        result  = PropagationResult(tle=self.tle)
        current = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start
        stop_utc = stop.replace(tzinfo=timezone.utc) if stop.tzinfo is None else stop
        dt      = timedelta(seconds=step_seconds)

        while current <= stop_utc:
            try:
                sv = self.state_at(current)
                result.states.append(sv)
            except RuntimeError:
                # Object has decayed or TLE is invalid — stop propagation
                break
            current += dt

        return result


# ---------------------------------------------------------------------------
# Batch propagator  (multiple TLEs simultaneously)
# ---------------------------------------------------------------------------

def propagate_batch(
    tles: List[TLE],
    start: datetime,
    stop: datetime,
    step_seconds: float = 60.0,
) -> List[PropagationResult]:
    """
    Propagate a list of TLEs over the same time window.

    Returns a list of PropagationResult, one per TLE, in the same order.
    """
    results: List[PropagationResult] = []
    for tle in tles:
        prop = Propagator(tle)
        results.append(prop.propagate(start, stop, step_seconds))
    return results


# ---------------------------------------------------------------------------
# Coordinate conversion helpers
# ---------------------------------------------------------------------------

def eci_to_ecef(
    position_eci: Tuple[float, float, float],
    epoch: datetime,
) -> Tuple[float, float, float]:
    """
    Rotate an ECI position vector into ECEF using Greenwich Sidereal Time (GST).

    This is an approximate conversion (ignores polar motion / nutation).
    Suitable for visualisation; use a full IAU model for high-precision work.
    """
    epoch_utc = epoch.replace(tzinfo=timezone.utc) if epoch.tzinfo is None else epoch

    jd, fr = jday(
        epoch_utc.year, epoch_utc.month, epoch_utc.day,
        epoch_utc.hour, epoch_utc.minute,
        epoch_utc.second + epoch_utc.microsecond * 1e-6,
    )
    jd_total = jd + fr

    # Greenwich Mean Sidereal Time (GMST) in radians — IAU 1982
    t_ut1     = (jd_total - 2451545.0) / 36525.0
    gmst_secs = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * t_ut1
        + 0.093104 * t_ut1 ** 2
        - 6.2e-6   * t_ut1 ** 3
    ) % 86400.0
    gmst_rad  = math.radians(gmst_secs / 240.0)   # seconds → degrees → radians

    cos_g, sin_g = math.cos(gmst_rad), math.sin(gmst_rad)
    x_eci, y_eci, z_eci = position_eci

    x_ecef =  cos_g * x_eci + sin_g * y_eci
    y_ecef = -sin_g * x_eci + cos_g * y_eci
    z_ecef =  z_eci

    return (x_ecef, y_ecef, z_ecef)


# ---------------------------------------------------------------------------
# Quick-start example  (run: python propagation.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # ISS (ZARYA) — example TLE from CelesTrak (may be outdated)
    iss_tle = TLE(
        name="ISS (ZARYA)",
        line1="1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990",
        line2="2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000",
    )

    now              = datetime.now(timezone.utc)
    one_orbit_later  = now + timedelta(minutes=95)   # ISS orbital period ≈ 92 min

    prop   = Propagator(iss_tle)
    result = prop.propagate(now, one_orbit_later, step_seconds=60)

    print(f"Object  : {result.tle.name}")
    print(f"Steps   : {len(result.states)}")
    print(f"First   : pos={result.states[0].position_km}  alt={result.states[0].altitude_km:.1f} km")
    print(f"Last    : pos={result.states[-1].position_km}  alt={result.states[-1].altitude_km:.1f} km")
