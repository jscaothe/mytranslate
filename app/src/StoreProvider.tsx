import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { conversations as mockConversations, initialGlossary, initialThreads } from './data/mock'
import { loadHistory } from './lib/history'
import { isTauri } from './lib/claude'
import { DEFAULT_POPUP_WIDTH, DEFAULT_QUICK_ACTION_APPS, DEFAULT_QUICK_ACTION_ITEMS, DEFAULT_TEMPLATES, newId, StoreContext, type MainTab, type PopupGeometry, type Screen, type Settings, type Store, type Toast } from './store'
import type { Conversation, Scenario, Thread, ThreadMessage } from './types'

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
  // The prototype shows how a configured team glossary looks; the real app starts without one.
  glossaryPath: isTauri ? '' : 'D:\\projects\\customerx\\docs\\glossary.yaml',
  templates: DEFAULT_TEMPLATES,
  autostart: true,
  blockedApps: ['1Password.exe', 'KeePass.exe'],
  hotkeysPaused: false,
  onboarded: false,
}

export function StoreProvider({ children, initialScreen = 'playground', initialMainTab = 'threads' }: { children: ReactNode; initialScreen?: Screen; initialMainTab?: MainTab }) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [mainTab, setMainTab] = useState<MainTab>(initialMainTab)
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [threads, setThreads] = useState<Thread[]>(isTauri ? [] : initialThreads)
  const [conversations, setConversations] = useState(isTauri ? [] : mockConversations)
  const [selectedThreadId, selectThread] = useState(initialThreads[0].id)
  const [glossary, setGlossary] = useState(isTauri ? [] : initialGlossary)
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

  const mergeThread = useCallback((from: string, into: string) => {
    setThreads((ts) => {
      const source = ts.find((t) => t.id === from)
      if (!source) return ts
      return ts
        .filter((t) => t.id !== from)
        .map((t) => (t.id === into ? { ...t, pinned: t.pinned || source.pinned, messages: [...t.messages, ...source.messages] } : t))
    })
    selectThread(into)
  }, [])

  const updateConversation = useCallback((id: string, patch: Partial<Pick<Conversation, 'keigo' | 'note'>>) => {
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  // In the real app the Rust side owns the settings: every window loads them, saves through it, and follows
  // changes made in other windows (the popup uses the profile and keigo chosen in the main window).
  const settingsRef = useRef(defaultSettings)
  const [settingsReady, setSettingsReady] = useState(!isTauri)
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

  // Real app: the Threads screen shows the history on this PC and refreshes after every filed translation.
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const refresh = () =>
      void loadHistory().then((h) => {
        if (!alive) return
        setConversations(h.conversations)
        setThreads(h.threads)
      })
    refresh()
    const off = listen('history:changed', refresh)
    return () => {
      alive = false
      void off.then((f) => f())
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const merge = (saved: unknown) => {
      if (alive && saved && typeof saved === 'object') applySettings({ ...defaultSettings, ...(saved as Partial<Settings>) })
    }
    void invoke('settings_get')
      .then(merge)
      .finally(() => alive && setSettingsReady(true))
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
      conversations,
      threads,
      selectedThreadId,
      selectThread,
      addMessage,
      createThread,
      updateThread,
      mergeThread,
      updateConversation,
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
    [screen, mainTab, openMain, scenario, conversations, threads, selectedThreadId, addMessage, createThread, updateThread, mergeThread, updateConversation, glossary, settings, settingsReady, updateSettings, toast, showToast, popupGeometry],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

