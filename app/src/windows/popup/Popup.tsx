import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  ChevronDown,
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
import { conversations, keigoLabels } from '../../data/mock'
import { diffChars } from '../../lib/diff'
import { relativeTime, setFeedback, suggestReplies, updateConversation, type Reply as SuggestedReply } from '../../lib/history'
import { detectThread } from '../../lib/mockEngine'
import { useStore } from '../../store'
import { defaultChoice, modelField, useQuickChoices, type AiChoice } from '../../lib/ai'
import { emit } from '@tauri-apps/api/event'
import { useUpdates } from '../../lib/updates'
import type { ErrorKind as ClaudeErrorKind, RateLimit, Sections } from '../../lib/claude'
import type { Confidence, Direction, Keigo, ReviewResult, Thread } from '../../types'
import { AiSwitcher } from './AiSwitcher'
import { ThreadPicker } from './ThreadPicker'
import type { PopupOrigin, PopupRequest, WindowedHost } from './types'
import { useFloatingFrame } from './useFloatingFrame'
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
  const { scenario, settings, threads, showToast } = store
  // A first-time tip about the keys, shown in the first real popup only (the guide's practice popup does not count).
  const [tipOpen, setTipOpen] = useState(() => !settings.popupTipShown && request.origin !== 'onboarding')

  const [direction, setDirection] = useState<Direction>(request.direction)
  const [source, setSource] = useState(request.source)
  const [origin, setOrigin] = useState<PopupOrigin>(request.origin)
  // The keigo remembered for this chat, else the default; changing it here remembers it for the chat.
  const [keigo, setKeigo] = useState<Keigo>(request.window?.keigo || settings.defaultKeigo)
  const [runKey, setRunKey] = useState(0)
  const [pinned, setPinned] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
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
  // Real app: the thread comes from the history on this PC. `id: null` with a title is a new thread the user named.
  const conversationId = request.window?.conversationId ?? null
  const [realChoice, setRealChoice] = useState<{ id: number | null; newTitle: string | null; confidence: 'high' | 'low' }>(() => ({
    id: request.window?.threadId ?? null,
    newTitle: null,
    confidence: request.window?.confidence ?? 'high',
  }))
  const [filedIn, setFiledIn] = useState<{ threadId: number; title: string } | null>(null)
  const frame = useFloatingFrame({
    request,
    container,
    geometry: store.popupGeometry,
    onGeometry: store.setPopupGeometry,
    rootRef,
  })

  const conversation = conversations.find((c) => c.id === request.conversationId)
  const conversationThreads = threads.filter((t) => t.conversationId === request.conversationId)

  const [threadPick, setThreadPick] = useState<{ id: string | null; confidence: Confidence }>(() => {
    const d = detectThread(request.conversationId, request.source, threads, scenario === 'uncertain_thread')
    return { id: d.threadId, confidence: d.confidence }
  })
  const thread = threads.find((t) => t.id === threadPick.id) ?? null

  const isReview = direction === 'review_ja'
  // Translations and reviews stream from Claude (canned answers in the browser prototype).
  const live = useTranslation({
    direction,
    text: source,
    keigo,
    runKey,
    enabled: longConfirmed && !notice,
    scenario,
    thread: windowed ? { conversationId, threadId: realChoice.id, newThreadTitle: realChoice.newTitle } : undefined,
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

  // The translation was filed when it finished. If the user picked another thread (before or after that), move it.
  const saved = live.saved
  useEffect(() => {
    if (!windowed || !saved || conversationId === null) return
    const current = filedIn?.threadId ?? saved.threadId
    const wantsNew = realChoice.id === null && realChoice.newTitle !== null
    if (!wantsNew && (realChoice.id === null || realChoice.id === current)) return
    void invoke<{ threadId: number; threadTitle: string }>('history_move', {
      messageId: saved.messageId,
      conversationId,
      fromThread: current,
      toThread: realChoice.id,
      newTitle: realChoice.newTitle,
    }).then((r) => {
      setFiledIn({ threadId: r.threadId, title: r.threadTitle })
      setRealChoice({ id: r.threadId, newTitle: null, confidence: 'high' })
    })
  }, [windowed, saved, conversationId, filedIn, realChoice])

  const realThreads = useMemo(() => request.window?.threads ?? [], [request.window?.threads])
  const realTitle =
    realChoice.newTitle ??
    (realChoice.id !== null && realChoice.id === filedIn?.threadId ? filedIn.title : null) ??
    realThreads.find((t) => t.id === realChoice.id)?.title ??
    (realChoice.id === null || realChoice.id === saved?.threadId ? saved?.threadTitle : undefined) ??
    'Thread mới'
  const pickerThreads = useMemo<Thread[]>(
    () =>
      realThreads.map((t) => ({
        id: String(t.id),
        conversationId: String(conversationId),
        title: t.title,
        summary: '',
        lastActive: relativeTime(t.lastActive),
        pinned: false,
        messages: [],
      })),
    [realThreads, conversationId],
  )
  const reviewResult = useMemo(
    () => (isReview && live.phase === 'done' ? toReview(source, live.sections) : null),
    [isReview, live.phase, live.sections, source],
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

  const save = (finalJa?: string) => {
    if (!resultReady) return
    let threadId = threadPick.id
    if (!threadId) threadId = store.createThread(request.conversationId, 'Thread mới')
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    if (direction === 'ja_vi') {
      store.addMessage(threadId, { author: 'other', name: 'Khách', time, ja: source, vi: finalText })
    } else if (direction === 'vi_ja') {
      store.addMessage(threadId, { author: 'me', name: 'Tôi', time, ja: finalJa ?? finalText, vi: source })
    } else if (reviewResult && finalJa !== undefined) {
      // A review is only recorded when the suggestion is used; keeping the original adds nothing to the thread.
      store.addMessage(threadId, { author: 'me', name: 'Tôi', time, ja: finalJa, vi: reviewResult.suggestionVi })
    }
  }

  const close = () => {
    save()
    onClose()
  }

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
    if (direction === 'ja_vi') return
    const text = finalText
    if (origin === 'composer' && onApply) {
      save(text)
      onApply(text)
      onClose()
    } else {
      void copy(text, 'Đã sao chép, dán vào ô chat bằng Ctrl+V')
      save(text)
      onClose()
    }
  }

  const keepOriginal = () => {
    onClose()
  }

  const changeKeigo = (k: Keigo) => {
    setKeigo(k)
    setRunKey((r) => r + 1)
    if (windowed && conversationId !== null) void updateConversation(String(conversationId), k)
  }

  const cycleKeigo = () => changeKeigo(keigoOrder[(keigoOrder.indexOf(keigo) + 1) % keigoOrder.length])

  // Reply suggestions for a client message: three short Japanese replies with their meaning.
  const [replies, setReplies] = useState<{ state: 'idle' | 'loading' | 'error'; items: SuggestedReply[]; error?: string }>({ state: 'idle', items: [] })
  const askReplies = () => {
    if (!resultReady || direction !== 'ja_vi' || replies.state === 'loading') return
    setReplies({ state: 'loading', items: [] })
    const done = (items: SuggestedReply[]) => setReplies({ state: 'idle', items })
    if (!windowed) {
      window.setTimeout(() => done(MOCK_REPLIES), 700)
      return
    }
    suggestReplies({ text: source, keigo, conversationId, threadId: saved?.threadId ?? realChoice.id })
      .then(done)
      .catch((e) => setReplies({ state: 'error', items: [], error: String(e) }))
  }

  const startReply = () => {
    setReplyMode(true)
  }

  const submitReply = () => {
    const text = replyText.trim()
    if (!text) return
    save()
    setDirection('vi_ja')
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
      } else if (pickerOpen) setPickerOpen(false)
      else if (replyMode) setReplyMode(false)
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
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      setPickerOpen(true)
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      setPinned((p) => !p)
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && !inDraft && !window.getSelection()?.toString()) {
      e.preventDefault()
      if (resultReady) void copy(finalText, 'Đã sao chép bản dịch')
      return
    }
    if (e.key === 'Tab' && direction === 'vi_ja') {
      e.preventDefault()
      cycleKeigo()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && (inDraft || !typing)) {
      e.preventDefault()
      // On a client message Enter starts a reply. Not a letter key: a Vietnamese input method (UniKey) would
      // count the letter as the start of the first word typed in the reply box and leave that word unconverted.
      if (direction === 'ja_vi') startReply()
      else primary()
      return
    }
    if (!typing && direction === 'ja_vi' && e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.altKey) {
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
        !frame.dragging && 'anim-popup',
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
            title="Kéo để đổi độ rộng, nhấp đúp để về mặc định"
            className="absolute top-3 bottom-3 -left-1 z-10 w-2 cursor-ew-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('right')}
            title="Kéo để đổi độ rộng, nhấp đúp để về mặc định"
            className="absolute top-3 bottom-3 -right-1 z-10 w-2 cursor-ew-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('bottom')}
            title="Kéo để đổi chiều cao, nhấp đúp để tự co theo nội dung"
            className="absolute inset-x-3 -bottom-1 z-10 h-2 cursor-ns-resize rounded-full hover:bg-accent/40"
          />
          <div
            {...frame.resizeHandle('bottom-left')}
            title="Kéo để đổi kích thước"
            className="absolute -bottom-1 -left-1 z-10 size-3.5 cursor-nesw-resize"
          />
          <div
            {...frame.resizeHandle('bottom-right')}
            title="Kéo để đổi kích thước"
            className="absolute -right-1 -bottom-1 z-10 size-3.5 cursor-nwse-resize"
          />
        </>
      )}
      <header
        ref={headerRef}
        onPointerDown={(e) => {
          if (!windowed) return frame.onHeaderPointerDown(e)
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) windowed.startDrag()
        }}
        className={cx(
          'relative flex h-10 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1 select-none',
          (container || windowed) && (frame.dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
        {(container || windowed) && <GripVertical size={14} className="shrink-0 text-ink-3" aria-hidden />}
        {windowed ? (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            title={`Đổi thread (Ctrl+T)${request.window?.workspace ? ` · ${request.window.workspace}` : ''}`}
            className={cx(
              'flex h-7 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-hover',
              realChoice.confidence === 'low' && 'border border-dashed border-warn',
            )}
          >
            <AppBadge app={request.app} />
            <span className="max-w-[110px] shrink-0 truncate text-[12.5px] text-ink-2">{request.window?.conversation || 'Ứng dụng khác'}</span>
            <span className="shrink-0 text-ink-3">›</span>
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{realTitle}</span>
            <ConfidenceMark confidence={realChoice.confidence} />
            <ChevronDown size={13} className="shrink-0 text-ink-3" />
          </button>
        ) : (
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          title="Đổi thread (Ctrl+T)"
          className={cx(
            'flex h-7 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-hover',
            threadPick.confidence === 'low' && 'border border-dashed border-warn',
          )}
        >
          <AppBadge app={request.app} />
          <span className="max-w-[96px] shrink-0 truncate text-[12.5px] text-ink-2" title={conversation ? `${conversation.workspace} ${conversation.name}` : undefined}>
            {conversation?.name ?? 'Khác'}
          </span>
          <span className="shrink-0 text-ink-3">›</span>
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{thread?.title ?? 'Thread mới'}</span>
          <ConfidenceMark confidence={threadPick.confidence} />
          <ChevronDown size={13} className="shrink-0 text-ink-3" />
        </button>
        )}
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
          <IconButton label="Đặt lại vị trí và kích thước" onClick={windowed ? windowed.onReset : frame.reset}>
            <RotateCcw size={13} />
          </IconButton>
        )}
        <IconButton label={pinned ? 'Bỏ ghim (Ctrl+P)' : 'Ghim popup (Ctrl+P)'} active={pinned} onClick={() => setPinned((p) => !p)}>
          <Pin size={14} />
        </IconButton>
        <IconButton label="Đóng (Esc)" onClick={close}>
          <X size={15} />
        </IconButton>
        {pickerOpen && windowed && (
          <ThreadPicker
            threads={pickerThreads}
            currentId={realChoice.id === null ? null : String(realChoice.id)}
            onClose={() => {
              setPickerOpen(false)
              rootRef.current?.focus()
            }}
            onPick={(id) => {
              setRealChoice({ id: Number(id), newTitle: null, confidence: 'high' })
              setPickerOpen(false)
              rootRef.current?.focus()
            }}
            onCreate={(title) => {
              setRealChoice({ id: null, newTitle: title, confidence: 'high' })
              setPickerOpen(false)
              rootRef.current?.focus()
            }}
          />
        )}
        {pickerOpen && !windowed && (
          <ThreadPicker
            threads={conversationThreads}
            currentId={threadPick.id}
            onClose={() => {
              setPickerOpen(false)
              rootRef.current?.focus()
            }}
            onPick={(id) => {
              setThreadPick({ id, confidence: 'high' })
              setPickerOpen(false)
              rootRef.current?.focus()
              showToast('Đã chuyển sang thread khác, lần sau sẽ ưu tiên thread này')
            }}
            onCreate={(title) => {
              const id = store.createThread(request.conversationId, title)
              setThreadPick({ id, confidence: 'high' })
              setPickerOpen(false)
              rootRef.current?.focus()
            }}
          />
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div ref={bodyRef}>
        {notice ? (
          <Banner tone="warn" icon={<AlertTriangle size={16} />} title={notice === 'no_selection' ? 'Chưa chọn đoạn văn bản nào' : 'Không đọc được clipboard'}>
            {notice === 'no_selection'
              ? 'Bôi đen tin nhắn cần dịch, hoặc đặt con trỏ trong ô chat có chữ, rồi nhấn phím tắt lại.'
              : 'Ứng dụng khác đang giữ clipboard. Hãy thử lại.'}
          </Banner>
        ) : (
        <>

        {!longConfirmed ? (
          <Banner tone="warn" icon={<AlertTriangle size={16} />} title={`Văn bản dài ${source.length.toLocaleString('vi-VN')} ký tự`}>
            Dịch đoạn dài sẽ mất nhiều thời gian và hạn mức hơn.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => setLongConfirmed(true)}>
                Tiếp tục
              </Button>
              <Button size="sm" onClick={onClose}>
                Hủy
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
        {direction === 'ja_vi' && (replies.state !== 'idle' || replies.items.length > 0) ? (
          <RepliesBlock
            state={replies.state}
            items={replies.items}
            error={replies.error}
            onRetry={askReplies}
            onCopy={(r) => void copy(r.ja, 'Đã sao chép câu trả lời')}
          />
        ) : null}
        {autoCopied && (
          <div role="status" className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12.5px] font-medium text-good">
            <Copy size={13} /> Đã sao chép bản dịch
          </div>
        )}
        {resultReady && live.answeredBy?.fallbackFrom && (
          <div className="border-t border-line px-4 py-1.5 text-[12px] text-ink-2">
            {aiName(live.answeredBy.fallbackFrom)} không dịch được, đã dịch bằng {aiName(live.answeredBy.provider)} ({live.answeredBy.model})
          </div>
        )}
        {tipVisible && (
          <FirstTip
            direction={direction}
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
              placeholder="Gõ câu trả lời bằng tiếng Việt..."
              className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setReplyMode(false)}>
                Hủy <Kbd>Esc</Kbd>
              </Button>
              <Button size="sm" variant="primary" disabled={!replyText.trim()} onClick={submitReply}>
                Dịch sang tiếng Nhật <Kbd className="h-4 border-transparent bg-white/25 text-on-accent">Ctrl+Enter</Kbd>
              </Button>
            </div>
          </div>
        ) : (
          <FooterActions
            direction={direction}
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
            onCopy={() => void copy(finalText, 'Đã sao chép bản dịch')}
            onFeedback={() => {
              setFeedbackSent(true)
              if (windowed && saved) void setFeedback(saved.messageId, true)
              showToast('Cảm ơn bạn, bản dịch này sẽ được xem xét để cải thiện prompt')
            }}
          />
        )}
      </footer>
      )}
    </div>
  )
}

