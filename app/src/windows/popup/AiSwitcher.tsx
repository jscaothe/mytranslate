import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { cx } from '../../components/styles'
import { AI_NAMES, AI_ORDER, modelName, sameChoice, type AiChoice, type QuickChoice } from '../../lib/ai'
import { useT } from '../../lib/i18n'
import type { AiProvider } from '../../store'

/** Distinct at 16 px: Claude and ChatGPT share an initial. */
const MARK_GLYPHS: Record<AiProvider, string> = { claude: 'C', codex: 'G', anthropic: 'C', openai: 'G', gemini: '✦' }

const MARK_COLORS: Record<AiProvider, string> = {
  claude: 'bg-[#d97757]',
  anthropic: 'bg-[#d97757]',
  codex: 'bg-[#10a37f]',
  openai: 'bg-[#10a37f]',
  gemini: 'bg-[#4285f4]',
}

/** A small coloured initial, so the AI in use is recognisable at a glance. */
export function AiMark({ provider, className }: { provider: AiProvider; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9.5px] font-bold text-white', MARK_COLORS[provider], className)}
    >
      {MARK_GLYPHS[provider]}
    </span>
  )
}

/**
 * The AI and model of this translation, in the popup header. Opening it (click or Ctrl+M) lists the quick choices;
 * picking one translates again with it and makes it the default.
 */
export function AiSwitcher({
  choices,
  current,
  answeredBy,
  open,
  onOpenChange,
  onPick,
  onManage,
}: {
  choices: QuickChoice[]
  /** The AI this popup asked for. */
  current: AiChoice
  /** The AI and model that actually answered. */
  answeredBy: AiChoice | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (c: AiChoice) => void
  onManage: () => void
}) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])
  const shown = answeredBy && !sameChoice(answeredBy, current) ? answeredBy : current
  // Another model of the same AI answers quietly: only the model name changes. Another AI is pointed out.
  const fellBack = shown.provider !== current.provider

  // Focus the ticked entry when the menu opens, so arrows and Enter work right away. The popup window is often
  // shorter than the menu: it scrolls rather than running past the window's bottom edge.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (menu) menu.style.maxHeight = `${Math.max(120, window.innerHeight - menu.getBoundingClientRect().top - 8)}px`
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[data-choice]:not(:disabled)') ?? [])]
    ;(items.find((b) => b.dataset.current === 'true') ?? items[0])?.focus()
  }, [open])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const groups = AI_ORDER
    .map((p) => ({ provider: p, items: choices.filter((c) => c.provider === p) }))
    .filter((g) => g.items.length > 0)

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(
          `AI dịch: ${AI_NAMES[shown.provider]} ${modelName(shown.provider, shown.model)}. Đổi AI (Ctrl+M)`,
          `翻訳AI: ${AI_NAMES[shown.provider]} ${modelName(shown.provider, shown.model)}。AIを変更 (Ctrl+M)`,
        )}
        title={
          fellBack
            ? t(
                `${AI_NAMES[current.provider]} không dịch được, đã dùng ${AI_NAMES[shown.provider]}`,
                `${AI_NAMES[current.provider]} で翻訳できなかったため ${AI_NAMES[shown.provider]} を使用しました`,
              )
            : t('Đổi AI dịch (Ctrl+M)', '翻訳AIを変更 (Ctrl+M)')
        }
        onClick={() => onOpenChange(!open)}
        className={cx(
          'flex h-7 max-w-[150px] items-center gap-1.5 rounded-md pr-1 pl-1.5 text-[12px] font-medium whitespace-nowrap',
          fellBack ? 'bg-warn-soft text-warn' : 'text-ink-2 hover:bg-hover hover:text-ink',
          open && 'bg-hover text-ink',
        )}
      >
        <AiMark provider={shown.provider} />
        <span className="truncate">{modelName(shown.provider, shown.model)}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('Chọn AI dịch', '翻訳AIを選択')}
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-30 mt-1 w-64 overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface py-1 shadow-popup"
        >
          {groups.map((g) => (
            <div key={g.provider} className="py-0.5">
              <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[11.5px] font-semibold text-ink-3">
                <AiMark provider={g.provider} className="size-3.5 text-[8.5px]" />
                {AI_NAMES[g.provider]}
                {!g.items[0].available && (
                  <span className="font-normal">
                    · {g.provider === 'codex' ? t('chưa thiết lập', '未設定') : t('chưa có API key', 'APIキー未設定')}
                  </span>
                )}
              </div>
              {g.items.map((c) => {
                const ticked = sameChoice(c, current)
                return (
                  <button
                    key={`${c.provider}|${c.model}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={ticked}
                    data-choice
                    data-current={ticked}
                    disabled={!c.available}
                    onClick={() => onPick({ provider: c.provider, model: c.model })}
                    className="flex h-8 w-full items-center gap-2 pr-3 pl-8 text-left text-[13px] text-ink outline-none hover:bg-hover focus-visible:bg-hover disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1 truncate">{modelName(c.provider, c.model)}</span>
                    {ticked && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={onManage}
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] text-ink-2 outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
          >
            <Settings2 size={14} /> {t('Thêm AI hoặc model…', 'AI・モデルを追加…')}
          </button>
        </div>
      )}
    </div>
  )
}
