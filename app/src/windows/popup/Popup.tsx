import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  GripVertical,
  Loader2,
  Languages,
  Lightbulb,
  Pin,
  Replace,
  Reply,
  RotateCcw,
  Settings,
  SpellCheck,
  ThumbsDown,
  Undo2,
  WifiOff,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, IconButton, Kbd, Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabel } from '../../data/mock'
import { diffChars, diffWords } from '../../lib/diff'
import { isMostlyJapanese, locale, otherLang, roleOf, targetLang, useLang, useT, writeDirection, type Lang, type Role } from '../../lib/i18n'
import { setFeedback } from '../../lib/history'
import { useStore } from '../../store'
import { AI_NAMES, AI_ORDER, choiceLabel, defaultChoice, modelField, useQuickChoices, type AiChoice, type QuickChoice } from '../../lib/ai'
import { ACCOUNT_TOOL, loginAccount, type Account } from '../../lib/accounts'
import { emit } from '@tauri-apps/api/event'
import { useUpdates } from '../../lib/updates'
import type { ErrorKind as ClaudeErrorKind, RateLimit, Sections } from '../../lib/claude'
import type { Direction, Keigo, ReviewResult } from '../../types'
import { issueLabel, parseIssues } from '../../lib/review'
import { AiSwitcher } from './AiSwitcher'
import type { PopupOrigin, PopupRequest, WindowedHost } from './types'
import { dragsFrom, useFloatingFrame } from './useFloatingFrame'
import { useTranslation } from './useTranslation'

const LONG_TEXT_LIMIT = 4000
/** A review spells out at most this many points; the suggestion covers them all. */
const MAX_SHOWN_ISSUES = 3
const keigoOrder: Keigo[] = ['casual', 'polite', 'formal']

/** One run for the reply: `check` shows what it produced, `use` sends it as soon as it is done. */
interface ReplyRun {
  seq: number
  text: string
  purpose: 'check' | 'use'
  direction: Direction
}
/** A popup that could not read any text explains why, then gets out of the way. */
const NOTICE_CLOSE_MS = 2200

export interface PopupProps {
  request: PopupRequest
  /** Size of the host area; omit to render inline instead of floating. */
  container?: { width: number; height: number }
  onClose: () => void
  /**
   * Replace the selected text in the chat app: a result for origin `composer`, or a reply written in the popup
   * when the text was selected in a message box. `keep` leaves the text on the clipboard too, for when it is not
   * known whether the selection can be typed over.
   */
  onApply?: (text: string, options?: { keep?: boolean }) => void
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

