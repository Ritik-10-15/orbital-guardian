// ============================================================
// src/components/ControlPanel.tsx
// Option B upgrade — catalog source selector + Space-Track support
// ======
import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { api } from '../api/client'

type CatalogSource = 'celestrak-stations' | 'celestrak-active' | 'celestrak-starlink' | 'spacetrack-debris' | 'spacetrack-all' | 'demo-debris'

const CATALOG_OPTIONS: { value: CatalogSource; label: string; desc: string }[] = [
  { value: 'demo-debris',         label: '🎯 Demo Debris (Guaranteed)', desc: 'Synthetic near-misses for reliable demo' },
  { value: 'celestrak-stations',  label: 'CelesTrak — Stations',   desc: 'ISS, CSS + crewed vehicles (~30)' },
  { value: 'celestrak-active',    label: 'CelesTrak — Active',      desc: 'All active satellites (~6000)' },
  { value: 'celestrak-starlink',  label: 'CelesTrak — Starlink',    desc: 'Starlink constellation (~6000)' },
  { value: 'spacetrack-debris',   label: 'Space-Track — Debris ★',  desc: 'LEO debris catalog (needs account)' },
  { value: 'spacetrack-all',      label: 'Space-Track — All LEO ★', desc: 'Full LEO catalog (needs account)' },
]


export function ControlPanel() {
  const {
    spacecraft, setSpacecraft,
    setOrbitPoints, setEvents,
    setLoading, setError, loading,
    activeFleetId, setFleetOrbitTrack, setFleetEvents,
  } = useStore()

  const [name,    setName]    = useState(spacecraft.name)
  const [line1,   setLine1]   = useState(spacecraft.line1)
  const [line2,   setLine2]   = useState(spacecraft.line2)
  const { catalogSource: catalog, setCatalogSource: setCatalog } = useStore()
  const [limit,   setLimit]   = useState(30)
  const [stConfigured, setStConfigured] = useState(false)

  // Check if Space-Track is configured on mount
  useEffect(() => {
    fetch('/api/catalog/status')
      .then(r => r.json())
      .then(d => setStConfigured(d.spacetrack_configured))
      .catch(() => {})
  }, [])

  // ── Load orbit track ──────────────────────────────────────────
  async function handleLoadOrbit() {
    const tle = { name, line1, line2 }
    setSpacecraft(tle)
    setLoading(true)
    setError(null)
    try {
      const res = await api.orbitTrack(tle, 2, 60)
      setOrbitPoints(res.points)
      setFleetOrbitTrack(activeFleetId, res.points)  
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── Run conjunction scan ──────────────────────────────────────
 async function handleScan() {
    const tle = { name, line1, line2 }
    setSpacecraft(tle)
    setLoading(true)
    setError(null)
    try {
      let debrisTles: { name: string; line1: string; line2: string }[] = []

      if (catalog === 'demo-debris') {
        const params = new URLSearchParams({
          sc_name: tle.name,
          sc_line1: tle.line1,
          sc_line2: tle.line2,
          count: '5',
        })
        const res = await fetch(`/api/catalog/demo-debris?${params}`)
        if (!res.ok) throw new Error(`Demo debris generation failed: ${res.status}`)
        const data = await res.json()
        debrisTles = data.objects
      } else {
        const [source, subtype] = catalog.split('-') as ['celestrak' | 'spacetrack', string]

        if (source === 'spacetrack') {
          const res = await fetch(`/api/catalog/spacetrack?type=${subtype}&limit=${limit}`)
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.detail ?? `Space-Track error ${res.status}`)
          }
          const data = await res.json()
          debrisTles = data.objects.slice(0, limit)
        } else {
          const category = subtype
          const res = await fetch(`/api/catalog/celestrak?category=${category}&limit=${limit}`)
          if (!res.ok) throw new Error(`CelesTrak fetch failed: ${res.status}`)
          const data = await res.json()
          debrisTles = data.objects.slice(0, limit)
        }
      }
      const screenKm = catalog === 'demo-debris' ? 50 : 5
      const result = await api.conjunctions(tle, debrisTles, 72, screenKm)
      setEvents(result.events)
      const worst = result.events[0]?.risk_level ?? 'UNKNOWN'
      const worstScore = result.events[0]?.risk_score ?? 0
      setFleetEvents(activeFleetId, result.events, worst, worstScore)
    } catch (e) {
      const msg = (e as Error).message
      setError(
        msg.includes('credentials not configured')
          ? '⚙️ Space-Track not configured. Add SPACETRACK_USER + SPACETRACK_PASS to backend/.env'
          : msg.includes('abort') || msg.includes('AbortError')
          ? 'Request timed out. Make sure the backend is running.'
          : msg.includes('Failed to fetch') || msg.includes('fetch')
          ? 'Cannot reach backend. Start it: cd backend && python -m uvicorn api:app --port 8000'
          : msg
      )
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--text)',
    padding: '5px 8px',
    fontSize: '12px',
    fontFamily: 'monospace',
    width: '100%',
    outline: 'none',
  }

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    padding: '7px 16px',
    border: 'none',
    borderRadius: '4px',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontSize: '12px',
    background: primary ? 'var(--accent)' : 'var(--surface2)',
    color: primary ? '#fff' : 'var(--text)',
    opacity: loading ? 0.6 : 1,
    whiteSpace: 'nowrap' as const,
  })

  const selectedOption = CATALOG_OPTIONS.find(o => o.value === catalog)!

  return (
    <div style={{
      padding: '10px 16px',
      background: 'var(--surface)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-end',
      flexWrap: 'wrap',
    }}>
      {/* TLE inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 180px' }}>
        <label style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>Name</label>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 280px' }}>
        <label style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>TLE Line 1</label>
        <input style={inputStyle} value={line1} onChange={e => setLine1(e.target.value)} maxLength={69} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 280px' }}>
        <label style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>TLE Line 2</label>
        <input style={inputStyle} value={line2} onChange={e => setLine2(e.target.value)} maxLength={69} />
      </div>

      {/* Catalog source selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 200px' }}>
        <label style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>
          Catalog Source
        </label>
        <select
          value={catalog}
          onChange={e => setCatalog(e.target.value as CatalogSource)}
          style={{ ...inputStyle, fontFamily: 'inherit' }}
        >
          {CATALOG_OPTIONS.map(o => (
            <option
              key={o.value}
              value={o.value}
              disabled={o.value.startsWith('spacetrack') && !stConfigured}
            >
              {o.label}{o.value.startsWith('spacetrack') && !stConfigured ? ' (not configured)' : ''}
            </option>
          ))}
        </select>
        <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
          {selectedOption.desc}
        </span>
      </div>

      {/* Object limit slider */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 130px' }}>
        <label style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>
          Objects: <span style={{ color: 'var(--accent)' }}>{limit}</span>
        </label>
        <input
          type="range"
          min={5}
          max={catalog.startsWith('spacetrack') ? 500 : 200}
          step={5}
          value={limit}
          onChange={e => setLimit(parseInt(e.target.value))}
          style={{ accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
          More = slower scan
        </span>
      </div>

      {/* Action buttons */}
      <button style={btnStyle(false)} onClick={handleLoadOrbit} disabled={loading}>
        🌐 Load Orbit
      </button>
      <button style={btnStyle(true)} onClick={handleScan} disabled={loading}>
        {loading ? '⏳ Scanning…' : '🔍 Scan Conjunctions'}
      </button>
    </div>
  )
}
