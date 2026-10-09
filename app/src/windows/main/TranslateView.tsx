import { AlertTriangle, BookMarked, Brain, Clock, Copy, Gauge, Languages, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../components/styles'
import { Button, Kbd, Segmented } from '../../components/ui'
import { keigoLabels } from '../../data/mock'
import { emptySections, isTauri, startTranslation, type ErrorKind, type RateLimit, type Sections, type Timing } from '../../lib/claude'
import { isJapanese } from '../../lib/mockEngine'
import { useStore } from '../../store'
import type { Keigo } from '../../types'

const errorText: Record<ErrorKind, string> = {
  not_installed: 'Không tìm thấy Claude Code. Cài Claude Code rồi thử lại.',
  not_logged_in: 'Claude Code chưa đăng nhập. Mở terminal, chạy "claude" để đăng nhập.',
  rate_limited: 'Đã hết hạn mức gói Claude, hãy thử lại sau.',
  cancelled: 'Đã hủy.',
  timeout: 'Claude không trả lời kịp, hãy thử lại.',
  cli: 'Claude Code báo lỗi.',
}

type Phase = 'idle' | 'waiting' | 'thinking' | 'streaming' | 'done' | 'error'

interface Run {
  phase: Phase
  sections: Sections
  timing: Timing | null
  rateLimit: RateLimit | null
  error: { kind: ErrorKind; message: string } | null
  warm: boolean | null
}

const emptyRun: Run = {
  phase: 'idle',
  sections: emptySections,
  timing: null,
  rateLimit: null,
  error: null,
  warm: null,
}

/**
 * Paste-and-translate screen. Also where translation speed is checked in the real app:
 * every result shows time to first character, total time, and whether a warm process and thinking were involved.
 */
export function TranslateView() {
  const { settings, showToast } = useStore()
  const [text, setText] = useState('')
  const [keigo, setKeigo] = useState<Keigo>(settings.defaultKeigo)
  const [run, setRun] = useState<Run>(emptyRun)
  const [history, setHistory] = useState<Timing[]>([])
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef<(() => void) | null>(null)
  const startedAt = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const busy = run.phase === 'waiting' || run.phase === 'thinking' || run.phase === 'streaming'
  const toJapanese = !isJapanese(text)

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setElapsed(performance.now() - startedAt.current), 100)
    return () => window.clearInterval(t)
  }, [busy])

  const go = async () => {
    const source = text.trim()
    if (!source || busy) return
    startedAt.current = performance.now()
    setElapsed(0)
    setRun({ ...emptyRun, phase: 'waiting' })
    cancelRef.current = await startTranslation(
      { direction: toJapanese ? 'vi_ja' : 'ja_vi', text: source, keigo, profile: settings.profilePrompt },
      (e) => {
        if (e.type === 'started') setRun((r) => ({ ...r, warm: e.warm }))
        if (e.type === 'thinking') setRun((r) => ({ ...r, phase: 'thinking' }))
        if (e.type === 'delta') setRun((r) => ({ ...r, phase: 'streaming', sections: e.sections }))
        if (e.type === 'done') {
          setRun((r) => ({ ...r, phase: 'done', sections: e.sections, timing: e.timing, rateLimit: e.rateLimit }))
          setHistory((h) => [e.timing, ...h].slice(0, 20))
          cancelRef.current = null
        }
        if (e.type === 'error') {
          setRun((r) => ({ ...r, phase: 'error', error: { kind: e.kind, message: e.message } }))
          cancelRef.current = null
        }
      },
    )
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showToast('Đã sao chép bản dịch')
    } catch {
      showToast('Không sao chép được')
    }
  }

  const medianFirst = median(history.map((h) => h.firstTokenMs).filter((v): v is number => v !== null))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Dịch</h2>
        {!isTauri && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-semibold text-warn">Dữ liệu giả lập</span>}
        <div className="flex-1" />
        {history.length > 0 && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2" title="Trung vị thời gian đến chữ đầu tiên của các lần dịch trong phiên này">
            <Gauge size={14} /> {history.length} lần · chữ đầu tiên trung vị {fmt(medianFirst)}
          </span>
        )}
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div className="rounded-lg border border-line bg-surface focus-within:border-accent">
          <textarea
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault()
                void go()
              }
              if (e.key === 'Escape' && busy) cancelRef.current?.()
            }}
            rows={4}
            placeholder="Dán tin nhắn tiếng Nhật hoặc gõ tiếng Việt..."
            className="block w-full resize-y rounded-t-lg bg-transparent px-3.5 pt-3 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <div className="flex items-center gap-3 px-3 pb-2.5">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-3">
              <Languages size={14} /> {text.trim() ? (toJapanese ? 'VI → JA' : 'JA → VI') : 'Tự nhận diện'}
            </span>
            {toJapanese && text.trim() && (
              <Segmented
                label="Mức kính ngữ"
                value={keigo}
                onChange={setKeigo}
                options={(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabels[k] }))}
              />
            )}
            <div className="flex-1" />
            {busy ? (
              <Button size="sm" onClick={() => cancelRef.current?.()}>
                Hủy <Kbd>Esc</Kbd>
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => void go()}>
                Dịch <Kbd className="h-4 border-transparent bg-white/25 text-on-accent">Ctrl+Enter</Kbd>
              </Button>
            )}
          </div>
        </div>

        {run.phase !== 'idle' && (
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12.5px] text-ink-2">
              <PhaseLabel phase={run.phase} elapsed={elapsed} />
              <div className="flex-1" />
              {run.timing && <TimingBadges timing={run.timing} />}
            </div>

            {run.phase === 'error' && run.error ? (
              <div className="flex gap-2.5 px-4 py-3 text-[13px]">
                <AlertTriangle size={16} className="mt-px shrink-0 text-bad" />
                <div>
                  <div className="font-semibold text-ink">{errorText[run.error.kind]}</div>
                  {run.error.kind === 'cli' && <div className="mt-0.5 font-mono text-[12px] break-all text-ink-3">{run.error.message}</div>}
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 py-3">
                  {run.sections.translation ? (
                    <p lang={toJapanese ? 'ja' : 'vi'} className={cx('text-[15px] leading-relaxed whitespace-pre-wrap', run.phase === 'streaming' && 'stream-caret')}>
                      {run.sections.translation}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2 py-1">
                      <div className="skeleton h-3.5 w-[85%]" />
                      <div className="skeleton h-3.5 w-[60%]" />
                    </div>
                  )}
                </div>
                {run.sections.backTranslation && (
                  <div className="border-t border-line bg-subtle px-4 py-3">
                    <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Ý nghĩa khi đọc lại</div>
                    <p lang="vi" className="text-[13.5px] leading-relaxed text-ink-2">
                      {run.sections.backTranslation}
                    </p>
                  </div>
                )}
                {run.sections.notes && (
                  <div className="flex gap-2 border-t border-line px-4 py-3 text-[12.5px] leading-snug whitespace-pre-wrap text-ink-2">
                    <BookMarked size={14} className="mt-px shrink-0 text-accent" />
                    {run.sections.notes}
                  </div>
                )}
                {run.phase === 'done' && (
                  <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                    {run.rateLimit?.utilization != null && <QuotaNote rate={run.rateLimit} />}
                    <div className="flex-1" />
                    <Button size="sm" onClick={() => void copy(run.sections.translation)}>
                      <Copy size={14} /> Sao chép
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {history.length > 1 && (
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-4 py-2 text-[12.5px] font-semibold text-ink-2">Các lần dịch trong phiên này</div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="py-1.5 pl-4 font-medium">#</th>
                  <th className="py-1.5 font-medium">Chữ đầu tiên</th>
                  <th className="py-1.5 font-medium">Hoàn tất</th>
                  <th className="py-1.5 font-medium">Tiến trình</th>
                  <th className="py-1.5 pr-4 font-medium">Suy nghĩ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-line tabular-nums">
                    <td className="py-1.5 pl-4 text-ink-3">{history.length - i}</td>
                    <td className={cx('py-1.5', h.firstTokenMs !== null && h.firstTokenMs > 3000 ? 'font-semibold text-warn' : 'text-ink')}>
                      {fmt(h.firstTokenMs)}
                    </td>
                    <td className="py-1.5 text-ink">{fmt(h.totalMs)}</td>
                    <td className="py-1.5 text-ink-2">{h.warm ? 'Chạy sẵn' : 'Khởi động mới'}</td>
                    <td className="py-1.5 pr-4 text-ink-2">{h.thought ? 'Có' : 'Không'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function PhaseLabel({ phase, elapsed }: { phase: Phase; elapsed: number }) {
  const label: Record<Phase, string> = {
    idle: '',
    waiting: 'Đang gửi tới Claude',
    thinking: 'Claude đang suy nghĩ',
    streaming: 'Đang dịch',
    done: 'Hoàn tất',
    error: 'Lỗi',
  }
  const live = phase === 'waiting' || phase === 'thinking' || phase === 'streaming'
  return (
    <span className="flex items-center gap-1.5">
      {phase === 'thinking' ? <Brain size={14} className="text-warn" /> : <Clock size={14} />}
      {label[phase]}
      {live && <span className="text-ink-3 tabular-nums">{fmt(elapsed)}</span>}
    </span>
  )
}

function TimingBadges({ timing }: { timing: Timing }) {
  const slow = timing.firstTokenMs !== null && timing.firstTokenMs > 3000
  return (
    <span className="flex items-center gap-2 tabular-nums">
      <span className={cx('flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', slow ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good')}>
        <Zap size={12} /> chữ đầu {fmt(timing.firstTokenMs)}
      </span>
      <span>xong {fmt(timing.totalMs)}</span>
      <span className="text-ink-3">· {timing.warm ? 'chạy sẵn' : 'khởi động mới'}</span>
      {timing.thought && <span className="text-warn">· có suy nghĩ</span>}
      <span className="text-ink-3">· {timing.model}</span>
    </span>
  )
}

function QuotaNote({ rate }: { rate: RateLimit }) {
  const used = Math.round((rate.utilization ?? 0) * 100)
  const period = rate.limitType === 'seven_day' ? 'tuần' : rate.limitType === 'five_hour' ? '5 giờ' : 'kỳ'
  const reset = rate.resetsAt ? new Date(rate.resetsAt * 1000).toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <span className={cx('text-[12px]', used >= 80 ? 'text-warn' : 'text-ink-3')}>
      Đã dùng {used}% hạn mức {period}
      {reset && `, làm mới ${reset}`}
    </span>
  )
}

function fmt(ms: number | null | undefined) {
  return ms == null ? '-' : `${(ms / 1000).toFixed(1).replace('.', ',')} giây`
}

function median(xs: number[]) {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
