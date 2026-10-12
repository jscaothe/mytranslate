import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  CircleAlert,
  Copy,
  GripVertical,
  Loader2,
  Languages,
  Lightbulb,
  Pin,
  Reply,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  WifiOff,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, IconButton, Kbd, Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabel } from '../../data/mock'
import { diffChars } from '../../lib/diff'
import { locale, otherLang, roleOf, targetLang, useLang, useT, writeDirection, type Lang, type Role, type T } from '../../lib/i18n'
import { setFeedback, suggestReplies, type Reply as SuggestedReply } from '../../lib/history'
import { useStore } from '../../store'
import { defaultChoice, modelField, useQuickChoices, type AiChoice } from '../../lib/ai'
import { emit } from '@tauri-apps/api/event'
import { useUpdates } from '../../lib/updates'
import type { ErrorKind as ClaudeErrorKind, RateLimit, Sections } from '../../lib/claude'
import type { Direction, Keigo, ReviewResult } from '../../types'
import { AiSwitcher } from './AiSwitcher'
import type { PopupOrigin, PopupRequest, WindowedHost } from './types'
import { dragsFrom, useFloatingFrame } from './useFloatingFrame'
import { useTranslation } from './useTranslation'

const LONG_TEXT_LIMIT = 4000
const keigoOrder: Keigo[] = ['casual', 'polite', 'formal']
/** A popup that could not read any text explains why, then gets out of the way. */
const NOTICE_CLOSE_MS = 2200
/** How long "copied" stays on screen after translate-and-copy. */
const AUTO_COPY_CLOSE_MS = 1200

export interface PopupProps {
  request: PopupRequest
  /** Size of the host area; omit to render inline instead of floating. */
  container?: { width: number; height: number }
  onClose: () => void
  /** Replace the text in the chat composer (only for origin `composer`). */
  onApply?: (text: string) => void
  /** Pinned popups stay open when the user clicks elsewhere. */
  onPinnedChange?: (pinned: boolean) => void
  /** Set when the popup is its own OS window (Tauri) instead of a box drawn on a page. */
  windowed?: WindowedHost
}