/** The keys a new user would not guess; the buttons below already show the main one. */
function FirstTip({ direction, origin, onDismiss }: { direction: Direction; origin: PopupOrigin; onDismiss: () => void }) {
  const enter = <Kbd>Enter</Kbd>
  return (
    <div role="note" className="flex items-start gap-2 border-t border-line bg-accent-soft px-4 py-2 text-[12.5px] leading-relaxed text-ink">
      <Lightbulb size={14} className="mt-[3px] shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        {direction === 'ja_vi' ? (
          <>Nhấn {enter} để gõ câu trả lời bằng tiếng Việt, MyTranslate sẽ dịch sang tiếng Nhật cho bạn.</>
        ) : origin === 'composer' ? (
          <>Nhấn {enter} để thay bản tiếng Nhật vào ô chat. <Kbd>Tab</Kbd> đổi mức kính ngữ.</>
        ) : (
          <>Nhấn {enter} để sao chép bản dịch. <Kbd>Tab</Kbd> đổi mức kính ngữ.</>
        )}{' '}
        <Kbd>Esc</Kbd> để đóng.
      </p>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1 font-medium text-accent hover:underline">
        Đã hiểu
      </button>
    </div>
  )
}

const MOCK_REPLIES: SuggestedReply[] = [
  { ja: '承知いたしました。確認いたします。', vi: 'Em đã hiểu. Em sẽ kiểm tra ạ.' },
  { ja: '詳細を教えていただけますでしょうか。', vi: 'Anh có thể cho em biết chi tiết hơn được không ạ?' },
  { ja: '本日中に確認してご連絡いたします。', vi: 'Trong hôm nay em sẽ kiểm tra và liên lạc lại ạ.' },
]

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
  return (
    <Section className="bg-subtle">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
        <Sparkles size={12} className="text-accent" /> Gợi ý trả lời
      </div>
      {state === 'loading' && (
        <div role="status" className="flex items-center gap-2 py-1 text-[13.5px] text-ink-2">
          <Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" /> Đang soạn gợi ý…
        </div>
      )}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-[13px] text-bad">
          <span className="min-w-0 flex-1 truncate" title={error}>
            Không lấy được gợi ý
          </span>
          <Button size="sm" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {items.map((r) => (
          <button
            key={r.ja}
            type="button"
            onClick={() => onCopy(r)}
            title="Bấm để sao chép"
            className="group -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span lang="ja" className="block text-[14px] leading-relaxed text-ink">
                {r.ja}
              </span>
              {r.vi && (
                <span lang="vi" className="block text-[12.5px] leading-relaxed text-ink-2">
                  {r.vi}
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

function ConfidenceMark({ confidence }: { confidence: Confidence }) {
  if (confidence === 'low') {
    return (
      <span title="App chưa chắc đây là đúng thread, bấm để chọn" className="shrink-0 text-[12px] font-bold text-warn">
        ?
      </span>
    )
  }
  return (
    <span
      title={confidence === 'high' ? 'Độ tin cậy cao' : 'Độ tin cậy trung bình'}
      className={cx('size-1.5 shrink-0 rounded-full', confidence === 'high' ? 'bg-good' : 'bg-warn')}
    />
  )
}

function DirectionBadge({ direction, verdict }: { direction: Direction; verdict?: 'ok' | 'suggest' | 'error' }) {
  if (direction === 'review_ja') {
    if (!verdict) return <span className="shrink-0 px-1.5 text-[12px] font-medium whitespace-nowrap text-ink-3">Kiểm tra JA</span>
    const map = {
      ok: ['bg-good-soft text-good', 'Ổn'],
      suggest: ['bg-warn-soft text-warn', 'Nên sửa'],
      error: ['bg-bad-soft text-bad', 'Có lỗi'],
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

function TranslationBody({
  direction,
  stream,
  draft,
  onDraft,
  back,
}: {
  direction: 'ja_vi' | 'vi_ja'
  stream: { text: string; started: boolean; done: boolean }
  draft: string | null
  onDraft: (v: string) => void
  /** Vietnamese reading of a Japanese result, so the user can check the meaning before sending. */
  back?: string
}) {
  if (!stream.started) return <PendingBlock label="Đang dịch…" />
  const lang = direction === 'ja_vi' ? 'vi' : 'ja'
  return (
    <>
      <Section>
        {direction === 'vi_ja' && stream.done && draft !== null ? (
          <textarea
            data-role="draft"
            lang={lang}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            aria-label="Bản tiếng Nhật, có thể sửa"
            className="-mx-1.5 -my-1 block w-[calc(100%+12px)] field-sizing-content resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] leading-relaxed text-ink hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
          />
        ) : (
          <p lang={lang} className={cx('text-[15px] leading-relaxed whitespace-pre-wrap', !stream.done && 'stream-caret')}>
            {stream.text}
          </p>
        )}
      </Section>
      {stream.done && direction === 'vi_ja' && back && (
        <Section className="bg-subtle">
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Ý nghĩa khi đọc lại</div>
          <p lang="vi" className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
            {back}
          </p>
        </Section>
      )}
    </>
  )
}

/** Turns Claude's review tags into what the popup shows: verdict, issues and a diff of the suggestion. */
function toReview(source: string, sections: Sections): ReviewResult {
  const verdict = (['ok', 'suggest', 'error'] as const).find((v) => sections.verdict.trim().toLowerCase() === v) ?? 'suggest'
  const issues = sections.issues
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const at = line.indexOf(':')
      return at > 0 && at < 20
        ? { kind: line.slice(0, at).trim(), span: String(i), text: line.slice(at + 1).trim() }
        : { kind: 'Góp ý', span: String(i), text: line }
    })
  const suggestion = sections.suggestion || source
  return { verdict, issues, diff: diffChars(source, suggestion), suggestion, suggestionVi: sections.suggestionVi }
}

function ReviewBody({ result }: { result: ReviewResult | null }) {
  if (!result) return <PendingBlock label="Đang kiểm tra câu tiếng Nhật…" />
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
          <p className="text-[13.5px] text-good">Câu đã tự nhiên và đúng kính ngữ, có thể gửi luôn.</p>
        </Section>
      )}
      {result.verdict !== 'ok' && (
        <Section>
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Đề xuất</div>
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
          {result.suggestionVi && (
            <p lang="vi" className="mt-1.5 text-[13px] whitespace-pre-wrap text-ink-2">
              Nghĩa: {result.suggestionVi}
            </p>
          )}
        </Section>
      )}
    </>
  )
}

/** Shown only when the plan is close to its limit, so the user is not surprised when translations stop. */
/** The popup is what people see every day: mention a waiting update, and open the main window to install it. */
function UpdateLine() {
  const { status } = useUpdates()
  if (!status?.available) return null
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-[12px] text-ink-2">
      <span className="flex-1">Có phiên bản mới {status.available.version}</span>
      <button type="button" onClick={() => void invoke('show_main_window')} className="font-medium text-accent hover:underline">
        Cập nhật
      </button>
    </div>
  )
}

function QuotaLine({ rate }: { rate: RateLimit | null }) {
  if (!rate) return null
  const used = rate.utilization ?? 0
  if (rate.status === 'allowed' && used < 0.8) return null
  const period = rate.limitType === 'seven_day' ? 'tuần' : rate.limitType === 'five_hour' ? '5 giờ' : 'hiện tại'
  const reset = rate.resetsAt
    ? new Date(rate.resetsAt * 1000).toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12px] text-warn">
      <AlertTriangle size={13} className="shrink-0" />
      <span>
        {used > 0 ? `Đã dùng ${Math.round(used * 100)}% hạn mức ${period} của gói Claude` : 'Gói Claude sắp hết hạn mức'}
        {reset && `, làm mới ${reset}`}
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
  const name = aiName(provider)
  const retry = (
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="primary" onClick={onRetry}>
        Thử lại
      </Button>
    </div>
  )
  const openSettings = (
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="primary" onClick={() => void invoke('show_main_window')}>
        Mở Cài đặt
      </Button>
      <Button size="sm" onClick={onRetry}>
        Thử lại
      </Button>
    </div>
  )
  if (kind === 'missing_key') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={`Chưa có API key ${name}`}>
        Nhập API key ở Cài đặt &gt; Kết nối AI, hoặc chọn AI khác.
        {openSettings}
      </Banner>
    )
  }
  if (kind === 'bad_key') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title={`API key ${name} không đúng`}>
        Key sai hoặc đã bị thu hồi. Nhập lại key ở Cài đặt &gt; Kết nối AI.
        {openSettings}
      </Banner>
    )
  }
  if (kind === 'network') {
    return (
      <Banner tone="bad" icon={<WifiOff size={16} />} title={`Không kết nối được tới ${name}`}>
        Kiểm tra mạng (hoặc proxy của công ty) rồi thử lại.
        {retry}
      </Banner>
    )
  }
  if (kind === 'rate_limited' && provider !== 'claude') {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title={`Hết hạn mức ${name}`}>
        Tài khoản API đã hết hạn mức hoặc chưa nạp tiền. Thử lại sau, hoặc bật "Tự chuyển sang AI khác khi lỗi" trong Cài đặt.
        {retry}
      </Banner>
    )
  }
  if (kind === 'not_logged_in') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title="Claude Code chưa đăng nhập">
        Mở terminal và chạy lệnh <code className="rounded bg-surface px-1 text-[12px]">claude</code> để đăng nhập bằng tài khoản Claude của bạn.
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      </Banner>
    )
  }
  if (kind === 'not_installed') {
    return (
      <Banner tone="bad" icon={<CircleAlert size={16} />} title="Không tìm thấy Claude Code">
        Cài Claude Code và đăng nhập, rồi thử lại.
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      </Banner>
    )
  }
  if (kind === 'rate_limited') {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title="Đã hết hạn mức gói Claude">
        Hãy thử lại sau khi hạn mức được làm mới.
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      </Banner>
    )
  }
  return (
    <Banner tone="bad" icon={<WifiOff size={16} />} title={kind === 'timeout' ? `${name} không trả lời kịp` : 'Không dịch được'}>
      <span className="font-mono text-[12px] break-all">{message}</span>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" onClick={onRetry}>
          Thử lại
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(message).catch(() => undefined)
            onAction('Đã sao chép thông tin lỗi')
          }}
        >
          Sao chép lỗi
        </Button>
      </div>
    </Banner>
  )
}

