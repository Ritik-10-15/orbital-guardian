"""
space_track.py
==============
Authenticated client for the Space-Track.org REST API.

Space-Track provides the US Space Surveillance Network catalog:
  • ~25,000+ tracked objects (satellites, rocket bodies, debris)
  • Authoritative TLE sets updated multiple times per day
  • Free registration at https://www.space-track.org/auth/createAccount

Authentication
--------------
Space-Track uses cookie-based session auth.  We POST credentials to
/ajaxauth/login once, receive a session cookie, then use it for all
subsequent requests.  The session is re-used within the process lifetime
and re-established automatically when it expires (HTTP 401).

Usage
-----
    from space_track import SpaceTrackClient

    async with SpaceTrackClient() as st:
        tles = await st.fetch_leo_debris(limit=500)
        # tles → List[TLE]

Requires: SPACETRACK_USER and SPACETRACK_PASS in backend/.env
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv

from propagation import TLE  # type: ignore[import]

# Load .env from the backend directory
load_dotenv(Path(__file__).parent / ".env")

# ── Constants ─────────────────────────────────────────────────
ST_BASE      = "https://www.space-track.org"
ST_LOGIN     = f"{ST_BASE}/ajaxauth/login"
ST_QUERY     = f"{ST_BASE}/basicspacedata/query"
ST_LOGOUT    = f"{ST_BASE}/ajaxauth/logout"

ST_USER = os.getenv("SPACETRACK_USER", "")
ST_PASS = os.getenv("SPACETRACK_PASS", "")


# ── TLE parser (same logic as api.py _parse_tle_text) ─────────
def _parse_3le(raw: str) -> List[TLE]:
    """Parse a 3-line element set block into TLE objects."""
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


# ── Client ────────────────────────────────────────────────────

class SpaceTrackClient:
    """
    Async context-manager client for Space-Track.org.

    Usage:
        async with SpaceTrackClient() as st:
            tles = await st.fetch_leo_debris(limit=200)
    """

    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None
        self._logged_in = False

    async def __aenter__(self) -> "SpaceTrackClient":
        self._client = httpx.AsyncClient(
            base_url=ST_BASE,
            timeout=30.0,
            follow_redirects=True,
        )
        await self._login()
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._client:
            try:
                await self._client.get(ST_LOGOUT)
            except Exception:
                pass
            await self._client.aclose()

    # ── Auth ──────────────────────────────────────────────────

    async def _login(self) -> None:
        if not ST_USER or not ST_PASS or ST_USER == "your_email@example.com":
            raise ValueError(
                "Space-Track credentials not configured. "
                "Set SPACETRACK_USER and SPACETRACK_PASS in backend/.env"
            )
        assert self._client is not None
        resp = await self._client.post(
            ST_LOGIN,
            data={"identity": ST_USER, "password": ST_PASS},
        )
        if resp.status_code != 200:
            raise PermissionError(
                f"Space-Track login failed (HTTP {resp.status_code}). "
                "Check your credentials in backend/.env"
            )
        self._logged_in = True

    async def _get(self, path: str) -> str:
        """GET a Space-Track query path, re-login once on 401."""
        assert self._client is not None
        resp = await self._client.get(path)
        if resp.status_code == 401:
            await self._login()
            resp = await self._client.get(path)
        resp.raise_for_status()
        return resp.text

    # ── Query helpers ─────────────────────────────────────────

    async def fetch_leo_debris(self, limit: int = 500) -> List[TLE]:
        """
        Fetch the most recently updated LEO debris objects (OBJECT_TYPE=DEBRIS).

        Returns up to *limit* TLEs sorted by EPOCH descending (freshest first).
        """
        path = (
            f"/basicspacedata/query/class/gp/OBJECT_TYPE/DEBRIS"
            f"/PERIOD/80--130"           # orbital period 80–130 min → LEO
            f"/orderby/EPOCH%20desc"
            f"/limit/{limit}"
            f"/format/3le"
        )
        raw  = await self._get(path)
        return _parse_3le(raw)

    async def fetch_active_satellites(self, limit: int = 500) -> List[TLE]:
        """
        Fetch active (DECAYED=0) satellites in LEO.
        """
        path = (
            f"/basicspacedata/query/class/gp/DECAYED/0"
            f"/PERIOD/80--130"
            f"/orderby/EPOCH%20desc"
            f"/limit/{limit}"
            f"/format/3le"
        )
        raw  = await self._get(path)
        return _parse_3le(raw)

    async def fetch_by_norad_id(self, norad_id: int) -> Optional[TLE]:
        """Fetch the latest TLE for a single NORAD catalog number."""
        path = (
            f"/basicspacedata/query/class/gp/NORAD_CAT_ID/{norad_id}"
            f"/orderby/EPOCH%20desc/limit/1/format/3le"
        )
        raw  = await self._get(path)
        tles = _parse_3le(raw)
        return tles[0] if tles else None

    async def fetch_all_leo(self, limit: int = 2000) -> List[TLE]:
        """
        Fetch ALL tracked LEO objects (satellites + debris + rocket bodies).
        Use with caution — large responses.
        """
        path = (
            f"/basicspacedata/query/class/gp/DECAYED/0"
            f"/PERIOD/80--130"
            f"/orderby/EPOCH%20desc"
            f"/limit/{limit}"
            f"/format/3le"
        )
        raw  = await self._get(path)
        return _parse_3le(raw)

    async def fetch_by_altitude_band(
        self,
        min_alt_km: int = 350,
        max_alt_km: int = 450,
        limit: int = 300,
    ) -> List[TLE]:
        """
        Fetch objects in a specific altitude band.
        Converts altitude to approximate orbital period via Kepler's 3rd law.
        """
        EARTH_RADIUS_KM = 6371
        GM = 3.986e5   # km³/s²

        def alt_to_period_min(alt_km: float) -> float:
            r = EARTH_RADIUS_KM + alt_km
            return 2 * 3.14159 * (r ** 1.5) / (GM ** 0.5) / 60.0

        p_min = alt_to_period_min(min_alt_km)
        p_max = alt_to_period_min(max_alt_km)

        path = (
            f"/basicspacedata/query/class/gp/DECAYED/0"
            f"/PERIOD/{p_min:.1f}--{p_max:.1f}"
            f"/orderby/EPOCH%20desc"
            f"/limit/{limit}"
            f"/format/3le"
        )
        raw  = await self._get(path)
        return _parse_3le(raw)


# ── Credentials check helper (used by API endpoint) ───────────

def spacetrack_configured() -> bool:
    """Return True if Space-Track credentials look valid."""
    return bool(ST_USER and ST_PASS and ST_USER != "your_email@example.com")
