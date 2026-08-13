// ============================================================
// src/store/useStore.ts
// Global Zustand store — Option F: fleet management added
// ============================================================

import { create } from 'zustand'
import type {
  ConjunctionEvent, LiveFrame, OrbitPoint, TLESchema,
  FleetMember, RiskLevel, ApprovalRecord,
} from '../types'
import { SPACECRAFT_PRESETS, eventKey } from '../types'

// ── helpers ───────────────────────────────────────────────────
function makeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
}

function makeMember(tle: TLESchema, colour: string): FleetMember {
  return {
    id:           makeId(tle.name),
    tle,
    colour,
    live_frame:   null,
    orbit_points: [],
    events:       [],
    risk_level:   'UNKNOWN',
    risk_score:   0,
    last_scanned: null,
    active:       true,
  }
}

// Cycle through distinct colours for user-added spacecraft
const FLEET_COLOURS = [
  '#facc15', '#f97316', '#a78bfa', '#34d399',
  '#22d3ee', '#60a5fa', '#f472b6', '#fb923c',
]

interface AppState {
  // ── Single spacecraft mode (legacy — kept for ControlPanel) ─
  spacecraft:    TLESchema
  setSpacecraft: (tle: TLESchema) => void

  // ── Orbit track (active spacecraft) ─────────────────────────
  orbitPoints:    OrbitPoint[]
  setOrbitPoints: (pts: OrbitPoint[]) => void

  // ── Live position (active spacecraft) ────────────────────────
  liveFrame:    LiveFrame | null
  setLiveFrame: (f: LiveFrame) => void

  // ── Conjunction events (active spacecraft) ───────────────────
  events:    ConjunctionEvent[]
  setEvents: (evs: ConjunctionEvent[]) => void

  // ── UI state ─────────────────────────────────────────────────
  loading:          boolean
  setLoading:       (v: boolean) => void
  error:            string | null
  setError:         (msg: string | null) => void
  selectedEvent:    ConjunctionEvent | null
  setSelectedEvent: (ev: ConjunctionEvent | null) => void

  // ── Fleet (Option F) ─────────────────────────────────────────
  fleet:              FleetMember[]
  activeFleetId:      string                          // which spacecraft is "active"
  fleetLoading:       boolean
  setFleetLoading:    (v: boolean) => void

  addToFleet:         (tle: TLESchema, colour?: string) => void
  removeFromFleet:    (id: string) => void
  toggleFleetMember:  (id: string) => void            // show/hide on globe
  setActiveFleetId:   (id: string) => void
  updateFleetMember:  (id: string, patch: Partial<FleetMember>) => void
  setFleetLiveFrame:  (id: string, frame: LiveFrame) => void
  setFleetOrbitTrack: (id: string, pts: OrbitPoint[]) => void
  setFleetEvents:     (id: string, evs: ConjunctionEvent[], risk: RiskLevel, score: number) => void
  clearFleet:         () => void

  // ── Catalog source (shared between ControlPanel + FleetPanel) ─
  catalogSource:      string
  setCatalogSource:   (source: string) => void

  // ── Operator approvals ────────────────────────────────────────
  approvals:      Record<string, ApprovalRecord>
  approveEvent:   (ev: ConjunctionEvent, missKm: number, score: number, notes?: string) => void
  rejectEvent:    (ev: ConjunctionEvent, missKm: number, score: number, notes?: string) => void
  clearApproval:  (ev: ConjunctionEvent) => void
}

// Default ISS TLE
const ISS: TLESchema = {
  name:  'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9990',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 00000',
}

// Seed the fleet with ISS on load
const INITIAL_FLEET: FleetMember[] = [
  makeMember(ISS, '#facc15'),
]

