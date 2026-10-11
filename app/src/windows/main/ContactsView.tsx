import { Users } from 'lucide-react'
import { useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabels } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { updateConversation as saveConversation } from '../../lib/history'
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
          {conversations.map((c) => (
            <ConversationCard key={c.id} conversation={c} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ConversationCard({ conversation: c }: { conversation: Conversation }) {
  const { settings, updateConversation, showToast } = useStore()
  const [note, setNote] = useState(c.note)

  const save = (keigo: Keigo | '', nextNote: string) => {
    updateConversation(c.id, { keigo, note: nextNote })
    if (isTauri) void saveConversation(c.id, keigo, nextNote).catch((e) => showToast(`Không lưu được: ${String(e)}`))
  }

  const dm = !c.name.startsWith('#')
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
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
          <div className="truncate text-[14px] font-semibold">{dm ? c.name : c.name.slice(1)}</div>
          <div className="flex items-center gap-1.5 truncate text-[12.5px] text-ink-2">
            <AppBadge app={c.app} className="size-3.5 text-[8px]" />
            {[c.app === 'slack' ? 'Slack' : c.app === 'teams' ? 'Teams' : 'Khác', c.workspace].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
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