export function Popup({ request, container, onClose, onApply, onPinnedChange, windowed }: PopupProps) {
  const store = useStore()
  const { scenario, settings, showToast } = store
  const lang = useLang()
  const t = useT()
  // A first-time tip about the keys, shown in the first real popup only (the guide's practice popup does not count).
  const [tipOpen, setTipOpen] = useState(() => !settings.popupTipShown && request.origin !== 'onboarding')

  const [direction, setDirection] = useState<Direction>(request.direction)
  const [source, setSource] = useState(request.source)
  const [origin, setOrigin] = useState<PopupOrigin>(request.origin)
  // The user's default keigo until they change it here. Only a level they chose overrides a person's note in the Glossary.
  const [keigo, setKeigo] = useState<Keigo>(settings.defaultKeigo)
  const [keigoChosen, setKeigoChosen] = useState(false)
  const [runKey, setRunKey] = useState(0)
  const [pinned, setPinned] = useState(false)
  // The AI switcher: a choice made here translates again with it (and becomes the default).
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiOverride, setAiOverride] = useState<AiChoice | null>(null)
  const [replyMode, setReplyMode] = useState(false)
  const [replyText, setReplyText] = useState('')
  /** User edits of the finished result, tied to the stream run they belong to. */
  const [edit, setEdit] = useState<{ key: string | null; text: string } | null>(null)
  const [longConfirmed, setLongConfirmed] = useState(request.source.length <= LONG_TEXT_LIMIT)
  const [feedback, setFeedbackSent] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const notice = request.window?.error ?? null
  // Real app: the Rust side filed the text under its chat and a thread, out of sight; replies use the same context.
  const conversationId = request.window?.conversationId ?? null
  const chatName = windowed ? (request.window?.conversation ?? '') : request.conversation
  // A reply typed in this popup goes into the thread its message was filed in, which may be one just started.
  const [filedThread, setFiledThread] = useState<number | null>(request.window?.threadId ?? null)
  const frame = useFloatingFrame({
    request,
    container,
    geometry: store.popupGeometry,
    onGeometry: store.setPopupGeometry,
    rootRef,
  })

  const isReview = direction === 'review_ja'
  // Reading the other side, writing to them, or checking Japanese: the popup's actions follow from it.
  const role = roleOf(direction, lang)
  // Translations and reviews stream from Claude (canned answers in the browser prototype).
  const live = useTranslation({
    direction,
    text: source,
    keigo,
    keigoChosen,
    runKey,
    enabled: longConfirmed && !notice,
    scenario,
    history: windowed ? { conversationId, threadId: filedThread } : undefined,
    ai: aiOverride,
  })

  const aiChoices = useQuickChoices(settings)
  const currentAi = aiOverride ?? defaultChoice(settings)
  const answeredAi: AiChoice | null =
    // Only a fallback differs from what was asked for.
    live.answeredBy?.fallbackFrom && ['claude', 'openai', 'gemini'].includes(live.answeredBy.provider)
      ? { provider: live.answeredBy.provider as AiChoice['provider'], model: live.answeredBy.model }
      : null
  const pickAi = (c: AiChoice) => {
    setAiMenuOpen(false)
    rootRef.current?.focus()
    if (c.provider === currentAi.provider && c.model === currentAi.model) return
    setAiOverride(c)
    // Also the default from now on: the user switches when a model suits them better.
    store.updateSettings(c.provider === 'claude' ? { aiProvider: 'claude', model: c.model as 'sonnet' | 'haiku' } : { aiProvider: c.provider, [modelField(c.provider)]: c.model })
  }
  const manageAi = () => {
    setAiMenuOpen(false)
    if (!windowed) {
      store.openMain('settings')
      return
    }
    void invoke('show_main_window').then(() => emit('ui:open-tab', 'settings'))
  }

  const saved = live.saved
  if (saved && saved.threadId !== filedThread) setFiledThread(saved.threadId)

  const reviewResult = useMemo(
    () => (isReview && live.phase === 'done' ? toReview(source, live.sections, t) : null),
    [isReview, live.phase, live.sections, source, t],
  )

  const resultReady = live.phase === 'done'
  const resultText = isReview ? live.sections.suggestion || source : live.sections.translation
  // Editable copy of the finished result; a new run discards older edits.
  const resultKey = `${runKey}|${direction}|${keigo}|${source}`
  const draft = resultReady ? (edit?.key === resultKey ? edit.text : resultText) : null
  const setDraft = (text: string) => setEdit({ key: resultKey, text })

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(onClose, NOTICE_CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [notice, onClose])

  const tipVisible = tipOpen && resultReady && !isReview && !request.window?.autoCopy
  const { updateSettings } = store
  useEffect(() => {
    if (tipVisible && !settings.popupTipShown) updateSettings({ popupTipShown: true })
  }, [tipVisible, settings.popupTipShown, updateSettings])

  // Toolbar "translate and copy": put the result on the clipboard as soon as it is ready, say so, then close.
  const autoCopy = Boolean(windowed && request.window?.autoCopy)
  const [autoCopied, setAutoCopied] = useState(false)
  useEffect(() => {
    if (!autoCopy || !resultReady || autoCopied) return
    void invoke('clipboard_write', { text: resultText }).then(() => setAutoCopied(true))
  }, [autoCopy, resultReady, autoCopied, resultText])
  useEffect(() => {
    if (!autoCopied) return
    const t = window.setTimeout(onClose, AUTO_COPY_CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [autoCopied, onClose])

  // A real window follows its content's height (the Rust side ignores this once the user sets a height).
  useEffect(() => {
    if (!windowed) return
    const measure = () => {
      const h = (headerRef.current?.offsetHeight ?? 0) + (bodyRef.current?.offsetHeight ?? 0) + (footerRef.current?.offsetHeight ?? 0)
      windowed.onFit(h)
    }
    const ro = new ResizeObserver(measure)
    for (const el of [headerRef.current, bodyRef.current, footerRef.current]) if (el) ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [windowed])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    onPinnedChange?.(pinned)
  }, [pinned, onPinnedChange])

  const finalText = draft ?? resultText

  const close = onClose

  const copy = async (text: string, message: string) => {
    if (windowed) {
      windowed.onCopy(text)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard may be unavailable in some embedded browsers; the toast still explains the action.
    }
    showToast(message)
  }

  const primary = () => {
    if (!resultReady) return
    if (role === 'read') return
    const text = finalText
    if (origin === 'composer' && onApply) {
      onApply(text)
      onClose()
    } else {
      void copy(text, t('Đã sao chép, dán vào ô chat bằng Ctrl+V', 'コピーしました。Ctrl+V で入力欄に貼り付けてください'))
      onClose()
    }
  }

  const keepOriginal = () => {
    onClose()
  }

  const changeKeigo = (k: Keigo) => {
    setKeigo(k)
    setKeigoChosen(true)
    setRunKey((r) => r + 1)
  }

  const cycleKeigo = () => changeKeigo(keigoOrder[(keigoOrder.indexOf(keigo) + 1) % keigoOrder.length])

  // Reply suggestions for the other side's message: three short replies in their language, with the meaning.
  const [replies, setReplies] = useState<{ state: 'idle' | 'loading' | 'error'; items: SuggestedReply[]; error?: string }>({ state: 'idle', items: [] })
  const askReplies = () => {
    if (!resultReady || role !== 'read' || replies.state === 'loading') return
    setReplies({ state: 'loading', items: [] })
    const done = (items: SuggestedReply[]) => setReplies({ state: 'idle', items })
    if (!windowed) {
      window.setTimeout(() => done(MOCK_REPLIES[lang]), 700)
      return
    }
    suggestReplies({ text: source, keigo, conversationId, threadId: filedThread })
      .then(done)
      .catch((e) => setReplies({ state: 'error', items: [], error: String(e) }))
  }

  const startReply = () => {
    setReplyMode(true)
  }

  const submitReply = () => {
    const text = replyText.trim()
    if (!text) return
    setDirection(writeDirection(lang))
    setSource(text)
    setOrigin('popup')
    setReplyMode(false)
    setReplyText('')
    setRunKey((r) => r + 1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const inReply = target.dataset.role === 'reply'
    const inDraft = target.dataset.role === 'draft'
    const typing = inReply || inDraft || target.tagName === 'INPUT'

    if (e.key === 'Escape') {
      e.preventDefault()
      if (aiMenuOpen) {
        setAiMenuOpen(false)
        rootRef.current?.focus()
      } else if (replyMode) setReplyMode(false)
      else close()
      return
    }
    // Keys inside the AI menu belong to it (Enter picks the focused entry).
    if (target.closest('[role="menu"]')) return
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      setAiMenuOpen((o) => !o)
      return
    }
    if (inReply) {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        submitReply()
      }
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      setPinned((p) => !p)
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && !inDraft && !window.getSelection()?.toString()) {
      e.preventDefault()
      if (resultReady) void copy(finalText, t('Đã sao chép bản dịch', '翻訳をコピーしました'))
      return
    }
    if (e.key === 'Tab' && role === 'write') {
      e.preventDefault()
      cycleKeigo()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && (inDraft || !typing)) {
      e.preventDefault()
      // On the other side's message Enter starts a reply. Not a letter key: an input method (UniKey, the
      // Japanese IME) would count the letter as the start of the first word typed in the reply box.
      if (role === 'read') startReply()
      else primary()
      return
    }
    if (!typing && role === 'read' && e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      askReplies()
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="MyTranslate"
      tabIndex={-1}
      data-popup
      data-direction={direction}
      onKeyDown={onKeyDown}
      style={frame.style}
      className={cx(
        'flex flex-col bg-window text-ink outline-none focus-visible:outline-none',
        // A real window gets its border, corners and shadow from Windows.
        windowed ? 'h-screen w-screen' : 'rounded-lg border border-line shadow-popup',
        !windowed && (container ? 'absolute z-40' : 'relative w-[440px]'),
        // A real window is on screen at once; its content then comes into focus. The in-page popup grows in.
        !frame.dragging && (windowed ? 'anim-reveal' : 'anim-popup'),
        frame.dragging && 'select-none',
      )}
    >
      {windowed && (
        <>
          <div onPointerDown={() => windowed.startResize('West')} className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize" />
          <div onPointerDown={() => windowed.startResize('East')} className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize" />
          <div onPointerDown={() => windowed.startResize('South')} className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize" />
          <div onPointerDown={() => windowed.startResize('SouthWest')} className="absolute bottom-0 left-0 z-10 size-3 cursor-nesw-resize" />
          <div onPointerDown={() => windowed.startResize('SouthEast')} className="absolute right-0 bottom-0 z-10 size-3 cursor-nwse-resize" />
        </>
      )}
      {container && (
        <>
          <div
            {...frame.resizeHandle('left')}
            title={t('Kéo để đổi độ rộng, nhấp đúp để về mặc định', 'ドラッグで幅を変更、ダブルクリックで元に戻す')}
            className="absolute top-3 bottom-3 -left-1 z-10 w-2 cursor-ew-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('right')}
            title={t('Kéo để đổi độ rộng, nhấp đúp để về mặc định', 'ドラッグで幅を変更、ダブルクリックで元に戻す')}
            className="absolute top-3 bottom-3 -right-1 z-10 w-2 cursor-ew-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('bottom')}
            title={t('Kéo để đổi chiều cao, nhấp đúp để tự co theo nội dung', 'ドラッグで高さを変更、ダブルクリックで内容に合わせる')}
            className="absolute inset-x-3 -bottom-1 z-10 h-2 cursor-ns-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('bottom-left')}
            title={t('Kéo để đổi kích thước', 'ドラッグでサイズを変更')}
            className="absolute -bottom-1 -left-1 z-10 size-3.5 cursor-nesw-resize"
          />
          <div
            {...frame.resizeHandle('bottom-right')}
            title={t('Kéo để đổi kích thước', 'ドラッグでサイズを変更')}
            className="absolute -right-1 -bottom-1 z-10 size-3.5 cursor-nwse-resize"
          />
        </>
      )}
      <header
        ref={headerRef}
        onPointerDown={(e) => {
          if (!windowed) return frame.onHeaderPointerDown(e)
          if (e.button === 0 && dragsFrom(e.target)) windowed.startDrag()
        }}
        className={cx(
          'relative flex h-10 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1 select-none',
          (container || windowed) && (frame.dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
        {(container || windowed) && <GripVertical size={14} className="shrink-0 text-ink-3" aria-hidden />}
        {/* Where the text came from. The thread it is filed under is picked automatically and not shown. */}
        <div
          title={[request.window?.workspace, chatName].filter(Boolean).join(' / ') || undefined}
          className="flex h-7 min-w-0 shrink items-center gap-1.5 px-1.5"
        >
          <AppBadge app={request.app} />
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{chatName || t('Ứng dụng khác', 'その他のアプリ')}</span>
        </div>
        <div className="h-full min-w-3 flex-1" />
        {isReview && <DirectionBadge direction={direction} verdict={resultReady ? reviewResult?.verdict : undefined} />}
        <AiSwitcher
          choices={aiChoices}
          current={currentAi}
          answeredBy={answeredAi}
          open={aiMenuOpen}
          onOpenChange={setAiMenuOpen}
          onPick={pickAi}
          onManage={manageAi}
        />
        {((container && frame.customized) || windowed?.customized) && (
          <IconButton label={t('Đặt lại vị trí và kích thước', '位置とサイズを元に戻す')} onClick={windowed ? windowed.onReset : frame.reset}>
            <RotateCcw size={13} />
          </IconButton>
        )}
        <IconButton
          label={pinned ? t('Bỏ ghim (Ctrl+P)', 'ピン留めを解除 (Ctrl+P)') : t('Ghim popup (Ctrl+P)', 'ポップアップをピン留め (Ctrl+P)')}
          active={pinned}
          onClick={() => setPinned((p) => !p)}
        >
          <Pin size={14} />
        </IconButton>
        <IconButton label={t('Đóng (Esc)', '閉じる (Esc)')} onClick={close}>
          <X size={15} />
        </IconButton>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div ref={bodyRef}>
        {notice ? (
          <Banner
            tone="warn"
            icon={<AlertTriangle size={16} />}
            title={
              notice === 'no_selection'
                ? t('Chưa chọn đoạn văn bản nào', 'テキストが選択されていません')
                : t('Không đọc được clipboard', 'クリップボードを読み取れません')
            }
          >
            {notice === 'no_selection'
              ? t(
                  'Bôi đen tin nhắn cần dịch, hoặc đặt con trỏ trong ô chat có chữ, rồi nhấn phím tắt lại.',
                  '翻訳したいメッセージを選択するか、文字のある入力欄にカーソルを置いて、もう一度ショートカットを押してください。',
                )
              : t('Ứng dụng khác đang giữ clipboard. Hãy thử lại.', '別のアプリがクリップボードを使用中です。もう一度お試しください。')}
          </Banner>
        ) : (
        <>

        {!longConfirmed ? (
          <Banner
            tone="warn"
            icon={<AlertTriangle size={16} />}
            title={t(`Văn bản dài ${source.length.toLocaleString('vi-VN')} ký tự`, `${source.length.toLocaleString('ja-JP')} 文字の長い文章です`)}
          >
            {t('Dịch đoạn dài sẽ mất nhiều thời gian và hạn mức hơn.', '長い文章の翻訳には時間と利用枠が多く必要です。')}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => setLongConfirmed(true)}>
                {t('Tiếp tục', '続ける')}
              </Button>
              <Button size="sm" onClick={onClose}>
                {t('Hủy', 'キャンセル')}
              </Button>
            </div>
          </Banner>
        ) : live.phase === 'error' && live.error ? (
          <ErrorBanner
            kind={live.error.kind}
            provider={live.error.provider}
            message={live.error.message}
            onRetry={() => setRunKey((r) => r + 1)}
            onAction={(t) => showToast(t)}
          />
        ) : isReview ? (
          <ReviewBody result={reviewResult} />
        ) : (
          <TranslationBody
            direction={direction}
            role={role}
            stream={{
              text: live.sections.translation,
              started: live.sections.translation !== '',
              done: live.phase === 'done',
            }}
            draft={draft}
            onDraft={setDraft}
            back={live.sections.backTranslation || undefined}
          />
        )}
        {role === 'read' && (replies.state !== 'idle' || replies.items.length > 0) ? (
          <RepliesBlock
            state={replies.state}
            items={replies.items}
            error={replies.error}
            onRetry={askReplies}
            onCopy={(r) => void copy(r.text, t('Đã sao chép câu trả lời', '返信をコピーしました'))}
          />
        ) : null}
        {autoCopied && (
          <div role="status" className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12.5px] font-medium text-good">
            <Copy size={13} /> {t('Đã sao chép bản dịch', '翻訳をコピーしました')}
          </div>
        )}
        {resultReady && live.answeredBy?.fallbackFrom && (
          <div className="border-t border-line px-4 py-1.5 text-[12px] text-ink-2">
            {t(
              `${aiName(live.answeredBy.fallbackFrom)} không dịch được, đã dịch bằng ${aiName(live.answeredBy.provider)} (${live.answeredBy.model})`,
              `${aiName(live.answeredBy.fallbackFrom)} で翻訳できなかったため、${aiName(live.answeredBy.provider)}（${live.answeredBy.model}）で翻訳しました`,
            )}
          </div>
        )}
        {tipVisible && (
          <FirstTip
            role={role}
            origin={origin}
            onDismiss={() => {
              setTipOpen(false)
              // The button goes away with the tip; keep the popup's keys (Enter, Esc) working.
              rootRef.current?.focus()
            }}
          />
        )}
        {resultReady && <QuotaLine rate={live.rateLimit} />}
        {resultReady && windowed && <UpdateLine />}
        </>
        )}
        </div>
      </div>

      {!notice && (
      <footer ref={footerRef} className="shrink-0 border-t border-line px-3 py-2.5">
        {replyMode ? (
          <div className="flex flex-col gap-2">
            <textarea
              data-role="reply"
              autoFocus
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t('Gõ câu trả lời bằng tiếng Việt...', '日本語で返信を入力…')}
              className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setReplyMode(false)}>
                {t('Hủy', 'キャンセル')} <Kbd>Esc</Kbd>
              </Button>
              <Button size="sm" variant="primary" disabled={!replyText.trim()} onClick={submitReply}>
                {t('Dịch sang tiếng Nhật', 'ベトナム語に翻訳')}{' '}
                <Kbd className="h-4 border-transparent bg-white/25 text-on-accent">Ctrl+Enter</Kbd>
              </Button>
            </div>
          </div>
        ) : (
          <FooterActions
            role={role}
            origin={origin}
            ready={resultReady}
            keigo={keigo}
            feedback={feedback}
            onKeigo={changeKeigo}
            onPrimary={primary}
            onKeep={keepOriginal}
            onReply={startReply}
            onSuggest={askReplies}
            suggesting={replies.state === 'loading'}
            onCopy={() => void copy(finalText, t('Đã sao chép bản dịch', '翻訳をコピーしました'))}
            onFeedback={() => {
              setFeedbackSent(true)
              if (windowed && saved) void setFeedback(saved.messageId, true)
              showToast(t('Cảm ơn bạn, bản dịch này sẽ được xem xét để cải thiện prompt', 'ありがとうございます。この翻訳はプロンプト改善の参考にします'))
            }}
          />
        )}
      </footer>
      )}
    </div>
  )
}

