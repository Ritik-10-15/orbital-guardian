// ============================================================
// src/components/AlertDashboard.tsx
// Option A + C upgrades:
//   ✦ Live countdown timer to TCA
//   ✦ Manoeuvre simulator slider
//   ✦ Score bar visualisation
//   ✦ Rich AI insight panel (LLM or rule-based)
//   ✦ Anomaly detection badge + explanation
//   ✦ Operator recommendation
// ============================================================

import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { RiskBadge } from './RiskBadge'
import { api } from '../api/client'
import type { ConjunctionEvent, RiskResponse, ApprovalStatus } from '../types'
import { RISK_COLOURS, eventKey } from '../types'
// ── AI insight types ─────────────────────────────────────────
interface AIInsight {
  insight:        string
  anomaly_score:  number
  is_anomaly:     boolean
  anomaly_reason: string
  recommendation: string
  source:         string
  openai_enabled: boolean
}

// ── AI insight fetcher hook ───────────────────────────────────
function useAIInsight(ev: ConjunctionEvent | null) {
  const [ai,      setAi]      = useState<AIInsight | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!ev) { setAi(null); return }
    setLoading(true)
    fetch('/api/ai/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        debris_name:           ev.debris_name,
        miss_distance_km:      ev.miss_distance_km,
        relative_velocity_kms: ev.relative_velocity_kms,
        hours_to_tca:          ev.hours_to_tca,
        risk_score:            ev.risk_score,
        risk_level:            ev.risk_level,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAi(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ev?.debris_name, ev?.miss_distance_km])

  return { ai, loading }
}

