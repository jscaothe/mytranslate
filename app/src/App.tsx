import { ChevronUp, FolderOpen, Globe, Moon, Sun, Wifi } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppMark, Hotkey } from './components/ui'
import { cx } from './components/styles'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './lib/claude'
import { comboFromEvent } from './lib/hotkeys'
import { Playground } from './playground/Playground'
import { useStore, type Screen } from './store'
import { StoreProvider } from './StoreProvider'
import type { Scenario } from './types'
import { MainWindow } from './windows/main/MainWindow'
import { Onboarding } from './windows/onboarding/Onboarding'
import { PopupWindow } from './windows/popup/PopupWindow'

const screens: { value: Screen; label: string }[] = [
  { value: 'playground', label: 'Mô phỏng sử dụng' },
  { value: 'main', label: 'Cửa sổ chính' },
  { value: 'onboarding', label: 'Onboarding' },
]

const scenarios: { value: Scenario; label: string }[] = [
  { value: 'normal', label: 'Bình thường' },
  { value: 'uncertain_thread', label: 'Không chắc thread' },
  { value: 'not_logged_in', label: 'Claude chưa đăng nhập' },
  { value: 'quota', label: 'Hết hạn mức' },
  { value: 'network', label: 'Lỗi mạng' },
]

export default function App() {
  if (isTauri) {
    return (
      <StoreProvider initialScreen="main" initialMainTab="translate">
        {getCurrentWindow().label === 'popup' ? <PopupShell /> : <TauriShell />}
      </StoreProvider>
    )
  }
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

/** The translation popup window. */
function PopupShell() {
  const { settings } = useStore()
  const theme = useResolvedTheme(settings.theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return <PopupWindow />
}

/** The real app window: no fake desktop or prototype toolbar. */
function TauriShell() {
  const { settings, settingsReady, toast } = useStore()
  const theme = useResolvedTheme(settings.theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return (
    <div className="relative h-full bg-window">
      {/* Wait for the saved settings, so a returning user never sees the first-run guide flash. */}
      {settingsReady && (settings.onboarded ? <MainWindow chromeless /> : <Onboarding chromeless />)}
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="anim-popup absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#1b1d22] px-4 py-2 text-[13px] text-white shadow-popup dark:bg-[#eceef2] dark:text-[#1b1d22]"
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

function useResolvedTheme(pref: 'system' | 'light' | 'dark') {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
}

function Shell() {
  const { screen, setScreen, scenario, setScenario, settings, updateSettings, openMain, toast } = useStore()
  const theme = useResolvedTheme(settings.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // The "open main window" shortcut works from every screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (comboFromEvent(e) === settings.hotkeys.main) {
        e.preventDefault()
        openMain()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openMain, settings.hotkeys.main])

  return (
    <div className="flex h-full min-h-[680px] min-w-[1180px] flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-window px-4">
        <div className="flex items-center gap-2">
          <AppMark size={20} />
          <span className="text-[14px] font-semibold">MyTranslate</span>
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">Prototype</span>
        </div>
        <nav className="flex items-center gap-1" aria-label="Màn hình">
          {screens.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setScreen(s.value)}
              className={cx(
                'h-8 rounded-md px-3 text-[13px] font-medium',
                screen === s.value ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          Trạng thái giả lập
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as Scenario)}
            className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          >
            {scenarios.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
          title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden bg-desktop">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(1200px 600px at 15% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%), radial-gradient(900px 500px at 100% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%)',
          }}
        />
        {screen === 'playground' && <Playground />}
        {screen === 'main' && <MainWindow />}
        {screen === 'onboarding' && <Onboarding />}
        {toast && (
          <div
            key={toast.id}
            role="status"
            className="anim-popup absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#1b1d22] px-4 py-2 text-[13px] text-white shadow-popup dark:bg-[#eceef2] dark:text-[#1b1d22]"
          >
            {toast.text}
          </div>
        )}
      </main>

      <Taskbar />
    </div>
  )
}

function Taskbar() {
  const { settings, updateSettings, openMain, setScreen, showToast, scenario } = useStore()
  const [trayOpen, setTrayOpen] = useState(false)
  const trayRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!trayOpen) return
    const onDown = (e: MouseEvent) => {
      if (!trayRef.current?.contains(e.target as Node)) setTrayOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTrayOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [trayOpen])

  const claudeOk = scenario === 'normal' || scenario === 'uncertain_thread'
  const claudeLabel = claudeOk ? 'Đã kết nối' : scenario === 'not_logged_in' ? 'Chưa đăng nhập' : scenario === 'quota' ? 'Hết hạn mức' : 'Mất kết nối'

  const item = (label: string, onClick: () => void, right?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => {
        setTrayOpen(false)
        onClick()
      }}
      className="flex h-8 w-full items-center gap-3 rounded-[4px] px-3 text-left text-[13px] text-ink hover:bg-hover"
    >
      <span className="flex-1">{label}</span>
      {right}
    </button>
  )

  return (
    <footer className="relative flex h-12 shrink-0 items-center border-t border-line bg-window/95 px-3 backdrop-blur">
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        {[
          { icon: <span className="flex size-5 items-center justify-center rounded-[4px] bg-[#4a154b] text-[10px] font-bold text-white">S</span>, label: 'Slack' },
          { icon: <span className="flex size-5 items-center justify-center rounded-[4px] bg-[#5059c9] text-[10px] font-bold text-white">T</span>, label: 'Teams' },
          { icon: <Globe size={19} className="text-accent" />, label: 'Trình duyệt' },
          { icon: <FolderOpen size={19} className="text-warn" />, label: 'File Explorer' },
        ].map((a) => (
          <span key={a.label} title={a.label} className="flex size-10 items-center justify-center rounded-md hover:bg-hover">
            {a.icon}
          </span>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <div ref={trayRef} className="relative">
          <button
            type="button"
            aria-label="MyTranslate trong khay hệ thống"
            aria-expanded={trayOpen}
            title="MyTranslate"
            onClick={() => setTrayOpen((o) => !o)}
            className={cx('relative flex size-9 items-center justify-center rounded-md hover:bg-hover', trayOpen && 'bg-hover')}
          >
            <AppMark size={17} />
            {(settings.hotkeysPaused || !claudeOk) && (
              <span className={cx('absolute right-1.5 bottom-1.5 size-2 rounded-full ring-2 ring-window', settings.hotkeysPaused ? 'bg-ink-3' : 'bg-bad')} />
            )}
          </button>
          {trayOpen && (
            <div className="anim-popup absolute right-0 bottom-11 z-50 w-64 rounded-lg border border-line bg-window p-1 shadow-popup">
              {item('Mở MyTranslate', () => openMain('threads'), <Hotkey combo={settings.hotkeys.main} />)}
              <div className="my-1 h-px bg-line" />
              {item(settings.hotkeysPaused ? 'Bật lại phím tắt' : 'Tạm dừng phím tắt', () =>
                updateSettings({ hotkeysPaused: !settings.hotkeysPaused }),
              )}
              <div className="flex h-8 items-center gap-2 px-3 text-[13px] text-ink-2">
                <span className={cx('size-2 rounded-full', claudeOk ? 'bg-good' : 'bg-bad')} />
                Claude: {claudeLabel}
              </div>
              <div className="my-1 h-px bg-line" />
              {item('Cài đặt', () => openMain('settings'))}
              {item('Chạy lại onboarding', () => setScreen('onboarding'))}
              {item('Kiểm tra cập nhật', () => showToast('Bạn đang dùng bản mới nhất (0.1.0)'))}
              {item('Thoát', () => showToast('Prototype: thoát app sẽ tắt toàn bộ phím tắt'))}
            </div>
          )}
        </div>
        <span className="flex h-9 items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-hover">
          <ChevronUp size={14} />
          <Wifi size={15} />
        </span>
        <span className="flex h-9 flex-col items-end justify-center rounded-md px-2 text-[11.5px] leading-tight text-ink hover:bg-hover">
          <span>{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{now.toLocaleDateString('vi-VN')}</span>
        </span>
      </div>
    </footer>
  )
}
