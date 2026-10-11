import { Check, CircleAlert, Keyboard, Loader2, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { AppMark, Button, Hotkey, WindowFrame } from '../../components/ui'
import { cx } from '../../components/styles'
import { invoke } from '@tauri-apps/api/core'
import { claudeStatus, isTauri, startTranslation } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { useStore, type QuickActionId } from '../../store'
import { Popup } from '../popup/Popup'
import type { PopupRequest } from '../popup/types'
import { HowItWorksDemo } from './HowItWorksDemo'

const steps = ['Chào mừng', 'Kết nối Claude', 'Thử ngay']
const sampleJa = 'お世話になっております。明日の打ち合わせの資料を共有いたします。'

type CheckState = 'idle' | 'running' | 'ok' | 'fail'

/** First-run guide. In the real app (`chromeless`) it fills the main window; in the prototype it sits on the fake desktop. */
export function Onboarding({ chromeless = false }: { chromeless?: boolean }) {
  const { setScreen, updateSettings } = useStore()
  const [step, setStep] = useState(0)
  const [claudeReady, setClaudeReady] = useState(false)
  const finish = () => (chromeless ? updateSettings({ onboarded: true }) : setScreen('playground'))

  const content = (
    <>
        <div className="flex shrink-0 items-center gap-2 px-8 pt-6">
          {steps.map((s, i) => (
            <div key={s} className="flex flex-1 flex-col gap-1.5">
              <div className={cx('h-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} />
              <span className={cx('text-[12px]', i === step ? 'font-semibold text-ink' : 'text-ink-3')}>
                {i + 1}. {s}
              </span>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {step === 0 && <Welcome />}
          {step === 1 && <ConnectClaude onReady={setClaudeReady} />}
          {step === 2 && <TryIt />}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-8 py-3.5">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
          <div className="flex-1" />
          {step < steps.length - 1 ? (
            <Button variant="primary" disabled={step === 1 && !claudeReady} onClick={() => setStep(step + 1)}>
              Tiếp tục
            </Button>
          ) : (
            <Button variant="primary" onClick={finish}>
              {chromeless ? 'Hoàn tất' : 'Hoàn tất, thu nhỏ về khay'}
            </Button>
          )}
        </div>
    </>
  )

  if (chromeless) return <div className="flex h-full flex-col bg-window">{content}</div>
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <WindowFrame title="Chào mừng đến với MyTranslate" icon={<AppMark size={16} />} onClose={() => setScreen('playground')} className="h-[560px] w-[680px]">
        {content}
      </WindowFrame>
    </div>
  )
}

function Welcome() {
  const { settings } = useStore()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div>
        <h1 className="text-[22px] font-semibold">Dịch Nhật - Việt ngay trong ô chat</h1>
        <p className="mt-1.5 text-[14px] text-ink-2">Bôi đen tin nhắn trong Teams hoặc Slack, rồi bấm Dịch. Chỉ vậy thôi.</p>
      </div>
      <HowItWorksDemo />
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        Quen tay rồi thì nhấn <Hotkey combo={settings.hotkeys.auto} /> thay cho bấm nút.
      </p>
    </div>
  )
}

function ConnectClaude({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scenario, showToast } = useStore()
  const [attempt, setAttempt] = useState(0)
  const failAt = scenario === 'not_logged_in' ? 1 : scenario === 'network' || scenario === 'quota' ? 2 : -1
  // Each check run is keyed so a retry or a scenario change starts over without resetting state in an effect.
  const runKey = `${attempt}:${failAt}`
  const [progress, setProgress] = useState<{ key: string; states: CheckState[]; details?: Record<number, string> } | null>(null)
  const states: CheckState[] = progress?.key === runKey ? progress.states : ['running', 'idle', 'idle']
  const details = progress?.key === runKey ? (progress.details ?? {}) : {}

  // Real app: is claude installed, then one short translation proves the login works and shows the speed.
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    let cancel: (() => void) | null = null
    const set = (s: CheckState[], d: Record<number, string> = {}) => alive && setProgress({ key: runKey, states: s, details: d })
    void (async () => {
      const status = await claudeStatus().catch((e) => ({ version: null, error: String(e) }))
      if (!alive) return
      if (!status.version) {
        set(['fail', 'idle', 'idle'], { 0: status.error ?? 'Không tìm thấy lệnh claude' })
        onReady(false)
        return
      }
      const found = { 0: `Tìm thấy ${status.version}` }
      set(['ok', 'running', 'idle'], found)
      cancel = await startTranslation({ direction: 'ja_vi', text: 'ありがとうございます。', keigo: 'polite' }, (e) => {
        if (e.type === 'done') {
          const first = e.timing.firstTokenMs === null ? '' : `, chữ đầu tiên sau ${(e.timing.firstTokenMs / 1000).toFixed(1).replace('.', ',')} giây`
          set(['ok', 'ok', 'ok'], { ...found, 2: `Dịch thử thành công${first}` })
          onReady(true)
        }
        if (e.type === 'error' && e.kind !== 'cancelled') {
          if (e.kind === 'not_logged_in') set(['ok', 'fail', 'idle'], found)
          else set(['ok', 'ok', 'fail'], { ...found, 2: e.message })
          onReady(false)
        }
      })
    })()
    return () => {
      alive = false
      cancel?.()
    }
  }, [runKey, onReady])

  useEffect(() => {
    if (isTauri) return
    const timers: number[] = []
    let current: CheckState[] = ['running', 'idle', 'idle']
    for (let i = 0; i < 3; i++) {
      timers.push(
        window.setTimeout(() => {
          current = [...current]
          if (i === failAt) {
            current[i] = 'fail'
          } else {
            current[i] = 'ok'
            if (i < 2) current[i + 1] = 'running'
          }
          setProgress({ key: runKey, states: current })
          onReady(i === 2 && failAt === -1)
        }, 700 * (i + 1)),
      )
      if (i === failAt) break
    }
    return () => timers.forEach(window.clearTimeout)
  }, [runKey, failAt, onReady])

  const retry = () => {
    onReady(false)
    setAttempt((n) => n + 1)
  }

  const items: { title: string; detail: string; fail: string; action?: ReactNode }[] = [
    { title: 'Đã cài Claude Code', detail: 'Tìm thấy claude 2.x trong PATH', fail: 'Không tìm thấy lệnh claude' },
    {
      title: 'Đã đăng nhập tài khoản Claude',
      detail: 'Đăng nhập bằng tài khoản Claude của bạn',
      fail: 'Chưa đăng nhập. Mở terminal và chạy lệnh claude để đăng nhập.',
      action: (
        <Button
          size="sm"
          onClick={() =>
            isTauri
              ? void invoke('open_claude_login').catch((e) => showToast(`Không mở được terminal: ${String(e)}`))
              : showToast('Mô phỏng: mở terminal chạy "claude"')
          }
        >
          <Terminal size={13} /> Mở terminal để đăng nhập
        </Button>
      ),
    },
    {
      title: 'Gọi thử thành công',
      detail: 'Chữ đầu tiên sau 1,8 giây',
      fail: scenario === 'quota' ? 'Đã hết hạn mức gói Claude, làm mới lúc 15:00.' : 'Không kết nối được tới Claude (network timeout).',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Kết nối với Claude</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">
          MyTranslate dùng Claude Code đã đăng nhập trên máy này. App không lưu và không đọc thông tin đăng nhập của bạn.
        </p>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map((item, i) => (
          <li key={item.title} className="flex items-start gap-3 px-4 py-3">
            <StatusIcon state={states[i]} />
            <div className="min-w-0 flex-1">
              <div className={cx('text-[13.5px] font-medium', states[i] === 'idle' ? 'text-ink-3' : 'text-ink')}>{item.title}</div>
              {states[i] === 'ok' && <div className="text-[12.5px] text-ink-3">{details[i] ?? item.detail}</div>}
              {states[i] === 'fail' && (
                <div className="mt-0.5 flex flex-col items-start gap-2">
                  <span className="text-[12.5px] break-all text-bad">{details[i] ?? item.fail}</span>
                  {item.action}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {states.includes('fail') && (
        <div className="flex items-center gap-3">
          <Button onClick={retry}>Kiểm tra lại</Button>
          {!isTauri && <span className="text-[12.5px] text-ink-3">Mẹo: đổi "Trạng thái giả lập" về "Bình thường" rồi kiểm tra lại.</span>}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ state }: { state: CheckState }) {
  if (state === 'running') return <Loader2 size={18} className="mt-px shrink-0 animate-spin text-accent" />
  if (state === 'ok')
    return (
      <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-good text-white">
        <Check size={12} strokeWidth={3} />
      </span>
    )
  if (state === 'fail') return <CircleAlert size={18} className="mt-px shrink-0 text-bad" />
  return <span className="mt-px size-[18px] shrink-0 rounded-full border-2 border-line" />
}

/** Only the buttons that open the popup; "Dịch và chép" would copy silently, which teaches nothing here. */
const tryItActions: QuickActionId[] = ['translate', 'review']

function TryIt() {
  const { settings } = useStore()
  const [request, setRequest] = useState<PopupRequest | null>(null)
  const [bar, setBar] = useState<{ text: string; x: number; y: number } | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const sampleRef = useRef<HTMLParagraphElement>(null)

  const open = useCallback((direction: PopupRequest['direction'], text?: string) => {
    setBar(null)
    setRequest({
      id: Date.now(),
      direction,
      source: text || window.getSelection()?.toString().trim() || sampleJa,
      origin: 'onboarding',
      conversationId: 'c-devqa',
      app: 'slack',
      anchor: { x: 0, y: 0 },
      placement: 'below',
    })
  }, [])

  // In the real app the global hotkey opens the real popup; this covers the prototype, where it is a page key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (combo === settings.hotkeys.jaVi || combo === settings.hotkeys.auto) {
        e.preventDefault()
        open('ja_vi')
      }
      if (e.key === 'Escape') setBar(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, settings.hotkeys])

  // Like the real toolbar: selecting with the mouse shows it next to the selection.
  const onMouseUp = () => {
    window.setTimeout(() => {
      const sel = window.getSelection()
      const area = areaRef.current
      const text = sel?.toString().trim() ?? ''
      if (!sel || !area || !text || sel.rangeCount === 0 || !sampleRef.current?.contains(sel.anchorNode)) return setBar(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const box = area.getBoundingClientRect()
      setBar({ text, x: Math.max(0, r.left - box.left), y: r.bottom - box.top + 6 })
    }, 0)
  }

  const items = settings.quickActions.items.filter((i) => tryItActions.includes(i.id))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Thử ngay</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Dùng chuột bôi đen câu tiếng Nhật dưới đây, rồi bấm <span className="font-semibold text-ink">Dịch sang Việt</span> trên thanh nhỏ hiện ra.
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
          <Keyboard size={15} /> Hoặc bôi đen rồi nhấn <Hotkey combo={settings.hotkeys.jaVi} />
        </p>
      </div>
      <div ref={areaRef} className="relative" onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-quick-bar]') && setBar(null)}>
        <p
          ref={sampleRef}
          lang="ja"
          onMouseUp={onMouseUp}
          className="cursor-text rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed selection:bg-[#b4d5fe] dark:selection:bg-[#3b5a8c]"
        >
          {sampleJa}
        </p>
        {bar && !request && (
          <QuickActionBar
            japanese
            items={items}
            display={settings.quickActions.display}
            onAction={(a) => open(a === 'review' ? 'review_ja' : 'ja_vi', bar.text)}
            onDismiss={() => setBar(null)}
            className="absolute z-10"
            style={{ left: bar.x, top: bar.y }}
          />
        )}
      </div>
      {request && (
        <>
          <Popup key={request.id} request={request} onClose={() => setRequest(null)} />
          <p className="text-[12.5px] text-ink-2">Trong Teams và Slack cũng làm y như vậy. Bấm Hoàn tất để bắt đầu dùng.</p>
        </>
      )}
    </div>
  )
}
