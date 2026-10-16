import { EyeOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLang, useT } from '../lib/i18n'
import { useStore, type QuickActionId, type QuickActionItem } from '../store'
import { quickActionMeta, visibleQuickActions } from './quickActions'
import { cx, pressable } from './styles'
import { Kbd } from './ui'

/** How long the pointer rests on a button before its shortcut shows: a pointer passing over shows nothing. */
const HINT_DELAY_MS = 300

/**
 * Small toolbar shown next to a mouse selection. Buttons use onMouseDown preventDefault so the selection
 * (and the composer focus) survive the click, exactly like the real app must not steal focus.
 * Resting the pointer on a button opens a line under the buttons with its keyboard shortcut, so the user learns
 * they need not reach for the mouse. It is part of the bar rather than a floating tooltip: in its own small window
 * a tooltip would be cut off, and the window grows to fit the bar.
 */
export function QuickActionBar({
  items,
  display = 'iconText',
  onAction,
  onDismiss,
  hideIn,
  style,
  className,
  bare = false,
}: {
  /** Buttons in display order, from Settings. */
  items: QuickActionItem[]
  /** Icon with label, or icon only with the label shown with the shortcut. */
  display?: 'iconText' | 'iconOnly'
  onAction: (a: QuickActionId) => void
  onDismiss?: () => void
  /** The app the bar is shown in: the close button opens a menu to turn the bar off there. */
  hideIn?: { name: string; onHide: () => void }
  style?: CSSProperties
  className?: string
  /** In its own window, Windows draws the border and rounded corners. */
  bare?: boolean
}) {
  const t = useT()
  const meta = quickActionMeta(useLang())
  const { hotkeys } = useStore().settings
  const shortcut: Record<QuickActionId, string> = { translate: hotkeys.auto, review: hotkeys.review }
  const iconOnly = display === 'iconOnly'

  // The button the pointer rests on. Once a hint shows, moving to the next button switches it at once.
  const [hinted, setHinted] = useState<QuickActionId | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const enter = (id: QuickActionId) => {
    window.clearTimeout(timer.current)
    if (hinted) setHinted(id)
    else timer.current = window.setTimeout(() => setHinted(id), HINT_DELAY_MS)
  }
  const leave = () => {
    window.clearTimeout(timer.current)
    setHinted(null)
  }
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      data-quick-bar
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onMouseLeave={leave}
      className={cx('flex w-max flex-col bg-window p-1', !bare && 'anim-popup rounded-lg border border-line shadow-popup', className)}
    >
      <div
        role="toolbar"
        aria-label={t('Thao tác nhanh MyTranslate', 'MyTranslate クイック操作')}
        // Same height, padding and icon size in both display modes; only the labels come and go. 32 px in all
        // (4 + 24 + 4) is a whole number of pixels at 100/125/150/175 % scaling, so top and bottom stay even.
        className="flex h-6 items-center gap-0.5"
      >
        {visibleQuickActions(items).map((id) => {
          const action = meta[id]
          const Icon = action.icon
          return (
            <BarButton
              key={id}
              onClick={() => {
                leave()
                onAction(id)
              }}
              onHover={() => !menuOpen && enter(id)}
              icon={<Icon size={11} strokeWidth={2.2} />}
              primary={action.primary}
              iconOnly={iconOnly}
              shortcut={shortcut[id]}
            >
              {action.label}
            </BarButton>
          )
        })}
        {onDismiss && (
          <>
            <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />
            <button
              type="button"
              aria-label={t('Ẩn thanh thao tác', 'ツールバーを隠す')}
              aria-haspopup={hideIn ? 'menu' : undefined}
              aria-expanded={hideIn ? menuOpen : undefined}
              onMouseEnter={leave}
              onClick={hideIn ? () => setMenuOpen((o) => !o) : onDismiss}
              className={cx(
                'flex size-6 shrink-0 items-center justify-center rounded-[5px] hover:bg-hover hover:text-ink',
                menuOpen ? 'bg-hover text-ink' : 'text-ink-3',
                pressable,
              )}
            >
              <X size={10} strokeWidth={2.2} />
            </button>
          </>
        )}
      </div>
      {/* Part of the bar like the shortcut line: in its own small window a floating menu would be cut off. */}
      {hideIn && menuOpen && (
        <div className="mt-1 border-t border-line pt-1">
          <div role="menu" aria-label={t('Ẩn thanh thao tác', 'ツールバーを隠す')}>
            <button
              type="button"
              role="menuitem"
              onClick={hideIn.onHide}
              className={cx('flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-[12.5px] whitespace-nowrap text-ink hover:bg-hover', pressable)}
            >
              <EyeOff size={13} className="shrink-0 text-ink-2" />
              {t(`Tắt trong ${hideIn.name}`, `${hideIn.name} では表示しない`)}
            </button>
          </div>
          <p className="px-2 pt-0.5 pb-1 text-[11px] whitespace-nowrap text-ink-3">
            {t('Bật lại trong Cài đặt > Thao tác nhanh', '「設定 > クイック操作」で元に戻せます')}
          </p>
        </div>
      )}
      {hinted && !menuOpen && (
        <div role="tooltip" className="mt-1 flex items-center gap-1 border-t border-line px-1 pt-1.5 pb-0.5 text-[11.5px] whitespace-nowrap text-ink-2">
          {iconOnly && <span className="mr-0.5 font-semibold text-ink">{meta[hinted].label}</span>}
          <span className="mr-0.5">{t('Phím tắt', 'ショートカット')}</span>
          {shortcut[hinted].split('+').map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </div>
      )}
    </div>
  )
}

function BarButton({
  onClick,
  onHover,
  icon,
  primary,
  iconOnly,
  shortcut,
  children,
}: {
  onClick: () => void
  onHover: () => void
  icon: ReactNode
  primary?: boolean
  iconOnly?: boolean
  shortcut: string
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={iconOnly ? children : undefined}
      aria-keyshortcuts={shortcut.replace('Ctrl', 'Control')}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cx(
        'flex h-6 shrink-0 items-center justify-center rounded-[5px] text-[12px] whitespace-nowrap hover:bg-hover hover:text-ink',
        pressable,
        iconOnly ? 'w-6' : 'gap-1 pr-2 pl-1.5',
        primary ? 'font-semibold text-ink' : 'font-medium text-ink-2',
      )}
    >
      {icon}
      {!iconOnly && children}
    </button>
  )
}
