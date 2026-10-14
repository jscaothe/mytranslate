import { listen } from '@tauri-apps/api/event'
import { ArrowRight, Loader2, PenLine, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Hotkey, Segmented } from '../../components/ui'
import { cx } from '../../components/styles'
import { isTauri } from '../../lib/claude'
import { locale, otherLang, useLang, useT, type Lang } from '../../lib/i18n'
import { issueLabel } from '../../lib/review'
import { ago, writingAdviceGet, writingAdviceMake, writingStats, type LangStats, type WritingAdvice, type WritingStats } from '../../lib/writing'
import { useStore } from '../../store'
import type { IssueKind } from '../../types'

type Period = '30' | '90' | 'all'

interface AdviceState {
  state: 'idle' | 'loading' | 'error'
  value: WritingAdvice | null
  error?: string
}

/**
 * What the checks of the user's own sentences found, per language: how often a sentence needed fixing, the kinds
 * of mistakes, the ones that keep coming back, and the AI's advice on what to work on.
 */
export function WritingView() {
  const { settings, showToast } = useStore()
  const t = useT()
  const lang = useLang()
  const [period, setPeriod] = useState<Period>('90')
  const [stats, setStats] = useState<WritingStats | null>(null)
  // The language the user writes to the other side, until they pick one or only the other has checks.
  const [target, setTarget] = useState<Lang | null>(null)
  const [advice, setAdvice] = useState<AdviceState & { lang: Lang | null }>({ lang: null, state: 'idle', value: null })

  const days = period === 'all' ? null : Number(period)
  const load = useCallback(() => {
    writingStats(days, lang)
      .then(setStats)
      .catch((e) => showToast(`${t('Không đọc được thống kê', '統計を読み込めません')}: ${String(e)}`))
  }, [days, lang, showToast, t])

  useEffect(load, [load])

  useEffect(() => {
    if (!isTauri) return
    const off = listen('history:changed', load)
    return () => void off.then((f) => f())
  }, [load])

  const shown: Lang =
    target ??
    (() => {
      const preferred = otherLang(lang)
      const count = (l: Lang) => stats?.languages.find((s) => s.lang === l)?.reviews ?? 0
      return count(preferred) === 0 && count(lang) > 0 ? lang : preferred
    })()
  const current = stats?.languages.find((s) => s.lang === shown) ?? null

  // Read again with the stats, which change when a new check is filed: the advice may have become stale.
  useEffect(() => {
    let alive = true
    writingAdviceGet(shown)
      .then((value) => alive && setAdvice((a) => (a.lang === shown && a.state === 'loading' ? a : { lang: shown, state: 'idle', value })))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [shown, stats])
  const shownAdvice: AdviceState = advice.lang === shown ? advice : { state: 'idle', value: null }

  const analyze = () => {
    const target = shown
    setAdvice((a) => ({ ...(a.lang === target ? a : { value: null }), lang: target, state: 'loading', error: undefined }))
    writingAdviceMake(target, lang)
      .then((value) => setAdvice({ lang: target, state: 'idle', value }))
      .catch((e) => setAdvice((a) => ({ ...a, lang: target, state: 'error', error: String(e) })))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line">
        {/* As wide as the page below, so the period sits over the right edge of the cards on a wide screen too. */}
        <div className="flex max-w-[960px] items-center gap-3 px-8 py-3">
          <h2 className="text-[15px] font-semibold">{t('Kỹ năng viết', '文章力')}</h2>
          <Segmented
            label={t('Ngôn ngữ của câu', '文の言語')}
            value={shown}
            onChange={setTarget}
            options={[
              { value: 'ja', label: t('Tiếng Nhật', '日本語') },
              { value: 'vi', label: t('Tiếng Việt', 'ベトナム語') },
            ]}
          />
          <div className="flex-1" />
          <Segmented
            label={t('Khoảng thời gian', '期間')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: '30', label: t('30 ngày', '30日') },
              { value: '90', label: t('90 ngày', '90日') },
              { value: 'all', label: t('Tất cả', 'すべて') },
            ]}
          />
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {current && current.reviews === 0 ? (
          <Empty hotkey={settings.hotkeys.review} textLang={shown} />
        ) : current ? (
          <div className="flex max-w-[960px] flex-col gap-5 px-8 py-5">
            <Summary stats={current} />
            <Card title={t('Lỗi theo loại', '誤りの種類')}>
              <KindBars kinds={current.kinds} textLang={shown} />
            </Card>
            <AdviceCard advice={shownAdvice} canAnalyze={current.kinds.length > 0} onAnalyze={analyze} />
            {current.repeated.length > 0 && (
              <Card
                title={t('Lỗi lặp lại', '繰り返している誤り')}
                hint={t('Cùng một chỗ sai gặp từ hai lần trở lên.', '同じ誤りが2回以上ありました。')}
              >
                <ul className="divide-y divide-line">
                  {current.repeated.map((r) => (
                    <li key={`${r.kind}|${r.wrong}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <KindChip kind={r.kind} textLang={shown} />
                      <Fix wrong={r.wrong} fix={r.fix} textLang={shown} />
                      <div className="flex-1" />
                      <span
                        className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-semibold text-warn tabular-nums"
                        title={t(`${r.count} lần`, `${r.count} 回`)}
                      >
                        {t(`${r.count} lần`, `${r.count} 回`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {current.recent.length > 0 && (
              <Card title={t('Gần đây', '最近の指摘')}>
                <ul className="divide-y divide-line">
                  {current.recent.map((r, i) => (
                    <li key={`${r.createdAt}-${i}`} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                      <KindChip kind={r.kind} textLang={shown} />
                      <div className="min-w-0 flex-1">
                        {(r.wrong || r.fix) && <Fix wrong={r.wrong} fix={r.fix} textLang={shown} />}
                        {r.explanation && <p className={cx('leading-snug text-ink-2', (r.wrong || r.fix) && 'mt-0.5')}>{r.explanation}</p>}
                      </div>
                      <span className="shrink-0 text-[12px] whitespace-nowrap text-ink-3" title={new Date(r.createdAt).toLocaleString(locale(lang))}>
                        {ago(r.createdAt, lang)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Summary({ stats }: { stats: LangStats }) {
  const t = useT()
  const lang = useLang()
  const issues = stats.kinds.reduce((n, k) => n + k.count, 0)
  const pct = stats.reviews > 0 ? Math.round((stats.clean / stats.reviews) * 100) : 0
  const n = (v: number) => v.toLocaleString(locale(lang))
  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile label={t('Câu đã kiểm tra', 'チェックした文')} value={n(stats.reviews)} />
      <Tile label={t('Không cần sửa', '修正不要')} value={`${pct}%`} detail={t(`${n(stats.clean)} / ${n(stats.reviews)} câu`, `${n(stats.reviews)} 文中 ${n(stats.clean)} 文`)} />
      <Tile label={t('Lỗi đã ghi nhận', '記録された誤り')} value={n(issues)} />
    </div>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[22px] leading-none font-semibold text-ink tabular-nums">{value}</span>
        {detail && <span className="text-[12px] text-ink-3 tabular-nums">{detail}</span>}
      </div>
    </div>
  )
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-2.5 rounded-lg border border-line bg-surface">{children}</div>
    </section>
  )
}

function KindBars({ kinds, textLang }: { kinds: LangStats['kinds']; textLang: Lang }) {
  const t = useT()
  const lang = useLang()
  if (kinds.length === 0) {
    return <p className="px-4 py-3 text-[13px] text-ink-3">{t('Chưa có lỗi nào trong khoảng thời gian này.', 'この期間に誤りはありません。')}</p>
  }
  const max = Math.max(...kinds.map((k) => k.count))
  return (
    <ul className="flex flex-col gap-2 px-4 py-3" aria-label={t('Lỗi theo loại', '誤りの種類')}>
      {kinds.map((k) => (
        <li key={k.kind} className="flex items-center gap-3 text-[13px]">
          <span className="w-20 shrink-0 text-ink-2">{issueLabel(k.kind, textLang, lang)}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(k.count / max) * 100}%` }} />
          </span>
          <span className="w-8 shrink-0 text-right font-medium text-ink tabular-nums">{k.count.toLocaleString(locale(lang))}</span>
        </li>
      ))}
    </ul>
  )
}

/** The kind of a mistake, in a column of its own so the mistakes of every row start at the same place. */
function KindChip({ kind, textLang }: { kind: IssueKind; textLang: Lang }) {
  const lang = useLang()
  return (
    <span className="w-[72px] shrink-0">
      <span className="inline-block rounded bg-subtle px-1.5 py-px text-[11.5px] font-semibold whitespace-nowrap text-ink-2">
        {issueLabel(kind, textLang, lang)}
      </span>
    </span>
  )
}

/** The wrong words struck through, then what to write instead. */
function Fix({ wrong, fix, textLang }: { wrong: string; fix: string; textLang: Lang }) {
  const t = useT()
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      {wrong && (
        <span lang={textLang} className="text-bad line-through decoration-bad/70">
          {wrong}
        </span>
      )}
      {wrong && fix && <ArrowRight size={12} className="shrink-0 text-ink-3" aria-label={t('sửa thành', '修正後')} />}
      {fix && (
        <span lang={textLang} className="rounded-sm bg-good-soft px-0.5 text-good">
          {fix}
        </span>
      )}
    </span>
  )
}

function AdviceCard({
  advice,
  canAnalyze,
  onAnalyze,
}: {
  advice: AdviceState
  canAnalyze: boolean
  onAnalyze: () => void
}) {
  const t = useT()
  const lang = useLang()
  const loading = advice.state === 'loading'
  const value = advice.value
  const button = (
    <Button size="sm" variant={value && !value.stale ? 'secondary' : 'primary'} disabled={loading || !canAnalyze} onClick={onAnalyze}>
      {loading ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> : value ? <RefreshCw size={13} /> : <Sparkles size={13} />}
      {value ? t('Làm mới', '更新') : t('Phân tích lỗi của tôi', '自分の誤りを分析')}
    </Button>
  )
  return (
    <Card
      title={t('Lời khuyên từ AI', 'AIからのアドバイス')}
      hint={
        value
          ? value.stale
            ? t('Có lỗi mới từ lần phân tích trước, bấm Làm mới để cập nhật.', '前回の分析の後に新しい誤りがあります。「更新」で反映できます。')
            : t(`Phân tích ${ago(value.createdAt, lang)}. Mỗi lần phân tích dùng một lượt AI.`, `分析: ${ago(value.createdAt, lang)}。分析ごとに AI を1回使います。`)
          : t('AI đọc các lỗi đã ghi nhận và chỉ ra điều nên lưu ý. Mỗi lần phân tích dùng một lượt AI.', '記録された誤りを AI が読み、気をつける点をまとめます。分析ごとに AI を1回使います。')
      }
      action={button}
    >
      {loading && !value ? (
        <div role="status" className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-2">
          <Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" /> {t('Đang phân tích…', '分析中…')}
        </div>
      ) : value && value.items.length > 0 ? (
        <ol className={cx('divide-y divide-line', loading && 'opacity-60')}>
          {value.items.map((item, i) => (
            <li key={`${i}-${item.title}`} className="flex gap-3 px-4 py-3">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                <div className="font-semibold text-ink">{item.title}</div>
                <p className="mt-0.5 text-ink-2">{item.advice}</p>
                {item.example && <p className="mt-1.5 rounded-md bg-subtle px-2.5 py-1.5 text-[12.5px] text-ink">{item.example}</p>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-3 text-[13px] text-ink-3">
          {canAnalyze
            ? t('Chưa có phân tích nào cho ngôn ngữ này.', 'この言語の分析はまだありません。')
            : t('Cần có lỗi được ghi nhận để AI phân tích.', '分析には記録された誤りが必要です。')}
        </p>
      )}
      {advice.state === 'error' && (
        <p role="alert" className="border-t border-line px-4 py-2 text-[12.5px] text-bad" title={advice.error}>
          {t('Không phân tích được', '分析できませんでした')}: {advice.error}
        </p>
      )}
    </Card>
  )
}

function Empty({ hotkey, textLang }: { hotkey: string; textLang: Lang }) {
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <PenLine size={28} className="text-ink-3" />
      <p className="text-[14px] font-semibold text-ink">
        {textLang === 'ja' ? t('Chưa kiểm tra câu tiếng Nhật nào', '日本語の文はまだチェックしていません') : t('Chưa kiểm tra câu tiếng Việt nào', 'ベトナム語の文はまだチェックしていません')}
      </p>
      <p className="max-w-[420px] text-[13px] leading-relaxed text-ink-2">
        {t('Bôi đen câu bạn vừa viết rồi nhấn', '書いた文を選択して')} <Hotkey combo={hotkey} />{' '}
        {t(
          'để kiểm tra. App ghi lại các lỗi để tổng hợp ở đây, và giữ chúng như lịch sử dịch (Cài đặt > Giữ lịch sử).',
          'を押すとチェックできます。誤りはここに集計され、翻訳履歴と同じ期間保存されます（設定 > 履歴の保存期間）。',
        )}
      </p>
    </div>
  )
}
