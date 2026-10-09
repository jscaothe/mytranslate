import { Check, CircleAlert, Keyboard, Loader2, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ProfilePromptEditor } from '../../components/ProfilePromptEditor'
import { AppMark, Button, Hotkey, Segmented, WindowFrame } from '../../components/ui'
import { cx } from '../../components/styles'
import { keigoLabels } from '../../data/mock'
import { comboFromEvent } from '../../lib/hotkeys'
import { useStore } from '../../store'
import { Popup } from '../popup/Popup'
import type { PopupRequest } from '../popup/types'

const steps = ['Chào mừng', 'Kết nối Claude', 'Hồ sơ', 'Thử ngay']
const sampleJa = 'お世話になっております。明日の打ち合わせの資料を共有いたします。'

type CheckState = 'idle' | 'running' | 'ok' | 'fail'

export function Onboarding() {
  const { setScreen } = useStore()
  const [step, setStep] = useState(0)
  const [claudeReady, setClaudeReady] = useState(false)

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <WindowFrame title="Chào mừng đến với MyTranslate" icon={<AppMark size={16} />} onClose={() => setScreen('playground')} className="h-[560px] w-[680px]">
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
          {step === 2 && <Profile />}
          {step === 3 && <TryIt />}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-8 py-3.5">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
          <div className="flex-1" />
          {step < steps.length - 1 ? (
            <Button variant="primary" disabled={step === 1 && !claudeReady} onClick={() => setStep(step + 1)}>
              Tiếp tục
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setScreen('playground')}>
              Hoàn tất, thu nhỏ về khay
            </Button>
          )}
        </div>
      </WindowFrame>
    </div>
  )
}

function Welcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <AppMark size={56} />
      <h1 className="text-[22px] font-semibold">Dịch Nhật - Việt ngay trong ô chat</h1>
      <p className="max-w-[440px] text-[14px] leading-relaxed text-ink-2">
        Bôi đen tin nhắn trong Teams hoặc Slack và nhấn một phím tắt. MyTranslate dịch bằng Claude, nhớ ngữ cảnh từng thread và giúp bạn viết tiếng Nhật đúng kính ngữ.
      </p>
      <div className="mt-2 flex gap-6 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <Hotkey combo="Ctrl+Alt+J" /> Đọc tin
        </span>
        <span className="flex items-center gap-1.5">
          <Hotkey combo="Ctrl+Alt+K" /> Trả lời
        </span>
        <span className="flex items-center gap-1.5">
          <Hotkey combo="Ctrl+Alt+L" /> Kiểm tra
        </span>
      </div>
    </div>
  )
}

function ConnectClaude({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scenario, showToast } = useStore()
  const [attempt, setAttempt] = useState(0)
  const failAt = scenario === 'not_logged_in' ? 1 : scenario === 'network' || scenario === 'quota' ? 2 : -1
  // Each check run is keyed so a retry or a scenario change starts over without resetting state in an effect.
  const runKey = `${attempt}:${failAt}`
  const [progress, setProgress] = useState<{ key: string; states: CheckState[] } | null>(null)
  const states: CheckState[] = progress?.key === runKey ? progress.states : ['running', 'idle', 'idle']

  useEffect(() => {
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
        <Button size="sm" onClick={() => showToast('Mô phỏng: mở terminal chạy "claude"')}>
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
              {states[i] === 'ok' && <div className="text-[12.5px] text-ink-3">{item.detail}</div>}
              {states[i] === 'fail' && (
                <div className="mt-0.5 flex flex-col items-start gap-2">
                  <span className="text-[12.5px] text-bad">{item.fail}</span>
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
          <span className="text-[12.5px] text-ink-3">Mẹo: đổi "Trạng thái giả lập" về "Bình thường" rồi kiểm tra lại.</span>
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

function Profile() {
  const { settings, updateSettings } = useStore()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Giới thiệu về bạn</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Viết tự do về bạn, dự án và cách bạn muốn Claude viết tiếng Nhật. Có thể sửa lại bất cứ lúc nào trong Cài đặt.
        </p>
      </div>
      <ProfilePromptEditor rows={6} value={settings.profilePrompt} onChange={(v) => updateSettings({ profilePrompt: v })} />
      <Field label="Mức kính ngữ mặc định khi viết cho khách">
        <div>
          <Segmented
            label="Mức kính ngữ mặc định"
            value={settings.defaultKeigo}
            onChange={(k) => updateSettings({ defaultKeigo: k })}
            options={(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabels[k] }))}
          />
        </div>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}

function TryIt() {
  const { settings } = useStore()
  const [request, setRequest] = useState<PopupRequest | null>(null)

  const open = useCallback(() => {
    const sel = window.getSelection()?.toString().trim()
    setRequest({
      id: Date.now(),
      direction: 'ja_vi',
      source: sel || sampleJa,
      origin: 'onboarding',
      conversationId: 'c-devqa',
      app: 'slack',
      anchor: { x: 0, y: 0 },
      placement: 'below',
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (combo === settings.hotkeys.jaVi || combo === settings.hotkeys.auto) {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, settings.hotkeys])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Thử ngay</h2>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[13.5px] text-ink-2">
          Bôi đen câu dưới đây rồi nhấn <Hotkey combo={settings.hotkeys.jaVi} />.
        </p>
      </div>
      <p lang="ja" className="rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed selection:bg-[#b4d5fe] dark:selection:bg-[#3b5a8c]">
        {sampleJa}
      </p>
      {request ? (
        <Popup key={request.id} request={request} onClose={() => setRequest(null)} />
      ) : (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <Keyboard size={15} /> Popup dịch sẽ hiện ở đây.
        </div>
      )}
    </div>
  )
}
