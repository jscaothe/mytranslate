import { MousePointer2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { QuickActionBar } from '../../components/QuickActionBar'
import { cx } from '../../components/styles'
import { otherLang, useLang, type Lang } from '../../lib/i18n'
import { useStore } from '../../store'

/** The other side's message and its translation, as each user sees them. */
const sample: Record<Lang, { author: string; message: string; translation: string; direction: string; captions: string[] }> = {
  vi: {
    author: 'Tanaka',
    message: '明日の打ち合わせは15時からでよろしいでしょうか。',
    translation: 'Cuộc họp ngày mai bắt đầu từ 15 giờ có được không ạ?',
    direction: 'Nhật → Việt',
    captions: ['Bôi đen tin nhắn', 'Bấm Dịch', 'Đọc bản dịch'],
  },
  ja: {
    author: 'Nguyễn',
    message: 'Cuộc họp ngày mai bắt đầu từ 15 giờ được không anh?',
    translation: '明日の打ち合わせは15時からでよろしいでしょうか。',
    direction: 'ベトナム語 → 日本語',
    captions: ['メッセージを選択', '「翻訳」をクリック', '訳を読む'],
  },
}

/** idle, selecting, toolbar shown, popup shown. */
type Phase = 0 | 1 | 2 | 3
const durations: Record<Phase, number> = { 0: 900, 1: 1200, 2: 1400, 3: 3200 }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A looping picture of the one thing a new user needs to know: select a message, press Dịch, read the result.
 * Decorative: screen readers get the sentence next to it, and nothing in it can be focused or clicked.
 */
export function HowItWorksDemo() {
  const { settings } = useStore()
  const lang = useLang()
  const { author, message, translation, direction, captions } = sample[lang]
  const [still] = useState(reducedMotion)
  const [phase, setPhase] = useState<Phase>(still ? 3 : 0)

  useEffect(() => {
    if (still) return
    const t = window.setTimeout(() => setPhase((p) => ((p + 1) % 4) as Phase), durations[phase])
    return () => window.clearTimeout(t)
  }, [phase, still])

  const step = phase <= 1 ? 0 : phase === 2 ? 1 : 2
  // Where the pointer rests: end of the message while selecting, on the Dịch button, then out of the way.
  const pointer = phase === 0 ? { left: 60, top: 70 } : phase === 1 ? { left: 372, top: 70 } : phase === 2 ? { left: 92, top: 112 } : { left: 424, top: 176 }

  return (
    <div className="flex flex-col items-center gap-3">
      <div aria-hidden inert className="relative h-[196px] w-[460px] overflow-hidden rounded-lg border border-line bg-surface text-left shadow-sm">
        <div className="flex h-8 items-center gap-1.5 border-b border-line px-3 text-[12px] text-ink-3">
          <AppBadge app="slack" className="size-3.5 text-[8px]" /> # customerx-dev
        </div>
        <div className="flex gap-2.5 px-3 pt-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[12px] font-semibold text-accent">
            {author.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-ink">
              {author} <span className="font-normal text-ink-3">10:24</span>
            </div>
            <p lang={otherLang(lang)} className="text-[13.5px] leading-relaxed text-ink">
              <span
                className={cx(
                  'bg-[linear-gradient(#b4d5fe,#b4d5fe)] bg-no-repeat dark:bg-[linear-gradient(#3b5a8c,#3b5a8c)]',
                  phase === 0 ? 'bg-size-[0%_100%]' : 'bg-size-[100%_100%]',
                  phase === 1 && 'transition-[background-size] duration-1000 ease-linear',
                )}
              >
                {message}
              </span>
            </p>
          </div>
        </div>

        {phase === 2 && (
          <QuickActionBar
            items={settings.quickActions.items}
            display={settings.quickActions.display}
            onAction={() => undefined}
            className="absolute top-[96px] left-[48px]"
          />
        )}

        {phase === 3 && (
          <div className="anim-popup absolute top-[96px] left-[48px] w-[360px] rounded-lg border border-line bg-window shadow-popup">
            <div className="border-b border-line px-3 py-1.5 text-[11.5px] font-medium text-ink-3">{direction}</div>
            <p lang={lang} className="px-3 py-2.5 text-[13.5px] leading-relaxed text-ink">
              {translation}
            </p>
          </div>
        )}

        {!still && (
          <MousePointer2
            size={18}
            className="absolute fill-window text-ink transition-[left,top] duration-700 ease-out"
            style={{ left: pointer.left, top: pointer.top }}
          />
        )}
      </div>

      <ol aria-hidden className="flex gap-5 text-[12.5px]">
        {captions.map((c, i) => (
          <li key={c} className={cx('flex items-center gap-1.5 transition-colors', i === step ? 'font-semibold text-ink' : 'text-ink-3')}>
            <span
              className={cx(
                'flex size-[18px] items-center justify-center rounded-full text-[11px] font-semibold',
                i === step ? 'bg-accent text-on-accent' : 'bg-subtle text-ink-3',
              )}
            >
              {i + 1}
            </span>
            {c}
          </li>
        ))}
      </ol>
    </div>
  )
}
