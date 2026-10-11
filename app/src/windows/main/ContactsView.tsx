import { Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabels } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { deleteConversation as removeConversation, updateConversation as saveConversation } from '../../lib/history'
import { useStore } from '../../store'
import type { Conversation, Keigo } from '../../types'

/**
 * Who the user talks to, per conversation (a DM is one person, a channel a group): the keigo level to write in,
 * and a note about the people that Claude reads with every translation in that conversation.
 */
export function ContactsView() {
  const { conversations } = useStore()

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <Users size={28} className="text-ink-3" />
        <p className="text-[14px] font-semibold text-ink">Chưa có cuộc hội thoại nào</p>
        <p className="max-w-[380px] text-[13px] leading-relaxed text-ink-2">
          Sau lần dịch đầu tiên trong một kênh hay một cuộc chat của Teams/Slack, bạn đặt mức kính ngữ và ghi chú cho người ở đó tại đây.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Người liên hệ</h2>
        <div className="flex-1" />
        <span className="text-[12.5px] text-ink-3">Kính ngữ và ghi chú được dùng cho mọi bản dịch trong cuộc hội thoại đó</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
        {/* Wide enough for the keigo control with its longest labels, so it never spills out of a card. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-3">
          {conversations.map((c) => (
            <ConversationCard key={c.id} conversation={c} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ConversationCard({ conversation: c }: { conversation: Conversation }) {
  const { settings, threads, updateConversation, deleteConversation, showToast } = useStore()
  const [note, setNote] = useState(c.note)
  const [confirming, setConfirming] = useState(false)
  const threadCount = threads.filter((t) => t.conversationId === c.id).length

  const save = (keigo: Keigo | '', nextNote: string) => {
    updateConversation(c.id, { keigo, note: nextNote })
    if (isTauri) void saveConversation(c.id, keigo, nextNote).catch((e) => showToast(`Không lưu được: ${String(e)}`))
  }

  const dm = !c.name.startsWith('#')
  const name = dm ? c.name : c.name.slice(1)

  const remove = () => {
    setConfirming(false)
    const done = () => showToast(`Đã xóa ${name}`)
    if (!isTauri) {
      deleteConversation(c.id)
      done()
      return
    }
    removeConversation(c.id)
      .then(done)
      .catch((e) => showToast(`Không xóa được: ${String(e)}`))
  }

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            'flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold',
            dm ? 'bg-accent-soft text-accent' : 'bg-subtle text-ink-2',
          )}
        >
          {dm ? c.name.slice(0, 1) : '#'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{name}</div>
          <div className="flex items-center gap-1.5 truncate text-[12.5px] text-ink-2">
            <AppBadge app={c.app} className="size-3.5 text-[8px]" />
            {[c.app === 'slack' ? 'Slack' : c.app === 'teams' ? 'Teams' : 'Khác', c.workspace].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className={cx('transition-opacity', !confirming && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
          <IconButton label={`Xóa ${name}`} active={confirming} onClick={() => setConfirming((v) => !v)}>
            <Trash2 size={14} />
          </IconButton>
        </span>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label={`Xóa ${name}`} className="rounded-md border border-bad/30 bg-bad-soft p-3">
          <p className="text-[12.5px] leading-relaxed text-pretty text-ink">
            Xóa {name} khỏi app? Kính ngữ, ghi chú
            {threadCount > 0 ? ` và ${threadCount.toLocaleString('vi-VN')} thread cùng mọi tin đã dịch trong đó` : ''} sẽ bị xóa vĩnh viễn. Lần sau dịch
            trong cuộc trò chuyện này, app sẽ bắt đầu lại từ đầu.
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
              Hủy
            </Button>
            <Button size="sm" variant="danger" onClick={remove}>
              Xóa
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-[12px] font-semibold text-ink-3">Kính ngữ khi viết tiếng Nhật</span>
        <Segmented
          label={`Mức kính ngữ với ${c.name}`}
          value={c.keigo || 'default'}
          onChange={(k) => save(k === 'default' ? '' : k, note)}
          options={[
            { value: 'default' as const, label: `Mặc định (${keigoLabels[settings.defaultKeigo]})` },
            ...(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabels[k] })),
          ]}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-3">Ghi chú cho AI</span>
        <textarea
          value={note}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== c.note && save(c.keigo, note.trim())}
          placeholder="Ví dụ: Tanaka là PM phía khách, gọi là 田中様; Suzuki là tester."
          className="resize-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </label>
    </div>
  )
}
