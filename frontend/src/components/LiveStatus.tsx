// ============================================================
// src/components/LiveStatus.tsx
// Top status bar — spacecraft name, live altitude, speed, UTC
// ============================================================

import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { createLiveSocket } from '../api/client'
import type { LiveFrame } from '../types'

export function LiveStatus() {
  const { spacecraft, setLiveFrame, liveFrame, activeFleetId, setFleetLiveFrame } = useStore()
  const [connected, setConnected] = useState(false)
  const [utc, setUtc] = useState(new Date().toISOString())

  // ── Clock tick ────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setUtc(new Date().toISOString()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── WebSocket live feed ───────────────────────────────────
  useEffect(() => {
    const ws = createLiveSocket(
      spacecraft,
      5,
      (frame) => {
        setLiveFrame(frame as LiveFrame)
        setFleetLiveFrame(activeFleetId, frame as LiveFrame)
        setConnected(true)
      },
      () => setConnected(false)
    )
    ws.onclose = () => setConnected(false)
    return () => ws.close()
  }, [spacecraft, setLiveFrame])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '24px',
      padding: '8px 20px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      fontSize: '12px',
      flexWrap: 'wrap',
    }}>
      {/* Connection dot */}
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? '#22c55e' : '#6b7280',
          boxShadow: connected ? '0 0 6px #22c55e' : 'none',
        }} />
        <span style={{ color: connected ? '#22c55e' : 'var(--muted)', fontWeight: 600 }}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      </span>

      {/* Spacecraft name */}
      <span style={{ color: 'var(--text)', fontWeight: 700 }}>
        🛰 {spacecraft.name}
      </span>

      {/* Live telemetry */}
      {liveFrame && (
        <>
          <Stat label="ALT" value={`${liveFrame.altitude_km.toFixed(1)} km`} />
          <Stat label="SPD" value={`${liveFrame.speed_kms.toFixed(2)} km/s`} />
          <Stat label="LAT" value={`${liveFrame.latitude_deg.toFixed(2)}°`} />
          <Stat label="LON" value={`${liveFrame.longitude_deg.toFixed(2)}°`} />
        </>
      )}

      {/* UTC clock — pushed to right */}
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontFamily: 'monospace' }}>
        {utc.replace('T', ' ').slice(0, 19)} UTC
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'flex', gap: '4px' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600 }}>
        {value}
      </span>
    </span>
  )
}
