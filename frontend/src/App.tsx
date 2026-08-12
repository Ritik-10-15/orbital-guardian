// ============================================================
// src/App.tsx
// Root layout: StatusBar → Globe + Dashboard → ControlPanel
// ============================================================

import React from 'react'
import { LiveStatus }      from './components/LiveStatus'
import { Globe }           from './components/Globe'
import { AlertDashboard }  from './components/AlertDashboard'
import { ControlPanel }    from './components/ControlPanel'
import { HeatmapPanel }    from './components/HeatmapPanel'
import { FleetManager }    from './components/FleetManager'
import { FleetPanel }      from './components/FleetPanel'
export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        height: '48px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        gap: '12px',
      }}>
        <span style={{ fontSize: '18px' }}>🛡️</span>
        <span style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '0.05em' }}>
          ORBITAL GUARDIAN
        </span>
        <span style={{
          fontSize: '10px',
          color: 'var(--muted)',
          fontWeight: 400,
          borderLeft: '1px solid var(--border)',
          paddingLeft: '12px',
          marginLeft: '4px',
        }}>
          Space Debris Conjunction & Risk Platform
        </span>
      </header>

      {/* ── Live telemetry bar ───────────────────────────────── */}
      <LiveStatus />

      {/* ── Main content ────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* 3D Globe — takes all remaining width */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Globe />

          {/* Heatmap panel — bottom left of globe */}
          <HeatmapPanel />

          {/* Legend overlay */}
          <div style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            background: 'rgba(10,14,26,0.85)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '10px 14px',
            fontSize: '11px',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
          }}>
            {[
              { colour: '#facc15', label: 'Spacecraft' },
              { colour: '#3b82f6', label: 'Orbit track' },
              { colour: '#dc2626', label: 'Critical debris' },
              { colour: '#ea580c', label: 'High debris' },
              { colour: '#ca8a04', label: 'Moderate debris' },
            ].map(({ colour, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
                <span style={{ color: 'var(--muted)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
         {/* Fleet manager — new sidebar */}
        <FleetManager />
        <FleetPanel />
        {/* Alert dashboard — fixed right panel */}
        <AlertDashboard />
      </div>

      {/* ── Bottom control panel ────────────────────────────── */}
      <ControlPanel />
    </div>
  )
}
