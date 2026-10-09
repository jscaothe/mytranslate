import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { initialContacts, initialGlossary, initialThreads } from './data/mock'
import { isTauri } from './lib/claude'
import { DEFAULT_POPUP_WIDTH, DEFAULT_QUICK_ACTION_APPS, DEFAULT_QUICK_ACTION_ITEMS, newId, StoreContext, type MainTab, type PopupGeometry, type Screen, type Settings, type Store, type Toast } from './store'
import type { Scenario, Thread, ThreadMessage } from './types'

const defaultSettings: Settings = {
  theme: 'system',
  defaultKeigo: 'formal',
  model: 'sonnet',
  provider: 'cli',
  hotkeys: { auto: 'Ctrl+Alt+T', jaVi: 'Ctrl+Alt+J', viJa: 'Ctrl+Alt+K', review: 'Ctrl+Alt+L', main: 'Ctrl+Alt+M' },
  profilePrompt: [
    'Tôi là Nguyễn Văn A (グエン・ヴァン・A), BrSE của Acme, đang làm dự án đặt phòng khách sạn cho CustomerX.',
    'Khách hàng là công ty Nhật, tôi thường trao đổi với PM (Tanaka) và tester (Suzuki).',
    'Khi viết tiếng Nhật, hãy xưng hô khiêm nhường, gọi khách là 〇〇様, và ký tên "Acme グエン" khi tin nhắn dài.',
    'Thuật ngữ kỹ thuật (deploy, API, UAT) giữ nguyên tiếng Anh.',
  ].join('\n'),
  quickActions: {
    enabled: true,
    appScope: 'selected',
    apps: DEFAULT_QUICK_ACTION_APPS,
    display: 'iconText',
    items: DEFAULT_QUICK_ACTION_ITEMS,
  },
  glossaryPath: 'D:\\projects\\customerx\\docs\\glossary.yaml',
  autostart: true,
  blockedApps: ['1Password.exe', 'KeePass.exe'],
  hotkeysPaused: false,
}

export function StoreProvider({ children, initialScreen = 'playground', initialMainTab = 'threads' }: { children: ReactNode; initialScreen?: Screen; initialMainTab?: MainTab }) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [mainTab, setMainTab] = useState<MainTab>(initialMainTab)
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [threads, setThreads] = useState<Thread[]>(initialThreads)
  const [selectedThreadId, selectThread] = useState(initialThreads[0].id)
  const [glossary, setGlossary] = useState(initialGlossary)
  const [contacts, setContacts] = useState(initialContacts)
  const [settings, setSettings] = useState(defaultSettings)
  const [toast, setToast] = useState<Toast | null>(null)
  const [popupGeometry, setPopupGeometry] = useState<PopupGeometry>({ width: DEFAULT_POPUP_WIDTH, height: null, position: null })
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  const openMain = useCallback((tab?: MainTab) => {
    if (tab) setMainTab(tab)
    setScreen('main')
  }, [])

  const addMessage = useCallback((threadId: string, msg: Omit<ThreadMessage, 'id'>) => {
    setThreads((ts) => {
      const target = ts.find((t) => t.id === threadId)
      if (!target) return ts
      const updated = { ...target, lastActive: 'vừa xong', messages: [...target.messages, { ...msg, id: newId('m') }] }
      // Most recent thread first, like the real list.
      return [updated, ...ts.filter((t) => t.id !== threadId)]
    })
  }, [])

  const createThread = useCallback((conversationId: string, title: string) => {
    const id = newId('t')
    setThreads((ts) => [
      { id, conversationId, title, summary: 'Thread mới, chưa có tóm tắt.', lastActive: 'vừa xong', pinned: false, messages: [] },
      ...ts,
    ])
    return id
  }, [])

  const updateThread = useCallback((id: string, patch: Partial<Thread>) => {
    setThreads((ts) =>
      ts.map((t) => {
        if (patch.pinned && t.conversationId === ts.find((x) => x.id === id)?.conversationId && t.id !== id) {
          return { ...t, pinned: false }
        }
        return t.id === id ? { ...t, ...patch } : t
      }),
    )
  }, [])

  // In the real app the Rust side owns the settings: every window loads them, saves through it, and follows
  // changes made in other windows (the popup uses the profile and keigo chosen in the main window).
  const settingsRef = useRef(defaultSettings)
  const applySettings = useCallback((next: Settings) => {
    settingsRef.current = next
    setSettings(next)
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch }
      applySettings(next)
      if (!isTauri) return
      invoke<{ failedHotkeys: string[] }>('settings_set', { value: next })
        .then(({ failedHotkeys }) => {
          if (failedHotkeys.length > 0) showToast(`Không đăng ký được ${failedHotkeys.join(', ')}: ứng dụng khác đang dùng tổ hợp này`)
        })
        .catch((e) => showToast(`Không lưu được cài đặt: ${String(e)}`))
    },
    [applySettings, showToast],
  )

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const merge = (saved: unknown) => {
      if (alive && saved && typeof saved === 'object') applySettings({ ...defaultSettings, ...(saved as Partial<Settings>) })
    }
    void invoke('settings_get').then(merge)
    const off = listen('settings:changed', (e) => merge(e.payload))
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
      threads,
      selectedThreadId,
      selectThread,
      addMessage,
      createThread,
      updateThread,
      glossary,
      setGlossary,
      contacts,
      setContacts,
      settings,
      updateSettings,
      toast,
      showToast,
      popupGeometry,
      setPopupGeometry,
    }),
    [screen, mainTab, openMain, scenario, threads, selectedThreadId, addMessage, createThread, updateThread, glossary, contacts, settings, updateSettings, toast, showToast, popupGeometry],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

