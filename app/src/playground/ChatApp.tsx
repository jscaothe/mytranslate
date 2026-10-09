import { Hash, MessageSquare, Phone, Search, SendHorizontal, Users, Video } from 'lucide-react'
import { forwardRef, useEffect, useRef } from 'react'
import { cx } from '../components/styles'
import type { ChatApp as ChatAppKind, ChatChannel } from '../types'

const avatarColors = ['#c2410c', '#0f766e', '#7c3aed', '#be185d', '#1d4ed8']

function Avatar({ name, me }: { name: string; me: boolean }) {
  const color = me ? '#2b5fd9' : avatarColors[name.length % avatarColors.length]
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-white"
      style={{ background: color }}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  )
}

interface Props {
  app: ChatAppKind
  channels: ChatChannel[]
  activeId: string
  onSelectChannel: (id: string) => void
  composer: string
  onComposer: (v: string) => void
  onSend: () => void
}

/**
 * A stand-in for the Slack / Teams desktop window. Only the parts needed to try MyTranslate are interactive:
 * channel switching, selecting message text and typing in the composer.
 */
export const ChatApp = forwardRef<HTMLTextAreaElement, Props>(function ChatApp(
  { app, channels, activeId, onSelectChannel, composer, onComposer, onSend },
  composerRef,
) {
  const channel = channels.find((c) => c.id === activeId) ?? channels[0]
  const listRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(channel.messages.length)

  // Scroll to the newest message when one is sent.
  useEffect(() => {
    if (channel.messages.length !== lastCount.current) {
      lastCount.current = channel.messages.length
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    }
  }, [channel.messages.length])

  const slack = app === 'slack'
  const title = slack ? `${channel.label} - CustomerX - Slack` : `Chat | ${channel.label} | Microsoft Teams`

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-window">
      {/* Title bar: its text is what MyTranslate reads to identify the conversation. */}
      <div
        className={cx('flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] select-none', slack ? 'bg-[#3f0e40] text-white/80' : 'bg-[#eef0fa] text-[#424242] dark:bg-[#292a40] dark:text-white/80')}
      >
        <span className={cx('flex size-4 items-center justify-center rounded-[4px] text-[9.5px] font-bold text-white', slack ? 'bg-[#e01e5a]' : 'bg-[#5059c9]')}>
          {slack ? 'S' : 'T'}
        </span>
        <span className="flex-1 truncate" title="Tiêu đề cửa sổ (app đọc để nhận diện cuộc hội thoại)">
          {title}
        </span>
        <div className={cx('flex h-7 w-72 items-center gap-1.5 rounded-md px-2', slack ? 'bg-white/15' : 'bg-white dark:bg-white/10')}>
          <Search size={13} />
          <span className="opacity-70">Tìm kiếm</span>
        </div>
        <div className="flex-1" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className={cx('flex w-56 shrink-0 flex-col', slack ? 'bg-[#4a154b] text-white/80' : 'border-r border-line bg-subtle text-ink-2')}>
          <div className={cx('flex h-12 items-center px-4 text-[15px] font-bold', slack ? 'text-white' : 'text-ink')}>
            {slack ? 'CustomerX' : 'Chat'}
          </div>
          <div className="px-2 text-[13px]">
            <div className="px-2 pt-2 pb-1 text-[12px] font-semibold opacity-70">{slack ? 'Kênh' : 'Gần đây'}</div>
            {channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectChannel(c.id)}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left',
                  c.id === channel.id
                    ? slack
                      ? 'bg-[#1164a3] text-white'
                      : 'bg-surface font-semibold text-ink shadow-sm'
                    : slack
                      ? 'hover:bg-white/10'
                      : 'hover:bg-hover',
                )}
              >
                {c.kind === 'channel' ? <Hash size={14} /> : <MessageSquare size={14} />}
                <span className="truncate">{c.label}</span>
              </button>
            ))}
            {slack && (
              <>
                <div className="px-2 pt-4 pb-1 text-[12px] font-semibold opacity-70">Tin nhắn trực tiếp</div>
                {['Tanaka', 'Suzuki'].map((n) => (
                  <div key={n} className="flex h-8 items-center gap-2 rounded-md px-2 opacity-60">
                    <span className="size-2 rounded-full bg-[#2bac76]" />
                    {n}
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* Conversation */}
        <section className="flex min-w-0 flex-1 flex-col bg-surface">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
            {channel.kind === 'channel' ? <Hash size={16} className="text-ink-2" /> : <MessageSquare size={16} className="text-ink-2" />}
            <span className="text-[15px] font-bold text-ink">{channel.label}</span>
            <div className="flex-1" />
            <span className="flex items-center gap-3 text-ink-3">
              {slack ? <Users size={16} /> : <Video size={16} />}
              <Phone size={15} />
            </span>
          </header>

          <div ref={listRef} data-chat-messages className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-3 flex items-center gap-3 text-[12px] text-ink-3">
              <span className="h-px flex-1 bg-line" />
              Hôm nay
              <span className="h-px flex-1 bg-line" />
            </div>
            {channel.messages.map((m) => (
              <div key={m.id} className="group flex gap-3 rounded-md px-2 py-2 hover:bg-subtle">
                <Avatar name={m.author} me={m.me} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-bold text-ink">{m.author}</span>
                    <span className="text-[12px] text-ink-3">{m.time}</span>
                  </div>
                  <p lang="ja" className="text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink selection:bg-[#b4d5fe] dark:selection:bg-[#3b5a8c]">
                    {m.text}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 px-4 pb-4">
            <div className="rounded-lg border border-line-strong bg-surface focus-within:border-ink-3">
              <textarea
                ref={composerRef}
                data-composer
                rows={2}
                value={composer}
                onChange={(e) => onComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
                placeholder={`Nhắn ${channel.kind === 'channel' ? '#' : ''}${channel.label}`}
                className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
              />
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="px-1 text-[11.5px] text-ink-3">Enter để gửi, Shift+Enter xuống dòng</span>
                <button
                  type="button"
                  aria-label="Gửi"
                  disabled={!composer.trim()}
                  onClick={onSend}
                  className={cx(
                    'flex size-7 items-center justify-center rounded-md',
                    composer.trim() ? (slack ? 'bg-[#007a5a] text-white' : 'bg-[#5b5fc7] text-white') : 'text-ink-3',
                  )}
                >
                  <SendHorizontal size={15} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
})