/** The keys a new user would not guess; the buttons below already show the main one. */
function FirstTip({ role, origin, onDismiss }: { role: Role; origin: PopupOrigin; onDismiss: () => void }) {
  const t = useT()
  const lang = useLang()
  const enter = <Kbd>Enter</Kbd>
  const tab = <Kbd>Tab</Kbd>
  const esc = <Kbd>Esc</Kbd>
  return (
    <div role="note" className="flex items-start gap-2 border-t border-line bg-accent-soft px-4 py-2 text-[12.5px] leading-relaxed text-ink">
      <Lightbulb size={14} className="mt-[3px] shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        {lang === 'ja' ? (
          role === 'read' ? (
            <>{enter} で日本語の返信を入力すると、MyTranslate がベトナム語に翻訳します。{esc} で閉じます。</>
          ) : origin === 'composer' ? (
            <>{enter} でベトナム語訳を入力欄に貼り付けます。{tab} で丁寧さを切り替えます。{esc} で閉じます。</>
          ) : (
            <>{enter} で翻訳をコピーします。{tab} で丁寧さを切り替えます。{esc} で閉じます。</>
          )
        ) : role === 'read' ? (
          <>Nhấn {enter} để gõ câu trả lời bằng tiếng Việt, MyTranslate sẽ dịch sang tiếng Nhật cho bạn. {esc} để đóng.</>
        ) : origin === 'composer' ? (
          <>Nhấn {enter} để thay bản tiếng Nhật vào ô chat. {tab} đổi mức kính ngữ. {esc} để đóng.</>
        ) : (
          <>Nhấn {enter} để sao chép bản dịch. {tab} đổi mức kính ngữ. {esc} để đóng.</>
        )}
      </p>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1 font-medium text-accent hover:underline">
        {t('Đã hiểu', 'OK')}
      </button>
    </div>
  )
}