export const useStore = create<AppState>((set, get) => ({
  // ── Legacy single-spacecraft state ──────────────────────────
  spacecraft:    ISS,
  setSpacecraft: (tle) => set({ spacecraft: tle }),
  orbitPoints:   [],
  setOrbitPoints: (pts) => set({ orbitPoints: pts }),
  liveFrame:     null,
  setLiveFrame:  (f) => set({ liveFrame: f }),
  events:        [],
  setEvents:     (evs) => set({ events: evs }),
  loading:       false,
  setLoading:    (v) => set({ loading: v }),
  error:         null,
  setError:      (msg) => set({ error: msg }),
  selectedEvent: null,
  setSelectedEvent: (ev) => set({ selectedEvent: ev }),

  // ── Fleet state ──────────────────────────────────────────────
  fleet:          INITIAL_FLEET,
  activeFleetId:  INITIAL_FLEET[0].id,
  fleetLoading:   false,
  setFleetLoading: (v) => set({ fleetLoading: v }),

  addToFleet: (tle, colour) => {
    const { fleet } = get()
    const id = makeId(tle.name)
    if (fleet.find(m => m.id === id)) return   // already in fleet
    const col = colour ?? FLEET_COLOURS[fleet.length % FLEET_COLOURS.length]
    set({ fleet: [...fleet, makeMember(tle, col)] })
  },

  removeFromFleet: (id) => {
    const { fleet, activeFleetId } = get()
    const updated = fleet.filter(m => m.id !== id)
    set({
      fleet: updated,
      activeFleetId: activeFleetId === id ? (updated[0]?.id ?? '') : activeFleetId,
    })
  },

  toggleFleetMember: (id) =>
    set(s => ({
      fleet: s.fleet.map(m => m.id === id ? { ...m, active: !m.active } : m),
    })),

  setActiveFleetId: (id) => {
    const { fleet } = get()
    const member = fleet.find(m => m.id === id)
    if (member) {
      set({
        activeFleetId: id,
        spacecraft:    member.tle,
        orbitPoints:   member.orbit_points,
        events:        member.events,
      })
    }
  },

  updateFleetMember: (id, patch) =>
    set(s => ({
      fleet: s.fleet.map(m => m.id === id ? { ...m, ...patch } : m),
    })),

  setFleetLiveFrame: (id, frame) =>
    set(s => ({
      fleet: s.fleet.map(m => m.id === id ? { ...m, live_frame: frame } : m),
      // Also update legacy liveFrame if this is the active spacecraft
      liveFrame: s.activeFleetId === id ? frame : s.liveFrame,
    })),

  setFleetOrbitTrack: (id, pts) =>
    set(s => ({
      fleet: s.fleet.map(m => m.id === id ? { ...m, orbit_points: pts } : m),
      orbitPoints: s.activeFleetId === id ? pts : s.orbitPoints,
    })),

  setFleetEvents: (id, evs, risk, score) =>
    set(s => ({
      fleet: s.fleet.map(m =>
        m.id === id
          ? { ...m, events: evs, risk_level: risk, risk_score: score, last_scanned: new Date().toISOString() }
          : m
      ),
      events: s.activeFleetId === id ? evs : s.events,
    })),

  clearFleet: () => set({ fleet: INITIAL_FLEET, activeFleetId: INITIAL_FLEET[0].id }),

  // ── Catalog source ───────────────────────────────────────────
  catalogSource: 'celestrak-stations',
  setCatalogSource: (source) => set({ catalogSource: source }),

  // ── Operator approvals ────────────────────────────────────────
  approvals: {},

  approveEvent: (ev, missKm, score, notes = '') => {
    const key = eventKey(ev)
    set(s => ({
      approvals: {
        ...s.approvals,
        [key]: {
          event_key: key,
          status: 'APPROVED',
          decided_at: new Date().toISOString(),
          decided_miss_km: missKm,
          decided_score: score,
          notes,
        },
      },
    }))
  },

  rejectEvent: (ev, missKm, score, notes = '') => {
    const key = eventKey(ev)
    set(s => ({
      approvals: {
        ...s.approvals,
        [key]: {
          event_key: key,
          status: 'REJECTED',
          decided_at: new Date().toISOString(),
          decided_miss_km: missKm,
          decided_score: score,
          notes,
        },
      },
    }))
  },

  clearApproval: (ev) => {
    const key = eventKey(ev)
    set(s => {
      const next = { ...s.approvals }
      delete next[key]
      return { approvals: next }
    })
  },
}))