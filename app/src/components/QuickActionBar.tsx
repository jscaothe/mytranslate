import { X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useLang, useT } from '../lib/i18n'
import type { QuickActionId, QuickActionItem } from '../store'
import { quickActionMeta, visibleQuickActions } from './quickActions'
import { cx } from './styles'

/**
 * Small toolbar shown next to a mouse selection. Buttons use onMouseDown preventDefault so the selection
 * (and the composer focus) survive the click, exactly like the real app must not steal focus.
 */
export function QuickActionBar({
  japanese,
  items,
  display = 'iconText',
  onAction,
  onDismiss,
  style,
  className,
  bare = false,
}: {
  /** Whether the selected text is Japanese; decides labels and which buttons apply. `null`: not known. */
  japanese: boolean | null
  /** Buttons in display order, from Settings. */
  items: QuickActionItem[]
  /** Icon with label, or icon only with the label as tooltip. */
  display?: 'iconText' | 'iconOnly'
  onAction: (a: QuickActionId) => void
  onDismiss?: () => void
  style?: CSSProperties
  className?: string
  /** In its own window, Windows draws the border and rounded corners. */
  bare?: boolean
}) {
  const t = useT()
  const meta = quickActionMeta(useLang())
  return (
    <div
      role="toolbar"
      aria-label={t('Thao tác nhanh MyTranslate', 'MyTranslate クイック操作')}
      data-quick-bar
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      className={cx(
        // Same height, padding and icon size in both display modes; only the labels come and go. 32 px in all
        // (4 + 24 + 4) is a whole number of pixels at 100/125/150/175 % scaling, so top and bottom stay even.
        'flex h-8 w-max items-center gap-0.5 bg-window p-1',
        !bare && 'anim-popup rounded-lg border border-line shadow-popup',
        className,
      )}
    >
      {visibleQuickActions(items, japanese).map((id) => {
        const action = meta[id]
        const Icon = action.icon
        return (
          <BarButton
            key={id}
            onClick={() => onAction(id)}
            icon={<Icon size={11} strokeWidth={2.2} />}
            primary={action.primary}
            iconOnly={display === 'iconOnly'}
            nativeTooltip={bare}
            title={action.title}
          >
            {action.label(japanese)}
          </BarButton>
        )
      })}
      {onDismiss && (
        <>
          <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />
          <button
            type="button"
            aria-label={t('Ẩn thanh thao tác', 'ツールバーを隠す')}
            title={bare ? t('Ẩn (Esc)', '隠す (Esc)') : undefined}
            onClick={onDismiss}
            className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X size={10} strokeWidth={2.2} />
          </button>
        </>
      )}
    </div>
  )
}

function BarButton({
  onClick,
  icon,
  primary,
  iconOnly,
  nativeTooltip,
  title,
  children,
}: {
  onClick: () => void
  icon: ReactNode
  primary?: boolean
  iconOnly?: boolean
  /** In its own small window a drawn tooltip would be cut off; let Windows draw it. */
  nativeTooltip?: boolean
  title?: string
  children: string
}) {
  const tooltip = iconOnly ? (title ? `${children} · ${title}` : children) : title
  return (
    <button
      type="button"
      title={nativeTooltip || !iconOnly ? tooltip : undefined}
      aria-label={iconOnly ? children : undefined}
      onClick={onClick}
      className={cx(
        'group relative flex h-6 shrink-0 items-center justify-center rounded-[5px] text-[12px] font-medium whitespace-nowrap transition-colors',
        iconOnly ? 'w-6' : 'gap-1 pr-2 pl-1.5',
        primary ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {icon}
      {!iconOnly && children}
      {iconOnly && !nativeTooltip && (
        // Native tooltips take about a second; icon-only buttons need their name faster than that.
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2 rounded-md bg-[#1b1d22] px-2 py-1 text-[12px] font-normal whitespace-nowrap text-white opacity-0 shadow-popup transition-opacity delay-200 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-[#eceef2] dark:text-[#1b1d22]"
        >
          {children}
          {title && <span className="ml-1 opacity-70">· {title}</span>}
        </span>
      )}
    </button>
  )
}
