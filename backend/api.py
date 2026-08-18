"""
api.py
======
FastAPI gateway for Orbital Guardian
Endpoints
---------
  GET  /health                  — liveness probe
  GET  /tle/fetch               — pull & cache a TLE catalog from CelesTrak
  GET  /orbits/{norad_id}       — propagate one object → lat/lon/alt track
  POST /conjunctions            — run conjunction analysis on given TLEs
  POST /risk                    — score a single raw conjunction metric set
  GET  /conjunctions/scored     — full pipeline: fetch → detect → score
  WS   /ws/live                 — stream live orbit positions to the frontend

Run
---
  pip install -r requirements.txt
  uvicorn api:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from propagation import TLE, Propagator, StateVector, eci_to_ecef  # type: ignore[import]
from conjunction import find_conjunctions, ConjunctionEvent      # type: ignore[import]
from risk_model import score_risk, score_events, RiskAssessment # type: ignore[import]
from space_track import SpaceTrackClient, spacetrack_configured # type: ignore[import]
from ai_insight import generate_insight, batch_generate_insights, AIAnalysis # type: ignore[import]

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Orbital Guardian API",
    version="1.0.0",
    description="Space debris conjunction detection and risk assessment.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

CELESTRAK_BASE = "https://celestrak.org/SOCRATES/query.php"
CELESTRAK_TLE  = "https://celestrak.org/pub/TLE"

# CelesTrak requires a User-Agent header — plain httpx gets 403 without it
CELESTRAK_HEADERS = {
    "User-Agent": "OrbitalGuardian/1.0 (educational project; contact: student@university.edu)"
}

# OpenAI — optional, for LLM-powered insights (Option C)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TLESchema(BaseModel):
    name:  str = Field(..., json_schema_extra={"example": "ISS (ZARYA)"})
    line1: str = Field(..., min_length=69, max_length=69)
    line2: str = Field(..., min_length=69, max_length=69)


class OrbitPoint(BaseModel):
    epoch:        str    # ISO-8601 UTC
    latitude_deg: float
    longitude_deg: float
    altitude_km:  float
    x_km:         float
    y_km:         float
    z_km:         float


class OrbitTrackResponse(BaseModel):
    name:   str
    points: List[OrbitPoint]


class ConjunctionRequest(BaseModel):
    spacecraft:       TLESchema
    debris_catalog:   List[TLESchema]
    lookahead_hours:  float = Field(72.0, ge=1.0, le=168.0)
    step_seconds:     float = Field(60.0, ge=10.0, le=300.0)
    screen_km:        float = Field(5.0,  ge=0.1,  le=50.0)


class ConjunctionEventSchema(BaseModel):
    debris_name:              str
    tca:                      str    # ISO-8601 UTC
    miss_distance_km:         float
    relative_velocity_kms:    float
    risk_level:               str
    risk_score:               float
    probability_of_collision: Optional[float]
    insight:                  str
    hours_to_tca:             float


class ConjunctionResponse(BaseModel):
    spacecraft_name: str
    window_start:    str
    window_end:      str
    event_count:     int
    events:          List[ConjunctionEventSchema]


class RiskRequest(BaseModel):
    miss_distance_km:      float = Field(..., ge=0.0)
    relative_velocity_kms: float = Field(..., ge=0.0)
    hours_to_tca:          float = Field(..., ge=0.0)
    debris_name:           str   = Field("UNKNOWN")


class RiskResponse(BaseModel):
    score:                 float
    level:                 str
    colour:                str
    insight:               str
    component_scores:      Dict[str, float]


class TLECatalogResponse(BaseModel):
    source:       str
    object_count: int
    cached_at:    str
    objects:      List[TLESchema]


class CatalogSourceResponse(BaseModel):
    source:          str    # "spacetrack" | "celestrak" | "fallback"
    category:        str
    object_count:    int
    debris_count:    int
    satellite_count: int
    cached_at:       str
    objects:         List[TLESchema]


class DensityBand(BaseModel):
    label:        str    # e.g. "LEO 400–500 km"
    min_alt_km:   int
    max_alt_km:   int
    object_count: int
    risk_index:   float  # 0–100 congestion score


class HeatmapResponse(BaseModel):
    bands:      List[DensityBand]
    total_objects: int
    generated_at:  str


class AIInsightRequest(BaseModel):
    debris_name:           str   = Field("UNKNOWN")
    miss_distance_km:      float = Field(..., ge=0.0)
    relative_velocity_kms: float = Field(..., ge=0.0)
    hours_to_tca:          float = Field(..., ge=0.0)
    risk_score:            float = Field(..., ge=0.0, le=100.0)
    risk_level:            str   = Field("UNKNOWN")


class AIInsightResponse(BaseModel):
    insight:        str
    anomaly_score:  float
    is_anomaly:     bool
    anomaly_reason: str
    recommendation: str
    source:         str     # "openai" | "rule-based"
    openai_enabled: bool


class EarlyWarningEvent(BaseModel):
    debris_name:      str
    miss_distance_km: float
    rel_v_kms:        float
    hours_to_tca:     float
    risk_score:       float
    risk_level:       str
    anomaly_score:    float
    is_anomaly:       bool
    anomaly_reason:   str
    recommendation:   str


class EarlyWarningResponse(BaseModel):
    spacecraft_name:  str
    total_events:     int
    anomaly_count:    int
    critical_count:   int
    events:           List[EarlyWarningEvent]
    generated_at:     str


class PassRequest(BaseModel):
    spacecraft: TLESchema
    station_lat: float = Field(..., ge=-90.0,  le=90.0,  description="Ground station latitude (deg)")
    station_lon: float = Field(..., ge=-180.0, le=180.0, description="Ground station longitude (deg)")
    station_name: str  = Field("Ground Station", description="Human-readable station name")
    min_elevation_deg: float = Field(5.0, ge=0.0, le=90.0, description="Minimum elevation for a valid pass (deg)")
    lookahead_hours: float   = Field(24.0, ge=1.0, le=168.0, description="How far ahead to search for passes")
    step_seconds: float      = Field(30.0, ge=5.0, le=120.0, description="Time step for scan (seconds)")


class SatPass(BaseModel):
    aos:        str    # Acquisition of Signal (ISO UTC)
    los:        str    # Loss of Signal (ISO UTC)
    max_el:     float  # Maximum elevation during pass (degrees)
    max_el_at:  str    # Time of max elevation (ISO UTC)
    duration_s: float  # Pass duration in seconds


class PassPredictionResponse(BaseModel):
    spacecraft: str
    station_name: str
    station_lat:  float
    station_lon:  float
    passes:       List[SatPass]
    computed_at:  str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tle_schema(t: TLE) -> TLESchema:
    return TLESchema(name=t.name, line1=t.line1, line2=t.line2)


def _to_tle(s: TLESchema) -> TLE:
    return TLE(name=s.name, line1=s.line1, line2=s.line2)


def _eci_to_latlon(
    position_km: tuple[float, float, float],
    epoch: datetime,
) -> tuple[float, float]:
    """
    Convert ECI position to geodetic latitude and longitude (degrees).
    Uses ECEF intermediate frame via GMST rotation.
    """
    x, y, z = eci_to_ecef(position_km, epoch)
    lon_deg = math.degrees(math.atan2(y, x))
    r_xy    = math.sqrt(x ** 2 + y ** 2)
    lat_deg = math.degrees(math.atan2(z, r_xy))   # geocentric (good enough for viz)
    return lat_deg, lon_deg


def _event_to_schema(ev: ConjunctionEvent, assessment_insight: str, risk_score: float) -> ConjunctionEventSchema:
    hours = max(0.0, ev.time_to_tca.total_seconds() / 3600.0)
    return ConjunctionEventSchema(
        debris_name=ev.debris_tle.name,
        tca=ev.tca.isoformat(),
        miss_distance_km=round(ev.miss_distance_km, 4),
        relative_velocity_kms=round(ev.relative_velocity_kms, 4),
        risk_level=ev.risk_level,
        risk_score=round(risk_score, 2),
        probability_of_collision=ev.probability_of_collision,
        insight=assessment_insight,
        hours_to_tca=round(hours, 2),
    )


def _parse_tle_text(raw: str) -> List[TLE]:
    """Parse a 3-line TLE text block (name / line1 / line2) into TLE objects."""
    tles: List[TLE] = []
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    i = 0
    while i + 2 < len(lines):
        name  = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]
        if line1.startswith("1 ") and line2.startswith("2 "):
            tles.append(TLE(name=name, line1=line1, line2=line2))
            i += 3
        else:
            i += 1
    return tles
# ---------------------------------------------------------------------------
# Synthetic demo debris — derived from a spacecraft's own orbit for reliable
# demo scans. NOT real tracked objects — clearly labeled DEMO-DEBRIS-*.
# ---------------------------------------------------------------------------

def _tle_checksum(line68: str) -> int:
    """Standard TLE checksum: sum of digits, '-' counts as 1, mod 10."""
    total = 0
    for ch in line68:
        if ch.isdigit():
            total += int(ch)
        elif ch == "-":
            total += 1
    return total % 10


def _generate_demo_debris(sc_name: str, line1: str, line2: str, count: int = 5) -> List[TLE]:
    """
    Generate synthetic debris TLEs by perturbing the spacecraft's own RAAN
    (orbital plane) and mean anomaly (position along orbit) by small,
    increasing amounts. This produces a realistic spread of miss distances
    — from a near-direct pass down to a wide, safe separation — guaranteed
    to be relevant to whichever spacecraft is being scanned.
    """
    try:
        base_raan = float(line2[17:25])
        base_ma   = float(line2[43:51])
    except ValueError:
        base_raan, base_ma = 0.0, 0.0

    # (raan_offset_deg, mean_anomaly_offset_deg) — tuned for a spread of
    # miss distances from very close to negligible within a 72h window
    OFFSETS = [
    (0.0001, 0.0004),   # extreme near-hit  → CRITICAL + ANOMALY
    (0.015,  0.05),     # near-direct pass  → CRITICAL/HIGH
    (0.08,   0.3),      # close pass        → HIGH
    (0.35,   1.0),      # moderate pass     → MODERATE
    (1.2,    3.0),      # wide pass         → LOW
]

    debris: List[TLE] = []
    for i in range(min(count, len(OFFSETS))):
        d_raan, d_ma = OFFSETS[i]
        new_raan = (base_raan + d_raan) % 360.0
        new_ma   = (base_ma + d_ma) % 360.0

        # Rebuild line2, replacing only the RAAN and mean-anomaly fields
        # (columns 18-25 and 44-51), preserving everything else byte-for-byte.
        prefix   = line2[:17]                  # up to RAAN
        raan_str = f"{new_raan:8.4f}"
        mid      = line2[25:43]                # eccentricity + arg perigee, unchanged
        ma_str   = f"{new_ma:8.4f}"
        suffix   = line2[51:68]                # mean motion + rev number, unchanged

        body_68  = prefix + raan_str + mid + ma_str + suffix
        checksum = _tle_checksum(body_68)
        new_line2 = body_68 + str(checksum)

        debris.append(TLE(
            name=f"DEMO-DEBRIS-{i + 1}",
            line1=line1,       # NORAD id/epoch irrelevant for propagation demo
            line2=new_line2,
        ))

    return debris

# ---------------------------------------------------------------------------
# Built-in fallback TLE catalog (used when CelesTrak is unreachable)
# Contains a small set of well-known LEO objects for demo purposes
# ---------------------------------------------------------------------------

_FALLBACK_TLE_CATALOG = """\
ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000
CSS (TIANHE)
1 48274U 21035A   24001.50000000  .00005770  00000-0  10000-3 0  9993
2 48274  41.4750 150.3421 0005750  55.6100 304.5050 15.60000000 00001
STARLINK-1007
1 44713U 19074B   24001.50000000  .00001200  00000-0  90000-4 0  9994
2 44713  53.0000 100.0000 0001400  80.0000 280.0000 15.06400000 00002
STARLINK-1008
1 44714U 19074C   24001.50000000  .00001300  00000-0  95000-4 0  9995
2 44714  53.0000 102.0000 0001500  82.0000 278.0000 15.06400000 00003
STARLINK-1009
1 44715U 19074D   24001.50000000  .00001250  00000-0  92000-4 0  9996
2 44715  53.0000 104.0000 0001600  84.0000 276.0000 15.06400000 00004
NOAA 15
1 25338U 98030A   24001.50000000  .00000020  00000-0  30000-4 0  9997
2 25338  98.7300 110.0000 0010800  80.0000 280.0000 14.25750000 00005
NOAA 18
1 28654U 05018A   24001.50000000  .00000015  00000-0  20000-4 0  9998
2 28654  98.8800 120.0000 0013500  90.0000 270.0000 14.09600000 00006
NOAA 19
1 33591U 09005A   24001.50000000  .00000018  00000-0  25000-4 0  9999
2 33591  98.7200 130.0000 0014000  95.0000 265.0000 14.12200000 00007
TERRA
1 25994U 99068A   24001.50000000  .00000008  00000-0  10000-4 0  9990
2 25994  98.2100 140.0000 0001200  85.0000 275.0000 14.57100000 00008
AQUA
1 27424U 02022A   24001.50000000  .00000010  00000-0  12000-4 0  9991
2 27424  98.2200 142.0000 0001300  87.0000 273.0000 14.57300000 00009
"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

