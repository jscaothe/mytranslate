import { createContext, useContext } from 'react'
import type { Contact, Conversation, GlossaryTerm, Keigo, Scenario, Thread, ThreadMessage } from './types'

export type Screen = 'playground' | 'main' | 'onboarding'
export type MainTab = 'translate' | 'threads' | 'glossary' | 'contacts' | 'settings'
export type ThemePref = 'system' | 'light' | 'dark'

export interface HotkeyMap {
  auto: string
  jaVi: string
  viJa: string
  review: string
  main: string
}

export interface Settings {
  theme: ThemePref
  defaultKeigo: Keigo
  model: 'sonnet' | 'haiku'
  provider: 'cli' | 'api'
  hotkeys: HotkeyMap
  /** Free-form self introduction that is added to every prompt. */
  profilePrompt: string
  /** Mini toolbar shown when text is selected with the mouse. */
  quickActions: QuickActionSettings
  glossaryPath: string
  autostart: boolean
  blockedApps: string[]
  hotkeysPaused: boolean
  /** Whether the first-run guide has been completed. */
  onboarded: boolean
}

export type QuickActionId = 'translate' | 'review' | 'copyTranslation'

export interface QuickActionItem {
  id: QuickActionId
  enabled: boolean
}

export const DEFAULT_QUICK_ACTION_ITEMS: QuickActionItem[] = [
  { id: 'translate', enabled: true },
  { id: 'review', enabled: true },
  { id: 'copyTranslation', enabled: true },
]

/** A desktop application, identified by its executable like Windows does. */
export interface AppRef {
  exe: string
  name: string
}

export const DEFAULT_QUICK_ACTION_APPS: AppRef[] = [
  { exe: 'ms-teams.exe', name: 'Microsoft Teams' },
  { exe: 'slack.exe', name: 'Slack' },
]

export interface QuickActionSettings {
  enabled: boolean
  /** `all`: every app (except blocked ones); `selected`: only the apps in `apps`. */
  appScope: 'all' | 'selected'
  apps: AppRef[]
  /** Buttons show an icon with a label, or only an icon (label in the tooltip). */
  display: 'iconText' | 'iconOnly'
  /** Buttons in display order. */
  items: QuickActionItem[]
}

/** Popup size and place, remembered until the app quits. `position: null` follows the cursor. */
export interface PopupGeometry {
  width: number
  /** `null` fits the content (up to a maximum); a number is a height the user dragged to. */
  height: number | null
  position: { left: number; top: number } | null
}

export const DEFAULT_POPUP_WIDTH = 440

export interface Toast {
  id: number
  text: string
}

export interface Store {
  screen: Screen
  setScreen: (s: Screen) => void
  mainTab: MainTab
  openMain: (tab?: MainTab) => void
  setMainTab: (t: MainTab) => void
  scenario: Scenario
  setScenario: (s: Scenario) => void
  /** Mock data in the prototype; the history on this PC in the real app. */
  conversations: Conversation[]
  threads: Thread[]
  selectedThreadId: string
  selectThread: (id: string) => void
  addMessage: (threadId: string, msg: Omit<ThreadMessage, 'id'>) => void
  createThread: (conversationId: string, title: string) => string
  updateThread: (id: string, patch: Partial<Thread>) => void
  glossary: GlossaryTerm[]
  setGlossary: (g: GlossaryTerm[]) => void
  contacts: Contact[]
  setContacts: (c: Contact[]) => void
  settings: Settings
  /** False until the real app has loaded the saved settings (always true in the prototype). */
  settingsReady: boolean
  updateSettings: (patch: Partial<Settings>) => void
  toast: Toast | null
  showToast: (text: string) => void
  popupGeometry: PopupGeometry
  setPopupGeometry: (g: PopupGeometry) => void
}

export const StoreContext = createContext<Store | null>(null)

let nextId = 1000
export const newId = (prefix: string) => `${prefix}-${nextId++}`

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore must be used inside StoreProvider')
  return s
}
