// ============================================================
// src/components/TCAOverlay.tsx
// Globe overlay: live countdown to the nearest active conjunction
// Shows the worst-risk event across all fleet members
// ============================================================

import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ConjunctionEvent } from '../types'
import { RISK_COLOURS } from '../types'

function useCountdown(tcaIso: string) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    function tick() {
      const diff = new Date(tcaIso).getTime() - Date.now()
      if (diff <= 0) { setRemaining('T+PASSED'); return }
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setRemaining(
        `T-${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tcaIso])
  return remaining
}

function TCACountdown({ ev }: { ev: ConjunctionEvent }) {
  const countdown = useCountdown(ev.tca)
  const colour = RISK_COLOURS[ev.risk_level]
  const isCritical = ev.risk_level === 'CRITICAL' || ev.risk_level === 'HIGH'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '2px',
    }}>
      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Next Conjunction
      </div>
      <div style={{
        fontSize: '10px',
        color: 'rgba(255,255,255,0.7)',
        maxWidth: '150px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {ev.debris_name}
      </div>
      <div style={{
        fontFamily: 'monospace',
        fontWeight: 800,
        fontSize: '20px',
        color: colour,
        letterSpacing: '0.08em',
        animation: isCritical ? 'criticalPulseDot 1s infinite' : undefined,
      }}>
        {countdown}
      </div>
      <div style={{
        fontSize: '9px',
        padding: '2px 8px',
        borderRadius: '999px',
        background: colour + '33',
        border: `1px solid ${colour}`,
        color: colour,
        fontWeight: 700,
        letterSpacing: '0.05em',
      }}>
        {ev.risk_level} · {ev.miss_distance_km.toFixed(2)} km miss
      </div>
    </div>
  )
}

export function TCAOverlay() {
  const { fleet } = useStore()

  // Find the highest-risk, soonest event across all active fleet members
  const allEvents = fleet.filter(m => m.active).flatMap(m => m.events)
  if (allEvents.length === 0) return null

  const riskOrder = ['CRITICAL','HIGH','MODERATE','LOW','NEGLIGIBLE','UNKNOWN']
  const worst = allEvents.slice().sort((a, b) => {
    const ra = riskOrder.indexOf(a.risk_level)
    const rb = riskOrder.indexOf(b.risk_level)
    if (ra !== rb) return ra - rb
    return a.hours_to_tca - b.hours_to_tca
  })[0]

  return (
    <div style={{
      position: 'absolute',
      top: '14px',
      right: '14px',
      background: 'rgba(10,14,26,0.88)',
      border: `1px solid ${RISK_COLOURS[worst.risk_level]}55`,
      borderRadius: '8px',
      padding: '10px 14px',
      zIndex: 10,
      backdropFilter: 'blur(6px)',
    }}>
      <TCACountdown ev={worst} />
    </div>
  )
}
