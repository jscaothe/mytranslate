import { AlertTriangle, ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx, inputClass } from '../../components/styles'
import { Button, IconButton, Segmented } from '../../components/ui'
import { runningApps } from '../../data/mock'
import { useT } from '../../lib/i18n'
import { useStore, type AppRef } from '../../store'

const iconColors = ['#0f766e', '#c2410c', '#1d4ed8', '#be185d', '#15803d', '#7c3aed']

/** Recognisable letter and colour for well-known apps, so the list matches what users see in the taskbar. */
const knownIcons: Record<string, { letter: string; color: string }> = {
  'ms-teams.exe': { letter: 'T', color: '#5059c9' },
  'slack.exe': { letter: 'S', color: '#4a154b' },
  'chrome.exe': { letter: 'C', color: '#1a73e8' },
  'msedge.exe': { letter: 'E', color: '#0c8a7e' },
  'olk.exe': { letter: 'O', color: '#0f6cbd' },
  'excel.exe': { letter: 'X', color: '#107c41' },
  'zalo.exe': { letter: 'Z', color: '#0068ff' },
  'chatwork.exe': { letter: 'C', color: '#e5352c' },
  'code.exe': { letter: 'V', color: '#007acc' },
}

export function AppIcon({ app }: { app: AppRef }) {
  const key = app.exe.toLowerCase()
  const hash = [...key].reduce((h, c) => h + c.charCodeAt(0), 0)
  const icon = knownIcons[key] ?? { letter: app.name.slice(0, 1).toUpperCase(), color: iconColors[hash % iconColors.length] }
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white"
      style={{ background: icon.color }}
    >
      {icon.letter}
    </span>
  )
}

const sameExe = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** "Hiện trong ứng dụng nào": every app, or only the listed ones. Shared by Settings and the first-run guide. */
export function AppScopeSetting() {
  const { settings, updateSettings, showToast } = useStore()
  const t = useT()
  const qa = settings.quickActions
  const label = t('Hiện trong ứng dụng nào', '表示するアプリ')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[13.5px] text-ink">{label}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {qa.appScope === 'all'
              ? t('Mọi ứng dụng, trừ các ứng dụng bị chặn ở mục Phím tắt.', 'すべてのアプリ（「ショートカット」で除外したアプリを除く）。')
              : t('Chỉ các ứng dụng trong danh sách dưới đây.', '下のリストのアプリだけ。')}
          </div>
        </div>
        <Segmented
          label={label}
          value={qa.appScope}
          onChange={(appScope) => updateSettings({ quickActions: { ...qa, appScope } })}
          options={[
            { value: 'all', label: t('Mọi ứng dụng', 'すべてのアプリ') },
            { value: 'selected', label: t('Ứng dụng đã chọn', '選んだアプリ') },
          ]}
        />
      </div>
      {qa.appScope === 'selected' && (
        <AppScopeEditor apps={qa.apps} onChange={(apps) => updateSettings({ quickActions: { ...qa, apps } })} onError={showToast} />
      )}
    </div>
  )
}

/** The apps the quick toolbar is limited to: picked from running apps, or typed as an executable name. */
export function AppScopeEditor({
  apps,
  onChange,
  onError,
}: {
  apps: AppRef[]
  onChange: (apps: AppRef[]) => void
  onError: (message: string) => void
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [exe, setExe] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const candidates = runningApps.filter((r) => !apps.some((a) => sameExe(a.exe, r.exe)))

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const addTyped = () => {
    const value = exe.trim()
    if (!/^[\w .+-]+\.exe$/i.test(value)) {
      onError(t('Nhập tên file chương trình, ví dụ: Zalo.exe', 'プログラムのファイル名を入力してください（例: Zalo.exe）'))
      return
    }
    if (apps.some((a) => sameExe(a.exe, value))) {
      onError(t(`${value} đã có trong danh sách`, `${value} はすでにリストにあります`))
      return
    }
    const known = runningApps.find((r) => sameExe(r.exe, value))
    onChange([...apps, known ?? { exe: value, name: value.replace(/\.exe$/i, '') }])
    setExe('')
  }

  return (
    <div className="flex flex-col gap-2.5">
      {apps.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label={t('Ứng dụng hiện thanh thao tác', 'ツールバーを表示するアプリ')}>
          {apps.map((app) => (
            <li key={app.exe} className="flex items-center gap-3 px-3 py-2">
              <AppIcon app={app} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink">{app.name}</div>
                <div className="truncate font-mono text-[11.5px] text-ink-3">{app.exe}</div>
              </div>
              <IconButton label={t(`Bỏ ${app.name}`, `${app.name} を外す`)} onClick={() => onChange(apps.filter((a) => a.exe !== app.exe))}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2.5 text-[12.5px] text-ink">
          <AlertTriangle size={15} className="shrink-0 text-warn" />
          {t('Chưa chọn ứng dụng nào, thanh thao tác sẽ không hiện ở đâu cả.', 'アプリが選ばれていないため、ツールバーはどこにも表示されません。')}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div ref={menuRef} className="relative">
          <Button size="sm" disabled={candidates.length === 0} onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <Plus size={14} /> {t('Thêm ứng dụng đang chạy', '実行中のアプリを追加')} <ChevronDown size={13} className="text-ink-3" />
          </Button>
          {menuOpen && (
            <ul
              role="menu"
              className="anim-popup scroll-thin absolute top-full left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-popup"
            >
              {candidates.map((app) => (
                <li key={app.exe}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange([...apps, app])
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover"
                  >
                    <AppIcon app={app} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{app.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-3">{app.exe}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-[12px] text-ink-3">{t('hoặc', 'または')}</span>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addTyped()
          }}
        >
          <input
            value={exe}
            onChange={(e) => setExe(e.target.value)}
            placeholder={t('Tên file, vd: Zalo.exe', 'ファイル名（例: Zalo.exe）')}
            aria-label={t('Tên file chương trình', 'プログラムのファイル名')}
            className={cx(inputClass, 'h-7 min-w-0 flex-1 font-mono text-[12.5px] placeholder:font-sans')}
          />
          <Button size="sm" type="submit" disabled={!exe.trim()}>
            {t('Thêm', '追加')}
          </Button>
        </form>
      </div>
    </div>
  )
}
