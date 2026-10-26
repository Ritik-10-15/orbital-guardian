// Global Zustand store. Fleet configuration, approvals, and the mission log
// are server-owned; telemetry, scans, and interaction state remain transient.

import { create } from 'zustand'
import { api } from '../api/client'
import type {
  ApprovalRecord, ConjunctionEvent, FleetMember, LiveFrame, MissionLogEntry,
  MissionLogDecision, OrbitPoint, RiskLevel, TLESchema,
} from '../types'
import { eventKey } from '../types'
import { PUBLIC_READ_ONLY } from '../config'

const LEGACY_STORAGE_KEY = 'orbital-guardian-store'
const MIGRATION_ID_KEY = 'orbital-guardian-local-import-id'
const MISSION_LOG_PAGE_SIZE = 100

function makeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
}

function makeMember(tle: TLESchema, colour: string, id = makeId(tle.name), active = true): FleetMember {
  return {
    id,
    tle,
    colour,
    live_frame: null,
    orbit_points: [],
    events: [],
    risk_level: 'UNKNOWN',
    risk_score: 0,
    last_scanned: null,
    active,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function newRequestId(): string {
  return crypto.randomUUID()
}

const FLEET_COLOURS = [
  '#facc15', '#f97316', '#a78bfa', '#34d399',
  '#22d3ee', '#60a5fa', '#f472b6', '#fb923c',
]

const ISS: TLESchema = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24336.50000000  .00002182  00000-0  40769-4 0  9993',
  line2: '2 25544  51.6416 132.9300 0006703 175.2100  30.8400 15.50377579432188',
}

const INITIAL_FLEET = [makeMember(ISS, '#facc15')]

interface AppState {
  spacecraft: TLESchema
  setSpacecraft: (tle: TLESchema) => void

  orbitPoints: OrbitPoint[]
  setOrbitPoints: (pts: OrbitPoint[]) => void
  liveFrame: LiveFrame | null
  setLiveFrame: (frame: LiveFrame) => void
  events: ConjunctionEvent[]
  setEvents: (events: ConjunctionEvent[]) => void

  loading: boolean
  setLoading: (value: boolean) => void
  error: string | null
  setError: (message: string | null) => void
  selectedEvent: ConjunctionEvent | null
  setSelectedEvent: (event: ConjunctionEvent | null) => void

  fleet: FleetMember[]
  activeFleetId: string
  fleetLoading: boolean
  setFleetLoading: (value: boolean) => void
  addToFleet: (tle: TLESchema, colour?: string) => Promise<void>
  removeFromFleet: (id: string) => Promise<void>
  toggleFleetMember: (id: string) => Promise<void>
  setActiveFleetId: (id: string) => void
  updateFleetMember: (id: string, patch: Partial<FleetMember>) => Promise<void>
  setFleetLiveFrame: (id: string, frame: LiveFrame) => void
  setFleetOrbitTrack: (id: string, points: OrbitPoint[]) => void
  setFleetEvents: (id: string, events: ConjunctionEvent[], risk: RiskLevel, score: number) => void

  catalogSource: string
  setCatalogSource: (source: string) => void

  approvals: Record<string, ApprovalRecord>
  approveEvent: (event: ConjunctionEvent, spacecraftId: string, missKm: number, score: number, notes?: string) => Promise<void>
  rejectEvent: (event: ConjunctionEvent, spacecraftId: string, missKm: number, score: number, notes?: string) => Promise<void>
  clearApproval: (event: ConjunctionEvent, spacecraftId: string) => Promise<void>

  missionLog: MissionLogEntry[]
  missionLogTotal: number
  missionLogHasMore: boolean
  missionLogLoadingMore: boolean
  loadMoreMissionLog: () => Promise<void>

  persistenceReady: boolean
  persistenceLoading: boolean
  persistenceError: string | null
  hydratePersistentState: () => Promise<void>
  clearPersistenceError: () => void

  scrubberIndex: number
  scrubberActive: boolean
  setScrubberIndex: (index: number | ((previous: number) => number)) => void
  setScrubberActive: (value: boolean) => void
}

let hydrationPromise: Promise<void> | null = null

export const useStore = create<AppState>()((set, get) => {
  function reportPersistenceError(error: unknown) {
    set({ persistenceError: messageOf(error) })
  }

  function canWrite(): boolean {
    if (PUBLIC_READ_ONLY) return false
    if (get().persistenceReady) return true
    set({ persistenceError: 'Persistent data is still loading or needs a successful local-data import.' })
    return false
  }

  async function writeDecision(
    event: ConjunctionEvent,
    spacecraftId: string,
    status: Exclude<MissionLogDecision, 'CLEARED'>,
    missKm: number,
    score: number,
    notes = '',
  ) {
    if (!canWrite()) return
    const member = get().fleet.find(candidate => candidate.id === spacecraftId)
    const spacecraftName = member?.tle.name ?? get().spacecraft.name
    try {
      set({ persistenceError: null })
      const result = await api.decide({
        request_id: newRequestId(),
        spacecraft_id: spacecraftId,
        spacecraft_name: spacecraftName,
        debris_name: event.debris_name,
        tca: event.tca,
        status,
        decided_miss_km: missKm,
        decided_score: score,
        notes,
        miss_distance_km: event.miss_distance_km,
        relative_velocity_kms: event.relative_velocity_kms,
        risk_score: event.risk_score,
        risk_level: event.risk_level,
      })
      set(state => {
        const nextApprovals = { ...state.approvals }
        const key = eventKey(event, spacecraftId)
        if (result.approval) nextApprovals[result.approval.event_key] = result.approval
        else delete nextApprovals[key]
        const alreadyLogged = state.missionLog.some(row => row.id === result.log_entry.id)
        return {
          approvals: nextApprovals,
          missionLog: [result.log_entry, ...state.missionLog.filter(row => row.id !== result.log_entry.id)],
          missionLogTotal: state.missionLogTotal + (alreadyLogged ? 0 : 1),
        }
      })
    } catch (error) {
      reportPersistenceError(error)
    }
  }

  return {
    spacecraft: ISS,
    setSpacecraft: (tle) => set({ spacecraft: tle }),
    orbitPoints: [],
    setOrbitPoints: (points) => set({ orbitPoints: points }),
    liveFrame: null,
    setLiveFrame: (frame) => set({ liveFrame: frame }),
    events: [],
    setEvents: (events) => set({ events }),

    loading: false,
    setLoading: (value) => set({ loading: value }),
    error: null,
    setError: (message) => set({ error: message }),
    selectedEvent: null,
    setSelectedEvent: (event) => set({ selectedEvent: event }),

    fleet: INITIAL_FLEET,
    activeFleetId: INITIAL_FLEET[0].id,
    fleetLoading: false,
    setFleetLoading: (value) => set({ fleetLoading: value }),

    addToFleet: async (tle, colour) => {
      if (!canWrite()) return
      const id = makeId(tle.name)
      if (get().fleet.some(member => member.id === id)) return
      const chosenColour = colour ?? FLEET_COLOURS[get().fleet.length % FLEET_COLOURS.length]
      try {
        set({ persistenceError: null })
        const saved = await api.addFleetMember(tle, chosenColour)
        const member = makeMember(saved.tle, saved.colour, saved.id, saved.active)
        set(state => ({ fleet: [...state.fleet, member] }))
      } catch (error) {
        reportPersistenceError(error)
      }
    },

    removeFromFleet: async (id) => {
      if (!canWrite()) return
      try {
        set({ persistenceError: null })
        await api.deleteFleetMember(id)
        set(state => {
          const fleet = state.fleet.filter(member => member.id !== id)
          const activeFleetId = state.activeFleetId === id ? (fleet[0]?.id ?? '') : state.activeFleetId
          const active = fleet.find(member => member.id === activeFleetId)
          const approvals = Object.fromEntries(
            Object.entries(state.approvals).filter(([, approval]) => approval.spacecraft_id !== id),
          )
          return {
            fleet,
            activeFleetId,
            spacecraft: active?.tle ?? state.spacecraft,
            orbitPoints: active?.orbit_points ?? [],
            events: active?.events ?? [],
            approvals,
          }
        })
      } catch (error) {
        reportPersistenceError(error)
      }
    },

    toggleFleetMember: async (id) => {
      if (!canWrite()) return
      const member = get().fleet.find(candidate => candidate.id === id)
      if (!member) return
      try {
        set({ persistenceError: null })
        const saved = await api.updateFleetMember(id, { active: !member.active })
        set(state => ({
          fleet: state.fleet.map(candidate => candidate.id === id ? { ...candidate, active: saved.active } : candidate),
        }))
      } catch (error) {
        reportPersistenceError(error)
      }
    },

    setActiveFleetId: (id) => {
      const member = get().fleet.find(candidate => candidate.id === id)
      if (!member) return
      set({ activeFleetId: id, spacecraft: member.tle, orbitPoints: member.orbit_points, events: member.events })
    },

    updateFleetMember: async (id, patch) => {
      if (!canWrite()) return
      const request: { tle?: TLESchema; colour?: string; active?: boolean } = {}
      if (patch.tle) request.tle = patch.tle
      if (patch.colour) request.colour = patch.colour
      if (typeof patch.active === 'boolean') request.active = patch.active
      if (Object.keys(request).length === 0) return
      try {
        set({ persistenceError: null })
        const saved = await api.updateFleetMember(id, request)
        set(state => ({
          fleet: state.fleet.map(member => member.id === id
            ? { ...member, tle: saved.tle, colour: saved.colour, active: saved.active }
            : member),
          spacecraft: state.activeFleetId === id ? saved.tle : state.spacecraft,
        }))
      } catch (error) {
        reportPersistenceError(error)
      }
    },

    setFleetLiveFrame: (id, frame) => set(state => ({
      fleet: state.fleet.map(member => member.id === id ? { ...member, live_frame: frame } : member),
      liveFrame: state.activeFleetId === id ? frame : state.liveFrame,
    })),

    setFleetOrbitTrack: (id, points) => set(state => ({
      fleet: state.fleet.map(member => member.id === id ? { ...member, orbit_points: points } : member),
      orbitPoints: state.activeFleetId === id ? points : state.orbitPoints,
    })),

    setFleetEvents: (id, events, risk, score) => set(state => ({
      fleet: state.fleet.map(member => member.id === id
        ? { ...member, events, risk_level: risk, risk_score: score, last_scanned: new Date().toISOString() }
        : member),
      events: state.activeFleetId === id ? events : state.events,
    })),

    catalogSource: 'celestrak-stations',
    setCatalogSource: (source) => set({ catalogSource: source }),

    approvals: {},
    approveEvent: (event, spacecraftId, missKm, score, notes = '') =>
      writeDecision(event, spacecraftId, 'APPROVED', missKm, score, notes),
    rejectEvent: (event, spacecraftId, missKm, score, notes = '') =>
      writeDecision(event, spacecraftId, 'REJECTED', missKm, score, notes),
    clearApproval: async (event, spacecraftId) => {
      if (!canWrite()) return
      const member = get().fleet.find(candidate => candidate.id === spacecraftId)
      try {
        set({ persistenceError: null })
        const result = await api.clearDecision({
          request_id: newRequestId(),
          spacecraft_id: spacecraftId,
          spacecraft_name: member?.tle.name ?? get().spacecraft.name,
          debris_name: event.debris_name,
          tca: event.tca,
        })
        set(state => {
          const nextApprovals = { ...state.approvals }
          const key = eventKey(event, spacecraftId)
          delete nextApprovals[key]
          if (result.approval) nextApprovals[result.approval.event_key] = result.approval
          return {
            approvals: nextApprovals,
            missionLog: [result.log_entry, ...state.missionLog.filter(row => row.id !== result.log_entry.id)],
            missionLogTotal: state.missionLogTotal + (state.missionLog.some(row => row.id === result.log_entry.id) ? 0 : 1),
          }
        })
      } catch (error) {
        reportPersistenceError(error)
      }
    },

    missionLog: [],
    missionLogTotal: 0,
    missionLogHasMore: false,
    missionLogLoadingMore: false,
    loadMoreMissionLog: async () => {
      const state = get()
      if (!state.persistenceReady || !state.missionLogHasMore || state.missionLogLoadingMore) return
      const offset = state.missionLog.length
      set({ missionLogLoadingMore: true })
      try {
        const page = await api.listMissionLog(offset, MISSION_LOG_PAGE_SIZE)
        set(current => {
          const knownIds = new Set(current.missionLog.map(entry => entry.id))
          const additions = page.items.filter(entry => !knownIds.has(entry.id))
          return {
            missionLog: [...current.missionLog, ...additions],
            missionLogTotal: page.total,
            missionLogHasMore: page.has_more,
            missionLogLoadingMore: false,
          }
        })
      } catch (error) {
        set({ missionLogLoadingMore: false, persistenceError: messageOf(error) })
      }
    },

    persistenceReady: false,
    persistenceLoading: false,
    persistenceError: null,
    hydratePersistentState: () => {
      if (hydrationPromise) return hydrationPromise
      hydrationPromise = (async () => {
        set({ persistenceLoading: true, persistenceError: null })
        let importError: string | null = null
        try {
          const rawLegacy = PUBLIC_READ_ONLY ? null : localStorage.getItem(LEGACY_STORAGE_KEY)
          if (rawLegacy) {
            const parsed = JSON.parse(rawLegacy) as {
              state?: { approvals?: Record<string, unknown>; missionLog?: MissionLogEntry[] }
              approvals?: Record<string, unknown>
              missionLog?: MissionLogEntry[]
            }
            const legacyState = parsed.state ?? parsed
            const legacyApprovals = legacyState.approvals ?? {}
            const legacyMissionLog = legacyState.missionLog ?? []
            if (Object.keys(legacyApprovals).length || legacyMissionLog.length) {
              let migrationId = localStorage.getItem(MIGRATION_ID_KEY)
              if (!migrationId) {
                migrationId = newRequestId()
                localStorage.setItem(MIGRATION_ID_KEY, migrationId)
              }
              const result = await api.importLocalState({
                migration_id: migrationId,
                approvals: legacyApprovals as Record<string, Omit<ApprovalRecord, 'spacecraft_id'> & { spacecraft_id?: string }>,
                mission_log: legacyMissionLog,
              })
              if (result.unmatched_approvals.length) {
                importError = `Imported browser data, but ${result.unmatched_approvals.length} approval key(s) were malformed. Keep the old browser data for review.`
              } else {
                localStorage.removeItem(LEGACY_STORAGE_KEY)
                localStorage.removeItem(MIGRATION_ID_KEY)
              }
            } else {
              localStorage.removeItem(LEGACY_STORAGE_KEY)
            }
          }
        } catch (error) {
          importError = `Could not import the previous browser data: ${messageOf(error)}`
        }

        try {
          const [fleetRecords, approvalRecords, logPage] = await Promise.all([
            api.listFleet(),
            api.listApprovals(),
            api.listMissionLog(0, MISSION_LOG_PAGE_SIZE),
          ])
          const fleet = fleetRecords.map(record => makeMember(record.tle, record.colour, record.id, record.active))
          const active = fleet[0] ?? INITIAL_FLEET[0]
          const approvals = Object.fromEntries(approvalRecords.map(record => [record.event_key, record]))
          set({
            fleet,
            activeFleetId: active.id,
            spacecraft: active.tle,
            orbitPoints: [],
            liveFrame: null,
            events: [],
            approvals,
            missionLog: logPage.items,
            missionLogTotal: logPage.total,
            missionLogHasMore: logPage.has_more,
            persistenceReady: importError === null,
            persistenceLoading: false,
            persistenceError: importError,
          })
        } catch (error) {
          set({
            persistenceReady: false,
            persistenceLoading: false,
            persistenceError: importError ?? `Could not load persisted data: ${messageOf(error)}`,
          })
        }
      })().finally(() => { hydrationPromise = null })
      return hydrationPromise
    },
    clearPersistenceError: () => set({ persistenceError: null }),

    scrubberIndex: 0,
    scrubberActive: false,
    setScrubberIndex: (index) => set(state => ({
      scrubberIndex: typeof index === 'function' ? index(state.scrubberIndex) : index,
    })),
    setScrubberActive: (value) => set({ scrubberActive: value }),
  }
})