# ── 1. Health ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
def health() -> Dict[str, str]:
    """Liveness probe — returns 200 OK when the server is running."""
    return {"status": "ok", "utc": datetime.now(timezone.utc).isoformat()}


# ── 2. TLE catalog fetch ───────────────────────────────────────────────────

@app.get("/tle/fetch", response_model=TLECatalogResponse, tags=["TLE"])
async def fetch_tle_catalog(
    category: str = Query(
        "active",
        description="CelesTrak TLE catalog name: active | stations | debris | tle-new",
    ),
) -> TLECatalogResponse:
    """
    Pull a fresh TLE catalog from CelesTrak and cache it to backend/data/.
    Returns the parsed object list so the frontend can display available targets.
    """
    url = f"{CELESTRAK_TLE}/{category}.txt"
    cache_file = DATA_DIR / f"{category}.txt"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=CELESTRAK_HEADERS)
            resp.raise_for_status()
        raw = resp.text
        cache_file.write_text(raw, encoding="utf-8")
    except Exception as exc:
        # Fall back to local cache, then built-in seed data
        if cache_file.exists():
            raw = cache_file.read_text(encoding="utf-8")
        else:
            raw = _FALLBACK_TLE_CATALOG
            cache_file.write_text(raw, encoding="utf-8")

    tles = _parse_tle_text(raw)
    return TLECatalogResponse(
        source=url,
        object_count=len(tles),
        cached_at=datetime.now(timezone.utc).isoformat(),
        objects=[_tle_schema(t) for t in tles],
    )


