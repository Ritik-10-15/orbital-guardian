// ============================================================
// src/components/FleetPanel.tsx
// Option F — Fleet overview table + fleet-wide scan
// Width-collapse + catalog-source-aware scanning
// ✦ Auto-refresh polling with configurable interval
// ============================================================

import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { RiskBadge } from './RiskBadge'
import { api } from '../api/client'
import type { FleetScanResponse, RiskLevel } from '../types'

function worstRisk(events: { risk_level: string }[]): RiskLevel {
  const order: RiskLevel[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'NEGLIGIBLE', 'UNKNOWN']
  for (const tier of order) {
    if (events.some(e => e.risk_level === tier)) return tier
  }
  return 'UNKNOWN'
}

function worstScore(events: { risk_score: number }[]): number {
  return events.reduce((max, e) => Math.max(max, e.risk_score), 0)
}

function exportFleetCSV(fleet: ReturnType<typeof useStore.getState>['fleet']) {
  const rows: string[] = []
  rows.push([
    'Spacecraft', 'Debris', 'TCA', 'Miss Distance (km)', 'Relative Velocity (km/s)',
    'Risk Level', 'Risk Score', 'Probability of Collision', 'Hours to TCA',
  ].join(','))

  fleet.forEach(member => {
    member.events.forEach(ev => {
      rows.push([
        `"${member.tle.name}"`,
        `"${ev.debris_name}"`,
        ev.tca,
        ev.miss_distance_km.toFixed(3),
        ev.relative_velocity_kms.toFixed(3),
        ev.risk_level,
        ev.risk_score.toFixed(1),
        ev.probability_of_collision !== null ? (ev.probability_of_collision * 100).toFixed(3) + '%' : 'N/A',
        ev.hours_to_tca.toFixed(2),
      ].join(','))
    })
  })

  if (rows.length === 1) {
    rows.push('No conjunction events recorded')
  }

  const csv  = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `orbital-guardian-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const POLL_OPTIONS = [
  { label: 'Off',   value: 0    },
  { label: '5 min', value: 5    },
  { label: '15 min',value: 15   },
  { label: '30 min',value: 30   },
]

export function FleetPanel() {
  const {
    fleet, setFleetLoading, setFleetEvents, fleetLoading,
    setFleetOrbitTrack, catalogSource,
  } = useStore()

  const [scanResult,   setScanResult]   = useState<FleetScanResponse | null>(null)
  const [scanError,    setScanError]    = useState<string | null>(null)
  const [showResults,  setShowResults]  = useState(true)
  const [collapsed,    setCollapsed]    = useState(false)
  const [pollInterval, setPollInterval] = useState(0)       // minutes; 0 = off
  const [nextScanIn,   setNextScanIn]   = useState<number>(0) // seconds until next auto-scan
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function handleFleetScan() {
    setFleetLoading(true)
    setScanError(null)
    setScanResult(null)

    try {
      const results = []
      for (const member of fleet) {
        if (!member.active) continue
        try {
          let debris: { name: string; line1: string; line2: string }[] = []

          if (catalogSource === 'demo-debris') {
            const params = new URLSearchParams({
              sc_name: member.tle.name,
              sc_line1: member.tle.line1,
              sc_line2: member.tle.line2,
              count: '5',
            })
            const debrisRes = await fetch(`/api/catalog/demo-debris?${params}`)
            const debrisData = await debrisRes.json()
            debris = debrisData.objects ?? []
          } else {
            const [source, subtype] = catalogSource.split('-') as ['celestrak' | 'spacetrack', string]
            const url = source === 'spacetrack'
              ? `/api/catalog/spacetrack?type=${subtype}&limit=30`
              : `/api/catalog/celestrak?category=${subtype}&limit=30`
            const debrisRes = await fetch(url)
            const debrisData = await debrisRes.json()
            debris = debrisData.objects ?? []
          }

          const screenKm = catalogSource === 'demo-debris' ? 50 : 5
          const res = await api.conjunctions(member.tle, debris, 72, screenKm)
          const risk  = worstRisk(res.events) as RiskLevel
          const score = worstScore(res.events)
          setFleetEvents(member.id, res.events, risk, score)
          results.push({
            spacecraft_name: member.tle.name,
            event_count:     res.event_count,
            worst_risk:      risk,
            worst_score:     score,
            events:          res.events,
          })

          const trackRes = await api.orbitTrack(member.tle, 2, 60)
          setFleetOrbitTrack(member.id, trackRes.points)
        } catch {
          results.push({
            spacecraft_name: member.tle.name,
            event_count:     0,
            worst_risk:      'UNKNOWN' as RiskLevel,
            worst_score:     0,
            events:          [],
          })
        }
      }

      const totalEvents   = results.reduce((n, r) => n + r.event_count, 0)
      const criticalCount = results.filter(r => r.worst_risk === 'CRITICAL').length

      setScanResult({
        fleet_size:     results.length,
        total_events:   totalEvents,
        critical_count: criticalCount,
        results,
        scanned_at:     new Date().toISOString(),
      })
    } catch (e) {
      setScanError((e as Error).message)
    } finally {
      setFleetLoading(false)
    }
  }

  // ── Auto-refresh polling ─────────────────────────────────────
  useEffect(() => {
    // Clear any existing timers
    if (pollRef.current)      clearInterval(pollRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    if (pollInterval === 0) {
      setNextScanIn(0)
      return
    }

    const intervalMs = pollInterval * 60 * 1000
    setNextScanIn(pollInterval * 60)

    // Countdown ticker (every second)
    countdownRef.current = setInterval(() => {
      setNextScanIn(s => (s > 0 ? s - 1 : 0))
    }, 1000)

    // Main scan trigger
    pollRef.current = setInterval(() => {
      handleFleetScan()
      setNextScanIn(pollInterval * 60)
    }, intervalMs)

    return () => {
      if (pollRef.current)      clearInterval(pollRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [pollInterval])

  if (collapsed) {
    return (
      <div style={{
        width: '44px',
        minWidth: '44px',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '10px',
        gap: '8px',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand Fleet Status panel"
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--muted)',
            fontSize: '12px',
            padding: '6px 8px',
            cursor: 'pointer',
          }}
        >
          ◀
        </button>
        <span style={{ fontSize: '16px' }}>🔍</span>
        {scanResult && scanResult.critical_count > 0 && (
          <span style={{
            background: '#dc2626',
            color: '#fff',
            borderRadius: '999px',
            width: 18, height: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 700,
          }}>
            {scanResult.critical_count}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: '320px',
      minWidth: '320px',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleFleetScan}
          disabled={fleetLoading}
          style={{
            flex: 1,
            padding: '8px',
            background: fleetLoading ? 'var(--surface2)' : '#1d4ed8',
            border: 'none',
            borderRadius: '5px',
            color: '#fff',
            fontWeight: 700,
            fontSize: '12px',
            cursor: fleetLoading ? 'not-allowed' : 'pointer',
            opacity: fleetLoading ? 0.7 : 1,
          }}
        >
          {fleetLoading ? '⏳ Scanning fleet…' : '🔍 Scan Entire Fleet'}
        </button>

        {/* Auto-refresh selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
          <select
            value={pollInterval}
            onChange={e => setPollInterval(Number(e.target.value))}
            title="Auto-refresh interval"
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '4px', color: pollInterval > 0 ? '#22c55e' : 'var(--muted)',
              fontSize: '11px', padding: '6px 4px', cursor: 'pointer',
            }}
          >
            {POLL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>🔄 {o.label}</option>
            ))}
          </select>
          {pollInterval > 0 && nextScanIn > 0 && (
            <span style={{ fontSize: '9px', color: '#22c55e', fontFamily: 'monospace' }}>
              next {Math.floor(nextScanIn / 60)}:{String(nextScanIn % 60).padStart(2,'0')}
            </span>
          )}
        </div>
        <button
          onClick={() => exportFleetCSV(fleet)}
          style={{
            padding: '8px 14px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '5px',
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          📄 Export CSV
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse Fleet Status panel"
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--muted)',
            fontSize: '11px',
            padding: '8px',
            cursor: 'pointer',
          }}
        >
          ▶
        </button>
      </div>

      {scanError && (
        <div style={{ fontSize: '11px', color: '#f87171' }}>{scanError}</div>
      )}

      {scanResult && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '6px',
        }}>
          {[
            { label: 'Scanned',  value: scanResult.fleet_size    },
            { label: 'Events',   value: scanResult.total_events  },
            { label: 'Critical', value: scanResult.critical_count, red: true },
          ].map(({ label, value, red }) => (
            <div key={label} style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '5px',
              padding: '6px 8px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: red && value > 0 ? '#dc2626' : 'var(--text)' }}>
                {value}
              </div>
              <div style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        onClick={() => setShowResults(s => !s)}
        style={{
          fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '0.06em', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>Fleet Status</span>
        <span>{showResults ? '▲' : '▼'}</span>
      </div>

      {showResults && fleet.map(member => {
        const result = scanResult?.results.find(r => r.spacecraft_name === member.tle.name)
        return (
          <div
            key={member.id}
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '10px 12px',
              borderLeft: `3px solid ${member.colour}`,
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: member.colour,
                  boxShadow: `0 0 5px ${member.colour}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 700, fontSize: '12px' }}>{member.tle.name}</span>
              </div>
              <RiskBadge level={member.risk_level} score={member.risk_score > 0 ? member.risk_score : undefined} size="sm" />
            </div>

            <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--muted)', flexWrap: 'wrap' }}>
              {member.live_frame && (
                <>
                  <span>ALT <b style={{ color: 'var(--text)' }}>{member.live_frame.altitude_km.toFixed(0)} km</b></span>
                  <span>SPD <b style={{ color: 'var(--text)' }}>{member.live_frame.speed_kms.toFixed(2)} km/s</b></span>
                  <span>LAT <b style={{ color: 'var(--text)' }}>{member.live_frame.latitude_deg.toFixed(1)}°</b></span>
                </>
              )}
              {result && (
                <span>{result.event_count} conjunction{result.event_count !== 1 ? 's' : ''} detected</span>
              )}
              {!member.live_frame && !result && (
                <span>Not yet scanned</span>
              )}
            </div>

            {member.events.length > 0 && (
              <div style={{
                marginTop: '6px',
                padding: '5px 8px',
                background: 'var(--surface)',
                borderRadius: '4px',
                fontSize: '10px',
                color: 'var(--muted)',
              }}>
                Top threat: <b style={{ color: 'var(--text)' }}>{member.events[0].debris_name}</b>
                {' '}— miss {member.events[0].miss_distance_km.toFixed(2)} km
                {' '}in {member.events[0].hours_to_tca.toFixed(1)} h
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}