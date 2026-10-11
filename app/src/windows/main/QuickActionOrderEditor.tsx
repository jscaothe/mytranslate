import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { quickActionMeta } from '../../components/quickActions'
import { cx } from '../../components/styles'
import { IconButton, Switch } from '../../components/ui'
import { useLang, useT } from '../../lib/i18n'
import type { QuickActionItem } from '../../store'

/**
 * Ordered list of toolbar buttons. Drag a row by its grip, or use the arrow buttons from the keyboard.
 * At least one button always stays on, otherwise the toolbar would be empty.
 */
export function QuickActionOrderEditor({
  items,
  onChange,
  onBlocked,
}: {
  items: QuickActionItem[]
  onChange: (items: QuickActionItem[]) => void
  onBlocked: (message: string) => void
}) {
  const t = useT()
  const metas = quickActionMeta(useLang())
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  /** Gap the dragged row would land in: 0 = before the first row, items.length = after the last. */
  const [dropGap, setDropGap] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    onChange(next)
  }

  const dropAt = (gap: number) => {
    if (dragIndex === null) return
    // Removing the row first shifts every later gap up by one.
    move(dragIndex, gap > dragIndex ? gap - 1 : gap)
  }

  const toggle = (index: number, enabled: boolean) => {
    if (!enabled && items.filter((i) => i.enabled).length === 1) {
      onBlocked(t('Cần giữ ít nhất một nút trên thanh thao tác', 'ツールバーには少なくとも1つのボタンが必要です'))
      return
    }
    onChange(items.map((it, i) => (i === index ? { ...it, enabled } : it)))
  }

  const endDrag = () => {
    setDragIndex(null)
    setDropGap(null)
  }

  return (
    <ol className="flex flex-col" aria-label={t('Thứ tự các nút trên thanh thao tác', 'ツールバーのボタンの順番')}>
      {items.map((item, index) => {
        const meta = metas[item.id]
        const Icon = meta.icon
        return (
          <li
            key={item.id}
            onDragOver={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setDropGap(e.clientY < r.top + r.height / 2 ? index : index + 1)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dropGap !== null) dropAt(dropGap)
              endDrag()
            }}
            className={cx(
              'relative flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0',
              dragIndex === index && 'opacity-40',
            )}
          >
            {dropGap === index && <DropLine position="top" />}
            {dropGap === items.length && index === items.length - 1 && <DropLine position="bottom" />}

            <span
              draggable
              onDragStart={(e) => {
                setDragIndex(index)
                e.dataTransfer.effectAllowed = 'move'
                // Use the whole row as the drag image, not just the grip.
                const row = e.currentTarget.closest('li')
                if (row) e.dataTransfer.setDragImage(row, 24, 20)
              }}
              onDragEnd={endDrag}
              title={t('Kéo để đổi thứ tự', 'ドラッグして並べ替え')}
              className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-ink-3 hover:text-ink active:cursor-grabbing"
            >
              <GripVertical size={15} />
            </span>
            <span className="w-4 shrink-0 text-center text-[12px] font-semibold text-ink-3 tabular-nums">{index + 1}</span>
            <span
              className={cx(
                'flex size-8 shrink-0 items-center justify-center rounded-md',
                item.enabled ? (meta.primary ? 'bg-accent-soft text-accent' : 'bg-subtle text-ink') : 'bg-subtle text-ink-3',
              )}
            >
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className={cx('text-[13.5px]', item.enabled ? 'text-ink' : 'text-ink-3')}>{meta.name}</div>
              <div className="text-[12px] leading-snug text-ink-3">{meta.description}</div>
            </div>
            <div className="flex shrink-0 items-center">
              <IconButton
                label={t(`Đưa "${meta.name}" lên`, `「${meta.name}」を上へ`)}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                className="disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                label={t(`Đưa "${meta.name}" xuống`, `「${meta.name}」を下へ`)}
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
                className="disabled:opacity-30"
              >
                <ArrowDown size={14} />
              </IconButton>
            </div>
            <Switch label={t(`Hiện nút ${meta.name}`, `「${meta.name}」ボタンを表示`)} checked={item.enabled} onChange={(v) => toggle(index, v)} />
          </li>
        )
      })}
    </ol>
  )
}

function DropLine({ position }: { position: 'top' | 'bottom' }) {
  return (
    <span
      aria-hidden
      className={cx('pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-accent', position === 'top' ? '-top-px' : '-bottom-px')}
    />
  )
}