# ── 3. Orbit track ─────────────────────────────────────────────────────────

@app.post("/orbits/track", response_model=OrbitTrackResponse, tags=["Orbits"])
def orbit_track(
    body: TLESchema,
    hours: float = Query(2.0, ge=0.1, le=24.0, description="Track duration in hours"),
    step: float  = Query(60.0, ge=10.0, le=300.0, description="Step size in seconds"),
) -> OrbitTrackResponse:
    """
    Propagate a TLE forward and return a lat/lon/alt ground track.
    Used by the frontend 3D globe to draw the orbital path.
    """
    tle   = _to_tle(body)
    prop  = Propagator(tle)
    start = datetime.now(timezone.utc)
    stop  = start + timedelta(hours=hours)
    result = prop.propagate(start, stop, step_seconds=step)

    points: List[OrbitPoint] = []
    for sv in result.states:
        lat, lon = _eci_to_latlon(sv.position_km, sv.epoch)
        points.append(OrbitPoint(
            epoch=sv.epoch.isoformat(),
            latitude_deg=round(lat, 5),
            longitude_deg=round(lon, 5),
            altitude_km=round(sv.altitude_km, 3),
            x_km=round(sv.position_km[0], 3),
            y_km=round(sv.position_km[1], 3),
            z_km=round(sv.position_km[2], 3),
        ))

    return OrbitTrackResponse(name=tle.name, points=points)


