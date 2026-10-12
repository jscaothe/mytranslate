import { Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, IconButton, Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabel } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { deleteConversation as removeConversation, updateConversation as saveConversation } from '../../lib/history'
import { locale, useLang, useT } from '../../lib/i18n'
import { useStore } from '../../store'
import type { Conversation, Keigo } from '../../types'

/**
 * Who the user talks to, per conversation (a DM is one person, a channel a group): the keigo level to write in,
 * and a note about the people that Claude reads with every translation in that conversation.
 */
export function ContactsView() {
  const { conversations } = useStore()
  const t = useT()

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <Users size={28} className="text-ink-3" />
        <p className="text-[14px] font-semibold text-ink">{t('Chưa có cuộc hội thoại nào', 'まだ会話がありません')}</p>
        <p className="max-w-[380px] text-[13px] leading-relaxed text-ink-2">
          {t(
            'Sau lần dịch đầu tiên trong một kênh hay một cuộc chat của Teams/Slack, bạn đặt mức kính ngữ và ghi chú cho người ở đó tại đây.',
            'Teams や Slack のチャンネル・チャットで初めて翻訳すると、ここでその相手への丁寧さとメモを設定できます。',
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">{t('Người liên hệ', '連絡先')}</h2>
        <div className="flex-1" />
        <span className="text-[12.5px] text-ink-3">
          {t('Kính ngữ và ghi chú được dùng cho mọi bản dịch trong cuộc hội thoại đó', '丁寧さとメモは、その会話のすべての翻訳に使われます')}
        </span>
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
  const t = useT()
  const lang = useLang()
  const [note, setNote] = useState(c.note)
  const [confirming, setConfirming] = useState(false)
  const threadCount = threads.filter((th) => th.conversationId === c.id).length

  const save = (keigo: Keigo | '', nextNote: string) => {
    updateConversation(c.id, { keigo, note: nextNote })
    if (isTauri) void saveConversation(c.id, keigo, nextNote).catch((e) => showToast(`${t('Không lưu được', '保存できません')}: ${String(e)}`))
  }

  // A Teams conversation in a team is a channel; a Slack channel is written with its #.
  const dm = c.app === 'teams' ? !c.workspace : !c.name.startsWith('#')
  const name = dm ? c.name : c.name.slice(1)

  const remove = () => {
    setConfirming(false)
    const done = () => showToast(t(`Đã xóa ${name}`, `${name} を削除しました`))
    if (!isTauri) {
      deleteConversation(c.id)
      done()
      return
    }
    removeConversation(c.id)
      .then(done)
      .catch((e) => showToast(`${t('Không xóa được', '削除できません')}: ${String(e)}`))
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
            {[c.app === 'slack' ? 'Slack' : c.app === 'teams' ? 'Teams' : t('Khác', 'その他'), c.org, c.workspace].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className={cx('transition-opacity', !confirming && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
          <IconButton label={t(`Xóa ${name}`, `${name} を削除`)} active={confirming} onClick={() => setConfirming((v) => !v)}>
            <Trash2 size={14} />
          </IconButton>
        </span>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label={t(`Xóa ${name}`, `${name} を削除`)} className="rounded-md border border-bad/30 bg-bad-soft p-3">
          <p className="text-[12.5px] leading-relaxed text-pretty text-ink">
            {lang === 'ja'
              ? `${name} をアプリから削除しますか？丁寧さ、メモ${threadCount > 0 ? `、${threadCount.toLocaleString(locale(lang))} 件のスレッドとその翻訳済みメッセージ` : ''}は完全に削除されます。次にこの会話で翻訳すると、最初からやり直しになります。`
              : `Xóa ${name} khỏi app? Kính ngữ, ghi chú${threadCount > 0 ? ` và ${threadCount.toLocaleString(locale(lang))} thread cùng mọi tin đã dịch trong đó` : ''} sẽ bị xóa vĩnh viễn. Lần sau dịch trong cuộc trò chuyện này, app sẽ bắt đầu lại từ đầu.`}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
              {t('Hủy', 'キャンセル')}
            </Button>
            <Button size="sm" variant="danger" onClick={remove}>
              {t('Xóa', '削除')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-[12px] font-semibold text-ink-3">{t('Kính ngữ khi viết tiếng Nhật', 'ベトナム語で送るときの丁寧さ')}</span>
        <Segmented
          label={t(`Mức kính ngữ với ${c.name}`, `${c.name} への丁寧さ`)}
          value={c.keigo || 'default'}
          onChange={(k) => save(k === 'default' ? '' : k, note)}
          options={[
            { value: 'default' as const, label: t(`Mặc định (${keigoLabel(settings.defaultKeigo, lang)})`, `既定（${keigoLabel(settings.defaultKeigo, lang)}）`) },
            ...(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabel(k, lang) })),
          ]}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-3">{t('Ghi chú cho AI', 'AIへのメモ')}</span>
        <textarea
          value={note}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== c.note && save(c.keigo, note.trim())}
          placeholder={t(
            'Ví dụ: Tanaka là PM phía khách, gọi là 田中様; Suzuki là tester.',
            '例: グエンさんは開発リーダーで「anh」と呼ぶ。チャンさんはテスター。',
          )}
          className="resize-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </label>
    </div>
  )
}
