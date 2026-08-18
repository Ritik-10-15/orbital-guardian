// ============================================================
// src/store/useStore.ts
// Global Zustand store — Option F: fleet management added
// Approvals + mission log are persisted to localStorage
// ============================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  ConjunctionEvent, LiveFrame, OrbitPoint, TLESchema,
  FleetMember, RiskLevel, ApprovalRecord, MissionLogEntry,
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

  // ── Mission log ───────────────────────────────────────────────
  missionLog:     MissionLogEntry[]
  addLogEntry:    (entry: Omit<MissionLogEntry, 'id' | 'logged_at'>) => void
  clearLog:       () => void

  // ── Orbit playback scrubber ───────────────────────────────────
  scrubberIndex:     number        // index into orbit_points of active member
  scrubberActive:    boolean       // true while user is dragging
  setScrubberIndex:  (i: number | ((prev: number) => number)) => void
  setScrubberActive: (v: boolean) => void
}

// Default ISS TLE — epoch: 2024-Dec-01 (day 336)
const ISS: TLESchema = {
  name:  'ISS (ZARYA)',
  line1: '1 25544U 98067A   24336.50000000  .00002182  00000-0  40769-4 0  9993',
  line2: '2 25544  51.6416 132.9300 0006703 175.2100  30.8400 15.50377579432188',
}

// Seed the fleet with ISS on load
const INITIAL_FLEET: FleetMember[] = [
  makeMember(ISS, '#facc15'),
]

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
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
    const now = new Date().toISOString()
    // find spacecraft name for log
    const scName = get().fleet.find(m => m.events.some(e => eventKey(e) === key))?.tle.name
                   ?? get().spacecraft.name
    set(s => ({
      approvals: {
        ...s.approvals,
        [key]: { event_key: key, status: 'APPROVED', decided_at: now, decided_miss_km: missKm, decided_score: score, notes },
      },
      missionLog: [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        logged_at: now,
        spacecraft_name:  scName,
        debris_name:      ev.debris_name,
        tca:              ev.tca,
        miss_distance_km: ev.miss_distance_km,
        risk_score:       ev.risk_score,
        risk_level:       ev.risk_level,
        decision:         'APPROVED' as const,
        notes,
        simulated_miss_km: missKm,
        simulated_score:   score,
      }, ...s.missionLog].slice(0, 200),
    }))
  },

  rejectEvent: (ev, missKm, score, notes = '') => {
    const key = eventKey(ev)
    const now = new Date().toISOString()
    const scName = get().fleet.find(m => m.events.some(e => eventKey(e) === key))?.tle.name
                   ?? get().spacecraft.name
    set(s => ({
      approvals: {
        ...s.approvals,
        [key]: { event_key: key, status: 'REJECTED', decided_at: now, decided_miss_km: missKm, decided_score: score, notes },
      },
      missionLog: [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        logged_at: now,
        spacecraft_name:  scName,
        debris_name:      ev.debris_name,
        tca:              ev.tca,
        miss_distance_km: ev.miss_distance_km,
        risk_score:       ev.risk_score,
        risk_level:       ev.risk_level,
        decision:         'REJECTED' as const,
        notes,
        simulated_miss_km: missKm,
        simulated_score:   score,
      }, ...s.missionLog].slice(0, 200),
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

  // ── Mission log ──────────────────────────────────────────────
  missionLog: [],
  addLogEntry: (entry) => set(s => ({
    missionLog: [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        logged_at: new Date().toISOString(),
      },
      ...s.missionLog,
    ].slice(0, 200),
  })),
  clearLog: () => set({ missionLog: [] }),

  // ── Orbit playback scrubber ──────────────────────────────────
  scrubberIndex:     0,
  scrubberActive:    false,
  setScrubberIndex:  (i) => set(s => ({
    scrubberIndex: typeof i === 'function' ? i(s.scrubberIndex) : i,
  })),
  setScrubberActive: (v) => set({ scrubberActive: v }),
    }),
    {
      name: 'orbital-guardian-store',
      storage: createJSONStorage(() => localStorage),
      // Persist approvals + mission log — fleet/live data is always transient
      partialize: (state) => ({
        approvals:  state.approvals,
        missionLog: state.missionLog,
      }),
    },
  )
)