  const { direction, source, origin } = request
  // The user's default keigo until they change it here. Only a level they chose overrides a person's note in the Glossary.
  const [keigo, setKeigo] = useState<Keigo>(settings.defaultKeigo)
  const [keigoChosen, setKeigoChosen] = useState(false)
  const [runKey, setRunKey] = useState(0)
  const [pinned, setPinned] = useState(false)
  // The AI switcher: a choice made here translates again with it (and becomes the default).
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiOverride, setAiOverride] = useState<AiChoice | null>(null)
  // Writing back from the reading popup: Ctrl+Enter checks the reply, Enter uses it (see `replyRun`).
  const [replyMode, setReplyMode] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replyRun, setReplyRun] = useState<ReplyRun | null>(null)
  /** After a check: send the reply as written instead of the corrected one. */
  const [keepOwn, setKeepOwn] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)
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

  const isReview = direction === 'review_ja' || direction === 'review_vi'
  // Reading the other side, writing to them, or checking what they wrote: the popup's actions follow from it.
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
  // The reply's own run: its translation, or the check of a reply already in the other side's language.
  const replyLive = useTranslation({
    direction: replyRun?.direction ?? writeDirection(lang),
    text: replyRun?.text ?? '',
    keigo,
    keigoChosen,
    runKey: replyRun?.seq ?? 0,
    enabled: replyRun !== null,
    scenario,
    history: windowed ? { conversationId, threadId: filedThread } : undefined,
    ai: aiOverride,
  })

  const aiChoices = useQuickChoices(settings)
  const currentAi = aiOverride ?? defaultChoice(settings)
  const answeredAi: AiChoice | null =
    // Differs from what was asked for when the chosen model or AI could not answer.
    live.answeredBy && (AI_ORDER as readonly string[]).includes(live.answeredBy.provider)
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
      store.openMain('settings', 'ai')
      return
    }
    void invoke('show_main_window').then(() => emit('ui:open-tab', 'settings:ai'))
  }

  const saved = live.saved
  if (saved && saved.threadId !== filedThread) setFiledThread(saved.threadId)

  const reviewResult = useMemo(
    () => (isReview && live.phase === 'done' ? toReview(source, live.sections, direction === 'review_ja' ? 'ja' : 'vi') : null),
    [isReview, live.phase, live.sections, source, direction],
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

  const tipVisible = tipOpen && resultReady && !isReview && !replyMode
  const { updateSettings } = store
  useEffect(() => {
    if (tipVisible && !settings.popupTipShown) updateSettings({ popupTipShown: true })
  }, [tipVisible, settings.popupTipShown, updateSettings])

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
    const text = finalText
    if (role === 'read') {
      void copy(text, t('Đã sao chép bản dịch', '翻訳をコピーしました'))
    } else if (origin === 'composer' && onApply) {
      onApply(text)
    } else {
      void copy(text, t('Đã sao chép, dán vào ô chat bằng Ctrl+V', 'コピーしました。Ctrl+V で入力欄に貼り付けてください'))
    }
    onClose()
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

  // The reply. Typed in the user's language it is translated; typed in the other side's it is used as written, and
  // a check reviews it in that language. It replaces the selected text when that was in a message box.
  const replyReplaces = !!onApply && request.inMessageBox !== false
  const replyBusy = replyRun !== null && replyLive.phase !== 'done' && replyLive.phase !== 'error'
  const replyStale = replyRun !== null && replyText.trim() !== replyRun.text
  const replyIsReview = replyRun?.direction === 'review_ja' || replyRun?.direction === 'review_vi'
  const replyReview = useMemo(
    () =>
      replyRun && replyIsReview && replyLive.phase === 'done'
        ? toReview(replyRun.text, replyLive.sections, replyRun.direction === 'review_ja' ? 'ja' : 'vi')
        : null,
    [replyRun, replyIsReview, replyLive.phase, replyLive.sections],
  )
  /** A check is shown for the reply as it is now: Enter sends what the check produced. */
  const replyChecked = replyRun?.purpose === 'check' && replyLive.phase === 'done' && !replyStale
  const replyFixed = replyChecked && !!replyReview && replyReview.verdict !== 'ok' && !keepOwn
  const replyResult = !replyRun ? '' : replyIsReview ? (replyFixed ? replyReview!.suggestion : replyRun.text) : replyLive.sections.translation

  const startReply = () => {
    setReplyMode(true)
  }

  const cancelReply = () => {
    setReplyMode(false)
    setReplyRun(null)
    rootRef.current?.focus()
  }

  const deliverReply = (text: string) => {
    if (replyReplaces) onApply!(text, { keep: request.inMessageBox === null })
    else void copy(text, t('Đã sao chép câu trả lời', '返信をコピーしました'))
    onClose()
  }

  /** Review in the other side's language, or translate from the user's. */
  const replyDirection = (text: string): Direction => {
    const other = otherLang(lang)
    if (isMostlyJapanese(text) === (other === 'ja')) return other === 'ja' ? 'review_ja' : 'review_vi'
    return writeDirection(lang)
  }

  const runReply = (text: string, purpose: ReplyRun['purpose']) =>
    setReplyRun((r) => ({ seq: (r?.seq ?? 0) + 1, text, purpose, direction: replyDirection(text) }))

  /** The step Enter takes now that a step's result is not on screen: translate the reply, or check it. */
  const replyTranslates = replyDirection(replyText.trim()) === writeDirection(lang)

  /** Enter, one step at a time: translate (or check), then use what that showed. */
  const nextReplyStep = () => {
    const text = replyText.trim()
    if (!text || replyBusy) return
    if (replyChecked) return deliverReply(replyResult)
    setKeepOwn(false)
    runReply(text, 'check')
  }

  /** Ctrl+Enter, without stopping to look: what is on screen, or the reply translated (or as written) at once. */
  const sendReplyNow = () => {
    const text = replyText.trim()
    if (!text || replyBusy) return
    if (replyChecked) return deliverReply(replyResult)
    // Already in the other side's language: nothing to translate.
    if (!replyTranslates) return deliverReply(text)
    runReply(text, 'use')
  }

  // Ctrl+Enter on a reply in the user's language: translated, then used straight away.
  const delivered = useRef(false)
  useEffect(() => {
    if (replyRun?.purpose !== 'use' || replyLive.phase !== 'done' || delivered.current) return
    delivered.current = true
    deliverReply(replyLive.sections.translation)
    // Runs once per finished run; `deliverReply` only reads what that run produced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyRun, replyLive.phase])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const inReply = target.dataset.role === 'reply'
    const inDraft = target.dataset.role === 'draft'
    const typing = inReply || inDraft || target.tagName === 'INPUT'

    // No key closes the popup or leaves the reply (decided 2026-10-14): Esc also cancels a word in the Japanese
    // input method, and a reply being written was lost with it. The close button and a click elsewhere close it.
    if (e.key === 'Escape') {
      e.preventDefault()
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
      // Enter while an input method (the Japanese IME) is composing confirms the word; Shift+Enter is a new line.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        if (e.ctrlKey) sendReplyNow()
        else nextReplyStep()
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inDraft || !typing)) {
      e.preventDefault()
      // On the other side's message Ctrl+Enter starts a reply. Not a letter key: an input method (UniKey, the
      // Japanese IME) would count the letter as the start of the first word typed in the reply box.
      if (!e.ctrlKey) primary()
      else if (role === 'read') startReply()
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
        <IconButton label={t('Đóng', '閉じる')} onClick={close}>
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
            alternatives={aiChoices.filter((c) => c.available && c.provider !== live.error?.provider)}
            onPick={pickAi}
            onSettings={manageAi}
          />
        ) : isReview ? (
          <ReviewBody result={reviewResult} streaming={live.sections.suggestion} textLang={direction === 'review_ja' ? 'ja' : 'vi'} />
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
        {replyMode && replyRun && (
          <div data-reply-result className={cx('border-t border-line', replyStale && 'opacity-45')}>
            {replyLive.phase === 'error' && replyLive.error ? (
              <ErrorBanner
                kind={replyLive.error.kind}
                provider={replyLive.error.provider}
                message={replyLive.error.message}
                onRetry={() => setReplyRun((r) => r && { ...r, seq: r.seq + 1 })}
                onAction={(t) => showToast(t)}
                alternatives={aiChoices.filter((c) => c.available && c.provider !== replyLive.error?.provider)}
                onPick={pickAi}
                onSettings={manageAi}
              />
            ) : replyRun.purpose === 'use' ? (
              <PendingBlock label={t('Đang dịch câu trả lời…', '返信を翻訳中…')} />
            ) : (
              <ReplyCheck
                run={replyRun}
                sections={replyLive.sections}
                done={replyLive.phase === 'done'}
                review={replyReview}
                keepOwn={keepOwn}
                onKeepOwn={(keep) => {
                  setKeepOwn(keep)
                  // Back to the reply box, where Enter uses the reply.
                  replyRef.current?.focus()
                }}
              />
            )}
          </div>
        )}
        {replyMode && replyRun?.purpose === 'check' && replyStale && !replyBusy && (
          <p className="px-4 pb-2 text-[12px] text-warn">
            {replyTranslates
              ? t('Bạn đã sửa câu trả lời: Enter để dịch lại, hoặc Ctrl+Enter để dùng luôn.', '返信が変更されました。Enter で翻訳し直し、Ctrl+Enter でそのまま使えます。')
              : t('Bạn đã sửa câu trả lời: Enter để kiểm tra lại, hoặc Ctrl+Enter để dùng luôn.', '返信が変更されました。Enter で再チェック、Ctrl+Enter でそのまま使えます。')}
          </p>
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
              // The button goes away with the tip; keep the popup's keys (Enter) working.
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
              ref={replyRef}
              data-role="reply"
              autoFocus
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t('Gõ câu trả lời bằng tiếng Việt (tự dịch) hoặc tiếng Nhật…', '日本語（自動で翻訳）またはベトナム語で返信を入力…')}
              className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              {/* Leaving the reply is a quiet link rather than a third button, so the two actions keep one row. */}
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] whitespace-nowrap text-ink-3">
                <span>
                  <Kbd>Shift+Enter</Kbd> {t('xuống dòng', '改行')}
                </span>
                <button type="button" onClick={cancelReply} className="rounded hover:text-ink">
                  {t('Hủy', 'キャンセル')}
                </button>
              </p>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Until a step's result is on screen, Ctrl+Enter skips looking at it; afterwards Enter does the same. */}
                {!replyChecked && (
                  <Button size="sm" disabled={!replyText.trim() || replyBusy} onClick={sendReplyNow}>
                    {replyReplaces ? <Replace size={14} /> : <Copy size={14} />}{' '}
                    {replyReplaces ? t('Thay ngay', 'すぐ貼り付け') : t('Sao chép ngay', 'すぐコピー')} <Kbd>Ctrl+Enter</Kbd>
                  </Button>
                )}
                <Button size="sm" variant="primary" disabled={!replyText.trim() || replyBusy} onClick={nextReplyStep}>
                  {!replyChecked ? (
                    replyTranslates ? (
                      <>
                        <Languages size={14} /> {t('Dịch', '翻訳')}
                      </>
                    ) : (
                      <>
                        <SpellCheck size={14} /> {t('Kiểm tra', 'チェック')}
                      </>
                    )
                  ) : replyReplaces ? (
                    <>
                      <Replace size={14} /> {replyFixed ? t('Thay bằng câu đã sửa', '修正案で置き換え') : t('Thay vào ô chat', '入力欄に貼り付け')}
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> {replyFixed ? t('Sao chép câu đã sửa', '修正案をコピー') : t('Sao chép', 'コピー')}
                    </>
                  )}{' '}
                  <Kbd>↵</Kbd>
                </Button>
              </div>
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
  const ctrlEnter = <Kbd>Ctrl+Enter</Kbd>
  const tab = <Kbd>Tab</Kbd>
  return (
    <div role="note" className="flex items-start gap-2 border-t border-line bg-accent-soft px-4 py-2 text-[12.5px] leading-relaxed text-ink">
      <Lightbulb size={14} className="mt-[3px] shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        {lang === 'ja' ? (
          role === 'read' ? (
            <>{enter} で翻訳をコピー、{ctrlEnter} で返信を入力します。</>
          ) : origin === 'composer' ? (
            <>{enter} でベトナム語訳を入力欄に貼り付けます。{tab} で丁寧さを切り替えます。</>
          ) : (
            <>{enter} で翻訳をコピーします。{tab} で丁寧さを切り替えます。</>
          )
        ) : role === 'read' ? (
          <>Nhấn {enter} để sao chép bản dịch, {ctrlEnter} để gõ câu trả lời.</>
        ) : origin === 'composer' ? (
          <>Nhấn {enter} để thay bản tiếng Nhật vào ô chat. {tab} đổi mức kính ngữ.</>
        ) : (
          <>Nhấn {enter} để sao chép bản dịch. {tab} đổi mức kính ngữ.</>
        )}
      </p>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1 font-medium text-accent hover:underline">
        {t('Đã hiểu', 'OK')}
      </button>
    </div>
  )
}