/** The prototype's suggested replies: in the other side's language, with the meaning in the user's. */
const MOCK_REPLIES: Record<Lang, SuggestedReply[]> = {
  vi: [
    { text: '承知いたしました。確認いたします。', meaning: 'Em đã hiểu. Em sẽ kiểm tra ạ.' },
    { text: '詳細を教えていただけますでしょうか。', meaning: 'Anh có thể cho em biết chi tiết hơn được không ạ?' },
    { text: '本日中に確認してご連絡いたします。', meaning: 'Trong hôm nay em sẽ kiểm tra và liên lạc lại ạ.' },
  ],
  ja: [
    { text: 'Anh hiểu rồi. Cảm ơn em nhé.', meaning: 'わかりました。ありがとう。' },
    { text: 'Em cho anh biết thêm chi tiết được không?', meaning: 'もう少し詳しく教えてもらえますか。' },
    { text: 'Anh sẽ kiểm tra và trả lời em trong hôm nay.', meaning: '今日中に確認して返事します。' },
  ],
}

function RepliesBlock({
  state,
  items,
  error,
  onRetry,
  onCopy,
}: {
  state: 'idle' | 'loading' | 'error'
  items: SuggestedReply[]
  error?: string
  onRetry: () => void
  onCopy: (r: SuggestedReply) => void
}) {
  const t = useT()
  const lang = useLang()
  return (
    <Section className="bg-subtle">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
        <Sparkles size={12} className="text-accent" /> {t('Gợi ý trả lời', '返信案')}
      </div>
      {state === 'loading' && (
        <div role="status" className="flex items-center gap-2 py-1 text-[13.5px] text-ink-2">
          <Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" /> {t('Đang soạn gợi ý…', '返信案を作成中…')}
        </div>
      )}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-[13px] text-bad">
          <span className="min-w-0 flex-1 truncate" title={error}>
            {t('Không lấy được gợi ý', '返信案を取得できません')}
          </span>
          <Button size="sm" onClick={onRetry}>
            {t('Thử lại', '再試行')}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {items.map((r) => (
          <button
            key={r.text}
            type="button"
            onClick={() => onCopy(r)}
            title={t('Bấm để sao chép', 'クリックでコピー')}
            className="group -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span lang={otherLang(lang)} className="block text-[14px] leading-relaxed text-ink">
                {r.text}
              </span>
              {r.meaning && (
                <span lang={lang} className="block text-[12.5px] leading-relaxed text-ink-2">
                  {r.meaning}
                </span>
              )}
            </span>
            <Copy size={13} className="mt-1 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </Section>
  )
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('border-b border-line px-4 py-3 last:border-b-0', className)}>{children}</div>
}

function DirectionBadge({ direction, verdict }: { direction: Direction; verdict?: 'ok' | 'suggest' | 'error' }) {
  const t = useT()
  if (direction === 'review_ja') {
    if (!verdict) return <span className="shrink-0 px-1.5 text-[12px] font-medium whitespace-nowrap text-ink-3">{t('Kiểm tra JA', '日本語チェック')}</span>
    const map = {
      ok: ['bg-good-soft text-good', t('Ổn', '問題なし')],
      suggest: ['bg-warn-soft text-warn', t('Nên sửa', '修正推奨')],
      error: ['bg-bad-soft text-bad', t('Có lỗi', '誤りあり')],
    } as const
    return <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap', map[verdict][0])}>{map[verdict][1]}</span>
  }
  return (
    <span className="flex shrink-0 items-center gap-1 px-1.5 text-[12px] font-semibold whitespace-nowrap text-ink-3">
      <Languages size={13} />
      {direction === 'ja_vi' ? 'JA → VI' : 'VI → JA'}
    </span>
  )
}

/** Shown until the first translated character arrives, so the user knows work is under way. */
function PendingBlock({ label }: { label: string }) {
  return (
    <Section>
      <div role="status" className="flex items-center gap-2 py-0.5 text-[14px] text-ink-2">
        <Loader2 size={16} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" />
        <span>{label}</span>
      </div>
    </Section>
  )
}

/**
 * Streamed text where each piece that arrives settles in from a light blur instead of popping in. Every piece keeps
 * its own span, so a piece already shown never animates again; text that gets shorter starts over.
 */
function InkText({ text }: { text: string }) {
  const [cuts, setCuts] = useState<number[]>([])
  const last = cuts.at(-1) ?? 0
  if (text.length < last) setCuts([])
  else if (text.length > last) setCuts([...cuts, text.length])
  return cuts.map((end, i) => {
    const start = i === 0 ? 0 : cuts[i - 1]
    return (
      <span key={start} className="ink-in">
        {text.slice(start, end)}
      </span>
    )
  })
}

function TranslationBody({
  direction,
  role,
  stream,
  draft,
  onDraft,
  back,
}: {
  direction: 'ja_vi' | 'vi_ja'
  role: Role
  stream: { text: string; started: boolean; done: boolean }
  draft: string | null
  onDraft: (v: string) => void
  /** The result read back in the user's language, so they can check the meaning before sending. */
  back?: string
}) {
  const t = useT()
  const userLang = useLang()
  if (!stream.started) return <PendingBlock label={t('Đang dịch…', '翻訳中…')} />
  const lang = targetLang(direction)
  return (
    <>
      <Section>
        {role === 'write' && stream.done && draft !== null ? (
          <textarea
            data-role="draft"
            lang={lang}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            aria-label={t('Bản tiếng Nhật, có thể sửa', 'ベトナム語訳（編集できます）')}
            className="-mx-1.5 -my-1 block w-[calc(100%+12px)] field-sizing-content resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] leading-relaxed text-ink hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
          />
        ) : (
          <p lang={lang} className={cx('text-[15px] leading-relaxed whitespace-pre-wrap', !stream.done && 'stream-caret')}>
            <InkText text={stream.text} />
          </p>
        )}
      </Section>
      {stream.done && role === 'write' && back && (
        <Section className="bg-subtle">
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Ý nghĩa khi đọc lại', '読み返したときの意味')}</div>
          <p lang={userLang} className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
            {back}
          </p>
        </Section>
      )}
    </>
  )
}

/** Turns Claude's review tags into what the popup shows: verdict, issues and a diff of the suggestion. */
function toReview(source: string, sections: Sections, t: T): ReviewResult {
  const verdict = (['ok', 'suggest', 'error'] as const).find((v) => sections.verdict.trim().toLowerCase() === v) ?? 'suggest'
  const issues = sections.issues
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const at = line.search(/[:：]/)
      return at > 0 && at < 20
        ? { kind: line.slice(0, at).trim(), span: String(i), text: line.slice(at + 1).trim() }
        : { kind: t('Góp ý', '指摘'), span: String(i), text: line }
    })
  const suggestion = sections.suggestion || source
  return { verdict, issues, diff: diffChars(source, suggestion), suggestion, suggestionVi: sections.suggestionVi }
}

