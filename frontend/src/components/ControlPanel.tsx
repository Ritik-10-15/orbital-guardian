// ============================================================
// src/components/ControlPanel.tsx
// Option B upgrade — catalog source selector + Space-Track support
// Rendered as the "Scan Setup" panel of the dashboard grid
// ============================================================
import React, { useEffect, useState } from 'react'
import { ScanSearch } from 'lucide-react'
import { PanelHeader } from './PanelHeader'
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

  // Follow the spacecraft selected in the fleet list
  useEffect(() => {
    setName(spacecraft.name)
    setLine1(spacecraft.line1)
    setLine2(spacecraft.line2)
  }, [spacecraft])

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
    borderRadius: '6px',
    color: 'var(--text)',
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: 'monospace',
    width: '100%',
    outline: 'none',
  }

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    padding: '9px 14px',
    border: primary ? 'none' : '1px solid var(--border)',
    borderRadius: '6px',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontSize: '12px',
    background: primary ? 'var(--accent-strong)' : 'var(--surface2)',
    color: primary ? '#fff' : 'var(--text)',
    opacity: loading ? 0.6 : 1,
    whiteSpace: 'nowrap' as const,
  })

  const selectedOption = CATALOG_OPTIONS.find(o => o.value === catalog)!

  return (
    <section id="scan" className="panel area-scan">
      <PanelHeader icon={ScanSearch} title="Scan Setup" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* TLE inputs */}
        <Field label="Spacecraft name">
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="TLE line 1">
          <input style={inputStyle} value={line1} onChange={e => setLine1(e.target.value)} maxLength={69} />
        </Field>
        <Field label="TLE line 2">
          <input style={inputStyle} value={line2} onChange={e => setLine2(e.target.value)} maxLength={69} />
        </Field>

        {/* Catalog source selector */}
        <Field label="Debris catalog" hint={selectedOption.desc}>
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
        </Field>

        {/* Object limit slider */}
        <Field label={<>Objects screened: <span style={{ color: 'var(--accent)' }}>{limit}</span></>} hint="More objects = slower scan">
          <input
            type="range"
            min={5}
            max={catalog.startsWith('spacetrack') ? 500 : 200}
            step={5}
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value))}
            style={{ accentColor: 'var(--accent)', width: '100%' }}
          />
        </Field>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '4px' }}>
          <button style={btnStyle(true)} onClick={handleScan} disabled={loading}>
            {loading ? '⏳ Scanning…' : '🔍 Scan Conjunctions'}
          </button>
          <button style={btnStyle(false)} onClick={handleLoadOrbit} disabled={loading}>
            🌐 Load Orbit
          </button>
        </div>
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span className="section-label">{label}</span>
      {children}
      {hint && <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{hint}</span>}
    </label>
  )
}
