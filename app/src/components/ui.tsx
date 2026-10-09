import { Minus, Square, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './styles'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-hover',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'danger' && 'bg-bad text-white hover:opacity-90',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-subtle px-1 font-sans text-[11px] leading-none font-medium text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function Hotkey({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {combo.split('+').map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={-1}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-6 rounded-[5px] px-2 text-[12.5px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-subtle',
      )}
    >
      <span
        className={cx(
          'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all',
          checked ? 'left-[18px] bg-on-accent' : 'left-[2px] bg-ink-2',
        )}
      />
    </button>
  )
}

/** Windows 11 style window with a title bar. */
export function WindowFrame({
  title,
  icon,
  children,
  className,
  onClose,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  onClose?: () => void
}) {
  return (
    <div className={cx('flex flex-col overflow-hidden rounded-lg border border-line bg-window shadow-window', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 select-none">
        {icon}
        <span className="flex-1 truncate text-[12px] text-ink-2">{title}</span>
        <div className="flex h-full">
          <span className="flex w-11 items-center justify-center text-ink-2" aria-hidden>
            <Minus size={14} />
          </span>
          <span className="flex w-11 items-center justify-center text-ink-2" aria-hidden>
            <Square size={11} />
          </span>
          <button
            type="button"
            aria-label="Đóng cửa sổ"
            onClick={onClose}
            className="flex w-11 items-center justify-center text-ink-2 hover:bg-bad hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

export function AppMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <text x="7" y="21" fontSize="14" fontWeight="700" fill="var(--accent-text)" fontFamily="Yu Gothic UI, Meiryo, sans-serif">
        あ
      </text>
      <text x="19" y="26" fontSize="10" fontWeight="700" fill="var(--accent-text)" opacity="0.8" fontFamily="Segoe UI, sans-serif">
        A
      </text>
    </svg>
  )
}
