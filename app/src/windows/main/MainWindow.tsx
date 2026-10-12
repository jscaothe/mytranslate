import { BookOpen, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppMark, WindowFrame } from '../../components/ui'
import { UpdateBanner } from '../../components/UpdatePanel'
import { useUpdates } from '../../lib/updates'
import { cx } from '../../components/styles'
import { useT, type T } from '../../lib/i18n'
import { useStore, type MainTab } from '../../store'
import { GlossaryView } from './GlossaryView'
import { SettingsView } from './SettingsView'

const nav = (t: T): { tab: MainTab; label: string; icon: ReactNode }[] => [
  { tab: 'glossary', label: t('Glossary', '用語集'), icon: <BookOpen size={19} /> },
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
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line py-2" aria-label={t('Điều hướng', 'ナビゲーション')}>
        {nav(t).map((n) => (
          <NavButton key={n.tab} active={mainTab === n.tab} label={n.label} onClick={() => setMainTab(n.tab)}>
            {n.icon}
          </NavButton>
        ))}
        <div className="flex-1" />
        <NavButton active={mainTab === 'settings'} label={t('Cài đặt', '設定')} onClick={() => setMainTab('settings')}>
          <Settings size={19} />
        </NavButton>
      </nav>
      {mainTab === 'glossary' && <GlossaryView />}
      {mainTab === 'settings' && <SettingsView updates={updates} />}
    </div>
    </div>
  )
}

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cx(
        'relative flex size-11 flex-col items-center justify-center rounded-md transition-colors',
        active ? 'bg-selected text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {active && <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-accent" />}
      {children}
    </button>
  )
}
