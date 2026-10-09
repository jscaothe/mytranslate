import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { newId, type Template } from '../../store'

const positions = [
  { value: 'before' as const, label: 'Đầu tin' },
  { value: 'after' as const, label: 'Cuối tin' },
]

/** The fixed sentences offered under a Japanese result: greetings go before the message, closings after. */
export function TemplatesEditor({ templates, onChange }: { templates: Template[]; onChange: (t: Template[]) => void }) {
  const [ja, setJa] = useState('')
  const [vi, setVi] = useState('')
  const [position, setPosition] = useState<Template['position']>('after')

  const move = (i: number, by: number) => {
    const next = [...templates]
    const [t] = next.splice(i, 1)
    next.splice(i + by, 0, t)
    onChange(next)
  }

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-line">
        {templates.map((t, i) => (
          <li key={t.id} className="group flex items-center gap-3 px-4 py-2">
            <span
              className={cx(
                'w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11.5px] font-medium',
                t.position === 'before' ? 'bg-accent-soft text-accent' : 'bg-subtle text-ink-2',
              )}
            >
              {t.position === 'before' ? 'Đầu tin' : 'Cuối tin'}
            </span>
            <div className="min-w-0 flex-1">
              <div lang="ja" className="truncate text-[13.5px] text-ink">
                {t.ja}
              </div>
              {t.vi && <div className="truncate text-[12px] text-ink-3">{t.vi}</div>}
            </div>
            <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton label="Lên" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30">
                <ArrowUp size={14} />
              </IconButton>
              <IconButton label="Xuống" disabled={i === templates.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30">
                <ArrowDown size={14} />
              </IconButton>
              <IconButton label={`Xóa ${t.ja}`} onClick={() => onChange(templates.filter((x) => x.id !== t.id))}>
                <Trash2 size={14} />
              </IconButton>
            </span>
          </li>
        ))}
        {templates.length === 0 && <li className="px-4 py-4 text-center text-[13px] text-ink-3">Chưa có mẫu câu nào</li>}
      </ul>
      <form
        className="flex items-center gap-2 border-t border-line bg-subtle px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ja.trim()) return
          onChange([...templates, { id: newId('tpl'), ja: ja.trim(), vi: vi.trim(), position }])
          setJa('')
          setVi('')
        }}
      >
        <input lang="ja" aria-label="Câu tiếng Nhật" value={ja} onChange={(e) => setJa(e.target.value)} placeholder="Câu tiếng Nhật" className={cx(inputClass, 'min-w-0 flex-1')} />
        <input aria-label="Nghĩa" value={vi} onChange={(e) => setVi(e.target.value)} placeholder="Nghĩa (không bắt buộc)" className={cx(inputClass, 'w-44')} />
        <Segmented label="Vị trí" value={position} onChange={setPosition} options={positions} />
        <Button type="submit" variant="primary" disabled={!ja.trim()}>
          <Plus size={14} /> Thêm
        </Button>
      </form>
    </div>
  )
}
