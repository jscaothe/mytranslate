import { ArrowLeftRight, Check, CircleAlert, ExternalLink, Keyboard, KeyRound, Loader2, RotateCw, ShieldAlert, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { AppMark, Button, Hotkey, WindowFrame } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { invoke } from '@tauri-apps/api/core'
import { AI_NAMES, KEY_HELP, RECOMMENDED_MODELS, testFailure, type TestResult } from '../../lib/ai'
import { claudeStatus, isTauri, startTranslation } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { useStore, type AiProvider, type QuickActionId } from '../../store'
import { AiMark } from '../popup/AiSwitcher'
import { Popup } from '../popup/Popup'
import type { PopupRequest } from '../popup/types'
import { HowItWorksDemo } from './HowItWorksDemo'

const steps = ['Chào mừng', 'Kết nối AI', 'Thử ngay']
const sampleJa = 'お世話になっております。明日の打ち合わせの資料を共有いたします。'

type CheckState = 'idle' | 'running' | 'ok' | 'fail'

/** First-run guide. In the real app (`chromeless`) it fills the main window; in the prototype it sits on the fake desktop. */
export function Onboarding({ chromeless = false }: { chromeless?: boolean }) {
  const { setScreen, updateSettings } = useStore()
  const [step, setStep] = useState(0)
  const [aiReady, setAiReady] = useState(false)
  const finish = () => (chromeless ? updateSettings({ onboarded: true }) : setScreen('playground'))

  // On a maximized window the guide keeps a readable width instead of stretching edge to edge.
  const column = 'mx-auto w-full max-w-[880px]'
  const content = (
    <>
        <div className="shrink-0 px-8 pt-6">
          <div className={cx(column, 'flex items-center gap-2')}>
            {steps.map((s, i) => (
              <div key={s} className="flex flex-1 flex-col gap-1.5">
                <div className={cx('h-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} />
                <span className={cx('text-[12px]', i === step ? 'font-semibold text-ink' : 'text-ink-3')}>
                  {i + 1}. {s}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className={cx(column, 'h-full')}>
            {step === 0 && <Welcome />}
            {step === 1 && <ConnectAi onReady={setAiReady} />}
            {step === 2 && <TryIt />}
          </div>
        </div>

        <div className="shrink-0 border-t border-line px-8 py-3.5">
          <div className={cx(column, 'flex items-center gap-2')}>
            {step > 0 && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
            <div className="flex-1" />
            {step < steps.length - 1 ? (
              <Button variant="primary" disabled={step === 1 && !aiReady} onClick={() => setStep(step + 1)}>
                Tiếp tục
              </Button>
            ) : (
              <Button variant="primary" onClick={finish}>
                {chromeless ? 'Hoàn tất' : 'Hoàn tất, thu nhỏ về khay'}
              </Button>
            )}
          </div>
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

/** The setup pages the Rust side agrees to open. */
type HelpPage = 'claude_code' | 'openai_keys' | 'gemini_keys'

function openHelp(page: HelpPage, showToast: (m: string) => void) {
  if (!isTauri) return showToast(`Mô phỏng: mở trang ${page === 'claude_code' ? 'cài Claude Code' : 'tạo API key'} trong trình duyệt`)
  void invoke('open_help_page', { page }).catch((e) => showToast(`Không mở được trình duyệt: ${String(e)}`))
}

/**
 * Step 2. Claude Code on this machine is used as is; without it (or when the user prefers another) the user picks
 * an AI and sets it up here. ChatGPT and Gemini need only an API key.
 */
function ConnectAi({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scenario } = useStore()
  // null while looking for Claude Code.
  const [claudeFound, setClaudeFound] = useState<boolean | null>(null)
  const [pick, setPick] = useState<AiProvider | null>(null)
  const [search, setSearch] = useState(0)

  useEffect(() => {
    let alive = true
    const found = (yes: boolean) => {
      if (!alive) return
      setClaudeFound(yes)
      setPick(yes ? 'claude' : null)
    }
    let timer = 0
    if (isTauri) {
      void claudeStatus()
        .then((s) => found(Boolean(s.version)))
        .catch(() => found(false))
    } else {
      timer = window.setTimeout(() => found(scenario !== 'no_claude'), 500)
    }
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [scenario, search])

  const choose = (p: AiProvider | null) => {
    onReady(false)
    setPick(p)
  }

  if (claudeFound === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13.5px] text-ink-2">
        <Loader2 size={16} className="animate-spin text-accent" /> Đang tìm Claude Code trên máy này…
      </div>
    )
  }

  if (claudeFound && pick === 'claude') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-[17px] font-semibold">Kết nối với Claude</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Máy này đã có Claude Code. MyTranslate dùng Claude Code đã đăng nhập, không lưu và không đọc thông tin đăng nhập của bạn.
          </p>
        </div>
        <ClaudeCheck onReady={onReady} />
        <button type="button" onClick={() => choose(null)} className="flex items-center gap-1.5 self-start text-[13px] text-accent hover:underline">
          <ArrowLeftRight size={14} /> Dùng ChatGPT hoặc Gemini thay cho Claude
        </button>
      </div>
    )
  }

  const options: { id: AiProvider; detail: string }[] = [
    { id: 'claude', detail: claudeFound ? 'Dùng Claude Code đã cài trên máy này.' : 'Cần cài Claude Code và có tài khoản Claude (gói Pro hoặc Max).' },
    { id: 'openai', detail: 'Dùng API key của OpenAI, trả tiền theo lượng dùng.' },
    { id: 'gemini', detail: 'Dùng API key của Google AI Studio, có gói miễn phí.' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Chọn AI để dịch</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {claudeFound
            ? 'Chọn AI bạn muốn dùng. Sau này vẫn đổi được trong Cài đặt hoặc ngay trên popup.'
            : 'Máy này chưa có Claude Code. Chọn một AI mà bạn có tài khoản.'}
        </p>
      </div>
      <div role="radiogroup" aria-label="AI dịch" className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {options.map((o) => {
          const selected = pick === o.id
          return (
            <div key={o.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(o.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover"
              >
                <span
                  className={cx(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-accent bg-accent' : 'border-line-strong',
                  )}
                >
                  {selected && <span className="size-1.5 rounded-full bg-on-accent" />}
                </span>
                <AiMark provider={o.id} className="size-6 text-[12px]" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{AI_NAMES[o.id]}</span>
                  <span className="block text-[12.5px] text-ink-3">{o.detail}</span>
                </span>
              </button>
              {selected && o.id === 'claude' && !claudeFound && <InstallClaude onRecheck={() => setSearch((n) => n + 1)} />}
              {selected && o.id !== 'claude' && <ApiKeySetup key={o.id} provider={o.id} onReady={onReady} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InstallClaude({ onRecheck }: { onRecheck: () => void }) {
  const { showToast } = useStore()
  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-subtle/60 px-4 py-3 text-[13px] text-ink-2">
      <p>Cài Claude Code theo hướng dẫn, mở nó một lần để đăng nhập tài khoản Claude, rồi quay lại đây.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => openHelp('claude_code', showToast)}>
          <ExternalLink size={13} /> Mở hướng dẫn cài đặt
        </Button>
        <Button size="sm" onClick={onRecheck}>
          <RotateCw size={13} /> Đã cài, kiểm tra lại
        </Button>
      </div>
    </div>
  )
}

/** ChatGPT or Gemini: save the API key, then one short translation proves it works and makes it the AI. */
function ApiKeySetup({ provider, onReady }: { provider: 'openai' | 'gemini'; onReady: (ready: boolean) => void }) {
  const { updateSettings, showToast } = useStore()
  const [hasKey, setHasKey] = useState(false)
  const [draft, setDraft] = useState('')
  const [test, setTest] = useState<{ state: 'idle' | 'running' } | { state: 'done'; result: TestResult }>({ state: 'idle' })
  const name = AI_NAMES[provider]
  const model = RECOMMENDED_MODELS[provider]

  const runTest = useCallback(() => {
    setTest({ state: 'running' })
    const done = (result: TestResult) => {
      setTest({ state: 'done', result })
      if (result.ok) updateSettings({ aiProvider: provider })
      onReady(result.ok)
    }
    if (!isTauri) {
      window.setTimeout(() => done({ ok: true, model, firstTokenMs: 640, totalMs: 1180, translation: 'Cảm ơn bạn.', error: null, errorKind: null }), 700)
      return
    }
    invoke<TestResult>('ai_test', { provider, model })
      .then(done)
      .catch((e) => done({ ok: false, model, firstTokenMs: null, totalMs: 0, translation: '', error: String(e), errorKind: null }))
  }, [provider, model, updateSettings, onReady])

  // A key saved earlier (in Settings) is tried right away.
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    void invoke<{ openai: boolean; gemini: boolean }>('ai_keys_status').then((k) => {
      if (!alive || !k[provider]) return
      setHasKey(true)
      runTest()
    })
    return () => {
      alive = false
    }
  }, [provider, runTest])

  const save = (key: string) => {
    const saved = () => {
      setHasKey(true)
      setDraft('')
      runTest()
    }
    if (!isTauri) return saved()
    invoke('ai_key_set', { provider, key })
      .then(saved)
      .catch((e) => showToast(`Không lưu được key: ${String(e)}`))
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',')

  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-subtle/60 px-4 py-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) save(draft.trim())
        }}
      >
        <label className="relative min-w-0 flex-1">
          <KeyRound size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input
            type="password"
            autoComplete="off"
            aria-label={`API key ${name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={hasKey ? '•••••••• (đã lưu, nhập để thay)' : `Dán API key ${name} (${KEY_HELP[provider].placeholder})`}
            className={cx(inputClass, 'w-full pl-8')}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!draft.trim() || test.state === 'running'}>
          Lưu và dịch thử
        </Button>
      </form>
      <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <button
          type="button"
          onClick={() => openHelp(provider === 'openai' ? 'openai_keys' : 'gemini_keys', showToast)}
          className="flex items-center gap-1 text-accent hover:underline"
        >
          <ExternalLink size={13} /> Tạo API key {name}
        </button>
        {test.state === 'running' && (
          <span className="flex items-center gap-1.5 text-ink-2">
            <Loader2 size={14} className="animate-spin" /> Đang dịch thử…
          </span>
        )}
        {test.state === 'done' && test.result.ok && (
          <span className="flex items-center gap-1.5 text-good">
            <Check size={14} /> Dịch thử thành công, chữ đầu tiên sau {seconds(test.result.firstTokenMs ?? test.result.totalMs)} giây
          </span>
        )}
        {test.state === 'done' && !test.result.ok && (
          <span className="flex min-w-0 items-center gap-1.5 text-bad" title={test.result.error ?? ''}>
            <CircleAlert size={14} className="shrink-0" /> {testFailure(test.result.errorKind)}
            <button type="button" onClick={runTest} className="ml-1 text-accent hover:underline">
              Thử lại
            </button>
          </span>
        )}
      </div>
      {provider === 'gemini' && (
        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
          Gói miễn phí có thể dùng nội dung để huấn luyện AI, không dùng cho tin nhắn của khách.
        </p>
      )}
    </div>
  )
}

/** Claude Code is installed: is it signed in, and does one short translation work. */
function ClaudeCheck({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scenario, showToast, updateSettings } = useStore()
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
          updateSettings({ aiProvider: 'claude' })
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
  }, [runKey, onReady, updateSettings])

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
