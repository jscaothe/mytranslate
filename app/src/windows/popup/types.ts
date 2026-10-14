import type { ChatApp, Direction } from '../../types'

/** Where the text came from in the real app (filled by the Rust side from the foreground window). */
export interface WindowContext {
  conversation: string
  workspace: string | null
  /** `no_selection` or `clipboard` when no text could be read. */
  error: string | null
  /** History: the conversation, and the thread the Rust side filed the text under (null = a new one). */
  conversationId: number | null
  threadId: number | null
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

export type PopupOrigin = 'chat' | 'composer' | 'onboarding'

export interface PopupRequest {
  id: number
  direction: Direction
  source: string
  origin: PopupOrigin
  /** Whether the text was selected in a box the user can type in; `null` when the app could not tell. */
  inMessageBox: boolean | null
  /** The chat the text came from, as shown in the popup's title bar (the prototype; the real app uses `window`). */
  conversation: string
  app: ChatApp | 'other'
  window?: WindowContext
  /** Point in the host container the popup attaches to. */
  anchor: { x: number; y: number }
  /** `above` keeps the popup clear of the chat composer. */
  placement: 'below' | 'above'
}
