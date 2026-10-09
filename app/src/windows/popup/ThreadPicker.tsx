import { Check, Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../components/styles'
import type { Thread } from '../../types'

export function ThreadPicker({
  threads,
  currentId,
  onPick,
  onCreate,
  onClose,
}: {
  threads: Thread[]
  currentId: string | null
  onPick: (id: string) => void
  onCreate: (title: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const q = query.trim().toLowerCase()
  const matches = threads.filter((t) => !q || t.title.toLowerCase().includes(q))
  // Last row is always "create new thread".
  const rowCount = matches.length + 1

  const choose = (i: number) => {
    if (i < matches.length) onPick(matches[i].id)
    else onCreate(query.trim() || 'Thread mới')
  }

  return (
    <div
      className="absolute top-full left-3 z-20 mt-1 w-[300px] overflow-hidden rounded-lg border border-line bg-surface shadow-popup"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActive((a) => (a + 1) % rowCount)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((a) => (a - 1 + rowCount) % rowCount)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          choose(active)
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5">
        <Search size={14} className="text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          placeholder="Tìm hoặc đặt tên thread mới..."
          className="h-9 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>
      <ul role="listbox" className="scroll-thin max-h-56 overflow-y-auto py-1">
        {matches.map((t, i) => (
          <li key={t.id} role="option" aria-selected={t.id === currentId}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', active === i && 'bg-hover')}
            >
              <span className="flex w-3.5 justify-center text-accent">{t.id === currentId && <Check size={14} />}</span>
              <span className="flex-1 truncate text-[13px] text-ink">{t.title}</span>
              <span className="text-[11.5px] text-ink-3">{t.lastActive}</span>
            </button>
          </li>
        ))}
        <li className="mt-1 border-t border-line pt-1">
          <button
            type="button"
            onMouseEnter={() => setActive(matches.length)}
            onClick={() => choose(matches.length)}
            className={cx(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-accent',
              active === matches.length && 'bg-hover',
            )}
          >
            <Plus size={14} />
            <span className="truncate">{q ? `Tạo thread "${query.trim()}"` : 'Tạo thread mới'}</span>
          </button>
        </li>
      </ul>
    </div>
  )
}
