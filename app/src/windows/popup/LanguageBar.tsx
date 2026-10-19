import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { langName, targetsFor, useLang, useT } from '../../lib/i18n'
import { READING_MODES, type ReadingMode } from '../../store'
import type { TextLang } from '../../types'

/**
 * Under the popup's header: the language of the text, the language to translate into (Ctrl+L switches), and for a
 * Japanese translation how to show its reading (Ctrl+H switches).
 */
export function LanguageBar({
  source,
  target,
  onTarget,
  reading,
  onReading,
}: {
  source: TextLang
  target: TextLang
  onTarget: (target: TextLang) => void
  reading: ReadingMode
  onReading: (mode: ReadingMode) => void
}) {
  const t = useT()
  const lang = useLang()
  return (
    <div data-language-bar className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <span className="shrink-0 text-[12px] text-ink-2">{langName(lang, source)}</span>
      <ArrowRight size={12} className="shrink-0 text-ink-3" aria-hidden />
      <div title={t('Dịch sang (Ctrl+L)', '翻訳先の言語 (Ctrl+L)')} className="shrink-0">
        <Segmented
          label={t('Dịch sang', '翻訳先の言語')}
          value={target}
          options={targetsFor(source).map((l) => ({ value: l, label: langName(lang, l) }))}
          onChange={onTarget}
        />
      </div>
      <div className="min-w-0 flex-1" />
      {target === 'ja' && <ReadingMenu mode={reading} onChange={onReading} />}
    </div>
  )
}

/** Over the reading of selected Japanese (the toolbar's reading button): furigana or hiragana, Ctrl+H switches. */
export function ReadingBar({
  mode,
  onMode,
}: {
  mode: Exclude<ReadingMode, 'off'>
  onMode: (mode: Exclude<ReadingMode, 'off'>) => void
}) {
  const t = useT()
  const lang = useLang()
  return (
    <div data-reading-bar className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <span className="shrink-0 text-[12px] text-ink-2">
        {t('Cách đọc', '読み方')} · {langName(lang, 'ja')}
      </span>
      <div className="min-w-0 flex-1" />
      <div title={t('Đổi cách đọc (Ctrl+H)', '読み方を切り替え (Ctrl+H)')} className="shrink-0">
        <Segmented
          label={t('Cách đọc', '読み方')}
          value={mode}
          options={[
            { value: 'furigana', label: t('Furigana', 'ふりがな') },
            { value: 'kana', label: t('Hiragana', 'ひらがな') },
          ]}
          onChange={onMode}
        />
      </div>
    </div>
  )
}

function ReadingMenu({ mode, onChange }: { mode: ReadingMode; onChange: (mode: ReadingMode) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const names: Record<ReadingMode, string> = {
    off: t('Tắt', 'オフ'),
    furigana: t('Furigana', 'ふりがな'),
    kana: t('Hiragana', 'ひらがな'),
  }
  const hints: Record<ReadingMode, string> = {
    off: t('Chỉ hiện bản dịch', '翻訳のみ表示'),
    furigana: t('Chữ nhỏ trên Kanji', '漢字の上に読み'),
    kana: t('Cả câu bằng hiragana', '文全体をひらがなで'),
  }

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The ticked entry gets the focus, so arrows and Enter work right away.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [open])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  const pick = (m: ReadingMode) => {
    setOpen(false)
    onChange(m)
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(`Cách đọc: ${names[mode]} (Ctrl+H)`, `読み方: ${names[mode]} (Ctrl+H)`)}
        title={t('Cách đọc tiếng Nhật (Ctrl+H)', '日本語の読み方 (Ctrl+H)')}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex h-7 items-center gap-1.5 rounded-md pr-1 pl-1.5 text-[12px] font-medium whitespace-nowrap',
          mode === 'off' ? 'text-ink-2 hover:bg-hover hover:text-ink' : 'bg-accent-soft text-accent',
          open && mode === 'off' && 'bg-hover text-ink',
        )}
      >
        <span lang="ja" aria-hidden className="text-[13px] leading-none">
          あ
        </span>
        {mode === 'off' ? t('Cách đọc', '読み方') : names[mode]}
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('Cách đọc tiếng Nhật', '日本語の読み方')}
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-line bg-surface py-1 shadow-popup"
        >
          {READING_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              onClick={() => pick(m)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{names[m]}</span>
                <span className="block text-[11.5px] text-ink-3">{hints[m]}</span>
              </span>
              {m === mode && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
