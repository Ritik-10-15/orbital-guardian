// ============================================================
// src/components/RiskBadge.tsx
// Coloured pill badge showing risk level + numeric score
// ============================================================

import React from 'react'
import type { RiskLevel } from '../types'
import { RISK_COLOURS, RISK_BG } from '../types'

interface Props {
  level: RiskLevel
  score?: number
  size?: 'sm' | 'md'
}

export function RiskBadge({ level, score, size = 'md' }: Props) {
  const colour = RISK_COLOURS[level]
  const bg     = RISK_BG[level]
  const pad    = size === 'sm' ? '2px 8px' : '4px 12px'
  const fs     = size === 'sm' ? '11px' : '12px'

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: pad,
      borderRadius: '999px',
      background: bg,
      border: `1px solid ${colour}`,
      color: colour,
      fontWeight: 700,
      fontSize: fs,
      letterSpacing: '0.05em',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: size === 'sm' ? 6 : 8,
        height: size === 'sm' ? 6 : 8,
        borderRadius: '50%',
        background: colour,
        flexShrink: 0,
      }} />
      {level}
      {score !== undefined && (
        <span style={{ opacity: 0.75, fontWeight: 400 }}>
          {score.toFixed(0)}
        </span>
      )}
    </span>
  )
}
