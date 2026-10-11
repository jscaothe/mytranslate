// In-app updates (updates.rs): status, check, and install with download progress.
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'
import { isTauri } from './claude'

export interface UpdateStatus {
  current: string
  /** Whether this build knows where to look for updates. */
  configured: boolean
  available: { version: string; notes: string; date: string | null } | null
  checkedAt: number | null
  error: string | null
}

export type InstallState =
  | { phase: 'idle' }
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' }
  | { phase: 'error'; message: string }

type InstallEvent = { type: 'progress'; downloaded: number; total: number | null } | { type: 'installing' }

// The prototype pretends a release server exists, so the screens can be tried.
let mockStatus: UpdateStatus = { current: '0.1.0', configured: true, available: null, checkedAt: null, error: null }

/** The update state shared by every screen of a window; follows checks made elsewhere (tray, timer). */
export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(isTauri ? null : mockStatus)
  const [checking, setChecking] = useState(false)
  const [install, setInstall] = useState<InstallState>({ phase: 'idle' })

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    void invoke<UpdateStatus>('update_status').then((s) => alive && setStatus(s))
    const offStatus = listen<UpdateStatus>('update:status', (e) => setStatus(e.payload))
    const offFailed = listen<string>('update:failed', (e) => setInstall({ phase: 'error', message: e.payload }))
    return () => {
      alive = false
      void offStatus.then((f) => f())
      void offFailed.then((f) => f())
    }
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      if (!isTauri) {
        await new Promise((r) => setTimeout(r, 700))
        mockStatus = {
          ...mockStatus,
          checkedAt: Date.now(),
          available: { version: '0.2.0', notes: 'Gợi ý trả lời, mẫu câu, glossary chung của team.', date: null },
        }
        setStatus(mockStatus)
        return
      }
      setStatus(await invoke<UpdateStatus>('update_check'))
    } finally {
      setChecking(false)
    }
  }, [])

  const installNow = useCallback(async () => {
    if (!isTauri) {
      const total = 3_000_000
      for (let d = 0; d <= total; d += 750_000) {
        setInstall({ phase: 'downloading', downloaded: d, total })
        await new Promise((r) => setTimeout(r, 250))
      }
      setInstall({ phase: 'installing' })
      return
    }
    setInstall({ phase: 'downloading', downloaded: 0, total: null })
    const channel = new Channel<InstallEvent>()
    channel.onmessage = (e) =>
      setInstall(e.type === 'installing' ? { phase: 'installing' } : { phase: 'downloading', downloaded: e.downloaded, total: e.total })
    try {
      await invoke('update_install', { onEvent: channel })
    } catch (e) {
      setInstall({ phase: 'error', message: String(e) })
    }
  }, [])

  return { status, checking, check, install, installNow }
}

export function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`
}
