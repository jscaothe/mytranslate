import { listen } from '@tauri-apps/api/event'
import { Archive, Download, Merge, MessagesSquare, MoreHorizontal, Pencil, Pin, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { IconButton } from '../../components/ui'
import { cx } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { loadMessages, renameThread } from '../../lib/history'
import { useStore } from '../../store'
import type { Conversation, Thread, ThreadMessage } from '../../types'

const appName = (c: Conversation) => (c.app === 'slack' ? 'Slack' : c.app === 'teams' ? 'Teams' : 'Ứng dụng khác')

export function ThreadsView() {
  const { conversations, threads, selectedThreadId, selectThread } = useStore()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      threads.filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.messages.some((m) => m.ja.toLowerCase().includes(q) || m.vi.toLowerCase().includes(q)),
      ),
    [threads, q],
  )

  const groups = conversations
    .map((c) => ({ conversation: c, threads: visible.filter((t) => t.conversationId === c.id) }))
    .filter((g) => g.threads.length > 0)

  const thread = threads.find((t) => t.id === selectedThreadId) ?? threads[0]

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <MessagesSquare size={28} className="text-ink-3" />
        <p className="text-[14px] font-semibold text-ink">Chưa có thread nào</p>
        <p className="max-w-[360px] text-[13px] leading-relaxed text-ink-2">
          Dịch bằng phím tắt trong Teams hoặc Slack, các tin sẽ được xếp vào thread theo từng cuộc trò chuyện ở đây.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Thread list */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
        <div className="p-3">
          <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
            <Search size={14} className="text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm trong tiếng Nhật và tiếng Việt"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </label>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-ink-3">Không tìm thấy thread nào</p>}
          {groups.map((g) => (
            <div key={g.conversation.id} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11.5px] font-semibold text-ink-3">
                <AppBadge app={g.conversation.app} className="size-3.5 text-[8px]" />
                <span className="truncate">
                  {[g.conversation.workspace, g.conversation.name].filter(Boolean).join(' · ')}
                </span>
              </div>
              {g.threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectThread(t.id)}
                  className={cx(
                    'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left',
                    t.id === thread.id ? 'bg-selected' : 'hover:bg-hover',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {t.pinned && <Pin size={12} className="shrink-0 text-accent" />}
                    <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{t.title}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{t.lastActive}</span>
                  </span>
                  {t.messages.length > 0 && (
                    <span lang="vi" className="truncate text-[12.5px] text-ink-2">
                      {t.messages.at(-1)?.vi}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <ThreadDetail key={thread.id} thread={thread} />
    </div>
  )
}

/** Keyed by thread id so menus and title editing reset when another thread is opened. */
function ThreadDetail({ thread }: { thread: Thread }) {
  const { conversations, updateThread, showToast } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const conversation = conversations.find((c) => c.id === thread.conversationId)
  // The real app loads a thread's messages on demand and follows new ones as they are filed.
  const [loaded, setLoaded] = useState<ThreadMessage[] | null>(null)
  const messages = isTauri ? (loaded ?? []) : thread.messages

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

  const rename = (title: string) => {
    if (!title || title === thread.title) return
    if (isTauri) void renameThread(thread.id, title).catch((e) => showToast(`Không đổi được tên: ${String(e)}`))
    else updateThread(thread.id, { title })
  }

  const menuAction = (label: string) => {
    setMenuOpen(false)
    showToast(`${label}: chưa có logic trong prototype`)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="relative flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
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
            <h2 className="truncate text-[15px] font-semibold text-ink">{thread.title}</h2>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
            {conversation && <AppBadge app={conversation.app} className="size-3.5 text-[8px]" />}
            {conversation ? [appName(conversation), conversation.workspace, conversation.name].filter(Boolean).join(' / ') : 'Khác'}
          </div>
        </div>
        <IconButton label="Đổi tên" onClick={() => setEditingTitle(true)}>
          <Pencil size={14} />
        </IconButton>
        {/* Pinning is not stored in the history yet, so the real app does not offer it. */}
        {!isTauri && (
          <IconButton
            label={thread.pinned ? 'Bỏ ghim thread' : 'Ghim thread (mọi tin trong cuộc hội thoại sẽ vào thread này)'}
            active={thread.pinned}
            onClick={() => updateThread(thread.id, { pinned: !thread.pinned })}
          >
            <Pin size={14} />
          </IconButton>
        )}
        <IconButton label="Thêm" active={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <MoreHorizontal size={16} />
        </IconButton>
        {menuOpen && (
          <div className="absolute top-12 right-4 z-10 w-52 rounded-lg border border-line bg-surface py-1 shadow-popup">
            {[
              { icon: <Merge size={14} />, label: 'Gộp vào thread khác' },
              { icon: <Download size={14} />, label: 'Xuất Markdown' },
              { icon: <Archive size={14} />, label: 'Lưu trữ' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => menuAction(item.label)}
                className="flex h-8 w-full items-center gap-2.5 px-3 text-left text-[13px] text-ink hover:bg-hover"
              >
                <span className="text-ink-2">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={timelineRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {thread.summary && (
          <div className="mb-5 rounded-lg border border-line bg-subtle px-4 py-3">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
              <Sparkles size={13} className="text-accent" /> Tóm tắt
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink">{thread.summary}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className={cx('flex flex-col', m.author === 'me' ? 'items-end' : 'items-start')}>
              <div className="mb-1 flex items-baseline gap-2 px-1 text-[12px]">
                <span className="font-semibold text-ink-2">{m.name}</span>
                <span className="text-ink-3">{m.time}</span>
              </div>
              <div
                className={cx(
                  'max-w-[78%] rounded-lg border px-3.5 py-2.5',
                  m.author === 'me' ? 'border-accent/25 bg-accent-soft' : 'border-line bg-surface',
                )}
              >
                <p lang="ja" className="text-[14px] leading-relaxed text-ink">
                  {m.ja}
                </p>
                <p lang="vi" className="mt-1.5 border-t border-line pt-1.5 text-[13px] leading-relaxed text-ink-2">
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
