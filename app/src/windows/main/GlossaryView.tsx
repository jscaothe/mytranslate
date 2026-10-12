import { invoke } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { Check, CircleAlert, FileText, Lock, Pencil, Plus, Search, Share2, Trash2, User, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { yamlEntry } from '../../lib/glossary'
import { locale, useLang, useT, type T } from '../../lib/i18n'
import { newId, useStore } from '../../store'
import type { GlossaryTerm } from '../../types'

type Filter = 'all' | 'personal' | 'project'
type KindFilter = 'all' | GlossaryTerm['kind']

interface TermRow {
  id: number
  ja: string
  vi: string
  note: string
  kind: GlossaryTerm['kind']
}

interface FileError {
  kind: 'not_found' | 'bad_format' | 'unreadable'
  /** The system's or the YAML parser's own message. */
  detail: string
}

interface TeamGlossary {
  path: string
  project: string
  terms: { ja: string; vi: string; note: string; kind?: GlossaryTerm['kind'] }[]
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
 * The glossary: terms, and the people the user chats with. Personal entries live in the database on this PC; the
 * team's are read from a shared YAML file chosen at the bottom of this screen. A term is sent to the AI with a text
 * it occurs in; a person (their note says who they are and how to address them) when their name is in the text, the
 * chat's recent messages or the chat's name. Personal entries win over the team's.
 */
export function GlossaryView() {
  const { glossary, setGlossary, showToast, settings, updateSettings } = useStore()
  const t = useT()
  const [team, setTeam] = useState<TeamGlossary | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [kind, setKind] = useState<GlossaryTerm['kind']>('term')
  const [ja, setJa] = useState('')
  const [vi, setVi] = useState('')
  const [note, setNote] = useState('')

  const reload = useCallback(() => {
    void invoke<TermRow[]>('glossary_list').then((rows) =>
      setGlossary(rows.map((r) => ({ id: String(r.id), ja: r.ja, vi: r.vi, note: r.note, kind: r.kind, scope: 'personal' as const }))),
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
    ? [...glossary, ...(team?.terms ?? []).map((term, i) => ({ ...term, kind: term.kind ?? 'term', id: `team-${i}`, scope: 'project' as const }))]
    : glossary.filter((term) => hasTeam || term.scope === 'personal')

  const q = query.trim().toLowerCase()
  const rows = all.filter(
    (term) =>
      (!hasTeam || filter === 'all' || term.scope === filter) &&
      (kindFilter === 'all' || term.kind === kindFilter) &&
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
      setGlossary([{ id: newId('g'), ja: ja.trim(), vi: vi.trim(), note: note.trim(), kind, scope: 'personal' }, ...glossary])
      reset()
      showToast(kind === 'person' ? t('Đã thêm người', '人物を追加しました') : t('Đã thêm vào glossary cá nhân', '個人用語集に追加しました'))
      return
    }
    invoke('glossary_add', { ja, vi, note, kind })
      .then(() => {
        reset()
        reload()
        showToast(kind === 'person' ? t('Đã thêm người', '人物を追加しました') : t('Đã thêm thuật ngữ', '用語を追加しました'))
      })
      .catch((e) => showToast(`${t('Không thêm được', '追加できません')}: ${String(e)}`))
  }

  const update = (id: string, patch: { ja: string; vi: string; note: string }) => {
    const next = { ja: patch.ja.trim(), vi: patch.vi.trim(), note: patch.note.trim() }
    if (!next.ja || !next.vi) return
    if (!isTauri) {
      setGlossary(glossary.map((x) => (x.id === id ? { ...x, ...next } : x)))
      return
    }
    invoke('glossary_update', { id: Number(id), ...next })
      .then(reload)
      .catch((e) => showToast(`${t('Không lưu được', '保存できません')}: ${String(e)}`))
  }

  const copyYaml = (term: { ja: string; vi: string; note: string; kind: GlossaryTerm['kind'] }) => {
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

  const person = kind === 'person'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">{t('Glossary', '用語集')}</h2>
        <Segmented
          label={t('Lọc loại', '種類で絞り込み')}
          value={kindFilter}
          onChange={setKindFilter}
          options={[
            { value: 'all', label: t('Tất cả', 'すべて') },
            { value: 'term', label: t('Thuật ngữ', '用語') },
            { value: 'person', label: t('Người', '人物') },
          ]}
        />
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
        <label className="flex h-8 w-56 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={14} className="text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Tìm thuật ngữ, người', '用語・人物を検索')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
      </div>

      <form
        aria-label={t('Thêm vào glossary', '用語集に追加')}
        className="flex shrink-0 flex-col gap-2 border-b border-line bg-subtle px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="flex items-center gap-2">
          <Segmented
            label={t('Loại', '種類')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'term', label: t('Thuật ngữ', '用語') },
              { value: 'person', label: t('Người', '人物') },
            ]}
          />
          <input
            value={ja}
            onChange={(e) => setJa(e.target.value)}
            placeholder={person ? t('Tên tiếng Nhật', '日本語の名前') : t('Tiếng Nhật', '日本語')}
            aria-label={person ? t('Tên tiếng Nhật', '日本語の名前') : t('Tiếng Nhật', '日本語')}
            className={cx(inputClass, 'w-36')}
          />
          <input
            value={vi}
            onChange={(e) => setVi(e.target.value)}
            placeholder={person ? t('Tên tiếng Việt', 'ベトナム語の名前') : t('Tiếng Việt', 'ベトナム語')}
            aria-label={person ? t('Tên tiếng Việt', 'ベトナム語の名前') : t('Tiếng Việt', 'ベトナム語')}
            className={cx(inputClass, 'w-40')}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              person
                ? t('Vai trò, cách xưng hô, kính ngữ. VD: PM khách, gọi 田中様', '役割、呼び方、丁寧さ。例: 開発リーダー、「anh」と呼ぶ')
                : t('Ghi chú (không bắt buộc)', 'メモ（任意）')
            }
            aria-label={person ? t('Mô tả cho AI', 'AIへの説明') : t('Ghi chú', 'メモ')}
            className={cx(inputClass, 'min-w-0 flex-1')}
          />
          <Button variant="primary" type="submit" disabled={!ja.trim() || !vi.trim()}>
            <Plus size={14} /> {t('Thêm', '追加')}
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">
          {person
            ? t(
                'Mô tả được gửi kèm cho AI khi tên người này có trong tin nhắn, các tin gần đây của cuộc chat hoặc tên cuộc chat.',
                'この説明は、名前がメッセージ、会話の最近のやり取り、または会話名に含まれるときに AI に送られます。',
              )
            : t('Thuật ngữ có trong câu đang dịch được gửi kèm cho AI, để dịch đúng như bạn muốn.', '翻訳する文に含まれる用語は AI に送られ、指定どおりに訳されます。')}
        </p>
      </form>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead className="sticky top-0 bg-window">
            <tr className="border-b border-line text-left text-[12px] text-ink-3">
              <th className="w-[22%] py-2 pl-5 font-semibold">{t('Tiếng Nhật', '日本語')}</th>
              <th className="w-[24%] py-2 font-semibold">{t('Tiếng Việt', 'ベトナム語')}</th>
              <th className="py-2 font-semibold">{t('Ghi chú', 'メモ')}</th>
              {hasTeam && <th className="w-32 py-2 font-semibold">{t('Phạm vi', '範囲')}</th>}
              <th className="w-24 py-2 pr-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((term) => (
              <TermRowView
                key={term.id}
                term={term}
                teamName={teamName}
                hasTeam={hasTeam}
                onSave={(patch) => update(term.id, patch)}
                onShare={() => copyYaml(term)}
                onRemove={() => remove(term.id)}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasTeam ? 5 : 4} className="px-5 py-10 text-center text-ink-3">
                  {q
                    ? t('Không có mục nào khớp', '一致する項目はありません')
                    : kindFilter === 'person'
                      ? t(
                          'Chưa có người nào. Thêm người bạn hay chat cùng, với vai trò và cách xưng hô, để AI dịch đúng giọng.',
                          'まだ人物がいません。よくやり取りする相手を、役割や呼び方と一緒に追加すると、AI が適切な口調で訳します。',
                        )
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

/** One entry. A personal one can be edited in place (Enter saves, Esc cancels) or deleted. */
function TermRowView({
  term,
  teamName,
  hasTeam,
  onSave,
  onShare,
  onRemove,
}: {
  term: GlossaryTerm
  teamName: string
  hasTeam: boolean
  onSave: (patch: { ja: string; vi: string; note: string }) => void
  onShare: () => void
  onRemove: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState<{ ja: string; vi: string; note: string } | null>(null)
  const person = term.kind === 'person'
  const save = () => {
    if (!draft || !draft.ja.trim() || !draft.vi.trim()) return
    onSave(draft)
    setDraft(null)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(null)
    }
  }
  const field = (name: 'ja' | 'vi' | 'note', label: string) =>
    draft && (
      <input
        value={draft[name]}
        aria-label={label}
        autoFocus={name === 'ja'}
        onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
        onKeyDown={onKey}
        className={cx(inputClass, '-my-1 -ml-[11px] h-7 w-full text-[length:inherit]')}
      />
    )

  return (
    <tr className="group border-b border-line hover:bg-subtle">
      <td lang="ja" className="py-2.5 pr-3 pl-5 text-[14px] text-ink">
        {draft ? (
          field('ja', person ? t('Tên tiếng Nhật', '日本語の名前') : t('Tiếng Nhật', '日本語'))
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {person && <User size={14} role="img" aria-label={t('Người', '人物')} className="shrink-0 text-accent" />}
            {term.ja}
          </span>
        )}
      </td>
      <td lang="vi" className="py-2.5 pr-3 text-ink">
        {draft ? field('vi', person ? t('Tên tiếng Việt', 'ベトナム語の名前') : t('Tiếng Việt', 'ベトナム語')) : term.vi}
      </td>
      <td className="py-2.5 pr-3 whitespace-pre-wrap text-ink-2">
        {draft ? field('note', person ? t('Mô tả cho AI', 'AIへの説明') : t('Ghi chú', 'メモ')) : term.note}
      </td>
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
      <td className="py-1.5 pr-5 text-right whitespace-nowrap">
        {term.scope === 'personal' &&
          (draft ? (
            <span className="inline-flex">
              <IconButton label={t('Lưu', '保存')} disabled={!draft.ja.trim() || !draft.vi.trim()} onClick={save}>
                <Check size={14} />
              </IconButton>
              <IconButton label={t('Hủy', 'キャンセル')} onClick={() => setDraft(null)}>
                <X size={14} />
              </IconButton>
            </span>
          ) : (
            <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton label={t('Sửa', '編集')} onClick={() => setDraft({ ja: term.ja, vi: term.vi, note: term.note })}>
                <Pencil size={14} />
              </IconButton>
              {hasTeam && (
                <IconButton label={t('Đề xuất vào glossary chung (sao chép YAML)', '共有用語集に提案（YAML をコピー）')} onClick={onShare}>
                  <Share2 size={14} />
                </IconButton>
              )}
              <IconButton label={t('Xóa', '削除')} onClick={onRemove}>
                <Trash2 size={14} />
              </IconButton>
            </span>
          ))}
      </td>
    </tr>
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