function ReviewBody({ result }: { result: ReviewResult | null }) {
  const t = useT()
  const lang = useLang()
  if (!result) return <PendingBlock label={t('Đang kiểm tra câu tiếng Nhật…', '日本語をチェック中…')} />
  return (
    <>
      {result.issues.length > 0 ? (
        <Section className="flex flex-col gap-2">
          {result.issues.map((issue, i) => (
            <div key={`${i}-${issue.kind}`} className="flex gap-2 text-[13px] leading-snug">
              <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-warn-soft text-[11px] font-bold text-warn">
                {i + 1}
              </span>
              <div>
                <span className="mr-1.5 rounded bg-subtle px-1.5 py-px text-[11.5px] font-semibold text-ink-2">{issue.kind}</span>
                <span className="text-ink">{issue.text}</span>
              </div>
            </div>
          ))}
        </Section>
      ) : (
        <Section>
          <p className="text-[13.5px] text-good">
            {t('Câu đã tự nhiên và đúng kính ngữ, có thể gửi luôn.', '自然で敬語も正しい文です。このまま送れます。')}
          </p>
        </Section>
      )}
      {result.verdict !== 'ok' && (
        <Section>
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Đề xuất', '修正案')}</div>
          <p lang="ja" className="text-[15px] leading-relaxed whitespace-pre-wrap">
            {result.diff.map((part, i) => (
              <span
                key={i}
                className={cx(
                  part.type === 'del' && 'text-bad line-through decoration-bad/70',
                  part.type === 'ins' && 'rounded-sm bg-good-soft text-good',
                )}
              >
                {part.text}
              </span>
            ))}
          </p>
          {/* The Vietnamese meaning helps a Vietnamese user; a Japanese user reads the suggestion itself. */}
          {result.suggestionVi && lang === 'vi' && (
            <p lang="vi" className="mt-1.5 text-[13px] whitespace-pre-wrap text-ink-2">
              Nghĩa: {result.suggestionVi}
            </p>
          )}
        </Section>
      )}
    </>
  )
}

