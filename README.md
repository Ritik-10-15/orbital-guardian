# 🛡️ Orbital Guardian

> **Space Debris Conjunction Detection & Fleet Risk Assessment Platform**
>
> Real-time multi-spacecraft orbital propagation, conjunction analysis, AI-powered risk insight, anomaly detection, and an operator approval workflow — built for spacecraft operators and mission control teams.

Built for the **AI Builders Challenge with IBM Bob** — August 2026 theme: **Advance Space Exploration with AI**.
*(Directly matches the challenge's own example idea: "Space debris tracking and collision avoidance systems.")*

---

## Problem Statement

Low Earth Orbit is increasingly crowded with active satellites, defunct spacecraft, and fragmentation debris. Every operator — from a single-CubeSat startup to a national space agency — needs to know, continuously and in real time: *is anything about to get dangerously close to my spacecraft, how dangerous is it really, and what should I do about it?*

Existing tools for this (Conjunction Data Messages, SOCRATES, commercial SSA platforms) are often siloed, expensive, or built around a single spacecraft rather than a whole fleet. Orbital Guardian explores what a lightweight, AI-assisted, fleet-aware version of this workflow could look like — from raw orbital elements all the way to a logged operator decision, in one interface.

## Solution Description

Orbital Guardian takes a fleet of spacecraft, propagates every orbit, screens for close approaches against a debris catalog, scores and explains the risk with both deterministic and AI-driven analysis, and gives an operator a real workflow to review and act on it — approve or reject a simulated avoidance manoeuvre, with the decision logged.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🛡️  ORBITAL GUARDIAN               Space Debris Conjunction Platform    │
├─────────────────────────────────────────────────────────────────────────┤
│ 🟢 LIVE  🛰 ISS (ZARYA)  ALT: 409.1km  SPD: 7.68km/s  UTC …            │
├─────────────┬───────────────────────┬──────────────────┬────────────────┤
│ 🛰 Fleet    │  🌍 3D Earth Globe     │ Fleet-wide scan  │ ⚠ Conjunction  │
│ manager     │  • Multi-spacecraft   │ + CSV export     │  Alerts        │
│ (add/remove,│    tracking, each     │ + Fleet Status   │  • Risk badge  │
│ per-ship    │    colour-coded       │   per-spacecraft │  • Countdown   │
│ telemetry)  │  • Orbit tracks       │                  │  • AI insight  │
│             │  • Debris markers     │ 📋 Mission Log   │  • Approve/    │
│             │  • Density heatmap    │  Operator audit  │    Reject      │
│             │  • TCA overlay        │  trail (CSV)     │                │
│             │  • Orbit scrubber     │ 🛰 Pass Predictor│                │
│             │                       │  Contact windows │                │
└─────────────┴───────────────────────┴──────────────────┴────────────────┘
```

Every panel width-collapses so the globe can take the full screen; a mission-control header pulses and beeps when any active event reaches CRITICAL severity.

## Selected Challenge Theme

**August Challenge — Advance Space Exploration with AI**

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  External Sources                                                │
│  CelesTrak TLE Feeds ──┐                                        │
│  Space-Track.org ───────┼──► Data Ingestion Layer               │
│  Synthetic Demo Debris ┘   (guaranteed-relevant offline demo)    │
└──────────────────────────────────┼──────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│  Backend  (Python / FastAPI)                                     │
│                                                                  │
│  propagation.py ──► SGP4 orbit propagator (ECI state vectors)   │
│  conjunction.py ──► Conjunction analysis (golden-section TCA)   │
│  risk_model.py  ──► Rule-based risk scoring (0–100, 5 tiers)    │
│  ai_insight.py  ──► LLM briefing + IsolationForest anomaly ML   │
│  space_track.py ──► Space-Track.org authenticated client        │
│  api.py         ──► FastAPI REST + WebSocket gateway            │
│                                                                  │
│  backend/data/  ──► TLE cache (auto-populated)                  │
│  backend/tests/ ──► 87 passing unit tests                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │  REST /api/*  +  WS /ws/live
┌──────────────────────────▼───────────────────────────────────────┐
│  Frontend  (React 18 + TypeScript + Vite + Zustand)              │
│                                                                  │
│  Globe.tsx           ──► Three.js 3D Earth, multi-spacecraft     │
│  FleetManager.tsx    ──► Add/remove spacecraft from fleet        │
│  FleetPanel.tsx      ──► Fleet-wide scan, per-ship status, CSV   │
│  AlertDashboard.tsx  ──► Conjunction events, AI insight, approval│
│  LiveStatus.tsx      ──► WebSocket live telemetry bar            │
│  HeatmapPanel.tsx    ──► Orbital shell density chart             │
│  ControlPanel.tsx    ──► TLE input + catalog source selector     │
│  TCAOverlay.tsx      ──► Live TCA countdown on globe             │
│  OrbitScrubber.tsx   ──► Orbit playback timeline scrubber        │
│  MissionLog.tsx      ──► Operator decision audit trail           │
│  PassPredictor.tsx   ──► Ground-station contact-window predictor │
│  RiskBadge.tsx       ──► Reusable risk-level badge               │
└──────────────────────────────────────────────────────────────────┘
```

## AI Approach

Three distinct layers of intelligence sit on top of the physics pipeline, each doing genuinely different analytical work:

| Layer | Technique | What it adds |
|---|---|---|
| **Anomaly detection** | `IsolationForest` (scikit-learn), trained on a synthetic baseline of "normal" LEO conjunctions, with continual learning as real events are observed | Flags events that are *statistically unusual*, independent of the fixed risk score — catches unusual combinations of miss distance, velocity, and timing that a rule-based threshold alone might under- or over-weight. |
| **LLM operational briefing** | GPT-4o-mini, given structured conjunction data (miss distance, closing velocity, estimated impact energy, estimated delta-V) and prompted for a 3-sentence mission-control briefing | Produces natural-language insight a duty officer could act on directly. Falls back to a rich rule-based multi-sentence generator if no API key is configured, so the system is always usable. |
| **Rule-based risk model** | Weighted composite score — 55% miss-distance decay curve, 25% relative velocity, 20% urgency — tiered into 5 risk levels | The interpretable, auditable backbone both AI layers reason on top of, which matters in a safety-critical domain. |

```
score = f(miss_distance) × 0.55
      + f(relative_velocity) × 0.25
      + f(hours_to_tca) × 0.20

Tiers:  ≥80 CRITICAL | ≥60 HIGH | ≥35 MODERATE | ≥10 LOW | <10 NEGLIGIBLE
```

## How IBM Bob Was Used

IBM Bob was the primary development tool for the initial build: scaffolding the full project (FastAPI backend, React/TypeScript frontend, Docker setup), implementing the core orbital mechanics pipeline (`propagation.py`, `conjunction.py`, `risk_model.py`), and building the AI insight layer (`ai_insight.py`).

When Bob's session token budget was reached partway through, development continued manually to: wire up the multi-spacecraft fleet feature end-to-end (fleet management UI, globe rendering, operator approval workflow), diagnose and fix a data-integrity bug in the conjunction screening logic (a self-match edge case producing false 0 km conjunctions), add a synthetic demo-debris generator for reliable offline demos, and complete the dependency and testing hygiene needed for a reproducible submission (full `requirements.txt`, 87 passing backend tests, and git version control throughout).

Bob was then used again in a second session to generate the full project summary, review all source files, and update this README.

## Quick Start

### Prerequisites
- Python 3.11+ and `pip`
- Node.js 18+ and `npm`

### 1 — Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/orbital-guardian
cd orbital-guardian
```

**Backend:**
```bash
cd backend
pip install -r requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2 — Configure environment (optional)

```bash
cp backend/.env.example backend/.env
```

```env
# Optional — enables the full Space-Track debris catalog
SPACETRACK_USER=your_email@example.com
SPACETRACK_PASS=your_password

# Optional — enables GPT-4o-mini AI insight generation
OPENAI_API_KEY=sk-your-key-here
```

The app runs fully without either variable — it falls back to rule-based insight and CelesTrak / synthetic demo data.

### 3 — Run

**Terminal 1 — Backend:**
```bash
cd backend
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

**Browser:** `http://127.0.0.1:3000`

### 4 — Or use Docker

```bash
docker-compose up --build
```
Then open `http://localhost:3000`

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | Liveness probe |
| `GET`  | `/tle/fetch` | Fetch TLE catalog from CelesTrak |
| `POST` | `/orbits/track` | Propagate TLE → lat/lon/alt ground track |
| `POST` | `/conjunctions` | Run conjunction analysis |
| `POST` | `/risk` | Score raw conjunction metrics |
| `GET`  | `/conjunctions/scored` | Full pipeline: fetch → detect → score |
| `GET`  | `/catalog/celestrak` | CelesTrak catalog (no auth) |
| `GET`  | `/catalog/spacetrack` | Space-Track catalog (requires account) |
| `GET`  | `/catalog/demo-debris` | Synthetic guaranteed-conjunction catalog for demos |
| `GET`  | `/catalog/heatmap` | Debris density by orbital band |
| `GET`  | `/catalog/status` | Data source availability |
| `POST` | `/ai/insight` | AI analysis for one event |
| `POST` | `/ai/early-warning` | Full scan + anomaly detection |
| `GET`  | `/ai/status` | AI feature status |
| `POST` | `/passes/predict` | Ground-station contact-window prediction (AOS, LOS, max elevation) |
| `WS`   | `/ws/live` | Live orbit position stream |

Full interactive docs: `http://127.0.0.1:8000/docs`

## Running Tests

```bash
cd backend
pytest -v
```
87 tests covering propagation, conjunction detection, and risk scoring.

## Project Structure

```
orbital-guardian/
├── backend/
│   ├── propagation.py    # SGP4 orbital propagator (TLE → ECI state vectors)
│   ├── conjunction.py    # Conjunction detection (coarse screen + golden-section TCA)
│   ├── risk_model.py     # Risk scoring — rule-based, 0–100, 5 tiers
│   ├── ai_insight.py     # GPT-4o-mini briefing + IsolationForest anomaly detection
│   ├── space_track.py    # Space-Track.org authenticated async client
│   ├── api.py            # FastAPI REST + WebSocket application
│   ├── requirements.txt
│   ├── .env.example
│   ├── Dockerfile
│   ├── data/             # On-disk TLE cache (auto-populated)
│   └── tests/            # 87 pytest unit tests
│       ├── test_propagation.py
│       ├── test_conjunction.py
│       └── test_risk_model.py
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Globe.tsx           # Three.js 3D Earth, multi-spacecraft fleet
│   │   │   ├── FleetManager.tsx    # Add/remove fleet spacecraft, preset picker
│   │   │   ├── FleetPanel.tsx      # Fleet-wide scan + per-ship status + CSV export
│   │   │   ├── AlertDashboard.tsx  # Conjunction alerts, AI insight, Approve/Reject
│   │   │   ├── LiveStatus.tsx      # WebSocket live telemetry bar
│   │   │   ├── HeatmapPanel.tsx    # Orbital shell debris density chart
│   │   │   ├── ControlPanel.tsx    # TLE input + catalog source selector
│   │   │   ├── TCAOverlay.tsx      # Live TCA countdown overlay on globe
│   │   │   ├── OrbitScrubber.tsx   # Orbit playback timeline scrubber
│   │   │   ├── MissionLog.tsx      # Operator decision audit trail + CSV export
│   │   │   ├── PassPredictor.tsx   # Ground-station contact-window predictor
│   │   │   └── RiskBadge.tsx       # Reusable risk-level badge component
│   │   ├── api/
│   │   │   └── client.ts           # Typed REST + WebSocket API client
│   │   ├── store/
│   │   │   └── useStore.ts         # Zustand state (fleet, approvals, mission log)
│   │   └── types/
│   │       └── index.ts            # Shared TypeScript types + spacecraft presets
│   ├── public/
│   │   └── textures/               # NASA Blue Marble Earth textures
│   ├── index.html
│   ├── vite.config.ts              # Dev proxy: /api → :8000, /ws → ws://:8000
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Data Sources

| Source | What | Auth |
|--------|------|------|
| [CelesTrak](https://celestrak.org) | TLE catalogs (active, stations, Starlink) | None — User-Agent required |
| [Space-Track.org](https://www.space-track.org) | Full SSN catalog (25,000+ objects) | Free account |
| Synthetic demo debris | Generated per-spacecraft near-miss objects for reliable offline demos | None |

## Spacecraft Presets

The following real spacecraft are available as one-click presets in the Fleet Manager:

| Spacecraft | Category | Orbit |
|------------|----------|-------|
| ISS (ZARYA) | Crewed | ~409 km, 51.6° |
| CSS (TIANHE) | Crewed | ~390 km, 41.5° |
| HST (HUBBLE) | Science | ~537 km, 28.5° |
| SENTINEL-1A | Earth Observation | ~693 km, SSO |
| TERRA | Earth Observation | ~705 km, SSO |
| NOAA 15 | Weather | ~807 km, SSO |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend language** | Python 3.12 |
| **Web framework** | FastAPI + Uvicorn (ASGI, WebSocket) |
| **Orbital mechanics** | sgp4 ≥ 2.22 |
| **Numerics** | NumPy |
| **ML / anomaly detection** | scikit-learn (IsolationForest) |
| **LLM** | OpenAI GPT-4o-mini |
| **HTTP client** | httpx (async) |
| **Frontend framework** | React 18 + TypeScript 5 |
| **Build tool** | Vite 5 |
| **3D rendering** | Three.js + @react-three/fiber + drei |
| **State management** | Zustand 4 (with localStorage persistence) |
| **Containerisation** | Docker + Docker Compose |
| **Production serving** | nginx:alpine |

## Team

Solo submission — **RITIK GUPTA**

## Links

- GitHub repository: https://github.com/ritikgupta/orbital-guardian
- Demo video (≤3 min): *(add your video link before submission)*

## License

MIT
