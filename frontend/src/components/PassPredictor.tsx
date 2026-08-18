// ============================================================
// src/components/PassPredictor.tsx
// Ground station satellite pass predictor
// Shows AOS / LOS / max elevation for the next N passes
// ============================================================

import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import type { GroundStation, SatPass } from '../types'

// ── Preset ground stations ────────────────────────────────────
const PRESET_STATIONS: GroundStation[] = [
  { id: 'houston',    name: 'Houston (JSC)',       lat:  29.559, lon:  -95.093, minEl: 5 },
  { id: 'baikonur',   name: 'Baikonur Cosmodrome', lat:  45.920, lon:   63.342, minEl: 5 },
  { id: 'kourou',     name: 'Kourou (ESA)',         lat:   5.232, lon:  -52.769, minEl: 5 },
  { id: 'svalbard',   name: 'Svalbard (KSAT)',      lat:  78.229, lon:   15.408, minEl: 5 },
  { id: 'madrid',     name: 'Madrid DSN',           lat:  40.429, lon:   -4.249, minEl: 5 },
  { id: 'canberra',   name: 'Canberra DSN',         lat: -35.401, lon:  148.982, minEl: 5 },
  { id: 'goldstone',  name: 'Goldstone DSN',        lat:  35.426, lon: -116.890, minEl: 5 },
]

