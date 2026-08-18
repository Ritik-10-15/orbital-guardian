// ============================================================
// src/components/OrbitScrubber.tsx
// Time-scrubber bar beneath the globe — drag to animate the
// spacecraft dot along its pre-propagated orbit track
// ============================================================

import React, { useCallback, useEffect } from 'react'
import { useStore } from '../store/useStore'

export function OrbitScrubber() {
  const {
    fleet, activeFleetId,
    scrubberIndex, scrubberActive,
    setScrubberIndex, setScrubberActive,
    orbitPoints,
  } = useStore()

  const activeMember = fleet.find(m => m.id === activeFleetId)
  const points = activeMember?.orbit_points ?? orbitPoints

  if (points.length < 2) return null

  const max = points.length - 1
  const current = points[scrubberIndex] ?? points[0]

  // Format the epoch string nicely
  const epochStr = current.epoch
    ? new Date(current.epoch).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : ''

  // Auto-advance when not being dragged (one step every 250ms)
  useEffect(() => {
    if (scrubberActive) return
    const id = setInterval(() => {
      setScrubberIndex((scrubberIndex + 1) % (max + 1))
    }, 250)
    return () => clearInterval(id)
  }, [scrubberActive, scrubberIndex, max])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScrubberIndex(parseInt(e.target.value))
  }, [setScrubberIndex])

  return (
    <div style={{
      position: 'absolute',
      bottom: '14px',
      left: '14px',
      right: '14px',
      background: 'rgba(10,14,26,0.88)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 14px',
      zIndex: 10,
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    }}>
      {/* Play/Pause button */}
      <button
        onClick={() => setScrubberActive(!scrubberActive)}
        title={scrubberActive ? 'Resume playback' : 'Pause playback'}
        style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          color: 'var(--text)',
          fontSize: '14px',
          padding: '3px 8px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {scrubberActive ? '▶' : '⏸'}
      </button>

      {/* Label */}
      <span style={{ fontSize: '10px', color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        Orbit Playback
      </span>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={max}
        value={scrubberIndex}
        onChange={handleChange}
        onMouseDown={() => setScrubberActive(true)}
        onMouseUp={() => setScrubberActive(false)}
        onTouchStart={() => setScrubberActive(true)}
        onTouchEnd={() => setScrubberActive(false)}
        style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
      />

      {/* Current time + altitude */}
      <div style={{ display: 'flex', gap: '12px', flexShrink: 0, fontSize: '11px' }}>
        <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>
          {epochStr}
        </span>
        <span style={{ color: 'var(--muted)' }}>
          ALT <b style={{ color: 'var(--text)' }}>{current.altitude_km.toFixed(0)} km</b>
        </span>
        <span style={{ color: 'var(--muted)' }}>
          {Math.round(scrubberIndex / max * 100)}%
        </span>
      </div>

      {/* Reset */}
      <button
        onClick={() => { setScrubberIndex(0); setScrubberActive(false) }}
        title="Reset to start"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--muted)',
          fontSize: '12px',
          cursor: 'pointer',
          flexShrink: 0,
          padding: '3px',
        }}
      >
        ⏮
      </button>
    </div>
  )
}
