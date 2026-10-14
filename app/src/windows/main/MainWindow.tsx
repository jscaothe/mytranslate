import { BookOpen, PenLine, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { AppMark, WindowFrame } from '../../components/ui'
import { UpdateBanner } from '../../components/UpdatePanel'
import { useUpdates } from '../../lib/updates'
import { cx, pressable } from '../../components/styles'
import { useT, type T } from '../../lib/i18n'
import { useStore, type MainTab } from '../../store'
import { GlossaryView } from './GlossaryView'
import { SettingsView } from './SettingsView'
import { WritingView } from './WritingView'

/** Every part of the window, together at the top, each with its icon and name (Settings no longer sits apart). */
const nav = (t: T): { tab: MainTab; label: string; icon: ReactNode }[] => [
  { tab: 'glossary', label: t('Glossary', '用語集'), icon: <BookOpen size={18} /> },
  { tab: 'writing', label: t('Kỹ năng viết', '文章力'), icon: <PenLine size={18} /> },
  { tab: 'settings', label: t('Cài đặt', '設定'), icon: <Settings size={18} /> },
]

/** In the prototype the window is drawn on a fake desktop; in Tauri (`chromeless`) the OS draws the frame. */
export function MainWindow({ chromeless = false }: { chromeless?: boolean }) {
  const { setScreen } = useStore()
  if (chromeless) {
    return (
      <div className="flex h-full flex-col bg-window">
        <MainContent />
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <WindowFrame
        title="MyTranslate"
        icon={<AppMark size={16} />}
        onClose={() => setScreen('playground')}
        className="h-full max-h-[700px] w-full max-w-[1040px]"
      >
        <MainContent />
      </WindowFrame>
    </div>
  )
}

function MainContent() {
  const { mainTab, setMainTab } = useStore()
  const t = useT()
  // One update state for the banner and Settings, so progress shows in both.
  const updates = useUpdates()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
    {mainTab !== 'settings' && <UpdateBanner status={updates.status} install={updates.install} onInstall={() => void updates.installNow()} />}
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-[168px] shrink-0 flex-col gap-0.5 border-r border-line p-2" aria-label={t('Điều hướng', 'ナビゲーション')}>
        {nav(t).map((n) => (
          <NavButton key={n.tab} active={mainTab === n.tab} label={n.label} onClick={() => setMainTab(n.tab)}>
            {n.icon}
          </NavButton>
        ))}
      </nav>
      {/* Keyed by tab: opening another tab leaves an error behind. */}
      <ErrorBoundary key={mainTab}>
        {mainTab === 'glossary' && <GlossaryView />}
        {mainTab === 'writing' && <WritingView />}
        {mainTab === 'settings' && <SettingsView updates={updates} />}
      </ErrorBoundary>
    </div>
    </div>
  )
}

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px]',
        pressable,
        active ? 'bg-selected font-semibold text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" />}
      {children}
      {label}
    </button>
  )
}
