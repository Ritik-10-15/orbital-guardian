// ============================================================
// src/components/TopBar.tsx
// Mission Control header: feed status, UTC clock, alerts, theme
// ============================================================

import React from 'react'
import { Bell, Clock, MonitorDot, Moon, Sun } from 'lucide-react'
import { useUtcClock } from '../hooks/useLiveFeed'
import { PUBLIC_READ_ONLY } from '../config'

interface Props {
  connected: boolean
  hasCritical: boolean
  alertCount: number
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenAlerts: () => void
}

export function TopBar({ connected, hasCritical, alertCount, theme, onToggleTheme, onOpenAlerts }: Props) {
  const utc = useUtcClock()

  return (
    <header className="topbar" data-critical={hasCritical}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}>
        <MonitorDot size={18} color="var(--accent)" />
        <span>Mission <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Control</span></span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em' }}>
        <span className="status-dot" style={{
          background: connected ? 'var(--ok)' : 'var(--muted)',
          boxShadow: connected ? '0 0 8px var(--ok)' : 'none',
        }} />
        <span style={{ color: connected ? 'var(--ok)' : 'var(--muted)' }}>{connected ? 'LIVE' : 'OFFLINE'}</span>
      </span>

      <span className="topbar-optional mono" style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--muted)' }}>
        <Clock size={13} />
        UTC {utc}
      </span>

      {PUBLIC_READ_ONLY && <span className="chip">PUBLIC VIEW ONLY</span>}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {hasCritical && (
          <button
            onClick={onOpenAlerts}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.25)',
              padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 800, color: '#fff', letterSpacing: '0.05em',
            }}
          >
            <span className="status-dot" style={{ background: '#fff', animation: 'criticalPulseDot 1s infinite' }} />
            CRITICAL<span className="topbar-optional"> CONJUNCTION DETECTED</span>
          </button>
        )}

        <button className="icon-button" onClick={onOpenAlerts} title="Open conjunction alerts" aria-label={`${alertCount} high-risk alerts`}>
          <Bell size={16} />
          {alertCount > 0 && (
            <span className="nav-badge" style={{ position: 'absolute', top: -6, right: -6, marginLeft: 0 }}>{alertCount}</span>
          )}
        </button>

        <button className="icon-button" onClick={onToggleTheme} title="Toggle light / dark theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span className="topbar-optional">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  )
}