/** The popup is what people see every day: mention a waiting update, and open the main window to install it. */
function UpdateLine() {
  const t = useT()
  const { status } = useUpdates()
  if (!status?.available) return null
  const version = status.available.version
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-[12px] text-ink-2">
      <span className="flex-1">{t(`Có phiên bản mới ${version}`, `新しいバージョン ${version} があります`)}</span>
      <button type="button" onClick={() => void invoke('show_main_window')} className="font-medium text-accent hover:underline">
        {t('Cập nhật', 'アップデート')}
      </button>
    </div>
  )
}

/** Shown only when the plan is close to its limit, so the user is not surprised when translations stop. */
function QuotaLine({ rate }: { rate: RateLimit | null }) {
  const t = useT()
  const lang = useLang()
  if (!rate) return null
  const used = rate.utilization ?? 0
  if (rate.status === 'allowed' && used < 0.8) return null
  const period =
    rate.limitType === 'seven_day' ? t('tuần', '週間') : rate.limitType === 'five_hour' ? t('5 giờ', '5時間') : t('hiện tại', '現在')
  const reset = rate.resetsAt
    ? new Date(rate.resetsAt * 1000).toLocaleString(locale(lang), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null
  const pct = Math.round(used * 100)
  return (
    <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12px] text-warn">
      <AlertTriangle size={13} className="shrink-0" />
      <span>
        {used > 0
          ? t(`Đã dùng ${pct}% hạn mức ${period} của gói Claude`, `Claude プランの${period}の利用枠を ${pct}% 使用しました`)
          : t('Gói Claude sắp hết hạn mức', 'Claude プランの利用枠がまもなく上限です')}
        {reset && t(`, làm mới ${reset}`, `（${reset} にリセット）`)}
      </span>
    </div>
  )
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'warn' | 'bad'
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className={cx('m-3 flex gap-2.5 rounded-md px-3 py-2.5', tone === 'warn' ? 'bg-warn-soft' : 'bg-bad-soft')}>
      <span className={cx('mt-px', tone === 'warn' ? 'text-warn' : 'text-bad')}>{icon}</span>
      <div className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-ink-2">{children}</div>
      </div>
    </div>
  )
}

