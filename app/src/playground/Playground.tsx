import { ChevronDown, ChevronUp, MousePointerClick } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QuickActionBar } from '../components/QuickActionBar'
import { Hotkey, Segmented } from '../components/ui'
import { cx } from '../components/styles'
import { mockData } from '../data/mock'
import { comboFromEvent } from '../lib/hotkeys'
import { locale, route, useLang, useT, type Action, type Lang } from '../lib/i18n'
import { isJapanese, translate } from '../lib/mockEngine'
import { useStore, type QuickActionId } from '../store'
import type { ChatApp as ChatAppKind, ChatChannel } from '../types'
import { Popup } from '../windows/popup/Popup'
import type { PopupRequest } from '../windows/popup/types'
import { ChatApp } from './ChatApp'

/** Texts to try, typed into the message box: what each user writes, and Japanese worth checking. */
const samples: Record<Lang, { label: string; text: string }[]> = {
  vi: [
    { label: 'Câu tiếng Việt', text: 'Em đã deploy bản sửa rồi, nhờ anh kiểm tra lại giúp em' },
    { label: 'Trả lời lịch release', text: 'Thứ Tư tuần sau được ạ, em sẽ gửi lịch chi tiết sau' },
    { label: 'Tiếng Nhật cần sửa', text: '明日までに確認してください。' },
  ],
  ja: [
    { label: 'リリース日程への返信', text: '来週の水曜日で大丈夫です。詳しいスケジュールを送ってください。' },
    { label: '本番反映の依頼', text: '確認しました。本番に反映してください。' },
    { label: 'チェックしたい日本語', text: '明日までに確認してください。' },
  ],
}

function firstChannels(lang: Lang): Record<ChatAppKind, string> {
  const { chatChannels } = mockData(lang)
  return { slack: chatChannels.slack[0].id, teams: chatChannels.teams[0].id }
}

