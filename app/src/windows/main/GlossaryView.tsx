import { invoke } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { CircleAlert, FileText, Lock, Plus, Search, Share2, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { yamlEntry } from '../../lib/glossary'
import { locale, useLang, useT, type T } from '../../lib/i18n'
import { newId, useStore } from '../../store'

type Filter = 'all' | 'personal' | 'project'

interface TermRow {
  id: number
  ja: string
  vi: string
  note: string
}

interface FileError {
  kind: 'not_found' | 'bad_format' | 'unreadable'
  /** The system's or the YAML parser's own message. */
  detail: string
}

interface TeamGlossary {
  path: string
  project: string
  terms: { ja: string; vi: string; note: string }[]
  error: FileError | null
}

function fileErrorText(e: FileError, t: T): string {
  const what =
    e.kind === 'not_found'
      ? t('Không tìm thấy file', 'ファイルが見つかりません')
      : e.kind === 'bad_format'
        ? t('File không đúng định dạng YAML của glossary', '用語集の YAML 形式ではありません')
        : t('Không đọc được file', 'ファイルを読み取れません')
  return e.detail ? `${what}: ${e.detail}` : what
}

/**
 * The glossary. Personal terms live in the database on this PC; the team's terms are read from a shared YAML
 * file chosen at the bottom of this screen. Terms that occur in a text are sent to the AI with it; personal ones win.
 */
export function GlossaryView() {
  const { glossary, setGlossary, showToast, settings, updateSettings } = useStore()
  const t = useT()
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

  const teamName = isTauri ? team?.project || t('Dự án', 'プロジェクト') : 'CustomerX'
  const hasTeam = isTauri ? Boolean(team?.path) : Boolean(settings.glossaryPath)
  // The prototype's sample data mixes in the team's terms; they go away with the file.
  const all = isTauri
    ? [...glossary, ...(team?.terms ?? []).map((term, i) => ({ ...term, id: `team-${i}`, scope: 'project' as const }))]
    : glossary.filter((term) => hasTeam || term.scope === 'personal')

  const q = query.trim().toLowerCase()
  const rows = all.filter(
    (term) =>
      (!hasTeam || filter === 'all' || term.scope === filter) &&
      (!q || term.ja.includes(q) || term.vi.toLowerCase().includes(q) || term.note.toLowerCase().includes(q)),
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
      showToast(t('Đã thêm vào glossary cá nhân', '個人用語集に追加しました'))
      return
    }
    invoke('glossary_add', { ja, vi, note })
      .then(() => {
        reset()
        reload()
        showToast(t('Đã thêm thuật ngữ', '用語を追加しました'))
      })
      .catch((e) => showToast(`${t('Không thêm được', '追加できません')}: ${String(e)}`))
  }

  const copyYaml = (term: { ja: string; vi: string; note: string }) => {
    const text = yamlEntry(term)
    const done = () =>
      showToast(t('Đã sao chép đoạn YAML, dán vào mục terms của file glossary chung', 'YAML をコピーしました。共有用語集ファイルの terms に貼り付けてください'))
    if (isTauri) void invoke('clipboard_write', { text }).then(done)
    else void navigator.clipboard.writeText(text).then(done, done)
  }

  const chooseTeamFile = () => {
    if (!isTauri) {
      updateSettings({ glossaryPath: 'D:\\projects\\customerx\\docs\\glossary.yaml' })
      showToast(t('Mô phỏng: đã chọn file glossary chung', 'シミュレーション: 共有用語集ファイルを選択しました'))
      return
    }
    void openFileDialog({ title: t('Chọn file glossary chung', '共有用語集ファイルを選択'), filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }] }).then(
      (path) => typeof path === 'string' && updateSettings({ glossaryPath: path }),
    )
  }

  const remove = (id: string) => {
    if (!isTauri) {
      setGlossary(glossary.filter((x) => x.id !== id))
      return
    }
    invoke('glossary_delete', { id: Number(id) })
      .then(reload)
      .catch((e) => showToast(`${t('Không xóa được', '削除できません')}: ${String(e)}`))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">{t('Glossary', '用語集')}</h2>
        {hasTeam && (
          <Segmented
            label={t('Lọc phạm vi', '範囲で絞り込み')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('Tất cả', 'すべて') },
              { value: 'personal', label: t('Cá nhân', '個人') },
              { value: 'project', label: t('Dự án', 'プロジェクト') },
            ]}
          />
        )}
        <div className="flex-1" />
        <label className="flex h-8 w-64 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={14} className="text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Tìm thuật ngữ', '用語を検索')}
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
        <input value={ja} onChange={(e) => setJa(e.target.value)} placeholder={t('Tiếng Nhật', '日本語')} className={cx(inputClass, 'w-44')} />
        <input value={vi} onChange={(e) => setVi(e.target.value)} placeholder={t('Tiếng Việt', 'ベトナム語')} className={cx(inputClass, 'w-52')} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('Ghi chú (không bắt buộc)', 'メモ（任意）')}
          className={cx(inputClass, 'flex-1')}
        />
        <Button variant="primary" type="submit" disabled={!ja.trim() || !vi.trim()}>
          <Plus size={14} /> {t('Thêm', '追加')}
        </Button>
      </form>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-window">
            <tr className="border-b border-line text-left text-[12px] text-ink-3">
              <th className="py-2 pl-5 font-semibold">{t('Tiếng Nhật', '日本語')}</th>
              <th className="py-2 font-semibold">{t('Tiếng Việt', 'ベトナム語')}</th>
              <th className="py-2 font-semibold">{t('Ghi chú', 'メモ')}</th>
              {hasTeam && <th className="py-2 font-semibold">{t('Phạm vi', '範囲')}</th>}
              <th className="w-24 py-2 pr-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((term) => (
              <tr key={term.id} className="group border-b border-line hover:bg-subtle">
                <td lang="ja" className="py-2.5 pl-5 text-[14px] text-ink">
                  {term.ja}
                </td>
                <td lang="vi" className="py-2.5 text-ink">
                  {term.vi}
                </td>
                <td className="py-2.5 text-ink-2">{term.note}</td>
                {hasTeam && (
                  <td className="py-2.5">
                    {term.scope === 'project' ? (
                      <span
                        className="inline-flex max-w-40 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent"
                        title={t('Chỉ sửa được trong file glossary chung', '共有用語集ファイルでのみ編集できます')}
                      >
                        <Lock size={11} className="shrink-0" /> <span className="truncate">{teamName}</span>
                      </span>
                    ) : (
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-medium text-ink-2">{t('Cá nhân', '個人')}</span>
                    )}
                  </td>
                )}
                <td className="py-1 pr-5 text-right">
                  {term.scope === 'personal' && (
                    <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {hasTeam && (
                        <IconButton label={t('Đề xuất vào glossary chung (sao chép YAML)', '共有用語集に提案（YAML をコピー）')} onClick={() => copyYaml(term)}>
                          <Share2 size={14} />
                        </IconButton>
                      )}
                      <IconButton label={t('Xóa', '削除')} onClick={() => remove(term.id)}>
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
                  {q
                    ? t('Không có thuật ngữ nào khớp', '一致する用語はありません')
                    : t(
                        'Chưa có thuật ngữ nào. Thêm tên màn hình, tên tính năng hay thuật ngữ khách hay dùng.',
                        'まだ用語がありません。画面名、機能名、よく使う用語を追加してください。',
                      )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TeamSource
        path={isTauri ? (team?.path ?? '') : settings.glossaryPath}
        project={teamName}
        count={all.filter((t) => t.scope === 'project').length}
        error={team?.error ? fileErrorText(team.error, t) : null}
        onChoose={chooseTeamFile}
        onStop={() => updateSettings({ glossaryPath: '' })}
      />
    </div>
  )
}

/** Where the team's terms come from, with the controls to pick, change or stop using the shared file. */
function TeamSource({
  path,
  project,
  count,
  error,
  onChoose,
  onStop,
}: {
  path: string
  project: string
  count: number
  error: string | null
  onChoose: () => void
  onStop: () => void
}) {
  const t = useT()
  const lang = useLang()
  if (!path) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-2.5 text-[12.5px]">
        <Users size={15} className="shrink-0 text-ink-3" />
        <p className="min-w-0 flex-1 text-ink-2">
          {t('Dùng chung thuật ngữ với team: chọn file', 'チームで用語を共有: プロジェクトの')}{' '}
          <code className="rounded bg-subtle px-1">glossary.yaml</code>{' '}
          {t('của dự án, trong repo hoặc thư mục OneDrive / SharePoint.', 'ファイル（リポジトリや OneDrive / SharePoint のフォルダ内）を選びます。')}
        </p>
        <Button size="sm" onClick={onChoose}>
          {t('Chọn file...', 'ファイルを選択…')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-2.5 text-[12.5px]">
      {error ? <CircleAlert size={15} className="shrink-0 text-bad" /> : <FileText size={15} className="shrink-0 text-ink-3" />}
      <div className="min-w-0 flex-1">
        {error ? (
          <p className="text-bad">
            {t('Không đọc được glossary chung', '共有用語集を読み取れません')}: {error}
          </p>
        ) : (
          <p className="text-ink-2">
            {t('Glossary chung', '共有用語集')} <span className="font-semibold text-ink">{project}</span>
            {t(
              `, ${count.toLocaleString(locale(lang))} thuật ngữ. App chỉ đọc file này; thuật ngữ cá nhân được ưu tiên khi trùng.`,
              `、${count.toLocaleString(locale(lang))} 語。アプリはこのファイルを読むだけです。重複する場合は個人の用語が優先されます。`,
            )}
          </p>
        )}
        <p className="truncate text-[12px] text-ink-3" title={path}>
          {path}
        </p>
      </div>
      <Button size="sm" onClick={onChoose}>
        {t('Đổi file...', 'ファイルを変更…')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onStop}>
        {t('Bỏ dùng', '使用をやめる')}
      </Button>
    </div>
  )
}