# ── 4. Conjunction detection ───────────────────────────────────────────────

@app.post("/conjunctions", response_model=ConjunctionResponse, tags=["Conjunctions"])
def conjunctions(body: ConjunctionRequest) -> ConjunctionResponse:
    """
    Run conjunction analysis between a spacecraft and a debris catalog.
    Returns all close-approach events detected within the look-ahead window,
    each scored and annotated with a plain-English risk insight.
    """
    sc_tle       = _to_tle(body.spacecraft)
    debris_tles  = [_to_tle(d) for d in body.debris_catalog]
    start        = datetime.now(timezone.utc)
    stop         = start + timedelta(hours=body.lookahead_hours)

    events = find_conjunctions(
        spacecraft_tle=sc_tle,
        debris_tles=debris_tles,
        start=start,
        lookahead_hours=body.lookahead_hours,
        step_seconds=body.step_seconds,
        screen_km=body.screen_km,
        refine=True,
    )

    # Score every event — mutates event.risk_level and event.probability_of_collision
    assessments = score_events(events)

    event_schemas = [
        _event_to_schema(ev, a.insight, a.score)
        for ev, a in zip(events, assessments)
    ]

    # Re-sort by risk score descending so highest threat appears first
    event_schemas.sort(key=lambda e: e.risk_score, reverse=True)

    return ConjunctionResponse(
        spacecraft_name=sc_tle.name,
        window_start=start.isoformat(),
        window_end=stop.isoformat(),
        event_count=len(event_schemas),
        events=event_schemas,
    )


# ── 5. Raw risk scoring ────────────────────────────────────────────────────

@app.post("/risk", response_model=RiskResponse, tags=["Risk"])
def risk(body: RiskRequest) -> RiskResponse:
    """
    Score a single set of conjunction metrics and return a full RiskAssessment.
    Useful for the manoeuvre simulator UI — pass hypothetical post-burn
    miss distances to see how risk changes.
    """
    ra = score_risk(
        miss_distance_km=body.miss_distance_km,
        relative_velocity_kms=body.relative_velocity_kms,
        hours_to_tca=body.hours_to_tca,
        debris_name=body.debris_name,
    )
    return RiskResponse(
        score=ra.score,
        level=ra.level,
        colour=ra.colour,
        insight=ra.insight,
        component_scores=ra.component_scores,
    )


# ── 6. Full scored pipeline (convenience) ─────────────────────────────────

