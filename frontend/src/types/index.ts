// ============================================================
// src/types/index.ts
// Shared TypeScript types — mirrors the backend Pydantic schemas
// Option F additions: fleet management types
// ============================================================

export interface TLESchema {
  name: string
  line1: string
  line2: string
}

export interface OrbitPoint {
  epoch: string
  latitude_deg: number
  longitude_deg: number
  altitude_km: number
  x_km: number
  y_km: number
  z_km: number
}

export interface OrbitTrackResponse {
  name: string
  points: OrbitPoint[]
}

export interface ConjunctionEvent {
  debris_name: string
  tca: string
  miss_distance_km: number
  relative_velocity_kms: number
  risk_level: RiskLevel
  risk_score: number
  probability_of_collision: number | null
  insight: string
  hours_to_tca: number
}

export interface ConjunctionResponse {
  spacecraft_name: string
  window_start: string
  window_end: string
  event_count: number
  events: ConjunctionEvent[]
}

export interface RiskRequest {
  miss_distance_km: number
  relative_velocity_kms: number
  hours_to_tca: number
  debris_name?: string
}

export interface RiskResponse {
  score: number
  level: RiskLevel
  colour: string
  insight: string
  component_scores: { base: number; velocity: number; urgency: number }
}

export interface LiveFrame {
  epoch: string
  latitude_deg: number
  longitude_deg: number
  altitude_km: number
  x_km: number
  y_km: number
  z_km: number
  speed_kms: number
}

export type RiskLevel = 'NEGLIGIBLE' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNKNOWN'

export const RISK_COLOURS: Record<RiskLevel, string> = {
  NEGLIGIBLE: '#2563eb',
  LOW:        '#16a34a',
  MODERATE:   '#ca8a04',
  HIGH:       '#ea580c',
  CRITICAL:   '#dc2626',
  UNKNOWN:    '#6b7280',
}

export const RISK_BG: Record<RiskLevel, string> = {
  NEGLIGIBLE: '#eff6ff',
  LOW:        '#f0fdf4',
  MODERATE:   '#fefce8',
  HIGH:       '#fff7ed',
  CRITICAL:   '#fef2f2',
  UNKNOWN:    '#f9fafb',
}

// ── Option F: Fleet management ────────────────────────────────

/** A spacecraft being tracked in the fleet */
export interface FleetMember {
  id:           string          // unique ID (uuid or name-slug)
  tle:          TLESchema
  colour:       string          // dot colour on globe
  live_frame:   LiveFrame | null
  orbit_points: OrbitPoint[]
  events:       ConjunctionEvent[]
  risk_level:   RiskLevel
  risk_score:   number          // worst event score, 0 if none
  last_scanned: string | null   // ISO timestamp
  active:       boolean         // visible on globe
}

/** Fleet-level scan result from /fleet/scan */
export interface FleetScanResult {
  spacecraft_name: string
  event_count:     number
  worst_risk:      RiskLevel
  worst_score:     number
  events:          ConjunctionEvent[]
}

export interface FleetScanResponse {
  fleet_size:     number
  total_events:   number
  critical_count: number
  results:        FleetScanResult[]
  scanned_at:     string
}

/** Built-in preset spacecraft for easy fleet building */
export interface SpacecraftPreset {
  id:       string
  name:     string
  category: string   // e.g. "Crewed", "Earth Obs", "Navigation"
  tle:      TLESchema
  colour:   string
}

export const SPACECRAFT_PRESETS: SpacecraftPreset[] = [
  {
    id: 'iss',
    name: 'ISS (ZARYA)',
    category: 'Crewed',
    colour: '#facc15',
    tle: {
      name: 'ISS (ZARYA)',
      line1: '1 25544U 98067A   24336.50000000  .00002182  00000-0  40769-4 0  9993',
      line2: '2 25544  51.6416 132.9300 0006703 175.2100  30.8400 15.50377579432188',
    },
  },
  {
    id: 'css',
    name: 'CSS (TIANHE)',
    category: 'Crewed',
    colour: '#f97316',
    tle: {
      name: 'CSS (TIANHE)',
      line1: '1 48274U 21035A   24336.50000000  .00005770  00000-0  98310-4 0  9994',
      line2: '2 48274  41.4750  35.1200 0005750  87.4300 272.7400 15.60218753182411',
    },
  },
  {
    id: 'hubble',
    name: 'HST (HUBBLE)',
    category: 'Science',
    colour: '#a78bfa',
    tle: {
      name: 'HST (HUBBLE)',
      line1: '1 20580U 90037B   24336.50000000  .00000800  00000-0  39760-4 0  9990',
      line2: '2 20580  28.4700 115.7100 0002500 135.6200 224.5100 15.09232745529473',
    },
  },
  {
    id: 'sentinel1a',
    name: 'SENTINEL-1A',
    category: 'Earth Obs',
    colour: '#34d399',
    tle: {
      name: 'SENTINEL-1A',
      line1: '1 39634U 14016A   24336.50000000  .00000100  00000-0  14980-4 0  9991',
      line2: '2 39634  98.1820 298.6500 0001200 126.8300 233.3100 14.59232745312704',
    },
  },
  {
    id: 'terra',
    name: 'TERRA',
    category: 'Earth Obs',
    colour: '#22d3ee',
    tle: {
      name: 'TERRA',
      line1: '1 25994U 99068A   24336.50000000  .00000008  00000-0  10012-4 0  9993',
      line2: '2 25994  98.2100 278.8400 0001200 126.7200 233.4100 14.57122208326847',
    },
  },
  {
    id: 'noaa15',
    name: 'NOAA 15',
    category: 'Weather',
    colour: '#60a5fa',
    tle: {
      name: 'NOAA 15',
      line1: '1 25338U 98030A   24336.50000000  .00000020  00000-0  29812-4 0  9993',
      line2: '2 25338  98.7300 344.6700 0010800 121.9300 238.2900 14.25752073428765',
    },
  },
]
// ── Operator approval workflow ──────────────────────────────
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface ApprovalRecord {
  event_key:        string          // unique id for the event (debris_name + tca)
  status:           ApprovalStatus
  decided_at:       string | null   // ISO timestamp, null if still pending
  decided_miss_km:  number          // the simulated miss distance at time of decision
  decided_score:    number          // the resulting risk score at time of decision
  notes:            string          // optional operator note
}

export function eventKey(ev: { debris_name: string; tca: string }): string {
  return `${ev.debris_name}__${ev.tca}`
}

// ── Mission log ─────────────────────────────────────────────
export interface MissionLogEntry {
  id:               string          // uuid-style unique key
  logged_at:        string          // ISO timestamp
  spacecraft_name:  string
  debris_name:      string
  tca:              string
  miss_distance_km: number
  risk_score:       number
  risk_level:       RiskLevel
  decision:         ApprovalStatus
  notes:            string
  simulated_miss_km: number         // miss distance at time of decision (post-manoeuvre)
  simulated_score:  number
}

// ── Ground station pass predictor ───────────────────────────
export interface GroundStation {
  id:     string
  name:   string
  lat:    number
  lon:    number
  minEl:  number   // minimum elevation angle (deg)
}

export interface SatPass {
  aos:        string   // Acquisition of Signal — ISO UTC
  los:        string   // Loss of Signal — ISO UTC
  max_el:     number   // max elevation during pass (deg)
  max_el_at:  string   // time of max elevation — ISO UTC
  duration_s: number
}

export interface PassPrediction {
  station:    GroundStation
  spacecraft: string
  passes:     SatPass[]
  computed_at: string
}