/** The check of a reply: its review in the other side's language, or its translation with the meaning read back. */
function ReplyCheck({
  run,
  sections,
  done,
  review,
  keepOwn,
  onKeepOwn,
}: {
  run: ReplyRun
  sections: Sections
  done: boolean
  review: ReviewResult | null
  keepOwn: boolean
  onKeepOwn: (keep: boolean) => void
}) {
  const t = useT()
  const userLang = useLang()
  const reviewing = run.direction === 'review_ja' || run.direction === 'review_vi'
  const heading = (
    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
      {reviewing ? <SpellCheck size={12} className="text-accent" /> : <Languages size={12} className="text-accent" />}
      {reviewing ? t('Kiểm tra câu trả lời', '返信のチェック') : t('Câu trả lời đã dịch', '翻訳した返信')}
      {reviewing && review && (
        <span className="ml-auto normal-case tracking-normal">
          <DirectionBadge direction={run.direction} verdict={review.verdict} />
        </span>
      )}
    </div>
  )
  if (reviewing) {
    return (
      <>
        <div className="px-4 pt-3">{heading}</div>
        <ReviewBody result={review} streaming={sections.suggestion} textLang={run.direction === 'review_ja' ? 'ja' : 'vi'} />
        {review && review.verdict !== 'ok' && (
          <Section>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={keepOwn} onChange={(e) => onKeepOwn(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
              {t('Giữ nguyên câu của tôi, không dùng đề xuất', '修正案を使わず、自分の文のまま使う')}
            </label>
          </Section>
        )}
      </>
    )
  }
  if (!sections.translation) {
    return (
      <>
        <div className="px-4 pt-3">{heading}</div>
        <PendingBlock label={t('Đang dịch…', '翻訳中…')} />
      </>
    )
  }
  return (
    <>
      <Section>
        <div className="mb-1">{heading}</div>
        <p lang={targetLang(run.direction)} className={cx('text-[15px] leading-relaxed whitespace-pre-wrap', !done && 'stream-caret')}>
          <InkText text={sections.translation} />
        </p>
      </Section>
      {done && sections.backTranslation && (
        <Section className="bg-subtle">
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Ý nghĩa khi đọc lại', '読み返したときの意味')}</div>
          <p lang={userLang} className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
            {sections.backTranslation}
          </p>
        </Section>
      )}
    </>
  )
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('border-b border-line px-4 py-3 last:border-b-0', className)}>{children}</div>
}

function DirectionBadge({ direction, verdict }: { direction: Direction; verdict?: 'ok' | 'suggest' | 'error' }) {
  const t = useT()
  if (direction === 'review_ja' || direction === 'review_vi') {
    if (!verdict) {
      return (
        <span className="shrink-0 px-1.5 text-[12px] font-medium whitespace-nowrap text-ink-3">
          {direction === 'review_ja' ? t('Kiểm tra JA', '日本語チェック') : t('Kiểm tra VI', 'ベトナム語チェック')}
        </span>
      )
    }
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
function toReview(source: string, sections: Sections, textLang: Lang): ReviewResult {
  const verdict = (['ok', 'suggest', 'error'] as const).find((v) => sections.verdict.trim().toLowerCase() === v) ?? 'suggest'
  const suggestion = sections.suggestion || source
  // Japanese has no spaces between words: compare characters; Vietnamese reads better word by word.
  const diff = textLang === 'ja' ? diffChars(source, suggestion) : diffWords(source, suggestion)
  return { verdict, issues: parseIssues(sections.issues), diff, suggestion, suggestionVi: sections.suggestionVi }
}

/** The check of a sentence the user wrote, in `textLang`: what is wrong, then the corrected sentence. */
function ReviewBody({ result, streaming, textLang }: { result: ReviewResult | null; streaming: string; textLang: Lang }) {
  const t = useT()
  const lang = useLang()
  // The AI writes the suggestion first: show it as it arrives, the points it found follow once it is done.
  if (!result && streaming) {
    return (
      <>
        <Section>
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Đề xuất', '修正案')}</div>
          <p lang={textLang} className="stream-caret text-[15px] leading-relaxed whitespace-pre-wrap">
            <InkText text={streaming} />
          </p>
        </Section>
        <PendingBlock label={t('Đang tìm góp ý…', '指摘をまとめています…')} />
      </>
    )
  }
  if (!result) {
    return (
      <PendingBlock
        label={textLang === 'ja' ? t('Đang kiểm tra câu tiếng Nhật…', '日本語をチェック中…') : t('Đang kiểm tra câu tiếng Việt…', 'ベトナム語をチェック中…')}
      />
    )
  }
  // The suggestion fixes everything found; only the most important points are spelled out under it (the AI lists
  // them most important first).
  const shown = result.issues.slice(0, MAX_SHOWN_ISSUES)
  const more = result.issues.length - shown.length
  return (
    <>
      {result.verdict === 'ok' ? (
        <Section>
          <p className="text-[13.5px] text-good">
            {textLang === 'ja'
              ? t('Câu đã tự nhiên và đúng kính ngữ, có thể gửi luôn.', '自然で敬語も正しい文です。このまま送れます。')
              : t('Câu đã tự nhiên và đúng, có thể gửi luôn.', '自然で正しい文です。このまま送れます。')}
          </p>
        </Section>
      ) : (
        <Section>
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Đề xuất', '修正案')}</div>
          <p lang={textLang} className="text-[15px] leading-relaxed whitespace-pre-wrap">
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
          {/* The meaning helps only when the sentence is not in the user's own language. */}
          {result.suggestionVi && textLang !== lang && (
            <p lang={lang} className="mt-1.5 text-[13px] whitespace-pre-wrap text-ink-2">
              {t('Nghĩa', '意味')}: {result.suggestionVi}
            </p>
          )}
        </Section>
      )}
      {shown.length > 0 && (
        <Section className="flex flex-col gap-2.5">
          <div className="text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('Góp ý chính', '主な指摘')}</div>
          {shown.map((issue, i) => (
            <div key={`${i}-${issue.kind}`} data-issue={issue.kind} className="flex gap-2 text-[13px] leading-snug">
              <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-warn-soft text-[11px] font-bold text-warn">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="rounded bg-subtle px-1.5 py-px text-[11.5px] font-semibold text-ink-2">{issueLabel(issue.kind, textLang, lang)}</span>
                  {issue.wrong && (
                    <span lang={textLang} className="text-bad line-through decoration-bad/70">
                      {issue.wrong}
                    </span>
                  )}
                  {issue.wrong && issue.fix && <ArrowRight size={12} className="shrink-0 text-ink-3" aria-label={t('sửa thành', '修正後')} />}
                  {issue.fix && (
                    <span lang={textLang} className="rounded-sm bg-good-soft px-0.5 text-good">
                      {issue.fix}
                    </span>
                  )}
                  {!issue.wrong && !issue.fix && issue.text && <span className="text-ink">{issue.text}</span>}
                </div>
                {(issue.wrong || issue.fix) && issue.text && <p className="mt-1 text-ink">{issue.text}</p>}
              </div>
            </div>
          ))}
          {more > 0 && (
            <p className="text-[12.5px] text-ink-3">
              {t(`Và ${more} góp ý nhỏ khác, đã được sửa trong đề xuất.`, `ほか ${more} 件の細かい指摘も修正案に反映済みです。`)}
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
  return (AI_ORDER as readonly string[]).includes(id) ? AI_NAMES[id as AiChoice['provider']] : 'Claude'
}

function ErrorBanner({
  kind,
  provider,
  message,
  onRetry,
  onAction,
  alternatives,
  onPick,
  onSettings,
}: {
  kind: ClaudeErrorKind
  provider: string
  message: string
  onRetry: () => void
  onAction: (toast: string) => void
  /** Other AIs ready to use, offered when this one cannot translate at all. */
  alternatives: QuickChoice[]
  onPick: (c: AiChoice) => void
  onSettings: () => void
}) {
  const t = useT()
  const name = aiName(provider)
  const account = provider === 'claude' || provider === 'codex' ? (provider as Account) : null
  const [signingIn, setSigningIn] = useState<'idle' | 'waiting' | 'failed'>('idle')
  const retryButton = (variant?: 'primary') => (
    <Button size="sm" variant={variant} onClick={onRetry}>
      <RotateCcw size={13} /> {t('Thử lại', '再試行')}
    </Button>
  )
  const retry = <div className="mt-2 flex gap-2">{retryButton('primary')}</div>
  const openSettings = (
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="primary" onClick={() => void invoke('show_main_window')}>
        <Settings size={13} /> {t('Mở Cài đặt', '設定を開く')}
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
  if (kind === 'rate_limited' && !account) {
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
  // One button per other AI ready to use; picking one translates this text with it right away.
  const otherWays = (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {alternatives
        .filter((c, i, all) => all.findIndex((x) => x.provider === c.provider) === i)
        .slice(0, 3)
        .map((c) => (
          <Button key={`${c.provider}:${c.model}`} size="sm" variant="secondary" onClick={() => onPick(c)}>
            {choiceLabel(c)}
          </Button>
        ))}
      <Button size="sm" variant={alternatives.length === 0 ? 'primary' : 'ghost'} onClick={onSettings}>
        <Settings size={13} /> {t('Mở Cài đặt', '設定を開く')}
      </Button>
    </div>
  )
  if (kind === 'blocked' && account) {
    const { tool, maker } = ACCOUNT_TOOL[account]
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t(`${name} từ chối yêu cầu từ MyTranslate`, `${name} が MyTranslate からの要求を拒否しました`)}>
        {t(
          `Tài khoản ${name} của bạn vẫn bình thường, nhưng ${maker} hiện không cho app khác dùng ${tool} để dịch. Dịch đoạn này bằng cách khác:`,
          `${name} アカウントは問題ありませんが、${maker} は現在、他のアプリが ${tool} で翻訳することを許可していません。別の方法で翻訳してください:`,
        )}
        {otherWays}
      </Banner>
    )
  }
  if (kind === 'not_logged_in' && account) {
    const signIn = () => {
      setSigningIn('waiting')
      loginAccount(account)
        .then(() => {
          setSigningIn('idle')
          onRetry()
        })
        .catch(() => setSigningIn('failed'))
    }
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t(`${name} chưa đăng nhập hoặc đăng nhập đã hết hạn`, `${name} にログインしていないか、ログインの期限が切れています`)}>
        {signingIn === 'waiting'
          ? t(`Mời bạn đăng nhập ${name} trên trang vừa mở. Xong là MyTranslate tự dịch lại.`, `開いたページで ${name} にログインしてください。完了すると自動で翻訳し直します。`)
          : signingIn === 'failed'
            ? t('Chưa đăng nhập được. Thử lại, hoặc dịch bằng cách khác.', 'ログインできませんでした。もう一度試すか、別の方法で翻訳してください。')
            : t(`Đăng nhập lại tài khoản ${name} của bạn; trang đăng nhập sẽ mở ra.`, `ご自身の ${name} アカウントにもう一度ログインしてください。ログインページが開きます。`)}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" disabled={signingIn === 'waiting'} onClick={signIn}>
            {signingIn === 'waiting' && <Loader2 size={13} className="animate-spin" />}
            {t(`Đăng nhập ${name}`, `${name} にログイン`)}
          </Button>
          {retryButton()}
        </div>
      </Banner>
    )
  }
  if (kind === 'not_installed' && account) {
    const { tool } = ACCOUNT_TOOL[account]
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={t(`Máy chưa có ${tool}`, `${tool} がインストールされていません`)}>
        {t(
          `Mở Cài đặt > Kết nối AI để MyTranslate tự cài ${tool}, hoặc dịch đoạn này bằng cách khác:`,
          `設定 > AI接続 を開くと MyTranslate が ${tool} をインストールします。または別の方法で翻訳してください:`,
        )}
        {otherWays}
      </Banner>
    )
  }
  if (kind === 'rate_limited') {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title={t(`Đã hết hạn mức gói ${name}`, `${name} プランの利用枠を使い切りました`)}>
        {t('Thử lại sau khi hạn mức được làm mới, hoặc dịch đoạn này bằng cách khác:', '利用枠のリセット後にもう一度試すか、別の方法で翻訳してください:')}
        {otherWays}
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
          <Copy size={13} /> {t('Sao chép lỗi', 'エラーをコピー')}
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
  onFeedback: () => void
}) {
  const t = useT()
  const lang = useLang()
  // Every action in the popup shows an icon and its name (decided 2026-10-14); only the title bar keeps icons alone.
  const feedbackButton = (
    <Button size="sm" variant="ghost" disabled={!ready || feedback} onClick={onFeedback}>
      <ThumbsDown size={14} /> {feedback ? t('Đã gửi phản hồi', 'フィードバック送信済み') : t('Dịch chưa tốt', '翻訳がよくない')}
    </Button>
  )
  const enterKbd = <Kbd>↵</Kbd>

  if (role === 'read') {
    return (
      // Wraps instead of overflowing when the popup is made narrow: copy moves under reply.
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onReply}>
          <Reply size={14} /> {t('Trả lời', '返信')} <Kbd>Ctrl+Enter</Kbd>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {feedbackButton}
          <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
            <Copy size={14} /> {t('Sao chép', 'コピー')} {enterKbd}
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
            <Replace size={14} /> {t('Thay vào chat', '入力欄に貼り付け')} {enterKbd}
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
        <Undo2 size={14} /> {t('Giữ nguyên', 'そのまま')}
      </Button>
      <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
        {origin === 'composer' ? (
          <>
            <Check size={14} /> {t('Dùng đề xuất', '修正案を使う')}
          </>
        ) : (
          <>
            <Copy size={14} /> {t('Sao chép đề xuất', '修正案をコピー')}
          </>
        )}{' '}
        {enterKbd}
      </Button>
    </div>
  )
}