/** Display name of an AI provider id. */
function aiName(id: string): string {
  return id === 'openai' ? 'ChatGPT' : id === 'gemini' ? 'Gemini' : 'Claude'
}

function ErrorBanner({
  kind,
  provider,
  message,
  onRetry,
  onAction,
}: {
  kind: ClaudeErrorKind
  provider: string
  message: string
  onRetry: () => void
  onAction: (toast: string) => void
}) {
  const t = useT()
  const name = aiName(provider)
  const retryButton = (variant?: 'primary') => (
    <Button size="sm" variant={variant} onClick={onRetry}>
      {t('Thử lại', '再試行')}
    </Button>
  )
  const retry = <div className="mt-2 flex gap-2">{retryButton('primary')}</div>
  const openSettings = (
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="primary" onClick={() => void invoke('show_main_window')}>
        {t('Mở Cài đặt', '設定を開く')}
      </Button>
      {retryButton()}
    </div>
  )
  if (kind === 'missing_key') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t(`Chưa có API key ${name}`, `${name} の APIキーがありません`)}>
        {t('Nhập API key ở Cài đặt > Kết nối AI, hoặc chọn AI khác.', '設定 > AI接続 で APIキーを入力するか、別のAIを選んでください。')}
        {openSettings}
      </Banner>
    )
  }
  if (kind === 'bad_key') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t(`API key ${name} không đúng`, `${name} の APIキーが正しくありません`)}>
        {t('Key sai hoặc đã bị thu hồi. Nhập lại key ở Cài đặt > Kết nối AI.', 'キーが誤っているか無効になっています。設定 > AI接続 で入力し直してください。')}
        {openSettings}
      </Banner>
    )
  }
  if (kind === 'network') {
    return (
      <Banner tone="bad" icon={<WifiOff size={16} />} title={t(`Không kết nối được tới ${name}`, `${name} に接続できません`)}>
        {t('Kiểm tra mạng (hoặc proxy của công ty) rồi thử lại.', 'ネットワーク（または社内プロキシ）を確認して、もう一度お試しください。')}
        {retry}
      </Banner>
    )
  }
  if (kind === 'rate_limited' && provider !== 'claude') {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title={t(`Hết hạn mức ${name}`, `${name} の利用枠を使い切りました`)}>
        {t(
          'Tài khoản API đã hết hạn mức hoặc chưa nạp tiền. Thử lại sau, hoặc bật "Tự chuyển sang AI khác khi lỗi" trong Cài đặt.',
          'APIアカウントの利用枠の上限に達したか、残高がありません。時間をおいて再試行するか、設定で「エラー時に別のAIに切り替える」をオンにしてください。',
        )}
        {retry}
      </Banner>
    )
  }
  if (kind === 'not_logged_in') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t('Claude Code chưa đăng nhập', 'Claude Code にログインしていません')}>
        {t('Mở terminal và chạy lệnh', 'ターミナルを開いて')} <code className="rounded bg-surface px-1 text-[12px]">claude</code>{' '}
        {t('để đăng nhập bằng tài khoản Claude của bạn.', 'を実行し、ご自身の Claude アカウントでログインしてください。')}
        {retry}
      </Banner>
    )
  }
  if (kind === 'not_installed') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t('Không tìm thấy Claude Code', 'Claude Code が見つかりません')}>
        {t('Cài Claude Code và đăng nhập, rồi thử lại.', 'Claude Code をインストールしてログインしてから、もう一度お試しください。')}
        {retry}
      </Banner>
    )
  }
  if (kind === 'rate_limited') {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title={t('Đã hết hạn mức gói Claude', 'Claude プランの利用枠を使い切りました')}>
        {t('Hãy thử lại sau khi hạn mức được làm mới.', '利用枠がリセットされてから、もう一度お試しください。')}
        <div className="mt-2 flex gap-2">{retryButton()}</div>
      </Banner>
    )
  }
  return (
    <Banner
      tone="bad"
      icon={<WifiOff size={16} />}
      title={kind === 'timeout' ? t(`${name} không trả lời kịp`, `${name} から時間内に応答がありません`) : t('Không dịch được', '翻訳できませんでした')}
    >
      <span className="font-mono text-[12px] break-all">{message}</span>
      <div className="mt-2 flex gap-2">
        {retryButton('primary')}
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(message).catch(() => undefined)
            onAction(t('Đã sao chép thông tin lỗi', 'エラー情報をコピーしました'))
          }}
        >
          {t('Sao chép lỗi', 'エラーをコピー')}
        </Button>
      </div>
    </Banner>
  )
}