@app.get("/conjunctions/scored", response_model=ConjunctionResponse, tags=["Conjunctions"])
async def conjunctions_scored(
    sc_name:  str   = Query(..., description="Spacecraft name"),
    sc_line1: str   = Query(..., description="TLE line 1 (69 chars)"),
    sc_line2: str   = Query(..., description="TLE line 2 (69 chars)"),
    category: str   = Query("active", description="Debris catalog: active | debris | tle-new"),
    lookahead: float = Query(72.0, ge=1.0, le=168.0),
    screen_km: float = Query(5.0,  ge=0.1, le=50.0),
) -> ConjunctionResponse:
    """
    One-shot: fetch the latest TLE catalog from CelesTrak, run full
    conjunction analysis against it, score every event, and return results.
    """
    # Fetch / load catalog
    cache_file = DATA_DIR / f"{category}.txt"
    url = f"{CELESTRAK_TLE}/{category}.txt"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=CELESTRAK_HEADERS)
            resp.raise_for_status()
        raw = resp.text
        cache_file.write_text(raw, encoding="utf-8")
    except Exception:
        if cache_file.exists():
            raw = cache_file.read_text(encoding="utf-8")
        else:
            raw = _FALLBACK_TLE_CATALOG
            cache_file.write_text(raw, encoding="utf-8")

    debris_tles = _parse_tle_text(raw)
    sc_tle      = TLE(name=sc_name, line1=sc_line1, line2=sc_line2)
    start       = datetime.now(timezone.utc)
    stop        = start + timedelta(hours=lookahead)

    events      = find_conjunctions(sc_tle, debris_tles, start, lookahead, screen_km=screen_km)
    assessments = score_events(events)

    event_schemas = [
        _event_to_schema(ev, a.insight, a.score)
        for ev, a in zip(events, assessments)
    ]
    event_schemas.sort(key=lambda e: e.risk_score, reverse=True)

    return ConjunctionResponse(
        spacecraft_name=sc_tle.name,
        window_start=start.isoformat(),
        window_end=stop.isoformat(),
        event_count=len(event_schemas),
        events=event_schemas,
    )


# ── 7. Space-Track catalog fetch ──────────────────────────────────────────

@app.get("/catalog/spacetrack", response_model=CatalogSourceResponse, tags=["Catalog"])
async def catalog_spacetrack(
    type:  str = Query("debris", description="Object type: debris | satellite | all"),
    limit: int = Query(200, ge=1, le=2000, description="Max objects to return"),
) -> CatalogSourceResponse:
    """
    Fetch live TLE catalog from Space-Track.org (requires credentials in .env).
    Falls back to CelesTrak if Space-Track is not configured.
    """
    if not spacetrack_configured():
        raise HTTPException(
            status_code=401,
            detail=(
                "Space-Track credentials not configured. "
                "Add SPACETRACK_USER and SPACETRACK_PASS to backend/.env — "
                "free account at https://www.space-track.org/auth/createAccount"
            ),
        )

    cache_file = DATA_DIR / f"spacetrack_{type}_{limit}.txt"
    tles: List[TLE] = []

    try:
        async with SpaceTrackClient() as st:
            if type == "debris":
                tles = await st.fetch_leo_debris(limit=limit)
            elif type == "satellite":
                tles = await st.fetch_active_satellites(limit=limit)
            else:
                tles = await st.fetch_all_leo(limit=limit)

        # Cache raw for offline fallback
        raw = "\n".join(f"{t.name}\n{t.line1}\n{t.line2}" for t in tles)
        cache_file.write_text(raw, encoding="utf-8")

    except Exception as exc:
        if cache_file.exists():
            raw   = cache_file.read_text(encoding="utf-8")
            tles  = _parse_tle_text(raw)
        else:
            raise HTTPException(status_code=502, detail=f"Space-Track fetch failed: {exc}")

    debris_count    = sum(1 for t in tles if any(k in t.name.upper() for k in ("DEB", "DEBRIS", "R/B", "ROCKET")))
    satellite_count = len(tles) - debris_count

    return CatalogSourceResponse(
        source="spacetrack",
        category=type,
        object_count=len(tles),
        debris_count=debris_count,
        satellite_count=satellite_count,
        cached_at=datetime.now(timezone.utc).isoformat(),
        objects=[_tle_schema(t) for t in tles],
    )


# ── 8. CelesTrak catalog with full category support ───────────────────────

@app.get("/catalog/celestrak", response_model=CatalogSourceResponse, tags=["Catalog"])
async def catalog_celestrak(
    category: str = Query(
        "stations",
        description="CelesTrak category: stations | active | debris | tle-new | starlink | oneweb",
    ),
    limit: int = Query(200, ge=1, le=5000),
) -> CatalogSourceResponse:
    """
    Fetch a TLE catalog from CelesTrak with proper User-Agent and local caching.
    No account required.
    """
    url        = f"{CELESTRAK_TLE}/{category}.txt"
    cache_file = DATA_DIR / f"celestrak_{category}.txt"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=CELESTRAK_HEADERS)
            resp.raise_for_status()
        raw = resp.text
        cache_file.write_text(raw, encoding="utf-8")
    except Exception:
        if cache_file.exists():
            raw = cache_file.read_text(encoding="utf-8")
        else:
            raw = _FALLBACK_TLE_CATALOG
            cache_file.write_text(raw, encoding="utf-8")

    tles = _parse_tle_text(raw)[:limit]
    debris_count    = sum(1 for t in tles if any(k in t.name.upper() for k in ("DEB", "DEBRIS", "R/B")))
    satellite_count = len(tles) - debris_count

    return CatalogSourceResponse(
        source="celestrak",
        category=category,
        object_count=len(tles),
        debris_count=debris_count,
        satellite_count=satellite_count,
        cached_at=datetime.now(timezone.utc).isoformat(),
        objects=[_tle_schema(t) for t in tles],
    )

    # ── 8b. Demo debris — synthetic, guaranteed-relevant catalog ──────────────