interface PassResult {
  spacecraft: string
  station_name: string
  station_lat: number
  station_lon: number
  passes: SatPass[]
  computed_at: string
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}m ${String(sec).padStart(2,'0')}s`
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19) + ' UTC'
}

function PassRow({ pass, i }: { pass: SatPass; i: number }) {
  const [expanded, setExpanded] = useState(false)
  const isHighEl = pass.max_el >= 60
  const isMedEl  = pass.max_el >= 20

  const elColour = isHighEl ? '#22c55e' : isMedEl ? '#facc15' : '#6b7280'

  return (
    <div style={{ borderBottom: '1px solid var(--border)', fontSize: '11px' }}>
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Pass number */}
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: 'var(--surface2)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', color: 'var(--muted)', flexShrink: 0,
        }}>{i + 1}</span>

        {/* AOS time */}
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '10px' }}>
          {formatTime(pass.aos).slice(0, 16)}
        </span>

        {/* Max elevation */}
        <span style={{
          fontWeight: 700, fontSize: '12px',
          color: elColour, flexShrink: 0,
        }}>
          {pass.max_el.toFixed(1)}°
        </span>

        {/* Duration */}
        <span style={{ color: 'var(--muted)', fontSize: '10px', flexShrink: 0 }}>
          {formatDuration(pass.duration_s)}
        </span>

        <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {[
            ['AOS',        formatTime(pass.aos)],
            ['LOS',        formatTime(pass.los)],
            ['Max El',     `${pass.max_el.toFixed(1)}°`],
            ['Max El At',  formatTime(pass.max_el_at)],
            ['Duration',   formatDuration(pass.duration_s)],
            ['Quality',    isHighEl ? '⭐ Excellent' : isMedEl ? '✓ Good' : '~ Marginal'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'var(--surface)', borderRadius: '4px', padding: '5px 8px' }}>
              <div style={{ color: 'var(--muted)', fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px' }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PassPredictor() {
  const { fleet, activeFleetId } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  const activeMember = fleet.find(m => m.id === activeFleetId) ?? fleet[0]

  const [stationId,    setStationId]    = useState('houston')
  const [customLat,    setCustomLat]    = useState('')
  const [customLon,    setCustomLon]    = useState('')
  const [customName,   setCustomName]   = useState('')
  const [minEl,        setMinEl]        = useState(5)
  const [lookahead,    setLookahead]    = useState(24)
  const [useCustom,    setUseCustom]    = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState<PassResult | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  const station = useCustom
    ? { name: customName || 'Custom', lat: parseFloat(customLat) || 0, lon: parseFloat(customLon) || 0 }
    : PRESET_STATIONS.find(s => s.id === stationId) ?? PRESET_STATIONS[0]

  async function predict() {
    if (!activeMember) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/passes/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spacecraft:        activeMember.tle,
          station_lat:       station.lat,
          station_lon:       station.lon,
          station_name:      station.name,
          min_elevation_deg: minEl,
          lookahead_hours:   lookahead,
          step_seconds:      30,
        }),
      })
      if (!res.ok) throw new Error(`Pass prediction failed: ${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '4px', color: 'var(--text)', padding: '4px 6px',
    fontSize: '11px', width: '100%', outline: 'none',
  }

  if (collapsed) {
    return (
      <div style={{
        width: '44px', minWidth: '44px',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: '10px', gap: '8px',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand Pass Predictor"
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: '4px', color: 'var(--muted)', fontSize: '12px',
            padding: '6px 8px', cursor: 'pointer',
          }}
        >◀</button>
        <span style={{ fontSize: '16px' }}>📡</span>
        {result && result.passes.length > 0 && (
          <span style={{
            background: '#1d4ed8', color: '#fff', borderRadius: '999px',
            width: 18, height: 18, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '10px', fontWeight: 700,
          }}>{result.passes.length}</span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: '290px', minWidth: '290px',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '8px',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>📡 Pass Predictor</span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: '4px', color: 'var(--muted)', fontSize: '11px',
            padding: '3px 8px', cursor: 'pointer',
          }}
        >▶</button>
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Spacecraft indicator */}
        <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
          Spacecraft: <b style={{ color: 'var(--text)' }}>{activeMember?.tle.name ?? 'None'}</b>
        </div>

        {/* Station preset / custom toggle */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <label style={{ fontSize: '10px', color: 'var(--muted)', flexShrink: 0 }}>Station</label>
          <button
            onClick={() => setUseCustom(false)}
            style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: !useCustom ? 'var(--accent)' : 'var(--surface2)',
              color: !useCustom ? '#fff' : 'var(--muted)',
            }}
          >Preset</button>
          <button
            onClick={() => setUseCustom(true)}
            style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: useCustom ? 'var(--accent)' : 'var(--surface2)',
              color: useCustom ? '#fff' : 'var(--muted)',
            }}
          >Custom</button>
        </div>

        {!useCustom ? (
          <select value={stationId} onChange={e => setStationId(e.target.value)} style={{ ...inputStyle, fontFamily: 'inherit' }}>
            {PRESET_STATIONS.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.lat.toFixed(1)}°, {s.lon.toFixed(1)}°)</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <input style={inputStyle} placeholder="Station name" value={customName} onChange={e => setCustomName(e.target.value)} />
            <div style={{ display: 'flex', gap: '4px' }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Lat (°)" type="number" min="-90" max="90" value={customLat} onChange={e => setCustomLat(e.target.value)} />
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Lon (°)" type="number" min="-180" max="180" value={customLon} onChange={e => setCustomLon(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '9px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>
              Min Elevation: <b style={{ color: 'var(--accent)' }}>{minEl}°</b>
            </label>
            <input type="range" min={0} max={30} step={1} value={minEl} onChange={e => setMinEl(+e.target.value)}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '9px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>
              Lookahead: <b style={{ color: 'var(--accent)' }}>{lookahead}h</b>
            </label>
            <input type="range" min={1} max={72} step={1} value={lookahead} onChange={e => setLookahead(+e.target.value)}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>
        </div>

        <button
          onClick={predict}
          disabled={loading || !activeMember}
          style={{
            padding: '7px', background: loading ? 'var(--surface2)' : 'var(--accent)',
            border: 'none', borderRadius: '5px', color: '#fff', fontWeight: 700,
            fontSize: '12px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '⏳ Computing…' : '📡 Predict Passes'}
        </button>

        {error && <div style={{ fontSize: '10px', color: '#f87171' }}>{error}</div>}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {result ? (
          <>
            {/* Summary bar */}
            <div style={{
              padding: '8px 14px',
              background: 'var(--surface2)',
              borderBottom: '1px solid var(--border)',
              fontSize: '11px',
              display: 'flex', gap: '12px', alignItems: 'center',
            }}>
              <span style={{ flex: 1 }}>{result.station_name}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{result.passes.length} passes</span>
              <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{lookahead}h window</span>
            </div>

            {result.passes.length === 0 ? (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📡</div>
                No passes above {minEl}° in next {lookahead} h
              </div>
            ) : (
              result.passes.map((p, i) => <PassRow key={i} pass={p} i={i} />)
            )}
          </>
        ) : (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>📡</div>
            Select a ground station and click<br />
            <b>Predict Passes</b> to find contact windows.
          </div>
        )}
      </div>
    </div>
  )
}
