// ============================================================
// src/components/FleetManager.tsx
// Option F — Add / remove spacecraft from fleet
// ============================================================

import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import { RiskBadge } from './RiskBadge'
import { SPACECRAFT_PRESETS } from '../types'
import type { TLESchema } from '../types'

export function FleetManager() {
  const { fleet, addToFleet, removeFromFleet, toggleFleetMember, activeFleetId, setActiveFleetId } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [customName,  setCustomName]  = useState('')
  const [customLine1, setCustomLine1] = useState('')
  const [customLine2, setCustomLine2] = useState('')

  function addPreset(id: string) {
    const preset = SPACECRAFT_PRESETS.find(p => p.id === id)
    if (preset) addToFleet(preset.tle, preset.colour)
  }

  function addCustom() {
    if (!customName || customLine1.length !== 69 || customLine2.length !== 69) return
    addToFleet({ name: customName, line1: customLine1, line2: customLine2 })
    setCustomName(''); setCustomLine1(''); setCustomLine2('')
    setShowAdd(false)
  }

  const inFleetIds = new Set(fleet.map(m => m.id))

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--text)',
    padding: '4px 8px',
    fontSize: '11px',
    fontFamily: 'monospace',
    width: '100%',
    outline: 'none',
  }

  return (
    <div style={{
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      width: '280px',
      minWidth: '280px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: '13px' }}>🛰 Fleet</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{
            background: 'var(--surface2)',
            borderRadius: '999px',
            padding: '1px 8px',
            fontSize: '11px',
            color: 'var(--muted)',
          }}>
            {fleet.length} spacecraft
          </span>
          <button
            onClick={() => setShowAdd(s => !s)}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            {showAdd ? '✕' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Add spacecraft panel */}
      {showAdd && (
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface2)',
          flexShrink: 0,
        }}>
          {/* Presets */}
          <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '6px', textTransform: 'uppercase' }}>
            Quick add preset
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
            {SPACECRAFT_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => addPreset(p.id)}
                disabled={inFleetIds.has(p.id)}
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  borderRadius: '4px',
                  border: `1px solid ${p.colour}`,
                  background: inFleetIds.has(p.id) ? 'var(--surface)' : 'transparent',
                  color: inFleetIds.has(p.id) ? 'var(--muted)' : p.colour,
                  cursor: inFleetIds.has(p.id) ? 'not-allowed' : 'pointer',
                  opacity: inFleetIds.has(p.id) ? 0.5 : 1,
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Custom TLE */}
          <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
            Custom TLE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <input style={inputStyle} placeholder="Name" value={customName} onChange={e => setCustomName(e.target.value)} />
            <input style={inputStyle} placeholder="TLE Line 1 (69 chars)" value={customLine1} onChange={e => setCustomLine1(e.target.value)} maxLength={69} />
            <input style={inputStyle} placeholder="TLE Line 2 (69 chars)" value={customLine2} onChange={e => setCustomLine2(e.target.value)} maxLength={69} />
            <button
              onClick={addCustom}
              style={{
                padding: '5px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: '2px',
              }}
            >
              Add to Fleet
            </button>
          </div>
        </div>
      )}

      {/* Fleet list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {fleet.map(member => {
          const isActive = member.id === activeFleetId
          return (
            <div
              key={member.id}
              onClick={() => setActiveFleetId(member.id)}
              style={{
                padding: '9px 14px',
                borderBottom: '1px solid var(--border)',
                background: isActive ? 'var(--surface2)' : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                borderLeft: `3px solid ${isActive ? member.colour : 'transparent'}`,
                transition: 'background 0.15s',
              }}
            >
              {/* Row 1: dot + name + risk badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: 10, height: 10,
                  borderRadius: '50%',
                  background: member.active ? member.colour : 'var(--muted)',
                  flexShrink: 0,
                  boxShadow: member.active ? `0 0 6px ${member.colour}` : 'none',
                }} />
                <span style={{
                  flex: 1,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}>
                  {member.tle.name}
                </span>
                <RiskBadge level={member.risk_level} score={member.risk_score > 0 ? member.risk_score : undefined} size="sm" />
              </div>

              {/* Row 2: telemetry + controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  {member.live_frame
                    ? `ALT ${member.live_frame.altitude_km.toFixed(0)} km  •  ${member.live_frame.speed_kms.toFixed(2)} km/s`
                    : member.last_scanned
                    ? `${member.events.length} events  •  scanned`
                    : 'Not scanned'}
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {/* Visibility toggle */}
                  <button
                    onClick={e => { e.stopPropagation(); toggleFleetMember(member.id) }}
                    title={member.active ? 'Hide on globe' : 'Show on globe'}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '3px',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {member.active ? '👁' : '🚫'}
                  </button>
                  {/* Remove */}
                  {fleet.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); removeFromFleet(member.id) }}
                      title="Remove from fleet"
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '3px',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
