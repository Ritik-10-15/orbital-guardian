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
}

// ── WebSocket helper ─────────────────────────────────────────────────────────

export function createLiveSocket(
  tle: TLESchema,
  intervalS = 5,
  onFrame: (frame: unknown) => void,
  onError?: (err: Event) => void
): WebSocket {
  const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/live`)

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
