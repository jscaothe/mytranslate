import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mockData } from './data/mock'
import { DEFAULT_HOTKEYS, knownHotkeys } from './lib/hotkeys'
import { isTauri } from './lib/claude'
import { pick, systemLang } from './lib/i18n'
import { DEFAULT_POPUP_WIDTH, DEFAULT_QUICK_ACTION_APPS, DEFAULT_QUICK_ACTION_ITEMS, StoreContext, type MainTab, type PopupGeometry, type Screen, type Settings, type Store, type Toast } from './store'
import type { Scenario } from './types'

const defaultSettings: Settings = {
  // The real app gets the saved language, or the language of Windows, from the Rust side.
  language: systemLang(),
  theme: 'system',
  defaultKeigo: 'formal',
  model: 'sonnet',
  aiProvider: 'claude',
  openaiModel: '',
  geminiModel: '',
  aiFallback: false,
  aiQuickModels: { openai: [], gemini: [] },
  hotkeys: DEFAULT_HOTKEYS,
  quickActions: {
    enabled: true,
    appScope: 'selected',
    apps: DEFAULT_QUICK_ACTION_APPS,
    display: 'iconText',
    items: DEFAULT_QUICK_ACTION_ITEMS,
  },
  // The prototype shows how a configured team glossary looks; the real app starts without one.
  glossaryPath: isTauri ? '' : 'D:\\projects\\customerx\\docs\\glossary.yaml',
  retentionMonths: 3,
  autoUpdateCheck: true,
  autostart: true,
  blockedApps: ['1Password.exe', 'KeePass.exe'],
  hotkeysPaused: false,
  onboarded: false,
  trayNoticeShown: false,
  popupTipShown: false,
}

/** The prototype's sample glossary, as a user of the starting language would have it. */
const mock = mockData(defaultSettings.language)

export function StoreProvider({ children, initialScreen = 'playground', initialMainTab = 'glossary' }: { children: ReactNode; initialScreen?: Screen; initialMainTab?: MainTab }) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [mainTab, setMainTab] = useState<MainTab>(initialMainTab)
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [glossary, setGlossary] = useState(isTauri ? [] : mock.glossary)
  const [settings, setSettings] = useState(defaultSettings)
  const [toast, setToast] = useState<Toast | null>(null)
  const [popupGeometry, setPopupGeometry] = useState<PopupGeometry>({ width: DEFAULT_POPUP_WIDTH, height: null, position: null })
  const toastTimer = useRef<number | undefined>(undefined)
  const settingsRef = useRef(defaultSettings)

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  const openMain = useCallback((tab?: MainTab) => {
    if (tab) setMainTab(tab)
    setScreen('main')
  }, [])

  // In the real app the Rust side owns the settings: every window loads them, saves through it, and follows
  // changes made in other windows (the popup uses the keigo and model chosen in the main window).
  const [settingsReady, setSettingsReady] = useState(!isTauri)
  const applySettings = useCallback((next: Settings) => {
    settingsRef.current = next
    setSettings(next)
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const before = settingsRef.current
      const next = { ...before, ...patch }
      applySettings(next)
      if (!isTauri) {
        // The prototype: a user of the other language has another glossary.
        if (next.language !== before.language) setGlossary(mockData(next.language).glossary)
        return
      }
      invoke<{ failedHotkeys: string[] }>('settings_set', { value: next })
        .then(({ failedHotkeys }) => {
          if (failedHotkeys.length > 0)
            showToast(
              pick(
                next.language,
                `Không đăng ký được ${failedHotkeys.join(', ')}: ứng dụng khác đang dùng tổ hợp này`,
                `${failedHotkeys.join('、')} を登録できません。別のアプリがこの組み合わせを使っています`,
              ),
            )
        })
        .catch((e) => showToast(`${pick(next.language, 'Không lưu được cài đặt', '設定を保存できません')}: ${String(e)}`))
    },
    [applySettings, showToast],
  )

  // The page's language follows the user's: screen readers, and Japanese line breaking.
  useEffect(() => {
    document.documentElement.lang = settings.language
  }, [settings.language])

  // Real app: the tray menu and the popup can ask the main window to open a tab (for example Settings).
  useEffect(() => {
    if (!isTauri) return
    const off = listen<MainTab>('ui:open-tab', (e) => setMainTab(e.payload))
    return () => void off.then((f) => f())
  }, [])

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const merge = (saved: unknown) => {
      if (!alive || !saved || typeof saved !== 'object') return
      // `profilePrompt` belonged to the removed self-introduction prompt; drop it so it is not saved again.
      const { profilePrompt: _removed, ...rest } = saved as Partial<Settings> & { profilePrompt?: unknown }
      applySettings({ ...defaultSettings, ...rest, hotkeys: knownHotkeys(rest.hotkeys) })
    }
    void invoke('settings_get')
      .then(merge)
      .finally(() => alive && setSettingsReady(true))
    // Changes made in other windows (or the tray); this window already shows its own.
    const self = getCurrentWindow().label
    const off = listen<{ settings: unknown; from: string }>('settings:changed', (e) => {
      if (e.payload.from !== self) merge(e.payload.settings)
    })
    return () => {
      alive = false
      void off.then((f) => f())
    }
  }, [applySettings])

  const value = useMemo<Store>(
    () => ({
      screen,
      setScreen,
      mainTab,
      openMain,
      setMainTab,
      scenario,
      setScenario,
      glossary,
      setGlossary,
      settings,
      settingsReady,
      updateSettings,
      toast,
      showToast,
      popupGeometry,
      setPopupGeometry,
    }),
    [screen, mainTab, openMain, scenario, glossary, settings, settingsReady, updateSettings, toast, showToast, popupGeometry],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

