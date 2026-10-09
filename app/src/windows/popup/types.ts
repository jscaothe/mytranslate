import type { ChatApp, Direction, Keigo } from '../../types'

/** Where the text came from in the real app (filled by the Rust side from the foreground window). */
export interface WindowContext {
  conversation: string
  workspace: string | null
  /** `no_selection` or `clipboard` when no text could be read. */
  error: string | null
  /** History: the conversation, the guessed thread (null = new) and the recent threads to pick from. */
  conversationId: number | null
  threadId: number | null
  confidence: 'high' | 'low'
  threads: { id: number; title: string; lastActive: number }[]
  /** Copy the result as soon as it is ready, then close (toolbar "translate and copy"). */
  autoCopy: boolean
  /** Keigo remembered for this conversation; `''` uses the default from the settings. */
  keigo: Keigo | ''
}

export type ResizeDirection = 'East' | 'West' | 'South' | 'SouthEast' | 'SouthWest'

/** Hooks into the real OS window when the popup is its own Tauri window. */
export interface WindowedHost {
  customized: boolean
  onReset: () => void
  onCopy: (text: string) => void
  onFit: (height: number) => void
  startDrag: () => void
  startResize: (direction: ResizeDirection) => void
}

export type PopupOrigin = 'chat' | 'composer' | 'popup' | 'onboarding'

export interface PopupRequest {
  id: number
  direction: Direction
  source: string
  origin: PopupOrigin
  conversationId: string
  app: ChatApp | 'other'
  window?: WindowContext
  /** Point in the host container the popup attaches to. */
  anchor: { x: number; y: number }
  /** `above` keeps the popup clear of the chat composer. */
  placement: 'below' | 'above'
}