function FooterActions({
  direction,
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
  direction: Direction
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
  const feedbackButton = (
    <IconButton label={feedback ? 'Đã gửi phản hồi' : 'Dịch chưa tốt'} active={feedback} disabled={!ready} onClick={onFeedback}>
      <ThumbsDown size={14} />
    </IconButton>
  )
  const enterKbd = <Kbd className="h-4 border-transparent bg-white/25 px-1 text-[12px] text-on-accent">↵</Kbd>

  if (direction === 'ja_vi') {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onReply}>
          <Reply size={14} /> Trả lời <Kbd>↵</Kbd>
        </Button>
        <Button size="sm" disabled={!ready || suggesting} onClick={onSuggest} title="AI gợi ý 3 câu trả lời tiếng Nhật">
          <Sparkles size={14} /> Gợi ý <Kbd>G</Kbd>
        </Button>
        <div className="flex-1" />
        {feedbackButton}
        <Button size="sm" disabled={!ready} onClick={onCopy}>
          <Copy size={14} /> Sao chép
        </Button>
      </div>
    )
  }
  if (direction === 'vi_ja') {
    return (
      // Wraps instead of overflowing when the popup is made narrow: the actions move under the keigo choice.
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span title="Tab để đổi mức kính ngữ" className="inline-flex">
          <Segmented
            label="Mức kính ngữ"
            value={keigo}
            onChange={onKeigo}
            options={keigoOrder.map((k) => ({ value: k, label: keigoLabels[k] }))}
          />
        </span>
        <div className="ml-auto flex items-center gap-2">
        {feedbackButton}
        {origin === 'composer' ? (
          <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
            Thay vào chat {enterKbd}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
            <Copy size={14} /> Sao chép {enterKbd}
          </Button>
        )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <Button size="sm" onClick={onKeep}>
        Giữ nguyên <Kbd>Esc</Kbd>
      </Button>
      <Button size="sm" variant="primary" disabled={!ready} onClick={onPrimary}>
        {origin === 'composer' ? 'Dùng đề xuất' : 'Sao chép đề xuất'} {enterKbd}
      </Button>
    </div>
  )
}
