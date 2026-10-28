// ============================================================
// src/hooks/useLiveFeed.ts
// WebSocket live telemetry for the active spacecraft + UTC clock
// ============================================================

import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { createLiveSocket } from '../api/client'
import type { LiveFrame } from '../types'

/** Opens the live feed for the active spacecraft; returns whether it is connected. */
export function useLiveFeed(): boolean {
  const { spacecraft, setLiveFrame, activeFleetId, setFleetLiveFrame } = useStore()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const ws = createLiveSocket(
      spacecraft,
      5,
      (frame) => {
        setLiveFrame(frame as LiveFrame)
        setFleetLiveFrame(activeFleetId, frame as LiveFrame)
        setConnected(true)
      },
      () => setConnected(false)
    )
    ws.onclose = () => setConnected(false)
    return () => ws.close()
  }, [spacecraft, setLiveFrame])

  return connected
}

/** Current UTC time as "YYYY-MM-DD HH:MM:SS", ticking every second. */
export function useUtcClock(): string {
  const [utc, setUtc] = useState(() => new Date().toISOString())
  useEffect(() => {
    const id = setInterval(() => setUtc(new Date().toISOString()), 1000)
    return () => clearInterval(id)
  }, [])
  return utc.replace('T', ' ').slice(0, 19)
}
