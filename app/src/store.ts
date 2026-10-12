import { createContext, useContext } from 'react'
import type { Lang } from './lib/i18n'
import type { GlossaryTerm, Keigo, Scenario } from './types'

export type Screen = 'playground' | 'main' | 'onboarding'
export type MainTab = 'glossary' | 'settings'
export type ThemePref = 'system' | 'light' | 'dark'

export type AiProvider = 'claude' | 'openai' | 'gemini'

/** One key translates either way (the text's language decides), one checks Japanese, one opens the main window. */
export interface HotkeyMap {
  auto: string
  review: string
  main: string
}

export interface Settings {
  /** The user's own language: the app's texts, and which way reading and writing translate. */
  language: Lang
  theme: ThemePref
  defaultKeigo: Keigo
  /** Claude model (Claude Code). */
  model: 'sonnet' | 'haiku'
  /** Which AI translates. Claude goes through Claude Code; ChatGPT and Gemini through their APIs. */
  aiProvider: AiProvider
  /** Model ids for the API providers; empty uses the recommended one. */
  openaiModel: string
  geminiModel: string
  /** When the chosen AI fails before answering, try the others that are set up. */
  aiFallback: boolean
  /** Extra models of ChatGPT and Gemini offered in the quick switcher, besides the default one. */
  aiQuickModels: { openai: string[]; gemini: string[] }
  hotkeys: HotkeyMap
  /** Mini toolbar shown when text is selected with the mouse. */
  quickActions: QuickActionSettings
  /** The team's shared glossary (YAML), read-only; empty when there is none. */
  glossaryPath: string
  /** Messages older than this many months are deleted; 0 keeps everything. */
  retentionMonths: number
  /** Look for a new version after start-up and every few hours. */
  autoUpdateCheck: boolean
  autostart: boolean
  blockedApps: string[]
  hotkeysPaused: boolean
  /** Whether the first-run guide has been completed. */
  onboarded: boolean
  /** The one-time notice "still running in the tray" was shown (set by the Rust side on the first close). */
  trayNoticeShown: boolean
  /** The one-time tip in the first translation popup was shown. */
  popupTipShown: boolean
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
  glossary: GlossaryTerm[]
  setGlossary: (g: GlossaryTerm[]) => void
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
