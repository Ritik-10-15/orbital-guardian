// ============================================================
// src/api/client.ts
// Typed API client — all calls go through /api (proxied to :8000)
// ============================================================

import type {
  TLESchema,
  OrbitTrackResponse,
  ConjunctionResponse,
  RiskRequest,
  RiskResponse,
  ApprovalRecord,
  FleetMemberRecord,
  MissionLogEntry,
  MissionLogPage,
  MissionLogDecision,
} from '../types'

const BASE = '/api'

async function get<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`)
}

async function getAllMissionLog(): Promise<MissionLogEntry[]> {
  const pageSize = 500
  const entries: MissionLogEntry[] = []
  let offset = 0
  while (true) {
    const page = await get<MissionLogPage>(`/mission-log?offset=${offset}&limit=${pageSize}`)
    entries.push(...page.items)
    if (!page.has_more) return entries
    offset += page.items.length
  }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  /** Liveness probe */
  health: () => get<{ status: string; utc: string }>('/health'),

  /** Fetch + cache a TLE catalog from CelesTrak */
  fetchTLECatalog: (category = 'active') =>
    get<{ source: string; object_count: number; objects: TLESchema[] }>(
      `/tle/fetch?category=${category}`
    ),

  /** Propagate a TLE and return a lat/lon/alt ground track */
  orbitTrack: (tle: TLESchema, hours = 2, step = 60) =>
    post<OrbitTrackResponse>(
      `/orbits/track?hours=${hours}&step=${step}`,
      tle
    ),

  /** Run full conjunction analysis */
  conjunctions: (
    spacecraft: TLESchema,
    debrisCatalog: TLESchema[],
    lookaheadHours = 72,
    screenKm = 5
  ) =>
    post<ConjunctionResponse>('/conjunctions', {
      spacecraft,
      debris_catalog: debrisCatalog,
      lookahead_hours: lookaheadHours,
      screen_km: screenKm,
    }),

  /** Score a single set of raw conjunction metrics */
  scoreRisk: (req: RiskRequest) =>
    post<RiskResponse>('/risk', req),

  listFleet: () => get<FleetMemberRecord[]>('/fleet'),
  addFleetMember: (tle: TLESchema, colour: string) =>
    post<FleetMemberRecord>('/fleet', { tle, colour, active: true }),
  updateFleetMember: (id: string, changes: { tle?: TLESchema; colour?: string; active?: boolean }) =>
    patch<FleetMemberRecord>(`/fleet/${encodeURIComponent(id)}`, changes),
  deleteFleetMember: (id: string) => del(`/fleet/${encodeURIComponent(id)}`),

  listApprovals: () => get<ApprovalRecord[]>('/approvals'),
  decide: (request: {
    request_id: string
    spacecraft_id: string
    spacecraft_name: string
    debris_name: string
    tca: string
    status: Exclude<MissionLogDecision, 'CLEARED'>
    decided_miss_km: number
    decided_score: number
    notes: string
    miss_distance_km: number
    relative_velocity_kms: number
    risk_score: number
    risk_level: string
  }) => put<{ approval: ApprovalRecord | null; log_entry: MissionLogEntry }>('/approvals', request),
  clearDecision: (request: {
    request_id: string
    spacecraft_id: string
    spacecraft_name: string
    debris_name: string
    tca: string
  }) => post<{ approval: ApprovalRecord | null; log_entry: MissionLogEntry }>('/approvals/clear', request),
  listMissionLog: (offset = 0, limit = 100) =>
    get<MissionLogPage>(`/mission-log?offset=${offset}&limit=${limit}`),
  allMissionLog: getAllMissionLog,
  importLocalState: (body: {
    migration_id: string
    approvals: Record<string, Omit<ApprovalRecord, 'spacecraft_id'> & { spacecraft_id?: string }>
    mission_log: MissionLogEntry[]
  }) => post<{
    imported: boolean
    already_imported: boolean
    mission_log_count: number
    approval_count: number
    unmatched_approvals: string[]
  }>('/state/import-local', body),
}

// ── WebSocket helper ─────────────────────────────────────────────────────────

export function createLiveSocket(
  tle: TLESchema,
  intervalS = 5,
  onFrame: (frame: unknown) => void,
  onError?: (err: Event) => void
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`)

  ws.onopen = () => {
    ws.send(JSON.stringify({ ...tle, interval_s: intervalS }))
  }

  ws.onmessage = (e) => {
    try {
      onFrame(JSON.parse(e.data as string))
    } catch {
      // ignore parse errors
    }
  }

  if (onError) ws.onerror = onError
  return ws
}
