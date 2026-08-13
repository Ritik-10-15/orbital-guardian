# 🛡️ Orbital Guardian

> **Space Debris Conjunction Detection & Risk Assessment Platform**
>
> Real-time orbital propagation, conjunction analysis, AI-powered risk insights, and 3D globe visualisation — built for spacecraft operators and mission control teams.

---

## 📸 Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ 🛡️  ORBITAL GUARDIAN          Space Debris Conjunction Platform │
├─────────────────────────────────────────────────────────────────┤
│ 🟢 LIVE  🛰 ISS (ZARYA)  ALT: 409.1km  SPD: 7.68km/s  UTC … │
├──────────────────────────────────────┬──────────────────────────┤
│                                      │  ⚠ Conjunction Alerts   │
│   🌍 3D Earth Globe (NASA texture)   │  DEBRIS-A  CRITICAL  95 │
│   • Animated spacecraft dot          │  ┌─────────────────────┐ │
│   • Real-time orbit track            │  │ 🤖 AI Analysis      │ │
│   • Colour-coded debris markers      │  │ ⚠ Anomaly detected  │ │
│   • Debris density heatmap           │  │ 📋 Recommendation   │ │
│                                      │  └─────────────────────┘ │
├──────────────────────────────────────┴──────────────────────────┤
│  TLE Input │ Catalog: CelesTrak-Stations │ Objects: 30  [Scan] │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  External Sources                                                │
│  CelesTrak TLE Feeds ──┐                                        │
│  Space-Track.org ───────┼──► Data Ingestion Layer               │
│  Ground Radar Sim ─────┘         │                              │
└──────────────────────────────────┼──────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│  Backend  (Python / FastAPI)                                     │
│                                                                  │
│  propagation.py ──► SGP4 orbit propagator (ECI state vectors)   │
│  conjunction.py  ──► Conjunction analysis (golden-section TCA)   │
│  risk_model.py  ──► Risk scoring (0–100, 5 tiers, Pc)           │
│  ai_insight.py  ──► LLM + ML anomaly detection                  │
│  space_track.py ──► Space-Track.org authenticated client        │
│  api.py         ──► FastAPI REST + WebSocket gateway (14 routes) │
│                                                                  │
│  backend/data/  ──► TLE cache (auto-populated)                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │  REST /api/*  +  WS /ws/live
┌──────────────────────────▼───────────────────────────────────────┐
│  Frontend  (React 18 + TypeScript + Vite)                        │
│                                                                  │
│  Globe.tsx          ──► Three.js 3D Earth (NASA texture)        │
│  LiveStatus.tsx     ──► WebSocket telemetry bar                  │
│  AlertDashboard.tsx ──► Conjunction events + AI analysis         │
│  HeatmapPanel.tsx   ──► Orbital shell density chart              │
│  ControlPanel.tsx   ──► TLE input + catalog selector             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+ and `pip`
- Node.js 18+ and `npm`

### 1 — Clone & install

```bash
git clone https://github.com/your-org/orbital-guardian
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

### 2 — Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Required for Space-Track catalog (free account)
SPACETRACK_USER=your_email@example.com
SPACETRACK_PASS=your_password

# Optional — enables GPT-4o-mini AI insights
OPENAI_API_KEY=sk-your-key-here

# Scan limit (objects screened per conjunction analysis)
MAX_DEBRIS_OBJECTS=200
```

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

## 🐳 Docker

```bash
# Build and start both services
docker-compose up --build

# Stop
docker-compose down

# Rebuild after code changes
docker-compose up --build --force-recreate
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/tle/fetch` | Fetch TLE catalog from CelesTrak |
| `POST` | `/orbits/track` | Propagate TLE → lat/lon/alt ground track |
| `POST` | `/conjunctions` | Run conjunction analysis |
| `POST` | `/risk` | Score raw conjunction metrics |
| `GET` | `/conjunctions/scored` | Full pipeline: fetch → detect → score |
| `GET` | `/catalog/celestrak` | CelesTrak catalog (no auth) |
| `GET` | `/catalog/spacetrack` | Space-Track catalog (requires account) |
| `GET` | `/catalog/heatmap` | Debris density by orbital band |
| `GET` | `/catalog/status` | Data source availability |
| `POST` | `/ai/insight` | AI analysis for one event |
| `POST` | `/ai/early-warning` | Full scan + anomaly detection |
| `GET` | `/ai/status` | AI feature status |
| `WS` | `/ws/live` | Live orbit position stream |

Full interactive docs: `http://127.0.0.1:8000/docs`

---

## 🧠 AI / ML Layer (Option C)

### LLM Insights (GPT-4o-mini)
- Set `OPENAI_API_KEY` in `.env` to enable
- Each conjunction event gets a 3-sentence operational briefing
- Covers: severity, impact energy (kJ), manoeuvre delta-V estimate
- Falls back to rich rule-based engine if key not set

### Anomaly Detection (IsolationForest)
- `scikit-learn` Isolation Forest trained on synthetic LEO conjunction baseline
- Flags events with unusual parameter combinations
- Score 0–100 (100 = most anomalous)
- Explains *why* an event is unusual (velocity, miss distance, warning time)

### Risk Scoring Model
```
score = f(miss_distance) × 0.55
      + f(relative_velocity) × 0.25
      + f(hours_to_tca) × 0.20

Tiers:  ≥80 CRITICAL | ≥60 HIGH | ≥35 MODERATE | ≥10 LOW | <10 NEGLIGIBLE
```

---

## 🧪 Running Tests

```bash
cd backend
pytest tests/ -v
```

---

## 📁 Project Structure

```
orbital-guardian/
├── backend/
│   ├── propagation.py    # SGP4 orbital propagator
│   ├── conjunction.py     # Conjunction detection engine
│   ├── risk_model.py     # Risk scoring (rule-based)
│   ├── ai_insight.py     # LLM + anomaly detection
│   ├── space_track.py    # Space-Track.org client
│   ├── api.py            # FastAPI application
│   ├── requirements.txt
│   ├── .env.example
│   ├── Dockerfile
│   └── data/             # TLE cache
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Globe.tsx           # 3D orbital globe
│   │   │   ├── AlertDashboard.tsx  # Conjunction alert panel
│   │   │   ├── LiveStatus.tsx      # Live telemetry bar
│   │   │   ├── HeatmapPanel.tsx    # Debris density heatmap
│   │   │   ├── ControlPanel.tsx    # TLE + catalog controls
│   │   │   └── RiskBadge.tsx       # Risk level badge
│   │   ├── api/client.ts           # Typed API client
│   │   ├── store/useStore.ts       # Zustand state
│   │   └── types/index.ts          # Shared TypeScript types
│   ├── public/textures/            # NASA Earth textures
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🛰️ Data Sources

| Source | What | Auth |
|--------|------|------|
| [CelesTrak](https://celestrak.org) | TLE catalogs (active, stations, Starlink) | None — User-Agent required |
| [Space-Track.org](https://www.space-track.org) | Full SSN catalog (25,000+ objects) | Free account |
| [NASA Blue Marble](https://visibleearth.nasa.gov) | Earth texture imagery | Public domain |

---

## 📄 License

MIT — see [LICENSE](LICENSE)
