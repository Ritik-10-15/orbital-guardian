// ============================================================
// src/components/FleetPanel.tsx
// Option F — Fleet overview table + fleet-wide scan
// ============================================================

import React, { useState } from 'react'
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

export function FleetPanel() {
  const {
    fleet, setFleetLoading, setFleetEvents, fleetLoading,
    setFleetOrbitTrack,
  } = useStore()

  const [scanResult, setScanResult] = useState<FleetScanResponse | null>(null)
  const [scanError,  setScanError]  = useState<string | null>(null)
  const [showResults, setShowResults] = useState(true)

  async function handleFleetScan() {
    setFleetLoading(true)
    setScanError(null)
    setScanResult(null)

    try {
      const catalogRes = await fetch('/api/catalog/celestrak?category=stations&limit=30')
      const catalog    = await catalogRes.json()
      const debris     = catalog.objects ?? []

      const results = []
      for (const member of fleet) {
        if (!member.active) continue
        try {
          const res = await api.conjunctions(member.tle, debris, 72, 5)
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

  return (
    <div style={{
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      flex: 1,
      overflowY: 'auto',
    }}>
      <button
        onClick={handleFleetScan}
        disabled={fleetLoading}
        style={{
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