// ── Countdown helpers ────────────────────────────────────────
function useCountdown(tcaIso: string) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    function tick() {
      const diff = new Date(tcaIso).getTime() - Date.now()
      if (diff <= 0) { setRemaining('PASSED'); return }
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setRemaining(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tcaIso])

  return remaining
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`
  const hrs  = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
}

// ── Score bar ────────────────────────────────────────────────
function ScoreBar({ score, colour }: { score: number; colour: string }) {
  return (
    <div style={{
      height: '6px',
      background: 'var(--surface)',
      borderRadius: '3px',
      overflow: 'hidden',
      marginTop: '4px',
    }}>
      <div style={{
        width: `${score}%`,
        height: '100%',
        background: colour,
        borderRadius: '3px',
        transition: 'width 0.5s ease',
      }} />
    </div>
  )
}

// ── Manoeuvre simulator ───────────────────────────────────────
function ManoeuvreSimulator({ ev }: { ev: ConjunctionEvent }) {
  const { approvals, approveEvent, rejectEvent, clearApproval } = useStore()
  const [missKm, setMissKm]       = useState(ev.miss_distance_km)
  const [result, setResult]       = useState<RiskResponse | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [notes, setNotes] = useState('')

  const key = eventKey(ev)
  const approval = approvals[key]

  async function simulate(newMiss: number) {
    setMissKm(newMiss)
    setSimLoading(true)
    try {
      const r = await api.scoreRisk({
        miss_distance_km:      newMiss,
        relative_velocity_kms: ev.relative_velocity_kms,
        hours_to_tca:          ev.hours_to_tca,
        debris_name:           ev.debris_name,
      })
      setResult(r)
    } catch {
      // silently ignore
    } finally {
      setSimLoading(false)
    }
  }

  const displayScore  = result?.score  ?? ev.risk_score
  const displayLevel  = result?.level  ?? ev.risk_level
  const displayColour = result?.colour ?? RISK_COLOURS[ev.risk_level]
  const displayInsight = result?.insight ?? ev.insight

  return (
    <div style={{
      marginTop: '12px',
      padding: '12px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          🚀 Manoeuvre Simulator
        </span>
        <ApprovalBadge status={approval?.status ?? 'PENDING'} />
      </div>

      {/* Miss distance slider */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--muted)',
          marginBottom: '4px',
        }}>
          <span>Post-burn miss distance</span>
          <span style={{ color: 'var(--text)', fontFamily: 'monospace', fontWeight: 600 }}>
            {missKm.toFixed(1)} km
          </span>
        </div>
        <input
          type="range"
          min={0.01}
          max={20}
          step={0.1}
          value={missKm}
          onChange={e => simulate(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: 'var(--muted)',
        }}>
          <span>0 km (direct hit)</span>
          <span>20 km (safe)</span>
        </div>
      </div>

      {/* Result */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '6px',
      }}>
        <RiskBadge level={displayLevel as any} score={displayScore} size="sm" />
        {simLoading && (
          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>calculating…</span>
        )}
      </div>
      <ScoreBar score={displayScore} colour={displayColour} />

      {/* Insight text */}
      <div style={{
        marginTop: '8px',
        fontSize: '11px',
        color: 'var(--muted)',
        lineHeight: 1.5,
        fontStyle: 'italic',
      }}>
        {displayInsight}
      </div>

      {/* ── Operator approval workflow ──────────────────────── */}
      <div style={{
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid var(--border)',
      }}>
        <textarea
          placeholder="Optional notes (e.g. burn timing, fuel budget considerations)…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{
            width: '100%',
            minHeight: '48px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text)',
            padding: '6px 8px',
            fontSize: '11px',
            fontFamily: 'inherit',
            resize: 'vertical',
            marginBottom: '8px',
            outline: 'none',
          }}
        />

        {approval ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--muted)', flex: 1 }}>
              Decided {new Date(approval.decided_at!).toLocaleString()} at {approval.decided_miss_km.toFixed(1)} km
            </span>
            <button
              onClick={() => clearApproval(ev)}
              style={{
                padding: '5px 10px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--muted)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Revise
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => approveEvent(ev, missKm, displayScore, notes)}
              style={{
                flex: 1,
                padding: '8px',
                background: '#16a34a',
                border: 'none',
                borderRadius: '5px',
                color: '#fff',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              ✓ Approve Manoeuvre
            </button>
            <button
              onClick={() => rejectEvent(ev, missKm, displayScore, notes)}
              style={{
                flex: 1,
                padding: '8px',
                background: '#dc2626',
                border: 'none',
                borderRadius: '5px',
                color: '#fff',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              ✕ Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Event row ────────────────────────────────────────────────
function EventRow({ ev, selected, onClick }: {
  ev: ConjunctionEvent
  selected: boolean
  onClick: () => void
}) {
  const countdown = useCountdown(ev.tca)

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        background: selected ? 'var(--surface2)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        padding: '10px 14px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#1f2937' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px' }} className="truncate">
          {ev.debris_name}
        </span>
        <RiskBadge level={ev.risk_level} score={ev.risk_score} size="sm" />
      </div>
      <div style={{ display: 'flex', gap: '10px', color: 'var(--muted)', fontSize: '11px', flexWrap: 'wrap' }}>
        <span>
          TCA&nbsp;
          <strong style={{
            color: ev.risk_level === 'CRITICAL' ? '#dc2626' :
                   ev.risk_level === 'HIGH'     ? '#ea580c' : 'var(--text)',
            fontFamily: 'monospace',
          }}>
            {countdown}
          </strong>
        </span>
        <span>Miss <strong style={{ color: 'var(--text)' }}>{ev.miss_distance_km.toFixed(2)} km</strong></span>
      </div>
    </button>
  )
}

// ── AI insight panel ─────────────────────────────────────────
function AIInsightPanel({ ev }: { ev: ConjunctionEvent }) {
  const { ai, loading } = useAIInsight(ev)

  return (
    <div style={{
      marginTop: '10px',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '7px 12px',
        background: 'var(--surface2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11px',
        fontWeight: 700,
      }}>
        <span>🤖 AI Analysis</span>
        {ai && (
          <span style={{
            fontSize: '9px',
            padding: '2px 6px',
            borderRadius: '999px',
            background: ai.openai_enabled ? '#1e3a5f' : 'var(--surface)',
            color: ai.openai_enabled ? '#60a5fa' : 'var(--muted)',
            border: `1px solid ${ai.openai_enabled ? '#3b82f6' : 'var(--border)'}`,
          }}>
            {ai.openai_enabled ? '⚡ GPT-4o-mini' : '📐 Rule-based'}
          </span>
        )}
      </div>

      <div style={{ padding: '10px 12px' }}>
        {loading && (
          <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Generating insight…</div>
        )}

        {/* Main insight text */}
        {ai && (
          <>
            <p style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.6, margin: '0 0 10px' }}>
              {ai.insight}
            </p>

            {/* Anomaly badge */}
            {ai.is_anomaly && (
              <div style={{
                padding: '8px 10px',
                background: '#431407',
                border: '1px solid #ea580c',
                borderRadius: '5px',
                fontSize: '11px',
                color: '#fed7aa',
                marginBottom: '10px',
                lineHeight: 1.5,
              }}>
                <strong>⚠ Anomaly detected</strong> — score {ai.anomaly_score.toFixed(0)}/100<br />
                {ai.anomaly_reason}
              </div>
            )}

            {/* Recommendation box */}
            <div style={{
              padding: '8px 10px',
              background: '#0f1f0f',
              border: '1px solid #16a34a',
              borderRadius: '5px',
              fontSize: '11px',
              color: '#86efac',
              lineHeight: 1.5,
            }}>
              <strong>📋 Recommendation:</strong><br />
              {ai.recommendation}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Event detail panel ───────────────────────────────────────
function EventDetail({ ev }: { ev: ConjunctionEvent }) {
  const countdown = useCountdown(ev.tca)
  const colour    = RISK_COLOURS[ev.risk_level]

  return (
    <div style={{
      padding: '14px',
      background: 'var(--surface2)',
      borderTop: '1px solid var(--border)',
      overflowY: 'auto',
      maxHeight: '55vh',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
      }}>
        <span style={{ fontWeight: 700, fontSize: '13px' }}>{ev.debris_name}</span>
        <RiskBadge level={ev.risk_level} score={ev.risk_score} />
      </div>

      {/* Score bar */}
      <ScoreBar score={ev.risk_score} colour={colour} />

      {/* Countdown clock */}
      <div style={{
        marginTop: '12px',
        padding: '10px',
        background: 'var(--surface)',
        border: `1px solid ${colour}`,
        borderRadius: '6px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Time to Closest Approach
        </div>
        <div style={{
          fontSize: '24px',
          fontFamily: 'monospace',
          fontWeight: 800,
          color: colour,
          letterSpacing: '0.1em',
        }}>
          {countdown}
        </div>
      </div>

      {/* AI insight panel */}
      <AIInsightPanel ev={ev} />

      {/* Metrics grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        fontSize: '12px',
        marginTop: '10px',
      }}>
        <Metric label="Miss Distance"  value={ev.miss_distance_km.toFixed(3) + ' km'} />
        <Metric label="Relative Vel"   value={ev.relative_velocity_kms.toFixed(2) + ' km/s'} />
        <Metric label="Risk Score"     value={ev.risk_score.toFixed(1) + ' / 100'} />
        <Metric label="Pc"             value={ev.probability_of_collision !== null
          ? (ev.probability_of_collision * 100).toFixed(2) + '%' : 'N/A'} />
      </div>

      {/* Manoeuvre simulator */}
      <ManoeuvreSimulator ev={ev} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      padding: '6px 8px',
    }}>
      <div style={{ color: 'var(--muted)', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontFamily: 'monospace', fontWeight: 600 }}>{value}</div>
    </div>
  )
}
function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const cfg = {
    PENDING:  { bg: '#292524', border: '#78716c', color: '#d6d3d1', label: '⏳ Pending Review' },
    APPROVED: { bg: '#0f1f0f', border: '#16a34a', color: '#86efac', label: '✓ Approved' },
    REJECTED: { bg: '#431407', border: '#dc2626', color: '#fca5a5', label: '✕ Rejected' },
  }[status] as { bg: string; border: string; color: string; label: string }

  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '999px',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      color: cfg.color,
      fontSize: '11px',
      fontWeight: 700,
    }}>
      {cfg.label}
    </span>
  )
}
// ── Main dashboard ───────────────────────────────────────────
// ── Main dashboard ───────────────────────────────────────────
export function AlertDashboard() {
  const { events, selectedEvent, setSelectedEvent, loading, error } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <div style={{
        width: '44px',
        minWidth: '44px',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '10px',
        gap: '8px',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand Conjunction Alerts panel"
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--muted)',
            fontSize: '12px',
            padding: '6px 8px',
            cursor: 'pointer',
          }}
        >
          ◀
        </button>
        <span style={{ fontSize: '16px' }}>⚠</span>
        {events.length > 0 && (
          <span style={{
            background: '#dc2626',
            color: '#fff',
            borderRadius: '999px',
            width: 18, height: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 700,
          }}>
            {events.length}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: '320px',
      minWidth: '320px',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: '13px' }}>⚠ Conjunction Alerts</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {events.length > 0 && (
            <span style={{
              background: '#dc2626',
              color: '#fff',
              borderRadius: '999px',
              padding: '1px 8px',
              fontSize: '11px',
              fontWeight: 700,
            }}>
              {events.length}
            </span>
          )}
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse Conjunction Alerts panel"
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--muted)',
              fontSize: '11px',
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            ▶
          </button>
        </div>
      </div>

      {/* Event list */}
      <div style={{ flex: selectedEvent ? '0 0 auto' : 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            ⏳ Scanning 72-hour window…
          </div>
        )}
        {error && (
          <div style={{ padding: '12px 14px', color: '#f87171', fontSize: '11px', lineHeight: 1.5 }}>
            {error}
          </div>
        )}
        {!loading && events.length === 0 && !error && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            No events detected.<br />Click <strong>🔍 Scan Conjunctions</strong> to check for threats.
          </div>
        )}
        {events.map((ev, i) => (
          <EventRow
            key={ev.debris_name + i}
            ev={ev}
            selected={selectedEvent?.debris_name === ev.debris_name}
            onClick={() => setSelectedEvent(
              selectedEvent?.debris_name === ev.debris_name ? null : ev
            )}
          />
        ))}
      </div>

      {/* Selected event detail + simulator */}
      {selectedEvent && <EventDetail ev={selectedEvent} />}
    </div>
  )
}