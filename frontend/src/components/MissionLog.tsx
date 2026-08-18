// ============================================================
// src/components/MissionLog.tsx
// Persistent audit trail of all operator approval decisions
// Auto-populated when events are Approved or Rejected
// ============================================================

import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import type { MissionLogEntry } from '../types'
import { RISK_COLOURS } from '../types'

function exportLogCSV(log: MissionLogEntry[]) {
  const rows: string[] = []
  rows.push([
    'Logged At', 'Spacecraft', 'Debris', 'TCA',
    'Decision', 'Risk Level', 'Risk Score',
    'Original Miss (km)', 'Simulated Miss (km)', 'Simulated Score', 'Notes',
  ].join(','))

  log.forEach(e => {
    rows.push([
      e.logged_at,
      `"${e.spacecraft_name}"`,
      `"${e.debris_name}"`,
      e.tca,
      e.decision,
      e.risk_level,
      e.risk_score.toFixed(1),
      e.miss_distance_km.toFixed(3),
      e.simulated_miss_km.toFixed(3),
      e.simulated_score.toFixed(1),
      `"${e.notes}"`,
    ].join(','))
  })

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `mission-log-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function LogRow({ entry }: { entry: MissionLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const isApproved = entry.decision === 'APPROVED'
  const decisionColour = isApproved ? '#22c55e' : '#ef4444'
  const riskColour = RISK_COLOURS[entry.risk_level]

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      fontSize: '11px',
    }}>
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Decision badge */}
        <span style={{
          padding: '2px 7px',
          borderRadius: '999px',
          background: decisionColour + '22',
          border: `1px solid ${decisionColour}`,
          color: decisionColour,
          fontWeight: 700,
          fontSize: '10px',
          flexShrink: 0,
        }}>
          {isApproved ? '✓' : '✕'}
        </span>

        {/* Spacecraft */}
        <span style={{ color: 'var(--muted)', flexShrink: 0, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.spacecraft_name}
        </span>

        {/* Debris */}
        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.debris_name}
        </span>

        {/* Risk level dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: riskColour, flexShrink: 0,
        }} />

        {/* Timestamp */}
        <span style={{ color: 'var(--muted)', fontSize: '10px', flexShrink: 0, fontFamily: 'monospace' }}>
          {entry.logged_at.replace('T',' ').slice(0,16)}
        </span>

        <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{
          padding: '0 12px 10px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
        }}>
          {[
            ['TCA',             entry.tca.replace('T',' ').slice(0,16) + ' UTC'],
            ['Risk Level',      entry.risk_level],
            ['Risk Score',      entry.risk_score.toFixed(1) + ' / 100'],
            ['Original Miss',   entry.miss_distance_km.toFixed(3) + ' km'],
            ['Simulated Miss',  entry.simulated_miss_km.toFixed(3) + ' km'],
            ['Simulated Score', entry.simulated_score.toFixed(1) + ' / 100'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'var(--surface)', borderRadius: '4px', padding: '5px 8px' }}>
              <div style={{ color: 'var(--muted)', fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{value}</div>
            </div>
          ))}
          {entry.notes && (
            <div style={{
              gridColumn: '1 / -1',
              background: 'var(--surface)',
              borderRadius: '4px',
              padding: '5px 8px',
            }}>
              <div style={{ color: 'var(--muted)', fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>Notes</div>
              <div style={{ fontStyle: 'italic', color: 'var(--muted)' }}>{entry.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MissionLog() {
  const { missionLog, clearLog } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL')

  const filtered = filter === 'ALL' ? missionLog : missionLog.filter(e => e.decision === filter)

  const approvedCount = missionLog.filter(e => e.decision === 'APPROVED').length
  const rejectedCount = missionLog.filter(e => e.decision === 'REJECTED').length

  if (collapsed) {
    return (
      <div style={{
        width: '44px', minWidth: '44px',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: '10px', gap: '8px',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand Mission Log"
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: '4px', color: 'var(--muted)', fontSize: '12px',
            padding: '6px 8px', cursor: 'pointer',
          }}
        >◀</button>
        <span style={{ fontSize: '16px' }}>📋</span>
        {missionLog.length > 0 && (
          <span style={{
            background: '#1d4ed8', color: '#fff', borderRadius: '999px',
            width: 18, height: 18, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '10px', fontWeight: 700,
          }}>{missionLog.length}</span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: '300px', minWidth: '300px',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '8px',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>📋 Mission Log</span>
        <span style={{ fontSize: '10px', color: '#22c55e' }}>{approvedCount} ✓</span>
        <span style={{ fontSize: '10px', color: '#ef4444' }}>{rejectedCount} ✕</span>
        <button
          onClick={() => exportLogCSV(missionLog)}
          disabled={missionLog.length === 0}
          title="Export log as CSV"
          style={{
            padding: '3px 8px', background: 'var(--surface2)',
            border: '1px solid var(--border)', borderRadius: '4px',
            color: 'var(--muted)', fontSize: '10px', cursor: missionLog.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >📄 CSV</button>
        <button
          onClick={() => { if (confirm('Clear mission log?')) clearLog() }}
          disabled={missionLog.length === 0}
          title="Clear log"
          style={{
            padding: '3px 6px', background: 'none',
            border: '1px solid var(--border)', borderRadius: '4px',
            color: '#ef4444', fontSize: '10px', cursor: missionLog.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >✕</button>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: '4px', color: 'var(--muted)', fontSize: '11px',
            padding: '3px 8px', cursor: 'pointer',
          }}
        >▶</button>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {(['ALL', 'APPROVED', 'REJECTED'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1, padding: '6px', background: filter === f ? 'var(--surface2)' : 'none',
              border: 'none', borderBottom: filter === f ? '2px solid var(--accent)' : '2px solid transparent',
              color: filter === f ? 'var(--text)' : 'var(--muted)',
              fontSize: '10px', fontWeight: filter === f ? 700 : 400, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >{f}</button>
        ))}
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
            No decisions logged yet.
            <br />
            <span style={{ fontSize: '10px' }}>Approve or reject a conjunction event to start the log.</span>
          </div>
        ) : (
          filtered.map(entry => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  )
}
