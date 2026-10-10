import { X } from 'lucide-react'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
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
  onHoverChange,
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
  onHoverChange?: (hover: boolean) => void
  style?: CSSProperties
  className?: string
  /** In its own window, Windows draws the border and shadow. */
  bare?: boolean
}) {
  // The bar can disappear under the pointer (after a click), which never fires mouseleave.
  useEffect(() => () => onHoverChange?.(false), [onHoverChange])

  return (
    <div
      role="toolbar"
      aria-label="Thao tác nhanh MyTranslate"
      data-quick-bar
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cx(
        // Same height, padding and icon size in both display modes; only the labels come and go.
        'flex w-max items-center gap-0.5 bg-window p-1',
        !bare && 'anim-popup rounded-[10px] border border-line shadow-popup',
        className,
      )}
    >
      {visibleQuickActions(items, japanese).map((id) => {
        const meta = quickActionMeta[id]
        const Icon = meta.icon
        return (
          <BarButton
            key={id}
            onClick={() => onAction(id)}
            icon={<Icon size={16} strokeWidth={1.9} />}
            primary={meta.primary}
            iconOnly={display === 'iconOnly'}
            nativeTooltip={bare}
            title={meta.title}
          >
            {meta.label(japanese)}
          </BarButton>
        )
      })}
      {onDismiss && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
          <button
            type="button"
            aria-label="Ẩn thanh thao tác"
            title={bare ? 'Ẩn (Esc)' : undefined}
            onClick={onDismiss}
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X size={14} />
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
        'group relative flex h-8 shrink-0 items-center justify-center rounded-md text-[13px] font-medium whitespace-nowrap transition-colors',
        iconOnly ? 'w-8' : 'gap-1.5 pr-3 pl-2.5',
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
