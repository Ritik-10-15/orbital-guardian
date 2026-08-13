// ============================================================
// src/App.tsx
// Root layout: StatusBar → Globe + Dashboard → ControlPanel
// Option E: Mission control header + CRITICAL blink + sound alert
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { LiveStatus }      from './components/LiveStatus'
import { Globe }           from './components/Globe'
import { AlertDashboard }  from './components/AlertDashboard'
import { ControlPanel }    from './components/ControlPanel'
import { HeatmapPanel }    from './components/HeatmapPanel'
import { FleetManager }    from './components/FleetManager'
import { FleetPanel }      from './components/FleetPanel'

// ── Beep sound (Web Audio API — no external file needed) ─────
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
    // Second beep for urgency
    setTimeout(() => {
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'square'
      osc2.frequency.value = 880
      gain2.gain.setValueAtTime(0.15, ctx.currentTime)
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start()
      osc2.stop(ctx.currentTime + 0.4)
    }, 220)
  } catch {
    // Audio not supported / blocked — fail silently
  }
}

// ── Hook: detect CRITICAL events and trigger sound on new ones ─
function useCriticalAlert() {
  const { fleet, events } = useStore()
  const seenKeys = useRef<Set<string>>(new Set())
  const [hasCritical, setHasCritical] = useState(false)

  useEffect(() => {
    // Gather all CRITICAL events across fleet members + legacy events
    const criticalKeys: string[] = []

    fleet.forEach(m => {
      m.events.forEach(ev => {
        if (ev.risk_level === 'CRITICAL') criticalKeys.push(`${m.id}__${ev.debris_name}__${ev.tca}`)
      })
    })
    events.forEach(ev => {
      if (ev.risk_level === 'CRITICAL') criticalKeys.push(`legacy__${ev.debris_name}__${ev.tca}`)
    })

    setHasCritical(criticalKeys.length > 0)

    // Play sound only for keys we haven't seen before
    const newOnes = criticalKeys.filter(k => !seenKeys.current.has(k))
    if (newOnes.length > 0) {
      playBeep()
      newOnes.forEach(k => seenKeys.current.add(k))
    }
  }, [fleet, events])

  return hasCritical
}

export default function App() {
   const hasCritical = useCriticalAlert()
   const [theme, setTheme] = useState<'dark' | 'light'>(() => {
     return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
   })

   useEffect(() => {
     document.documentElement.setAttribute('data-theme', theme)
     localStorage.setItem('theme', theme)
   }, [theme])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>

      {/* Blink keyframes — injected once */}
      <style>{`
        @keyframes criticalBlink {
          0%, 100% { background-color: #7f1d1d; }
          50%      { background-color: #dc2626; }
        }
        @keyframes criticalPulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        height: '48px',
        background: hasCritical ? undefined : 'var(--surface)',
        animation: hasCritical ? 'criticalBlink 1s infinite' : undefined,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        gap: '12px',
        transition: 'background-color 0.3s',
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

        {hasCritical && (
          <span style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0,0,0,0.25)',
            padding: '4px 12px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '0.05em',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#fff',
              animation: 'criticalPulseDot 1s infinite',
            }} />
            CRITICAL CONJUNCTION DETECTED
          </span>
        )}

        <button
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          style={{
            marginLeft: hasCritical ? '10px' : 'auto',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text)',
            fontSize: '13px',
            padding: '5px 10px',
            cursor: 'pointer',
          }}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
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