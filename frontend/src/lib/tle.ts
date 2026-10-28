// ============================================================
// src/lib/tle.ts
// Orbital elements decoded from a TLE, plus derived quantities
// (period, semi-major axis, apogee/perigee) for the telemetry panel.
// ============================================================

import type { TLESchema } from '../types'

const MU_EARTH_KM3_S2 = 398600.4418
const EARTH_RADIUS_KM = 6378.137

export interface OrbitalElements {
  noradId: string
  cosparId: string
  epoch: Date | null
  inclinationDeg: number
  raanDeg: number
  eccentricity: number
  argPerigeeDeg: number
  meanMotionRevDay: number
  periodMin: number
  semiMajorAxisKm: number
  apogeeKm: number
  perigeeKm: number
  regime: 'LEO' | 'MEO' | 'GEO' | 'HEO'
}

function field(line: string, start: number, end: number): string {
  return line.slice(start - 1, end).trim()
}

/** TLE epoch "YYDDD.DDDDDDDD" → Date (UTC). */
function parseEpoch(raw: string): Date | null {
  const yy = parseInt(raw.slice(0, 2), 10)
  const day = parseFloat(raw.slice(2))
  if (Number.isNaN(yy) || Number.isNaN(day)) return null
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000)
}

/** International designator "98067A" → "1998-067A". */
function formatCospar(raw: string): string {
  if (raw.length < 5) return raw || '—'
  const yy = parseInt(raw.slice(0, 2), 10)
  if (Number.isNaN(yy)) return raw
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  return `${year}-${raw.slice(2)}`
}

export function parseTle(tle: TLESchema): OrbitalElements | null {
  const { line1, line2 } = tle
  if (line1.length < 63 || line2.length < 63) return null

  const inclinationDeg = parseFloat(field(line2, 9, 16))
  const raanDeg = parseFloat(field(line2, 18, 25))
  const eccentricity = parseFloat(`0.${field(line2, 27, 33)}`)
  const argPerigeeDeg = parseFloat(field(line2, 35, 42))
  const meanMotionRevDay = parseFloat(field(line2, 53, 63))
  if ([inclinationDeg, eccentricity, meanMotionRevDay].some(Number.isNaN) || meanMotionRevDay <= 0) return null

  const meanMotionRadS = (meanMotionRevDay * 2 * Math.PI) / 86_400
  const semiMajorAxisKm = Math.cbrt(MU_EARTH_KM3_S2 / (meanMotionRadS * meanMotionRadS))
  const apogeeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM
  const perigeeKm = semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM

  let regime: OrbitalElements['regime'] = 'LEO'
  if (eccentricity > 0.25) regime = 'HEO'
  else if (Math.abs(meanMotionRevDay - 1.0027) < 0.05) regime = 'GEO'
  else if (apogeeKm > 2000) regime = 'MEO'

  return {
    noradId: field(line1, 3, 7),
    cosparId: formatCospar(field(line1, 10, 17)),
    epoch: parseEpoch(field(line1, 19, 32)),
    inclinationDeg,
    raanDeg,
    eccentricity,
    argPerigeeDeg,
    meanMotionRevDay,
    periodMin: 1440 / meanMotionRevDay,
    semiMajorAxisKm,
    apogeeKm,
    perigeeKm,
    regime,
  }
}

/** Human description of the orbit, e.g. "Sun-synchronous LEO". */
export function describeOrbit(el: OrbitalElements): string {
  if (el.regime === 'LEO' && el.inclinationDeg > 96 && el.inclinationDeg < 100.5) return 'Sun-synchronous LEO'
  if (el.regime === 'LEO' && el.inclinationDeg > 80) return 'Polar LEO'
  return el.regime
}
