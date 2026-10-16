import { createContext, useContext } from 'react'
import type { Lang } from './lib/i18n'
import type { GlossaryTerm, Keigo, Scenario } from './types'

export type Screen = 'playground' | 'main' | 'onboarding'
export type MainTab = 'glossary' | 'writing' | 'settings'
/** The parts of Settings, each with its own page. AI comes first: users change the AI and model the most. */
export type SettingsSection = 'ai' | 'general' | 'quick' | 'updates' | 'data'
export type ThemePref = 'system' | 'light' | 'dark'

/**
 * `claude` is Claude Code (the user's Claude account) and `codex` is ChatGPT through Codex (their ChatGPT account);
 * `anthropic`, `openai` and `gemini` use an API key.
 */
export type AiProvider = 'claude' | 'codex' | 'anthropic' | 'openai' | 'gemini'
/** The AIs used with an API key. */
export type ApiProvider = Exclude<AiProvider, 'claude' | 'codex'>

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
  codexModel: string
  anthropicModel: string
  openaiModel: string
  geminiModel: string
  /** When the chosen AI fails before answering, try the others that are set up. */
  aiFallback: boolean
  /** Extra models of ChatGPT and Gemini offered in the quick switcher, besides the default one. */
  aiQuickModels: Record<ApiProvider, string[]>
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

export type QuickActionId = 'translate' | 'review'

export interface QuickActionItem {
  id: QuickActionId
  enabled: boolean
}

export const DEFAULT_QUICK_ACTION_ITEMS: QuickActionItem[] = [
  { id: 'translate', enabled: true },
  { id: 'review', enabled: true },
]

/**
 * Saved toolbar buttons as this version knows them: buttons that no longer exist (such as the removed "Dịch và
 * chép") are dropped, new ones are added at the end, the user's order and choices are kept.
 */
export function knownQuickActions(saved: QuickActionItem[] | undefined): QuickActionItem[] {
  const known = (saved ?? []).filter((i, at, all) =>
    DEFAULT_QUICK_ACTION_ITEMS.some((d) => d.id === i.id) && all.findIndex((x) => x.id === i.id) === at,
  )
  return [...known, ...DEFAULT_QUICK_ACTION_ITEMS.filter((d) => !known.some((i) => i.id === d.id))]
}

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
  /** Apps the user turned the toolbar off in from its close menu, while it shows in every app. */
  hiddenApps: AppRef[]
  /** Buttons show an icon with a label, or only an icon (label in the tooltip). */
  display: 'iconText' | 'iconOnly'
  /** Buttons in display order. */
  items: QuickActionItem[]
}

const sameApp = (a: AppRef, b: AppRef) => a.exe.toLowerCase() === b.exe.toLowerCase()

/**
 * "Tắt trong <app>" from the toolbar's close menu. Limited to chosen apps, the app leaves the list; in every app,
 * it joins the apps the toolbar is turned off in.
 */
export function hideQuickBarIn(qa: QuickActionSettings, app: AppRef): QuickActionSettings {
  if (qa.appScope === 'selected') return { ...qa, apps: qa.apps.filter((a) => !sameApp(a, app)) }
  if (qa.hiddenApps.some((a) => sameApp(a, app))) return qa
  return { ...qa, hiddenApps: [...qa.hiddenApps, app] }
}

/** Whether the toolbar shows in the app with this executable (the Rust side decides the same way). */
export function quickBarShowsIn(qa: QuickActionSettings, exe: string): boolean {
  const app = { exe, name: '' }
  return qa.enabled && !qa.hiddenApps.some((a) => sameApp(a, app)) && (qa.appScope === 'all' || qa.apps.some((a) => sameApp(a, app)))
}

/** Popup size and place, remembered until the app quits. `position: null` follows the cursor. */
export interface PopupGeometry {
  width: number
  /** `null` fits the content (up to a maximum); a number is a height the user dragged to. */
  height: number | null
  position: { left: number; top: number } | null
}

/** Like the real app's narrowest translation popup (`MIN_WIDTH_WITH_KEIGO` in placement.rs): the keigo row fits. */
export const DEFAULT_POPUP_WIDTH = 500

export interface Toast {
  id: number
  text: string
}

export interface Store {
  screen: Screen
  setScreen: (s: Screen) => void
  mainTab: MainTab
  /** Opens the main window, on `tab` (and on a part of Settings) when given. */
  openMain: (tab?: MainTab, section?: SettingsSection) => void
  setMainTab: (t: MainTab) => void
  settingsSection: SettingsSection
  setSettingsSection: (s: SettingsSection) => void
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
