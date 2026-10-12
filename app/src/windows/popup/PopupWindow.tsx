import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Popup } from './Popup'
import type { PopupRequest, WindowedHost } from './types'
import type { Direction } from '../../types'

/** What the Rust side sends when a hotkey fires (see `popup.rs`). */
interface OpenPayload {
  id: number
  direction: Direction
  text: string
  origin: 'chat' | 'composer'
  app: 'slack' | 'teams' | 'other'
  conversation: string
  workspace: string | null
  error: string | null
  conversationId: number | null
  threadId: number | null
}

interface GeometryInfo {
  customized: boolean
  userHeight: boolean
}

const FOCUS_LOSS_GRACE_MS = 150
const INTERACTION_SETTLE_MS = 800

const toRequest = (p: OpenPayload): PopupRequest => ({
  id: p.id,
  direction: p.direction,
  source: p.text,
  origin: p.origin,
  conversation: p.conversation,
  app: p.app,
  window: {
    conversation: p.conversation,
    workspace: p.workspace,
    error: p.error,
    conversationId: p.conversationId,
    threadId: p.threadId,
  },
  anchor: { x: 0, y: 0 },
  placement: 'below',
})

/** The page loaded in the hidden "popup" window. It waits for hotkeys and shows one translation at a time. */
export function PopupWindow() {
  const [request, setRequest] = useState<PopupRequest | null>(null)
  const [customized, setCustomized] = useState(false)
  const pinned = useRef(false)
  /** Until this time, focus loss comes from the user dragging or resizing the popup, not from clicking away. */
  const interactingUntil = useRef(0)

  const refreshGeometry = useCallback(() => {
    void invoke<GeometryInfo>('popup_geometry').then((g) => setCustomized(g.customized))
  }, [])

  const hide = useCallback(() => {
    void invoke('popup_hide')
  }, [])

  // Every move/resize event during a drag extends the window in which focus loss is ignored.
  const keepInteracting = useCallback(() => {
    if (Date.now() < interactingUntil.current) interactingUntil.current = Date.now() + INTERACTION_SETTLE_MS
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    const subscriptions = [
      listen<OpenPayload>('popup:open', (e) => {
        pinned.current = false
        refreshGeometry()
        setRequest(toRequest(e.payload))
      }),
      // Clicking anywhere else closes the popup, unless it is pinned. Windows reports a brief focus loss when a
      // drag or resize starts, so wait a moment and check again before hiding.
      win.onFocusChanged(({ payload: focused }) => {
        if (focused || pinned.current) return
        window.setTimeout(async () => {
          if (pinned.current || Date.now() < interactingUntil.current) return
          if (!(await win.isFocused())) hide()
        }, FOCUS_LOSS_GRACE_MS)
      }),
      win.onMoved(() => {
        keepInteracting()
        refreshGeometry()
      }),
      win.onResized(() => {
        keepInteracting()
        refreshGeometry()
      }),
    ]
    return () => subscriptions.forEach((s) => void s.then((off) => off()))
  }, [hide, refreshGeometry, keepInteracting])

  const host = useMemo<WindowedHost>(
    () => ({
      customized,
      onReset: () => void invoke('popup_reset_geometry').then(refreshGeometry),
      onCopy: (text) => void invoke('popup_copy', { text }),
      onFit: (height) => void invoke('popup_fit', { height }),
      startDrag: () => {
        interactingUntil.current = Date.now() + INTERACTION_SETTLE_MS
        // Only a drag the user starts may change the remembered place and size.
        void invoke('popup_user_change').then(() => getCurrentWindow().startDragging())
      },
      startResize: (direction) => {
        interactingUntil.current = Date.now() + INTERACTION_SETTLE_MS
        // Only a drag the user starts may change the remembered place and size.
        void invoke('popup_user_change').then(() => getCurrentWindow().startResizeDragging(direction))
      },
    }),
    [customized, refreshGeometry],
  )

  if (!request) return null
  return (
    <Popup
      key={request.id}
      request={request}
      windowed={host}
      onClose={hide}
      onApply={(text) => void invoke('popup_apply', { text })}
      onPinnedChange={(p) => {
        pinned.current = p
      }}
    />
  )
}
