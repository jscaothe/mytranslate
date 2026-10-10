import { BookOpen, Languages, MessagesSquare, Settings, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppMark, WindowFrame } from '../../components/ui'
import { UpdateBanner } from '../../components/UpdatePanel'
import { useUpdates } from '../../lib/updates'
import { cx } from '../../components/styles'
import { useStore, type MainTab } from '../../store'
import { ContactsView } from './ContactsView'
import { GlossaryView } from './GlossaryView'
import { SettingsView } from './SettingsView'
import { ThreadsView } from './ThreadsView'
import { TranslateView } from './TranslateView'

const nav: { tab: MainTab; label: string; icon: ReactNode }[] = [
  { tab: 'translate', label: 'Dịch', icon: <Languages size={19} /> },
  { tab: 'threads', label: 'Threads', icon: <MessagesSquare size={19} /> },
  { tab: 'glossary', label: 'Glossary', icon: <BookOpen size={19} /> },
  { tab: 'contacts', label: 'Người liên hệ', icon: <Users size={19} /> },
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
  // One update state for the banner and Settings, so progress shows in both.
  const updates = useUpdates()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
    {mainTab !== 'settings' && <UpdateBanner status={updates.status} install={updates.install} onInstall={() => void updates.installNow()} />}
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line py-2" aria-label="Điều hướng">
        {nav.map((n) => (
          <NavButton key={n.tab} active={mainTab === n.tab} label={n.label} onClick={() => setMainTab(n.tab)}>
            {n.icon}
          </NavButton>
        ))}
        <div className="flex-1" />
        <NavButton active={mainTab === 'settings'} label="Cài đặt" onClick={() => setMainTab('settings')}>
          <Settings size={19} />
        </NavButton>
      </nav>
      {mainTab === 'translate' && <TranslateView />}
      {mainTab === 'threads' && <ThreadsView />}
      {mainTab === 'glossary' && <GlossaryView />}
      {mainTab === 'contacts' && <ContactsView />}
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
