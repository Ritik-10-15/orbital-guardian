// ============================================================
// src/components/PanelHeader.tsx
// Shared panel title bar: icon + title on the left, actions right
// ============================================================

import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
}

export function PanelHeader({ icon: Icon, title, children }: Props) {
  return (
    <div className="panel-header">
      <h2 className="panel-title">
        <Icon size={15} strokeWidth={2} />
        <span className="truncate">{title}</span>
      </h2>
      {children && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {children}
        </div>
      )}
    </div>
  )
}
