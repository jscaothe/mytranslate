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
}: {
  /** Whether the selected text is Japanese; decides labels and which buttons apply. */
  japanese: boolean
  /** Buttons in display order, from Settings. */
  items: QuickActionItem[]
  /** Icon with label, or icon only with the label as tooltip. */
  display?: 'iconText' | 'iconOnly'
  onAction: (a: QuickActionId) => void
  onDismiss?: () => void
  onHoverChange?: (hover: boolean) => void
  style?: CSSProperties
  className?: string
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
      className={cx('anim-popup flex h-9 items-center gap-0.5 rounded-lg border border-line bg-window px-1 shadow-popup', className)}
    >
      {visibleQuickActions(items, japanese).map((id) => {
        const meta = quickActionMeta[id]
        const Icon = meta.icon
        return (
          <BarButton
            key={id}
            onClick={() => onAction(id)}
            icon={<Icon size={display === 'iconOnly' ? 15 : 14} />}
            primary={meta.primary}
            iconOnly={display === 'iconOnly'}
            title={meta.title}
          >
            {meta.label(japanese)}
          </BarButton>
        )
      })}
      {onDismiss && (
        <button
          type="button"
          aria-label="Ẩn thanh thao tác"
          onClick={onDismiss}
          className="ml-0.5 flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function BarButton({
  onClick,
  icon,
  primary,
  iconOnly,
  title,
  children,
}: {
  onClick: () => void
  icon: ReactNode
  primary?: boolean
  iconOnly?: boolean
  title?: string
  children: string
}) {
  return (
    <button
      type="button"
      title={iconOnly ? undefined : title}
      aria-label={iconOnly ? children : undefined}
      onClick={onClick}
      className={cx(
        'group relative flex h-7 items-center rounded-md text-[12.5px] font-medium whitespace-nowrap',
        iconOnly ? 'w-7 justify-center' : 'gap-1.5 px-2',
        primary ? 'text-accent hover:bg-accent-soft' : 'text-ink hover:bg-hover',
      )}
    >
      {icon}
      {!iconOnly && children}
      {iconOnly && (
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
