import { listen } from '@tauri-apps/api/event'
import { Archive, ArchiveRestore, ChevronLeft, Download, Loader2, Merge, MoreHorizontal, Pencil, Pin, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, IconButton } from '../../components/ui'
import { cx } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { deleteThread as removeThread, exportThread, loadMessages, mergeThreads, renameThread, searchThreads, setArchived, setPinned, summarizeThread } from '../../lib/history'
import { useStore } from '../../store'
import type { Conversation, Thread, ThreadMessage } from '../../types'
import { GettingStarted } from './GettingStarted'

const appName = (c: Conversation) => (c.app === 'slack' ? 'Slack' : c.app === 'teams' ? 'Teams' : 'Ứng dụng khác')

export function ThreadsView() {
  const { conversations, threads, selectedThreadId, selectThread } = useStore()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const q = query.trim().toLowerCase()
  // The real app searches every message in the history (messages are not loaded up front).
  const [found, setFound] = useState<{ q: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!isTauri || !q) return
    let alive = true
    const t = window.setTimeout(() => void searchThreads(q).then((ids) => alive && setFound({ q, ids })), 150)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q, threads])
  const archivedCount = threads.filter((t) => t.archived).length
  const visible = useMemo(
    () =>
      threads.filter(
        (t) =>
          Boolean(t.archived) === showArchived &&
          (!q ||
            (isTauri
              ? found?.q === q && found.ids.has(t.id)
              : t.title.toLowerCase().includes(q) ||
                t.summary.toLowerCase().includes(q) ||
                t.messages.some((m) => m.ja.toLowerCase().includes(q) || m.vi.toLowerCase().includes(q)))),
      ),
    [threads, q, showArchived, found],
  )

  const groups = conversations
    .map((c) => ({ conversation: c, threads: visible.filter((t) => t.conversationId === c.id) }))
    // Pinned thread first in its conversation, then most recent.
    .map((g) => ({ ...g, threads: [...g.threads.filter((t) => t.pinned), ...g.threads.filter((t) => !t.pinned)] }))
    .filter((g) => g.threads.length > 0)

  const thread = threads.find((t) => t.id === selectedThreadId && Boolean(t.archived) === showArchived) ?? groups[0]?.threads[0]

  if (threads.length === 0) return <GettingStarted />

  return (
    <div className="flex min-h-0 flex-1">
      {/* Thread list */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
        <div className="flex flex-col gap-2 p-3">
          {showArchived && (
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className="flex h-7 items-center gap-1 self-start rounded-md pr-2 pl-1 text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              <ChevronLeft size={14} /> Thread đang dùng
            </button>
          )}
          <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
            <Search size={14} className="text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={showArchived ? 'Tìm trong thread đã lưu trữ' : 'Tìm trong tiếng Nhật và tiếng Việt'}
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </label>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-[13px] text-ink-3">{q ? 'Không tìm thấy thread nào' : 'Không có thread nào'}</p>
          )}
          {groups.map((g) => (
            <div key={g.conversation.id} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11.5px] font-semibold text-ink-3">
                <AppBadge app={g.conversation.app} className="size-3.5 text-[8px]" />
                <span className="truncate">{[g.conversation.workspace, g.conversation.name].filter(Boolean).join(' · ')}</span>
              </div>
              {g.threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectThread(t.id)}
                  className={cx('flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left', t.id === thread?.id ? 'bg-selected' : 'hover:bg-hover')}
                >
                  <span className="flex items-center gap-1.5">
                    {t.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Đang ghim" />}
                    <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{t.title}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{t.lastActive}</span>
                  </span>
                  {(t.messages.at(-1)?.vi ?? t.summary) && (
                    <span lang="vi" className="truncate text-[12.5px] text-ink-2">
                      {t.messages.at(-1)?.vi ?? t.summary}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        {!showArchived && archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-4 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Archive size={14} /> Đã lưu trữ ({archivedCount})
          </button>
        )}
      </div>

      {thread ? (
        <ThreadDetail key={thread.id} thread={thread} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">Chọn một thread</div>
      )}
    </div>
  )
}

/** Keyed by thread id so menus and title editing reset when another thread is opened. */
function ThreadDetail({ thread }: { thread: Thread }) {
  const { conversations, threads, updateThread, mergeThread, deleteThread, showToast } = useStore()
  const [menu, setMenu] = useState<'closed' | 'main' | 'merge' | 'delete'>('closed')
  const [editingTitle, setEditingTitle] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const conversation = conversations.find((c) => c.id === thread.conversationId)
  // The real app loads a thread's messages on demand and follows new ones as they are filed.
  const [loaded, setLoaded] = useState<ThreadMessage[] | null>(null)
  const messages = isTauri ? (loaded ?? []) : thread.messages
  const mergeTargets = threads.filter((t) => t.conversationId === thread.conversationId && t.id !== thread.id && !t.archived)

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const load = () => void loadMessages(thread.id).then((m) => alive && setLoaded(m))
    load()
    const off = listen('history:changed', load)
    return () => {
      alive = false
      void off.then((f) => f())
    }
  }, [thread.id])

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight })
  }, [messages.length])

  useEffect(() => {
    if (menu === 'closed') return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu('closed')
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu('closed')
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /** Runs a history change in the real app, or applies it to the prototype's data. */
  const act = (real: () => Promise<unknown>, mock: () => void, done?: string) => {
    setMenu('closed')
    if (!isTauri) {
      mock()
      if (done) showToast(done)
      return
    }
    real()
      .then(() => done && showToast(done))
      .catch((e) => showToast(`Không thực hiện được: ${String(e)}`))
  }

  const rename = (title: string) => {
    if (!title || title === thread.title) return
    act(() => renameThread(thread.id, title), () => updateThread(thread.id, { title }))
  }

  const togglePin = () =>
    act(
      () => setPinned(thread.id, !thread.pinned),
      () => updateThread(thread.id, { pinned: !thread.pinned, archived: false }),
      thread.pinned ? 'Đã bỏ ghim' : 'Đã ghim: tin mới trong cuộc hội thoại này sẽ vào thread này',
    )

  const toggleArchive = () =>
    act(
      () => setArchived(thread.id, !thread.archived),
      () => updateThread(thread.id, { archived: !thread.archived, pinned: thread.archived ? thread.pinned : false }),
      thread.archived ? 'Đã đưa thread trở lại' : 'Đã lưu trữ thread',
    )

  const merge = (into: Thread) =>
    act(() => mergeThreads(thread.id, into.id), () => mergeThread(thread.id, into.id), `Đã gộp vào "${into.title}"`)

  const remove = () => act(() => removeThread(thread.id), () => deleteThread(thread.id), `Đã xóa thread "${thread.title}"`)

  const exportMarkdown = () => {
    setMenu('closed')
    if (!isTauri) {
      showToast('Prototype: app thật sẽ hỏi nơi lưu file .md')
      return
    }
    exportThread(thread.id)
      .then((path) => path && showToast(`Đã lưu ${path}`))
      .catch((e) => showToast(`Không xuất được: ${String(e)}`))
  }

  const summarize = () => {
    setSummarizing(true)
    if (!isTauri) {
      window.setTimeout(() => {
        updateThread(thread.id, { summary: 'Tóm tắt mô phỏng: khách và team đang trao đổi về chủ đề này, chưa có việc còn mở.', summaryStale: false })
        setSummarizing(false)
      }, 900)
      return
    }
    summarizeThread(thread.id)
      .catch((e) => showToast(`Không tóm tắt được: ${String(e)}`))
      .finally(() => setSummarizing(false))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="relative flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              aria-label="Tên thread"
              defaultValue={thread.title}
              onBlur={(e) => {
                rename(e.target.value.trim())
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="h-7 w-full rounded-md border border-accent bg-surface px-2 text-[15px] font-semibold text-ink focus:outline-none"
            />
          ) : (
            <h2 className="flex items-center gap-2 truncate text-[15px] font-semibold text-ink">
              <span className="truncate">{thread.title}</span>
              {thread.archived && <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-ink-2">Đã lưu trữ</span>}
            </h2>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
            {conversation && <AppBadge app={conversation.app} className="size-3.5 text-[8px]" />}
            {conversation ? [appName(conversation), conversation.workspace, conversation.name].filter(Boolean).join(' / ') : 'Khác'}
          </div>
        </div>
        <IconButton label="Đổi tên" onClick={() => setEditingTitle(true)}>
          <Pencil size={14} />
        </IconButton>
        <IconButton
          label={thread.pinned ? 'Bỏ ghim thread' : 'Ghim thread (mọi tin mới trong cuộc hội thoại sẽ vào thread này)'}
          active={thread.pinned}
          onClick={togglePin}
        >
          <Pin size={14} />
        </IconButton>
        <div ref={menuRef} className="relative">
          <IconButton label="Thêm" active={menu !== 'closed'} onClick={() => setMenu((m) => (m === 'closed' ? 'main' : 'closed'))}>
            <MoreHorizontal size={16} />
          </IconButton>
          {menu === 'main' && (
            <div role="menu" className="absolute top-10 right-0 z-10 w-56 rounded-lg border border-line bg-surface py-1 shadow-popup">
              <MenuItem icon={<Merge size={14} />} label="Gộp vào thread khác" disabled={mergeTargets.length === 0} onClick={() => setMenu('merge')} />
              <MenuItem icon={<Download size={14} />} label="Xuất Markdown" onClick={exportMarkdown} />
              <MenuItem
                icon={thread.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                label={thread.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
                onClick={toggleArchive}
              />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Trash2 size={14} />} label="Xóa thread" danger onClick={() => setMenu('delete')} />
            </div>
          )}
          {menu === 'delete' && (
            <div role="alertdialog" aria-label="Xóa thread" className="absolute top-10 right-0 z-10 w-80 rounded-lg border border-line bg-surface p-3.5 shadow-popup">
              <p className="text-[13.5px] font-semibold text-ink">Xóa thread này?</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-pretty text-ink-2">
                {messages.length > 0 ? `${messages.length.toLocaleString('vi-VN')} tin đã dịch` : 'Thread'} trong "{thread.title}" sẽ bị xóa vĩnh viễn, không thể hoàn
                tác. Muốn ẩn đi mà vẫn giữ lại thì dùng Lưu trữ.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" autoFocus onClick={() => setMenu('closed')}>
                  Hủy
                </Button>
                <Button size="sm" variant="danger" onClick={remove}>
                  Xóa thread
                </Button>
              </div>
            </div>
          )}
          {menu === 'merge' && (
            <div role="menu" aria-label="Gộp vào" className="absolute top-10 right-0 z-10 w-72 rounded-lg border border-line bg-surface py-1 shadow-popup">
              <div className="px-3 pt-1.5 pb-1 text-[11.5px] font-semibold text-ink-3">Gộp toàn bộ tin vào</div>
              <div className="scroll-thin max-h-64 overflow-y-auto">
                {mergeTargets.map((t) => (
                  <MenuItem key={t.id} label={t.title} hint={t.lastActive} onClick={() => merge(t)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={timelineRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <SummaryCard thread={thread} busy={summarizing} canSummarize={messages.length > 0} onSummarize={summarize} />

        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className={cx('flex flex-col', m.author === 'me' ? 'items-end' : 'items-start')}>
              <div className="mb-1 flex items-baseline gap-2 px-1 text-[12px]">
                <span className="font-semibold text-ink-2">{m.name}</span>
                <span className="text-ink-3">{m.time}</span>
              </div>
              <div className={cx('max-w-[78%] rounded-lg border px-3.5 py-2.5', m.author === 'me' ? 'border-accent/25 bg-accent-soft' : 'border-line bg-surface')}>
                <p lang="ja" className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
                  {m.ja}
                </p>
                <p lang="vi" className="mt-1.5 border-t border-line pt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">
                  {m.vi}
                </p>
              </div>
            </div>
          ))}
          {messages.length === 0 && <p className="py-8 text-center text-[13px] text-ink-3">Thread này chưa có tin nào</p>}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ thread, busy, canSummarize, onSummarize }: { thread: Thread; busy: boolean; canSummarize: boolean; onSummarize: () => void }) {
  if (!thread.summary) {
    if (!canSummarize) return null
    return (
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-dashed border-line px-4 py-3">
        <Sparkles size={15} className="shrink-0 text-accent" />
        <p className="flex-1 text-[13px] text-ink-2">Tóm tắt nội dung, việc đã chốt và việc còn mở của thread bằng tiếng Việt.</p>
        <Button onClick={onSummarize} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? 'Đang tóm tắt…' : 'Tóm tắt'}
        </Button>
      </div>
    )
  }
  return (
    <div className="mb-5 rounded-lg border border-line bg-subtle px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
        <Sparkles size={13} className="text-accent" /> Tóm tắt
        {thread.summaryStale && !busy && <span className="rounded-full bg-warn-soft px-1.5 py-px text-[11px] font-medium text-warn">Có tin mới</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSummarize}
          disabled={busy}
          title="Tóm tắt lại bằng AI"
          className="flex h-6 items-center gap-1 rounded px-1.5 font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {busy ? 'Đang tóm tắt…' : 'Cập nhật'}
        </button>
      </div>
      <p className={cx('text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink', busy && 'opacity-60')}>{thread.summary}</p>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  disabled,
  danger,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex h-8 w-full items-center gap-2.5 px-3 text-left text-[13px] hover:bg-hover disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent',
        danger ? 'text-bad' : 'text-ink',
      )}
    >
      {icon && <span className={danger ? 'text-bad' : 'text-ink-2'}>{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-ink-3">{hint}</span>}
    </button>
  )
}