@app.get("/catalog/demo-debris", response_model=CatalogSourceResponse, tags=["Catalog"])
def catalog_demo_debris(
    sc_name:  str = Query(..., description="Spacecraft name"),
    sc_line1: str = Query(..., description="Spacecraft TLE line 1"),
    sc_line2: str = Query(..., description="Spacecraft TLE line 2"),
    count: int = Query(5, ge=1, le=5, description="Number of demo debris objects"),
) -> CatalogSourceResponse:
    """
    Generate synthetic debris objects derived from the given spacecraft's
    own orbit, guaranteed to produce a realistic spread of conjunction
    events (CRITICAL down to NEGLIGIBLE) for reliable demos.

    These are NOT real tracked objects — clearly labeled DEMO-DEBRIS-*.
    """
    debris = _generate_demo_debris(sc_name, sc_line1, sc_line2, count)
    return CatalogSourceResponse(
        source="demo",
        category="synthetic",
        object_count=len(debris),
        debris_count=len(debris),
        satellite_count=0,
        cached_at=datetime.now(timezone.utc).isoformat(),
        objects=[_tle_schema(t) for t in debris],
    )


# ── 9. Debris density heatmap ─────────────────────────────────────────────

@app.get("/catalog/heatmap", response_model=HeatmapResponse, tags=["Catalog"])
async def catalog_heatmap(
    category: str = Query("stations", description="CelesTrak category to analyse"),
) -> HeatmapResponse:
    """
    Analyse the cached TLE catalog and return a debris density heatmap
    bucketed by orbital altitude shell (100 km bands from 200–2000 km).
    """
    # Load from cache — refresh if stale
    cache_file = DATA_DIR / f"celestrak_{category}.txt"
    if not cache_file.exists():
        cache_file = DATA_DIR / f"{category}.txt"
    if cache_file.exists():
        raw  = cache_file.read_text(encoding="utf-8")
        tles = _parse_tle_text(raw)
    else:
        tles = _parse_tle_text(_FALLBACK_TLE_CATALOG)

    # Bin objects by altitude using mean motion → semi-major axis → altitude
    EARTH_RADIUS_KM = 6371.0
    GM              = 3.986004418e5  # km³/s²
    TWO_PI          = 6.283185307

    BANDS: List[tuple[int, int, str]] = [
        (200,  400,  "VLEO 200–400 km"),
        (400,  600,  "LEO  400–600 km"),
        (600,  800,  "LEO  600–800 km"),
        (800,  1000, "LEO  800–1000 km"),
        (1000, 1200, "LEO  1000–1200 km"),
        (1200, 2000, "LEO  1200–2000 km"),
        (2000, 36000,"MEO/HEO 2000–36000 km"),
    ]

    counts = {b[2]: 0 for b in BANDS}

    for tle in tles:
        try:
            # Parse mean motion (rev/day) from TLE line 2, columns 52-63
            mm_rev_day = float(tle.line2[52:63])
            mm_rad_s   = mm_rev_day * TWO_PI / 86400.0
            if mm_rad_s <= 0:
                continue
            sma_km     = (GM / mm_rad_s ** 2) ** (1 / 3)
            alt_km     = sma_km - EARTH_RADIUS_KM
            for min_a, max_a, label in BANDS:
                if min_a <= alt_km < max_a:
                    counts[label] += 1
                    break
        except (ValueError, IndexError):
            continue

    # Congestion risk index: normalise to 0–100 relative to busiest band
    max_count = max(counts.values()) or 1
    bands_out = [
        DensityBand(
            label=label,
            min_alt_km=min_a,
            max_alt_km=max_a,
            object_count=counts[label],
            risk_index=round(counts[label] / max_count * 100, 1),
        )
        for min_a, max_a, label in BANDS
    ]

    return HeatmapResponse(
        bands=bands_out,
        total_objects=len(tles),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ── 10. Catalog status (which sources are available) ──────────────────────

@app.get("/catalog/status", tags=["Catalog"])
async def catalog_status() -> Dict[str, object]:
    """
    Returns which data sources are available and what's cached locally.
    Used by the frontend to show the catalog source selector.
    """
    cached_files = list(DATA_DIR.glob("*.txt"))
    return {
        "spacetrack_configured": spacetrack_configured(),
        "spacetrack_user":       ST_USER_MASKED if spacetrack_configured() else None,
        "cached_catalogs":       [f.name for f in cached_files],
        "cache_dir":             str(DATA_DIR),
    }


def _mask(s: str) -> str:
    """Mask an email: user@domain.com → u***@domain.com"""
    if "@" not in s:
        return "***"
    local, domain = s.split("@", 1)
    return local[0] + "***@" + domain


ST_USER_MASKED = _mask(os.getenv("SPACETRACK_USER", ""))


# ── 11. AI insight (single event) ─────────────────────────────────────────

@app.post("/ai/insight", response_model=AIInsightResponse, tags=["AI"])
async def ai_insight(body: AIInsightRequest) -> AIInsightResponse:
    """
    Generate a rich AI analysis for one conjunction event.
    Uses GPT-4o-mini if OPENAI_API_KEY is set, else rule-based fallback.
    """
    analysis = await generate_insight(
        debris_name=body.debris_name,
        miss_km=body.miss_distance_km,
        rel_v_kms=body.relative_velocity_kms,
        hours=body.hours_to_tca,
        risk_score=body.risk_score,
        risk_level=body.risk_level,
    )
    return AIInsightResponse(
        insight=analysis.insight,
        anomaly_score=analysis.anomaly_score,
        is_anomaly=analysis.is_anomaly,
        anomaly_reason=analysis.anomaly_reason,
        recommendation=analysis.recommendation,
        source=analysis.source,
        openai_enabled=bool(OPENAI_API_KEY and OPENAI_API_KEY != "your_openai_key_here"),
    )


# ── 12. Early warning scan ─────────────────────────────────────────────────

@app.post("/ai/early-warning", response_model=EarlyWarningResponse, tags=["AI"])
async def ai_early_warning(body: ConjunctionRequest) -> EarlyWarningResponse:
    """
    Run a full conjunction scan + AI anomaly detection on every event.
    Returns events sorted by anomaly score — most unusual threats first.
    Flags events the rule-based scorer might have missed.
    """
    sc_tle      = _to_tle(body.spacecraft)
    debris_tles = [_to_tle(d) for d in body.debris_catalog]
    start       = datetime.now(timezone.utc)

    events      = find_conjunctions(
        spacecraft_tle=sc_tle,
        debris_tles=debris_tles,
        start=start,
        lookahead_hours=body.lookahead_hours,
        step_seconds=body.step_seconds,
        screen_km=body.screen_km,
        refine=True,
    )
    assessments = score_events(events)
    analyses    = await batch_generate_insights(events)

    out_events: List[EarlyWarningEvent] = []
    for ev, ra, ai in zip(events, assessments, analyses):
        hours = max(0.0, ev.time_to_tca.total_seconds() / 3600.0)
        out_events.append(EarlyWarningEvent(
            debris_name=ev.debris_tle.name,
            miss_distance_km=round(ev.miss_distance_km, 4),
            rel_v_kms=round(ev.relative_velocity_kms, 4),
            hours_to_tca=round(hours, 2),
            risk_score=round(ra.score, 2),
            risk_level=ev.risk_level,
            anomaly_score=ai.anomaly_score,
            is_anomaly=ai.is_anomaly,
            anomaly_reason=ai.anomaly_reason,
            recommendation=ai.recommendation,
        ))

    # Sort: anomalies first, then by risk score
    out_events.sort(key=lambda e: (not e.is_anomaly, -e.anomaly_score, -e.risk_score))

    return EarlyWarningResponse(
        spacecraft_name=sc_tle.name,
        total_events=len(out_events),
        anomaly_count=sum(1 for e in out_events if e.is_anomaly),
        critical_count=sum(1 for e in out_events if e.risk_level == "CRITICAL"),
        events=out_events,
        generated_at=start.isoformat(),
    )


# ── 13. AI status ──────────────────────────────────────────────────────────

@app.get("/ai/status", tags=["AI"])
async def ai_status() -> Dict[str, object]:
    """Returns which AI features are active."""
    return {
        "openai_enabled":   bool(OPENAI_API_KEY and OPENAI_API_KEY != "your_openai_key_here"),
        "openai_model":     "gpt-4o-mini",
        "anomaly_detector": "IsolationForest (scikit-learn)",
        "fallback":         "rule-based multi-sentence engine",
    }


# ── 14. WebSocket — live orbit stream ─────────────────────────────────────

# ── Pass predictor ─────────────────────────────────────────────────────────

@app.post("/passes/predict", response_model=PassPredictionResponse, tags=["Passes"])
def predict_passes(body: PassRequest) -> PassPredictionResponse:
    """
    Predict satellite passes over a ground station for the look-ahead window.

    A "pass" is any interval where the satellite's elevation above the station
    horizon exceeds min_elevation_deg.  AOS / LOS / max-elevation are returned
    for each pass so operators know exactly when they can uplink / downlink.

    Uses ECEF geometry: converts each propagated ECI state to ECEF, then
    computes azimuth/elevation from the station's topocentric frame.
    """
    EARTH_RADIUS_KM = 6371.0
    DEG = math.pi / 180.0

    tle   = _to_tle(body.spacecraft)
    prop  = Propagator(tle)
    start = datetime.now(timezone.utc)
    stop  = start + timedelta(hours=body.lookahead_hours)

    # Station ECEF position (fixed, assuming spherical Earth)
    lat_r = body.station_lat * DEG
    lon_r = body.station_lon * DEG
    cos_lat = math.cos(lat_r)
    sin_lat = math.sin(lat_r)
    cos_lon = math.cos(lon_r)
    sin_lon = math.sin(lon_r)
    sx = EARTH_RADIUS_KM * cos_lat * cos_lon
    sy = EARTH_RADIUS_KM * cos_lat * sin_lon
    sz = EARTH_RADIUS_KM * sin_lat
    station_ecef = (sx, sy, sz)

    def elevation_at(sv: StateVector) -> float:
        """Return satellite elevation (degrees) above station horizon."""
        px, py, pz = eci_to_ecef(sv.position_km, sv.epoch)
        # Range vector from station to satellite
        rx, ry, rz = px - sx, py - sy, pz - sz
        range_km = math.sqrt(rx*rx + ry*ry + rz*rz)
        if range_km < 1e-6:
            return 90.0
        # Dot product with station zenith unit vector
        dot = rx * cos_lat * cos_lon + ry * cos_lat * sin_lon + rz * sin_lat
        return math.degrees(math.asin(dot / range_km))

    # Scan full window at step_seconds resolution
    result  = prop.propagate(start, stop, step_seconds=body.step_seconds)
    passes: List[SatPass] = []
    in_pass = False
    pass_start: datetime | None = None
    max_el  = -90.0
    max_el_epoch: datetime | None = None

    def finalise_pass(aos: datetime, los: datetime, mx_el: float, mx_el_t: datetime) -> None:
        passes.append(SatPass(
            aos=aos.isoformat(),
            los=los.isoformat(),
            max_el=round(mx_el, 2),
            max_el_at=mx_el_t.isoformat(),
            duration_s=round((los - aos).total_seconds(), 1),
        ))

    prev_sv: StateVector | None = None

    for sv in result.states:
        try:
            el = elevation_at(sv)
        except Exception:
            continue

        if el >= body.min_elevation_deg:
            if not in_pass:
                in_pass    = True
                pass_start = sv.epoch
                max_el     = el
                max_el_epoch = sv.epoch
            else:
                if el > max_el:
                    max_el       = el
                    max_el_epoch = sv.epoch
        else:
            if in_pass:
                # End of pass — use previous sv epoch as LOS
                los_epoch = prev_sv.epoch if prev_sv else sv.epoch
                if pass_start and max_el_epoch:
                    finalise_pass(pass_start, los_epoch, max_el, max_el_epoch)
                in_pass    = False
                pass_start = None
                max_el     = -90.0
                max_el_epoch = None

        prev_sv = sv

    # Handle pass still in progress at end of window
    if in_pass and pass_start and max_el_epoch and result.states:
        los_epoch = result.states[-1].epoch
        finalise_pass(pass_start, los_epoch, max_el, max_el_epoch)

    return PassPredictionResponse(
        spacecraft=tle.name,
        station_name=body.station_name,
        station_lat=body.station_lat,
        station_lon=body.station_lon,
        passes=passes,
        computed_at=start.isoformat(),
    )


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    """
    Stream live ECI + lat/lon position updates for a given TLE.

    Client sends one JSON message on connect:
        {"name": "...", "line1": "...", "line2": "...", "interval_s": 5}

    Server pushes a position frame every interval_s seconds until the
    client disconnects.
    """
    await websocket.accept()
    try:
        init = await websocket.receive_text()
        data = json.loads(init)
        tle  = TLE(name=data["name"], line1=data["line1"], line2=data["line2"])
        interval = float(data.get("interval_s", 5.0))
        prop = Propagator(tle)

        while True:
            now = datetime.now(timezone.utc)
            try:
                sv  = prop.state_at(now)
                lat, lon = _eci_to_latlon(sv.position_km, sv.epoch)
                frame = {
                    "epoch":         sv.epoch.isoformat(),
                    "latitude_deg":  round(lat, 5),
                    "longitude_deg": round(lon, 5),
                    "altitude_km":   round(sv.altitude_km, 3),
                    "x_km":          round(sv.position_km[0], 3),
                    "y_km":          round(sv.position_km[1], 3),
                    "z_km":          round(sv.position_km[2], 3),
                    "speed_kms":     round(sv.speed_kms, 4),
                }
                await websocket.send_text(json.dumps(frame))
            except RuntimeError as exc:
                await websocket.send_text(json.dumps({"error": str(exc)}))
                break

            await asyncio.sleep(interval)

    except WebSocketDisconnect:
        pass  # client closed — exit cleanly
