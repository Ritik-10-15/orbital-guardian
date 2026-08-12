// ============================================================
// src/components/HeatmapPanel.tsx
// Option B — Debris density heatmap by orbital altitude shell
// ============================================================

import React, { useEffect, useState } from 'react'

interface DensityBand {
  label:        string
  min_alt_km:   number
  max_alt_km:   number
  object_count: number
  risk_index:   number
}

interface HeatmapData {
  bands:         DensityBand[]
  total_objects: number
  generated_at:  string
}

function riskColour(idx: number): string {
  if (idx >= 80) return '#dc2626'
  if (idx >= 60) return '#ea580c'
  if (idx >= 35) return '#ca8a04'
  if (idx >= 10) return '#16a34a'
  return '#2563eb'
}

export function HeatmapPanel() {
  const [data,    setData]    = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/catalog/heatmap?category=stations')
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    finally  { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{
      position: 'absolute',
      bottom: '70px',
      left: '14px',
      background: 'rgba(10,14,26,0.92)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      width: '220px',
      zIndex: 10,
    }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'none',
          border: 'none',
          color: 'var(--text)',
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>📊 Debris Density</span>
        <span style={{ color: 'var(--muted)', fontSize: '10px' }}>
          {data ? `${data.total_objects} objects` : '—'}
          {'  '}{open ? '▲' : '▼'}
        </span>
      </button>

      {/* Heatmap bars */}
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          {loading && (
            <div style={{ color: 'var(--muted)', fontSize: '11px', padding: '6px 0' }}>
              Loading…
            </div>
          )}
          {data?.bands.map(band => (
            <div key={band.label} style={{ marginBottom: '6px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '10px',
                color: 'var(--muted)',
                marginBottom: '2px',
              }}>
                <span>{band.label}</span>
                <span style={{ color: riskColour(band.risk_index), fontFamily: 'monospace' }}>
                  {band.object_count}
                </span>
              </div>
              <div style={{
                height: '5px',
                background: 'var(--surface2)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${band.risk_index}%`,
                  height: '100%',
                  background: riskColour(band.risk_index),
                  borderRadius: '3px',
                  transition: 'width 0.6s ease',
                }} />
              </div>
            </div>
          ))}
          <button
            onClick={load}
            style={{
              marginTop: '6px',
              width: '100%',
              padding: '4px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--muted)',
              fontSize: '10px',
              cursor: 'pointer',
            }}
          >
            ↻ Refresh
          </button>
        </div>
      )}
    </div>
  )
}
