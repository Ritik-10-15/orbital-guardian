// ============================================================
// src/App.tsx
// Mission-control shell: Sidebar | TopBar + dashboard panel grid
// Option E: CRITICAL blink + sound alert
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { useLiveFeed }     from './hooks/useLiveFeed'
import { Sidebar }         from './components/Sidebar'
import type { SectionId }  from './components/Sidebar'
import { TopBar }          from './components/TopBar'
import { SpacecraftHero }  from './components/SpacecraftHero'
import { TelemetryPanel }  from './components/TelemetryPanel'
import { Globe }           from './components/Globe'
import { AlertDashboard }  from './components/AlertDashboard'
import { ControlPanel }    from './components/ControlPanel'
import { HeatmapPanel }    from './components/HeatmapPanel'
import { FleetManager }    from './components/FleetManager'
import { FleetPanel }      from './components/FleetPanel'
import { TCAOverlay }      from './components/TCAOverlay'
import { OrbitScrubber }   from './components/OrbitScrubber'
import { MissionLog }      from './components/MissionLog'
import { PassPredictor }   from './components/PassPredictor'

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

// ── Hook: which dashboard section the user is looking at ──────
// Sections that share a grid row tie on position; the last one the
// user navigated to keeps the highlight, otherwise the first wins.
const SECTION_ORDER: SectionId[] = ['hero', 'fleet', 'globe', 'scan', 'alerts', 'passes', 'status', 'log']

function useActiveSection(scrollRef: React.RefObject<HTMLElement>) {
  const [active, setActive] = useState<SectionId>('hero')
  const activeRef = useRef<SectionId>('hero')
  const suppressUntil = useRef(0)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function onScroll() {
      if (!container || Date.now() < suppressUntil.current) return
      const containerTop = container.getBoundingClientRect().top
      let bestTop = -Infinity
      let candidates: SectionId[] = []
      for (const id of SECTION_ORDER) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = Math.round(el.getBoundingClientRect().top - containerTop)
        if (top > 120) continue
        if (top > bestTop) { bestTop = top; candidates = [id] }
        else if (top === bestTop) candidates.push(id)
      }
      const next = candidates.includes(activeRef.current) ? activeRef.current : (candidates[0] ?? 'hero')
      activeRef.current = next
      setActive(next)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  const navigate = useCallback((id: SectionId) => {
    activeRef.current = id
    setActive(id)
    suppressUntil.current = Date.now() + 800
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return { active, navigate }
}

const LEGEND = [
  { colour: '#facc15', label: 'Spacecraft' },
  { colour: '#3b82f6', label: 'Orbit track' },
  { colour: '#dc2626', label: 'Critical debris' },
  { colour: '#ea580c', label: 'High debris' },
  { colour: '#ca8a04', label: 'Moderate debris' },
]

export default function App() {
  const hasCritical = useCriticalAlert()
  const connected = useLiveFeed()
  const fleet = useStore(state => state.fleet)
  const persistenceLoading = useStore(state => state.persistenceLoading)
  const persistenceReady = useStore(state => state.persistenceReady)
  const persistenceError = useStore(state => state.persistenceError)
  const hydratePersistentState = useStore(state => state.hydratePersistentState)
  const clearPersistenceError = useStore(state => state.clearPersistenceError)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
    } catch {
      return 'dark'
    }
  })
  const scrollRef = useRef<HTMLElement>(null)
  const { active, navigate } = useActiveSection(scrollRef)

  const alertCount = fleet.reduce(
    (n, m) => n + m.events.filter(ev => ev.risk_level === 'CRITICAL' || ev.risk_level === 'HIGH').length,
    0,
  )

  useEffect(() => {
    void hydratePersistentState()
  }, [hydratePersistentState])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* storage unavailable */ }
  }, [theme])

  return (
    <div className="app-shell">
      <Sidebar active={active} alertCount={alertCount} connected={connected} onNavigate={navigate} />

      <div className="app-main">
        <TopBar
          connected={connected}
          hasCritical={hasCritical}
          alertCount={alertCount}
          theme={theme}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          onOpenAlerts={() => navigate('alerts')}
        />

        {(persistenceLoading || persistenceError) && (
          <div role="status" style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '7px 20px', background: persistenceError ? '#7f1d1d' : '#0c4a6e',
            color: '#fff', fontSize: '11px', flexShrink: 0,
          }}>
            <span style={{ flex: 1 }}>
              {persistenceError ?? 'Loading fleet and operator history from the database…'}
            </span>
            {persistenceError && !persistenceReady && (
              <button onClick={() => { void hydratePersistentState() }} style={{ cursor: 'pointer' }}>Retry</button>
            )}
            {persistenceError && persistenceReady && (
              <button onClick={clearPersistenceError} style={{ cursor: 'pointer' }}>Dismiss</button>
            )}
          </div>
        )}

        <main className="app-scroll" ref={scrollRef}>
          <div className="dashboard">
            <SpacecraftHero />
            <TelemetryPanel connected={connected} />
            <FleetManager />

            {/* 3D globe with its overlays; always dark so overlays stay legible */}
            <section id="globe" className="panel area-globe" data-theme="dark" style={{ display: 'block' }} aria-label="3D tracking globe">
              <Globe />
              <TCAOverlay />
              <OrbitScrubber />
              <HeatmapPanel />

              <div style={{
                position: 'absolute',
                top: '14px',
                left: '14px',
                background: 'var(--overlay)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '11px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                backdropFilter: 'blur(6px)',
              }}>
                {LEGEND.map(({ colour, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
                    <span style={{ color: 'var(--muted)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </section>

            <ControlPanel />
            <AlertDashboard />
            <PassPredictor />
            <FleetPanel />
            <MissionLog />
          </div>
        </main>
      </div>
    </div>
  )
}
