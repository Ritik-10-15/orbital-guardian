// ============================================================
// src/components/Sidebar.tsx
// Left navigation: jumps between dashboard panels + system status
// ============================================================

import React from 'react'
import {
  LayoutDashboard, Satellite, Globe as GlobeIcon, AlertTriangle, ScanSearch,
  SatelliteDish, Activity, ClipboardList, Wifi, Database, Radar,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'

export type SectionId = 'hero' | 'fleet' | 'globe' | 'alerts' | 'scan' | 'passes' | 'status' | 'log'

const NAV: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: 'hero',   label: 'Dashboard',    icon: LayoutDashboard },
  { id: 'fleet',  label: 'Fleet',        icon: Satellite },
  { id: 'globe',  label: 'Tracking',     icon: GlobeIcon },
  { id: 'alerts', label: 'Conjunctions', icon: AlertTriangle },
  { id: 'scan',   label: 'Scan Setup',   icon: ScanSearch },
  { id: 'passes', label: 'Passes',       icon: SatelliteDish },
  { id: 'status', label: 'Fleet Status', icon: Activity },
  { id: 'log',    label: 'Mission Log',  icon: ClipboardList },
]

const CATALOG_LABELS: Record<string, string> = {
  'demo-debris':        'Demo debris',
  'celestrak-stations': 'CelesTrak stations',
  'celestrak-active':   'CelesTrak active',
  'celestrak-starlink': 'CelesTrak Starlink',
  'spacetrack-debris':  'Space-Track debris',
  'spacetrack-all':     'Space-Track LEO',
}

interface Props {
  active: SectionId
  alertCount: number
  connected: boolean
  onNavigate: (id: SectionId) => void
}

export function Sidebar({ active, alertCount, connected, onNavigate }: Props) {
  const persistenceReady = useStore(state => state.persistenceReady)
  const catalogSource = useStore(state => state.catalogSource)

  return (
    <aside className="sidebar">
      <a className="sidebar-brand" href="#hero" onClick={e => { e.preventDefault(); onNavigate('hero') }}>
        <span style={{
          width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
          boxShadow: '0 0 18px rgba(56,189,248,0.45)',
          color: '#fff',
        }}>
          <Radar size={18} />
        </span>
        <span className="sidebar-brand-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>Orbital Guardian</span>
          <span style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.18em', fontWeight: 600 }}>
            DEBRIS DEFENCE
          </span>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="Dashboard sections">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className="nav-item"
            aria-current={active === id}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
            {id === 'alerts' && alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <StatusLine
          icon={Wifi}
          label="Live feed"
          value={connected ? 'Connected' : 'Offline'}
          ok={connected}
        />
        <StatusLine
          icon={Database}
          label="Database"
          value={persistenceReady ? 'Synced' : 'Connecting…'}
          ok={persistenceReady}
        />
        <StatusLine
          icon={Radar}
          label="Debris catalog"
          value={CATALOG_LABELS[catalogSource] ?? catalogSource}
          ok
        />
      </div>
    </aside>
  )
}

function StatusLine({ icon: Icon, label, value, ok }: { icon: LucideIcon; label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
      <span className="status-dot" style={{
        marginTop: 5,
        background: ok ? 'var(--ok)' : 'var(--muted)',
        boxShadow: ok ? '0 0 6px var(--ok)' : 'none',
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, minWidth: 0 }}>
        <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Icon size={11} /> {label}
        </span>
        <span className="truncate" style={{ color: ok ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>{value}</span>
      </div>
    </div>
  )
}
