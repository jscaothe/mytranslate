import { invoke } from '@tauri-apps/api/core'
import { Lock, Plus, Search, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { yamlEntry } from '../../lib/glossary'
import { newId, useStore } from '../../store'

type Filter = 'all' | 'personal' | 'project'

interface TermRow {
  id: number
  ja: string
  vi: string
  note: string
}

interface TeamGlossary {
  path: string
  project: string
  terms: { ja: string; vi: string; note: string }[]
  error: string | null
}

/**
 * The glossary. Personal terms live in the database on this PC; the team's terms are read from the shared YAML
 * file set in Settings. Terms that occur in a text are sent to Claude with it; personal ones win.
 */
export function GlossaryView() {
  const { glossary, setGlossary, showToast, settings } = useStore()
  const [team, setTeam] = useState<TeamGlossary | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [ja, setJa] = useState('')
  const [vi, setVi] = useState('')
  const [note, setNote] = useState('')

  const reload = useCallback(() => {
    void invoke<TermRow[]>('glossary_list').then((rows) =>
      setGlossary(rows.map((r) => ({ id: String(r.id), ja: r.ja, vi: r.vi, note: r.note, scope: 'personal' as const }))),
    )
  }, [setGlossary])

  useEffect(() => {
    if (isTauri) reload()
  }, [reload])

  // The team file is re-read when the screen opens or the path changes (the Rust side caches it by mtime).
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    void invoke<TeamGlossary>('glossary_team').then((g) => alive && setTeam(g))
    return () => {
      alive = false
    }
  }, [settings.glossaryPath])

  const teamName = isTauri ? team?.project || 'Dự án' : 'CustomerX'
  const all = isTauri
    ? [...glossary, ...(team?.terms ?? []).map((t, i) => ({ ...t, id: `team-${i}`, scope: 'project' as const }))]
    : glossary
  const hasTeam = !isTauri || Boolean(team?.path)

  const q = query.trim().toLowerCase()
  const rows = all.filter(
    (t) =>
      (filter === 'all' || t.scope === filter) &&
      (!q || t.ja.includes(q) || t.vi.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)),
  )

  const add = () => {
    if (!ja.trim() || !vi.trim()) return
    const reset = () => {
      setJa('')
      setVi('')
      setNote('')
    }
    if (!isTauri) {
      setGlossary([{ id: newId('g'), ja: ja.trim(), vi: vi.trim(), note: note.trim(), scope: 'personal' }, ...glossary])
      reset()
      showToast('Đã thêm vào glossary cá nhân')
      return
    }
    invoke('glossary_add', { ja, vi, note })
      .then(() => {
        reset()
        reload()
        showToast('Đã thêm thuật ngữ')
      })
      .catch((e) => showToast(`Không thêm được: ${String(e)}`))
  }

  const copyYaml = (t: { ja: string; vi: string; note: string }) => {
    const text = yamlEntry(t)
    const done = () => showToast('Đã sao chép đoạn YAML, dán vào mục terms của file glossary chung')
    if (isTauri) void invoke('clipboard_write', { text }).then(done)
    else void navigator.clipboard.writeText(text).then(done, done)
  }

  const remove = (id: string) => {
    if (!isTauri) {
      setGlossary(glossary.filter((x) => x.id !== id))
      return
    }
    invoke('glossary_delete', { id: Number(id) })
      .then(reload)
      .catch((e) => showToast(`Không xóa được: ${String(e)}`))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Glossary</h2>
        {hasTeam && (
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
        )}
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
              {hasTeam && <th className="py-2 font-semibold">Phạm vi</th>}
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
                {hasTeam && (
                  <td className="py-2.5">
                    {t.scope === 'project' ? (
                      <span className="inline-flex max-w-40 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent" title="Chỉ sửa được trong file glossary chung">
                        <Lock size={11} className="shrink-0" /> <span className="truncate">{teamName}</span>
                      </span>
                    ) : (
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-medium text-ink-2">Cá nhân</span>
                    )}
                  </td>
                )}
                <td className="py-1 pr-5 text-right">
                  {t.scope === 'personal' && (
                    <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {hasTeam && (
                        <IconButton label="Đề xuất vào glossary chung (sao chép YAML)" onClick={() => copyYaml(t)}>
                          <Share2 size={14} />
                        </IconButton>
                      )}
                      <IconButton label="Xóa" onClick={() => remove(t.id)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasTeam ? 5 : 4} className="py-10 text-center text-ink-3">
                  {q ? 'Không có thuật ngữ nào khớp' : 'Chưa có thuật ngữ nào. Thêm tên màn hình, tên tính năng hay thuật ngữ khách hay dùng.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2 text-[12px] text-ink-3">
        {team?.error ? (
          <span className="text-bad">
            Glossary chung <code className="rounded bg-subtle px-1">{team.path}</code>: {team.error}
          </span>
        ) : hasTeam ? (
          <>
            Thuật ngữ dự án đọc từ <code className="rounded bg-subtle px-1">{isTauri ? team?.path : settings.glossaryPath}</code> và chỉ sửa được trong file
            đó. Thuật ngữ cá nhân được ưu tiên khi trùng.
          </>
        ) : (
          'Thuật ngữ xuất hiện trong đoạn cần dịch sẽ được gửi kèm cho Claude. Glossary chung của team đặt trong Cài đặt.'
        )}
      </div>
    </div>
  )
}
