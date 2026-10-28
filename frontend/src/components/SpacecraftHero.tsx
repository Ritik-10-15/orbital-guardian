// ============================================================
// src/components/SpacecraftHero.tsx
// Headline card for the active spacecraft: identity, status, and
// the conjunction picture from its latest scan.
// ============================================================

import React, { useEffect, useState } from 'react'
import { Satellite } from 'lucide-react'
import { useStore } from '../store/useStore'
import { parseTle, describeOrbit } from '../lib/tle'
import { RISK_COLOURS, SPACECRAFT_PRESETS } from '../types'
import type { RiskLevel } from '../types'

const STATUS: Record<RiskLevel, { label: string; colour: string }> = {
  UNKNOWN:    { label: 'NOT SCANNED', colour: '#7f93b2' },
  NEGLIGIBLE: { label: 'NOMINAL',     colour: '#34d399' },
  LOW:        { label: 'NOMINAL',     colour: '#34d399' },
  MODERATE:   { label: 'MONITOR',     colour: '#eab308' },
  HIGH:       { label: 'AT RISK',     colour: '#f97316' },
  CRITICAL:   { label: 'CRITICAL',    colour: '#ef4444' },
}

function formatUtc(date: Date | null): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'passed'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `in ${h}h ${String(m).padStart(2, '0')}m` : `in ${m}m`
}

export function SpacecraftHero() {
  const { fleet, activeFleetId, spacecraft } = useStore()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const member = fleet.find(m => m.id === activeFleetId)
  const tle = member?.tle ?? spacecraft
  const elements = parseTle(tle)
  const preset = SPACECRAFT_PRESETS.find(p => p.tle.name === tle.name)
  const colour = member?.colour ?? '#38bdf8'
  const status = STATUS[member?.risk_level ?? 'UNKNOWN']

  const events = member?.events ?? []
  const nextEvent = events
    .filter(ev => new Date(ev.tca).getTime() > now)
    .sort((a, b) => new Date(a.tca).getTime() - new Date(b.tca).getTime())[0]

  const subtitle = [
    preset?.category,
    elements && describeOrbit(elements),
    elements && `${elements.inclinationDeg.toFixed(1)}° inclination`,
  ].filter(Boolean).join(' · ')

  return (
    <section id="hero" className="panel area-hero" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '1 1 300px', minWidth: 0 }}>
          <span style={{
            width: 56, height: 56, borderRadius: '12px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `radial-gradient(circle at 30% 30%, ${colour}55, transparent 70%), var(--surface2)`,
            border: `1px solid ${colour}66`,
            color: colour,
          }}>
            <Satellite size={28} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 className="truncate" style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.2 }}>
                {tle.name}
              </h1>
              <span style={{
                padding: '2px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
                color: status.colour, background: `${status.colour}1f`, border: `1px solid ${status.colour}55`,
              }}>
                {status.label}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
              {subtitle || 'Custom TLE'}
            </div>
          </div>
        </div>

        {/* Conjunction picture */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(96px, auto))', gap: '10px', flex: '0 1 auto' }}>
          <Stat label="Conjunctions · 72h" value={member?.last_scanned ? String(events.length) : '—'} />
          <Stat
            label="Highest risk"
            value={member && member.risk_level !== 'UNKNOWN' ? member.risk_level : '—'}
            colour={member && member.risk_level !== 'UNKNOWN' ? RISK_COLOURS[member.risk_level] : undefined}
          />
          <Stat
            label="Next TCA"
            value={nextEvent ? formatCountdown(new Date(nextEvent.tca).getTime() - now) : '—'}
          />
        </div>

        {/* Catalog identity */}
        <dl style={{
          display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '14px', rowGap: '2px',
          padding: '8px 14px', borderRadius: '8px', background: 'var(--surface2)', border: '1px solid var(--border)',
          fontSize: '11px', flex: '0 0 auto',
        }}>
          <dt style={{ color: 'var(--muted)' }}>NORAD ID</dt>
          <dd className="mono">{elements?.noradId ?? '—'}</dd>
          <dt style={{ color: 'var(--muted)' }}>COSPAR</dt>
          <dd className="mono">{elements?.cosparId ?? '—'}</dd>
          <dt style={{ color: 'var(--muted)' }}>TLE epoch</dt>
          <dd className="mono">{formatUtc(elements?.epoch ?? null)}</dd>
        </dl>
      </div>
    </section>
  )
}

function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div style={{
      padding: '8px 12px', borderRadius: '8px',
      background: 'var(--surface2)', border: '1px solid var(--border)',
    }}>
      <div className="section-label" style={{ fontSize: '9px' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 700, color: colour ?? 'var(--text)', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}
