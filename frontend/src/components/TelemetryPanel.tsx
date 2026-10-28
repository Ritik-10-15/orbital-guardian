// ============================================================
// src/components/TelemetryPanel.tsx
// Live position from the WebSocket feed, orbital elements decoded
// from the TLE, and the altitude profile of the propagated track.
// ============================================================

import React from 'react'
import {
  Activity, Mountain, Gauge, Navigation, MapPin, Compass, Orbit, Timer,
  RotateCw, Crosshair, ArrowUpRight, ArrowDownRight, Circle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'
import { parseTle } from '../lib/tle'
import { PanelHeader } from './PanelHeader'
import type { OrbitPoint } from '../types'

export function TelemetryPanel({ connected }: { connected: boolean }) {
  const { fleet, activeFleetId, spacecraft, liveFrame, orbitPoints } = useStore()
  const member = fleet.find(m => m.id === activeFleetId)
  const elements = parseTle(member?.tle ?? spacecraft)
  const frame = member?.live_frame ?? liveFrame
  const track = member?.orbit_points.length ? member.orbit_points : orbitPoints
  const colour = member?.colour ?? '#38bdf8'

  return (
    <section id="telemetry" className="panel area-telem">
      <PanelHeader icon={Activity} title="Telemetry">
        <span className="chip" style={connected ? { color: 'var(--ok)', borderColor: 'var(--ok)' } : undefined}>
          <span className="status-dot" style={{ width: 6, height: 6, background: connected ? 'var(--ok)' : 'var(--muted)' }} />
          {connected ? 'LIVE · 5 s' : 'OFFLINE'}
        </span>
      </PanelHeader>

      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '14px 22px', alignContent: 'start',
      }}>
        <Group title="Live position">
          <Row icon={Mountain}   label="Altitude"  value={frame ? `${frame.altitude_km.toFixed(1)} km` : '—'} />
          <Row icon={Gauge}      label="Velocity"  value={frame ? `${frame.speed_kms.toFixed(2)} km/s` : '—'} />
          <Row icon={Navigation} label="Latitude"  value={frame ? formatLat(frame.latitude_deg) : '—'} />
          <Row icon={MapPin}     label="Longitude" value={frame ? formatLon(frame.longitude_deg) : '—'} />
        </Group>

        <Group title="Orbital elements">
          <Row icon={Compass}   label="Inclination"     value={elements ? `${elements.inclinationDeg.toFixed(2)}°` : '—'} />
          <Row icon={Circle}    label="Eccentricity"    value={elements ? elements.eccentricity.toFixed(5) : '—'} />
          <Row icon={RotateCw}  label="RAAN"            value={elements ? `${elements.raanDeg.toFixed(2)}°` : '—'} />
          <Row icon={Crosshair} label="Arg. of perigee" value={elements ? `${elements.argPerigeeDeg.toFixed(2)}°` : '—'} />
          <Row icon={Orbit}     label="Mean motion"     value={elements ? `${elements.meanMotionRevDay.toFixed(4)} rev/d` : '—'} />
          <Row icon={Timer}     label="Period"          value={elements ? `${elements.periodMin.toFixed(1)} min` : '—'} />
        </Group>

        <Group title="Orbit geometry">
          <Row icon={Orbit}          label="Semi-major axis" value={elements ? `${elements.semiMajorAxisKm.toFixed(1)} km` : '—'} />
          <Row icon={ArrowUpRight}   label="Apogee"          value={elements ? `${elements.apogeeKm.toFixed(1)} km` : '—'} />
          <Row icon={ArrowDownRight} label="Perigee"         value={elements ? `${elements.perigeeKm.toFixed(1)} km` : '—'} />
        </Group>

        <Group title="Altitude profile · next 2 h">
          {track.length >= 2
            ? <AltitudeChart points={track} colour={colour} />
            : <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '6px 0' }}>
                Use Load Orbit or Scan Entire Fleet to plot the propagated track.
              </div>}
        </Group>
      </div>
    </section>
  )
}

function formatLat(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg >= 0 ? 'N' : 'S'}`
}

function formatLon(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg >= 0 ? 'E' : 'W'}`
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: '4px' }}>{title}</div>
      <div className="kv-list">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="kv-row">
      <Icon size={13} />
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  )
}

function AltitudeChart({ points, colour }: { points: OrbitPoint[]; colour: string }) {
  const W = 300, H = 72, PAD = 4
  const alts = points.map(p => p.altitude_km)
  const min = Math.min(...alts)
  const max = Math.max(...alts)
  const range = max - min || 1
  const x = (i: number) => PAD + (i / (alts.length - 1)) * (W - PAD * 2)
  const y = (a: number) => H - PAD - ((a - min) / range) * (H - PAD * 2)
  const line = alts.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(a).toFixed(1)}`).join(' ')
  const area = `${line} L${x(alts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  const gradientId = `alt-fill-${colour.replace('#', '')}`

  return (
    <div style={{ paddingTop: '6px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={`Altitude between ${min.toFixed(0)} and ${max.toFixed(0)} km`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.35" />
            <stop offset="100%" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={colour} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted)' }}>
        <span>min {min.toFixed(1)} km</span>
        <span>max {max.toFixed(1)} km</span>
      </div>
    </div>
  )
}
