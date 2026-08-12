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
      line1: '1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990',
      line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000',
    },
  },
  {
    id: 'css',
    name: 'CSS (TIANHE)',
    category: 'Crewed',
    colour: '#f97316',
    tle: {
      name: 'CSS (TIANHE)',
      line1: '1 48274U 21035A   24001.50000000  .00005770  00000-0  10000-3 0  9993',
      line2: '2 48274  41.4750 150.3421 0005750  55.6100 304.5050 15.60000000 00001',
    },
  },
  {
    id: 'hubble',
    name: 'HST (HUBBLE)',
    category: 'Science',
    colour: '#a78bfa',
    tle: {
      name: 'HST (HUBBLE)',
      line1: '1 20580U 90037B   24001.50000000  .00000800  00000-0  40000-4 0  9992',
      line2: '2 20580  28.4700 280.0000 0002500  90.0000 270.0000 15.09200000 00003',
    },
  },
  {
    id: 'sentinel1a',
    name: 'SENTINEL-1A',
    category: 'Earth Obs',
    colour: '#34d399',
    tle: {
      name: 'SENTINEL-1A',
      line1: '1 39634U 14016A   24001.50000000  .00000100  00000-0  15000-4 0  9994',
      line2: '2 39634  98.1820  60.0000 0001200  86.0000 274.0000 14.59200000 00004',
    },
  },
  {
    id: 'terra',
    name: 'TERRA',
    category: 'Earth Obs',
    colour: '#22d3ee',
    tle: {
      name: 'TERRA',
      line1: '1 25994U 99068A   24001.50000000  .00000008  00000-0  10000-4 0  9990',
      line2: '2 25994  98.2100 140.0000 0001200  85.0000 275.0000 14.57100000 00008',
    },
  },
  {
    id: 'noaa15',
    name: 'NOAA 15',
    category: 'Weather',
    colour: '#60a5fa',
    tle: {
      name: 'NOAA 15',
      line1: '1 25338U 98030A   24001.50000000  .00000020  00000-0  30000-4 0  9997',
      line2: '2 25338  98.7300 110.0000 0010800  80.0000 280.0000 14.25750000 00005',
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
