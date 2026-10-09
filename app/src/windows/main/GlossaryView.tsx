import { Lock, Plus, Search, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { newId, useStore } from '../../store'

type Filter = 'all' | 'personal' | 'project'

export function GlossaryView() {
  const { glossary, setGlossary, showToast, settings } = useStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [ja, setJa] = useState('')
  const [vi, setVi] = useState('')
  const [note, setNote] = useState('')

  const q = query.trim().toLowerCase()
  const rows = glossary.filter(
    (t) => (filter === 'all' || t.scope === filter) && (!q || t.ja.includes(q) || t.vi.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)),
  )

  const add = () => {
    if (!ja.trim() || !vi.trim()) return
    setGlossary([{ id: newId('g'), ja: ja.trim(), vi: vi.trim(), note: note.trim(), scope: 'personal' }, ...glossary])
    setJa('')
    setVi('')
    setNote('')
    showToast('Đã thêm vào glossary cá nhân')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Glossary</h2>
        <Segmented
          label="Lọc phạm vi"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'personal', label: 'Cá nhân' },
            { value: 'project', label: 'Dự án' },
          ]}
        />
        <div className="flex-1" />
        <label className="flex h-8 w-64 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={14} className="text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm thuật ngữ"
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-b border-line bg-subtle px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={ja} onChange={(e) => setJa(e.target.value)} placeholder="Tiếng Nhật" className={cx(inputClass, 'w-44')} />
        <input value={vi} onChange={(e) => setVi(e.target.value)} placeholder="Tiếng Việt" className={cx(inputClass, 'w-52')} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (không bắt buộc)" className={cx(inputClass, 'flex-1')} />
        <Button variant="primary" type="submit" disabled={!ja.trim() || !vi.trim()}>
          <Plus size={14} /> Thêm
        </Button>
      </form>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-window">
            <tr className="border-b border-line text-left text-[12px] text-ink-3">
              <th className="py-2 pl-5 font-semibold">Tiếng Nhật</th>
              <th className="py-2 font-semibold">Tiếng Việt</th>
              <th className="py-2 font-semibold">Ghi chú</th>
              <th className="py-2 font-semibold">Phạm vi</th>
              <th className="w-24 py-2 pr-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="group border-b border-line hover:bg-subtle">
                <td lang="ja" className="py-2.5 pl-5 text-[14px] text-ink">
                  {t.ja}
                </td>
                <td className="py-2.5 text-ink">{t.vi}</td>
                <td className="py-2.5 text-ink-2">{t.note}</td>
                <td className="py-2.5">
                  {t.scope === 'project' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                      <Lock size={11} /> CustomerX
                    </span>
                  ) : (
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-medium text-ink-2">Cá nhân</span>
                  )}
                </td>
                <td className="py-1 pr-5 text-right">
                  {t.scope === 'personal' && (
                    <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconButton label="Đề xuất vào glossary chung" onClick={() => showToast('Đã sao chép đoạn YAML, dán vào file glossary chung của dự án')}>
                        <Share2 size={14} />
                      </IconButton>
                      <IconButton label="Xóa" onClick={() => setGlossary(glossary.filter((x) => x.id !== t.id))}>
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-ink-3">
                  Không có thuật ngữ nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2 text-[12px] text-ink-3">
        Thuật ngữ dự án được đọc từ <code className="rounded bg-subtle px-1">{settings.glossaryPath}</code> và chỉ sửa được trong file đó.
      </div>
    </div>
  )
}