export function Playground() {
  const { settings, showToast, scenario } = useStore()
  const t = useT()
  const lang = useLang()
  const [app, setApp] = useState<ChatAppKind>('slack')
  const [channels, setChannels] = useState<Record<ChatAppKind, ChatChannel[]>>(() => mockData(lang).chatChannels)
  const [activeId, setActiveId] = useState<Record<ChatAppKind, string>>(() => firstChannels(lang))
  const [composer, setComposer] = useState('')
  const [request, setRequest] = useState<PopupRequest | null>(null)
  // A user of the other language chats with other people.
  const [shownLang, setShownLang] = useState(lang)
  if (shownLang !== lang) {
    setShownLang(lang)
    setChannels(mockData(lang).chatChannels)
    setActiveId(firstChannels(lang))
    setRequest(null)
  }
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [guideOpen, setGuideOpen] = useState(true)
  const [quick, setQuick] = useState<{ x: number; y: number; startY: number; japanese: boolean } | null>(null)
  /** Where the current mouse selection started, to keep the toolbar off the selected lines. */
  const downY = useRef(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const mouse = useRef<{ x: number; y: number } | null>(null)
  /** Composer range the popup result will replace. */
  const replaceRange = useRef<[number, number] | null>(null)
  const requestSeq = useRef(0)

  const channel = channels[app].find((c) => c.id === activeId[app]) ?? channels[app][0]

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Reads what the user selected: highlighted message text first, then the composer (all of it if nothing is selected). */
  const capture = useCallback(() => {
    const root = rootRef.current
    if (!root) return null
    const box = root.getBoundingClientRect()
    const composerEl = composerRef.current
    const sel = window.getSelection()
    const messages = root.querySelector('[data-chat-messages]')
    const messageSelection =
      sel && sel.rangeCount > 0 && !sel.isCollapsed && messages?.contains(sel.anchorNode) ? sel.toString().trim() : ''

    if (messageSelection && sel) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      return {
        text: messageSelection,
        origin: 'chat' as const,
        anchor: mouse.current ?? { x: r.left - box.left, y: r.bottom - box.top },
        placement: 'below' as const,
        range: null,
      }
    }
    if (composerEl && document.activeElement === composerEl) {
      const { selectionStart: s, selectionEnd: e, value } = composerEl
      const range: [number, number] = s !== e ? [s, e] : [0, value.length]
      const r = composerEl.getBoundingClientRect()
      return {
        text: value.slice(range[0], range[1]).trim(),
        origin: 'composer' as const,
        anchor: { x: r.left - box.left + 12, y: r.top - box.top - 8 },
        placement: 'above' as const,
        range,
      }
    }
    return null
  }, [])

  const trigger = useCallback(
    (action: Action) => {
      if (settings.hotkeysPaused) {
        showToast(t('Phím tắt đang tạm dừng, bật lại trong menu khay hệ thống', 'ショートカットは一時停止中です。タスクトレイのメニューで再開できます'))
        return
      }
      const got = capture()
      if (!got?.text) {
        showToast(t('Chưa chọn đoạn văn bản nào', 'テキストが選択されていません'))
        return
      }
      if (got.range) replaceRange.current = got.range

      const { direction, origin } = route(action, got.text, lang, got.origin)

      setQuick(null)
      requestSeq.current += 1
      setRequest({
        id: requestSeq.current,
        direction,
        source: got.text,
        origin,
        // What the real app reads from the chat window's title: a channel with its #, a DM by the person's name.
        conversation: channel.kind === 'channel' ? `#${channel.label}` : channel.label,
        app,
        anchor: got.anchor,
        placement: got.placement,
      })
    },
    [app, capture, channel.kind, channel.label, settings.hotkeysPaused, showToast, t, lang],
  )

  // Mouse users get a small toolbar after selecting text, so they never have to reach for the keyboard.
  const onMouseUp = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-popup], [data-guide], [data-quick-bar]')) return
    const qa = settings.quickActions
    if (!qa.enabled || settings.hotkeysPaused || e.button !== 0) return
    // The real app checks the process of the window under the cursor; here it is the simulated chat app.
    const exe = app === 'slack' ? 'slack.exe' : 'ms-teams.exe'
    const listed = (list: { exe: string }[]) => list.some((a) => a.exe.toLowerCase() === exe)
    if (qa.appScope === 'selected' && !listed(qa.apps)) return
    if (settings.blockedApps.some((b) => b.toLowerCase() === exe)) return
    // Let the browser finish updating the selection first.
    window.setTimeout(() => {
      const got = capture()
      const composerSelected =
        got?.origin === 'composer' && composerRef.current && composerRef.current.selectionStart !== composerRef.current.selectionEnd
      if (!got?.text || (got.origin === 'composer' && !composerSelected) || !mouse.current) {
        setQuick(null)
        return
      }
      setQuick({ x: mouse.current.x, y: mouse.current.y, startY: downY.current, japanese: isJapanese(got.text) })
    }, 0)
  }

  const runQuick = (action: QuickActionId) => {
    if (action === 'translate') return trigger('auto')
    if (action === 'review') return trigger('review')
    const got = capture()
    setQuick(null)
    if (!got?.text) return
    if (scenario === 'not_logged_in' || scenario === 'quota' || scenario === 'network') {
      showToast(
        t(
          'Không dịch được: Claude đang báo lỗi, thử lại bằng popup để xem chi tiết',
          '翻訳できません: Claude でエラーが発生しています。ポップアップで再試行すると詳細を確認できます',
        ),
      )
      return
    }
    const result = translate(got.text, isJapanese(got.text) ? 'ja_vi' : 'vi_ja', settings.defaultKeigo, lang)
    void navigator.clipboard.writeText(result.translation).catch(() => undefined)
    const preview = `${result.translation.slice(0, 36)}${result.translation.length > 36 ? '...' : ''}`
    showToast(t(`Đã dịch và sao chép: ${preview}`, `翻訳してコピーしました: ${preview}`))
  }

  // Global shortcuts (in the real app these are OS-wide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const { hotkeys } = settings
      const map: Record<string, Action> = { [hotkeys.auto]: 'auto', [hotkeys.review]: 'review' }
      const action = map[combo]
      if (!action) return
      e.preventDefault()
      trigger(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings, trigger])

  // Like the real app: the toolbar stays until the user clicks somewhere else.
  useEffect(() => {
    if (!quick) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-quick-bar]')) setQuick(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [quick])

  // Clicking outside the popup closes it unless it is pinned (the popup handles pin by ignoring this).
  const popupPinnedRef = useRef(false)
  const setPinned = useCallback((p: boolean) => {
    popupPinnedRef.current = p
  }, [])
  useEffect(() => {
    if (!request) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-popup]') || target.closest('[data-guide]')) return
      if (popupPinnedRef.current) return
      setRequest(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [request])

  const closePopup = () => {
    setRequest(null)
    // Return focus to where the user was, like the real app does.
    if (request?.origin === 'composer') composerRef.current?.focus()
  }

  const apply = (text: string) => {
    const range = replaceRange.current ?? [0, composer.length]
    const next = composer.slice(0, range[0]) + text + composer.slice(range[1])
    setComposer(next)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      const caret = range[0] + text.length
      el.setSelectionRange(caret, caret)
    })
  }

  const send = () => {
    const text = composer.trim()
    if (!text) return
    const time = new Date().toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
    const author = mockData(lang).me
    setChannels((all) => ({
      ...all,
      [app]: all[app].map((c) =>
        c.id === channel.id ? { ...c, messages: [...c.messages, { id: `me-${Date.now()}`, author, me: true, time, text }] } : c,
      ),
    }))
    setComposer('')
  }

  const fillSample = (text: string) => {
    setComposer(text)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(text.length, text.length)
    })
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      onMouseUp={onMouseUp}
      onMouseDown={(e) => {
        const box = rootRef.current?.getBoundingClientRect()
        if (box) downY.current = e.clientY - box.top
      }}
      onMouseMove={(e) => {
        const box = rootRef.current?.getBoundingClientRect()
        if (box) mouse.current = { x: e.clientX - box.left, y: e.clientY - box.top }
      }}
    >
      <div className="absolute top-5 bottom-5 left-5 right-[356px]">
        <ChatApp
          ref={composerRef}
          app={app}
          channels={channels[app]}
          activeId={channel.id}
          onSelectChannel={(id) => {
            setActiveId((a) => ({ ...a, [app]: id }))
            setRequest(null)
            setQuick(null)
          }}
          composer={composer}
          onComposer={setComposer}
          onSend={send}
        />
      </div>

      <aside data-guide className="absolute top-5 right-5 w-[316px] overflow-hidden rounded-lg border border-line bg-window shadow-window">
        <button
          type="button"
          onClick={() => setGuideOpen((o) => !o)}
          className="flex h-11 w-full items-center gap-2 border-b border-line px-4 text-left"
        >
          <MousePointerClick size={16} className="text-accent" />
          <span className="flex-1 text-[13.5px] font-semibold">{t('Thử nghiệm', '試してみる')}</span>
          {guideOpen ? <ChevronUp size={16} className="text-ink-3" /> : <ChevronDown size={16} className="text-ink-3" />}
        </button>
        {guideOpen && (
          <div className="flex flex-col gap-4 p-4 text-[13px] leading-snug">
            <div className="flex items-center justify-between">
              <span className="text-ink-2">{t('App chat', 'チャットアプリ')}</span>
              <Segmented
                label={t('App chat', 'チャットアプリ')}
                value={app}
                onChange={(v) => {
                  setApp(v)
                  setRequest(null)
                }}
                options={[
                  { value: 'slack', label: 'Slack' },
                  { value: 'teams', label: 'Teams' },
                ]}
              />
            </div>

            {lang === 'ja' ? (
              <>
                <Step n={1} title="ベトナム側のメッセージを読む">
                  ベトナム語のメッセージを選択して <Hotkey combo={settings.hotkeys.auto} />
                  {settings.quickActions.enabled ? '、または表示されたツールバーの「日本語に翻訳」をクリック。' : '。'}
                </Step>
                <Step n={2} title="日本語で返信する">
                  入力欄に日本語を書いて <Hotkey combo={settings.hotkeys.auto} />。<Hotkey combo="Tab" /> で丁寧さを切り替え、
                  <Hotkey combo="Enter" /> でベトナム語訳を入力欄に貼り付けます。
                </Step>
                <Step n={3} title="相手のことを AI に伝える">
                  用語集に種類「人物」で相手を追加し、役割や呼び方を書きます。名前が会話に出ると、AI に一緒に送られます。
                </Step>
                <Step n={4} title="ポップアップの移動とサイズ変更">
                  タイトルバーをドラッグして移動、左右・下の端や下の角をドラッグしてサイズを変更できます。次のポップアップもアプリを終了するまで同じ位置とサイズで開きます。
                </Step>
              </>
            ) : (
              <>
                <Step n={1} title="Đọc tin của khách">
                  Bôi đen một tin tiếng Nhật rồi nhấn <Hotkey combo={settings.hotkeys.auto} />
                  {settings.quickActions.enabled ? ', hoặc bấm "Dịch sang Việt" trên thanh thao tác hiện ra.' : '.'}
                </Step>
                <Step n={2} title="Trả lời bằng tiếng Việt">
                  Gõ tiếng Việt vào ô chat rồi nhấn <Hotkey combo={settings.hotkeys.auto} />. Nhấn <Hotkey combo="Tab" /> để đổi kính ngữ,{' '}
                  <Hotkey combo="Enter" /> để thay vào ô chat.
                </Step>
                <Step n={3} title="Kiểm tra câu tiếng Nhật">
                  Viết tiếng Nhật vào ô chat rồi nhấn <Hotkey combo={settings.hotkeys.review} />.
                </Step>
                <Step n={4} title="Cho AI biết bạn đang nói với ai">
                  Thêm người vào Glossary với loại "Người", ghi vai trò và cách xưng hô. Khi tên họ có trong cuộc chat, app gửi kèm cho AI.
                </Step>
                <Step n={5} title="Di chuyển và đổi kích thước popup">
                  Kéo thanh tiêu đề để di chuyển; kéo mép trái, phải, dưới hoặc góc dưới để đổi kích thước. Popup sau sẽ mở đúng như vậy cho
                  đến khi tắt app.
                </Step>
              </>
            )}

            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink-3">{t('Điền nhanh vào ô chat', '入力欄にサンプルを入れる')}</div>
              <div className="flex flex-wrap gap-1.5">
                {samples[lang].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => fillSample(s.text)}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {lang === 'ja' ? (
              <p className="border-t border-line pt-3 text-[12px] text-ink-3">
                翻訳は <Hotkey combo={settings.hotkeys.auto} /> ひとつで、文の言語から向きを自動で判断します。<Hotkey combo={settings.hotkeys.main} />{' '}
                またはタスクトレイのアイコンでメイン画面を開きます。ツールバーの「シミュレーション」でエラー画面を確認できます。
              </p>
            ) : (
              <p className="border-t border-line pt-3 text-[12px] text-ink-3">
                Chỉ cần một phím <Hotkey combo={settings.hotkeys.auto} />: app tự nhận ngôn ngữ để chọn hướng dịch. <Hotkey combo={settings.hotkeys.main} /> hoặc icon khay
                hệ thống để mở cửa sổ chính. Đổi "Trạng thái giả lập" trên thanh công cụ để xem các màn hình lỗi.
              </p>
            )}
          </div>
        )}
      </aside>

      {quick && !request && (
        <QuickActionBar
          japanese={quick.japanese}
          items={settings.quickActions.items}
          display={settings.quickActions.display}
          onAction={runQuick}
          onDismiss={() => setQuick(null)}
          className="absolute z-30"
          style={{
            left: Math.max(8, Math.min(quick.x - 16, size.width - (settings.quickActions.display === 'iconOnly' ? 170 : 400))),
            // Like the real app: above a one-line selection, below one dragged down over several lines.
            top: quickTop(quick, size.height),
          }}
        />
      )}

      {request && (
        <Popup
          key={request.id}
          request={request}
          container={size}
          onClose={closePopup}
          onApply={apply}
          onPinnedChange={setPinned}
        />
      )}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11.5px] font-bold text-accent')}>
        {n}
      </span>
      <div>
        <div className="font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-ink-2 [&_kbd]:align-middle">{children}</div>
      </div>
    </div>
  )
}

/** Toolbar top (40 px tall, 16 px clear of the pointer's line), on the side away from the selected text. */
function quickTop(q: { y: number; startY: number }, height: number): number {
  const above = q.y - 16 - 40
  const below = q.y + 16
  const draggedDown = q.y - q.startY > 16
  if (above >= 4 && !(draggedDown && below + 40 <= height - 4)) return above
  return below
}