function FooterActions({
  role,
  origin,
  ready,
  keigo,
  feedback,
  onKeigo,
  onPrimary,
  onKeep,
  onReply,
  onSuggest,
  suggesting,
  onCopy,
  onFeedback,
}: {
  role: Role
  origin: PopupOrigin
  ready: boolean
  keigo: Keigo
  feedback: boolean
  onKeigo: (k: Keigo) => void
  onPrimary: () => void
  onKeep: () => void
  onReply: () => void
  onSuggest: () => void
  suggesting: boolean
  onCopy: () => void
  onFeedback: () => void
}) {
  const t = useT()
  const lang = useLang()
  const feedbackButton = (
    <IconButton
      label={feedback ? t('Đã gửi phản hồi', 'フィードバック送信済み') : t('Dịch chưa tốt', '翻訳がよくない')}
      active={feedback}
      disabled={!ready}
      onClick={onFeedback}
    >
      <ThumbsDown size={14} />
    </IconButton>
  )
  const enterKbd = <Kbd className="h-4 border-transparent bg-white/25 px-1 text-[12px] text-on-accent">↵</Kbd>

  if (role === 'read') {
    return (
      // Wraps instead of overflowing when the popup is made narrow: copy moves under reply and suggest.
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onReply}>
          <Reply size={14} /> {t('Trả lời', '返信')} <Kbd>↵</Kbd>
        </Button>
        <Button
          size="sm"
          disabled={!ready || suggesting}
          onClick={onSuggest}
          title={t('AI gợi ý 3 câu trả lời tiếng Nhật', 'AIがベトナム語の返信案を3つ提案します')}
        >
          <Sparkles size={14} /> {t('Gợi ý', '返信案')} <Kbd>G</Kbd>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {feedbackButton}
          <Button size="sm" disabled={!ready} onClick={onCopy}>
            <Copy size={14} /> {t('Sao chép', 'コピー')}
          </Button>
        </div>
      </div>
    )
  }
  if (role === 'write') {
    return (
      // Wraps instead of overflowing when the popup is made narrow: the actions move under the keigo choice.
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span title={t('Tab để đổi mức kính ngữ', 'Tab で丁寧さを切り替え')} className="inline-flex">
          <Segmented
            label={t('Mức kính ngữ', '丁寧さ')}
            value={keigo}
            onChange={onKeigo}
            options={keigoOrder.map((k) => ({ value: k, label: keigoLabel(k, lang) }))}
          />
        </span>
        <div className="ml-auto flex items-center gap-2">
        {feedbackButton}
        {origin === 'composer' ? (
          <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
            {t('Thay vào chat', '入力欄に貼り付け')} {enterKbd}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
            <Copy size={14} /> {t('Sao chép', 'コピー')} {enterKbd}
          </Button>
        )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" onClick={onKeep}>
        {t('Giữ nguyên', 'そのまま')} <Kbd>Esc</Kbd>
      </Button>
      <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
        {origin === 'composer' ? t('Dùng đề xuất', '修正案を使う') : t('Sao chép đề xuất', '修正案をコピー')} {enterKbd}
      </Button>
    </div>
  )
}
