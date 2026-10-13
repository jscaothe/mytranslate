import { Check, ChevronLeft, CircleAlert, ExternalLink, Keyboard, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { AppMark, Button, Hotkey, Segmented, WindowFrame } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { invoke } from '@tauri-apps/api/core'
import { API_PROVIDERS, KEY_HELP, RECOMMENDED_MODELS, testFailure, vendorName, type TestResult } from '../../lib/ai'
import { ACCOUNT_TOOL, accountStatus, type Account } from '../../lib/accounts'
import { isTauri } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { otherLang, readDirection, useLang, useT, type Lang, type T } from '../../lib/i18n'
import { useStore, type AiProvider, type ApiProvider, type QuickActionId } from '../../store'
import { AiMark } from '../popup/AiSwitcher'
import { Popup } from '../popup/Popup'
import { AccountCheck } from '../../components/AccountCheck'
import type { PopupRequest } from '../popup/types'
import { HowItWorksDemo } from './HowItWorksDemo'

/** A message from the other side, for the user to select and translate. */
const sampleMessage: Record<Lang, string> = {
  vi: 'お世話になっております。明日の打ち合わせの資料を共有いたします。',
  ja: 'Em gửi anh tài liệu cho buổi họp ngày mai ạ. Anh xem trước giúp em nhé.',
}

/** First-run guide. In the real app (`chromeless`) it fills the main window; in the prototype it sits on the fake desktop. */
export function Onboarding({ chromeless = false }: { chromeless?: boolean }) {
  const { setScreen, updateSettings } = useStore()
  const t = useT()
  const steps = [t('Chào mừng', 'ようこそ'), t('Kết nối AI', 'AIに接続'), t('Thử ngay', '試してみる')]
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
            {step > 0 && <Button onClick={() => setStep(step - 1)}>{t('Quay lại', '戻る')}</Button>}
            <div className="flex-1" />
            {step < steps.length - 1 ? (
              <Button variant="primary" disabled={step === 1 && !aiReady} onClick={() => setStep(step + 1)}>
                {t('Tiếp tục', '次へ')}
              </Button>
            ) : (
              <Button variant="primary" onClick={finish}>
                {t('Hoàn tất, thu nhỏ về khay', '完了してトレイに最小化')}
              </Button>
            )}
          </div>
        </div>
    </>
  )

  if (chromeless) return <div className="flex h-full flex-col bg-window">{content}</div>
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <WindowFrame
        title={t('Chào mừng đến với MyTranslate', 'MyTranslate へようこそ')}
        icon={<AppMark size={16} />}
        onClose={() => setScreen('playground')}
        className="h-[560px] w-[680px]"
      >
        {content}
      </WindowFrame>
    </div>
  )
}

function Welcome() {
  const { settings, updateSettings } = useStore()
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      {/* The language is guessed from Windows; both names stay readable so anyone can switch. */}
      <Segmented
        label="Ngôn ngữ / 言語"
        value={settings.language}
        onChange={(language) => updateSettings({ language })}
        options={[
          { value: 'vi', label: 'Tiếng Việt' },
          { value: 'ja', label: '日本語' },
        ]}
      />
      <div>
        <h1 className="text-[22px] font-semibold">{t('Dịch Nhật - Việt ngay trong ô chat', 'チャット欄で、そのまま日越翻訳')}</h1>
        <p className="mt-1.5 text-[14px] text-ink-2">
          {t('Bôi đen tin nhắn trong Teams hoặc Slack, rồi bấm Dịch. Chỉ vậy thôi.', 'Teams や Slack でメッセージを選択して「翻訳」をクリックするだけです。')}
        </p>
      </div>
      <HowItWorksDemo />
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        {settings.language === 'ja' ? (
          <>
            慣れてきたら、ボタンの代わりに <Hotkey combo={settings.hotkeys.auto} /> を押しても翻訳できます。
          </>
        ) : (
          <>
            Quen tay rồi thì nhấn <Hotkey combo={settings.hotkeys.auto} /> thay cho bấm nút.
          </>
        )}
      </p>
    </div>
  )
}

/** The setup pages the Rust side agrees to open. */
type HelpPage = 'claude_code' | `${ApiProvider}_keys`

function openHelp(page: HelpPage, showToast: (m: string) => void, t: T) {
  if (!isTauri) {
    return showToast(
      page === 'claude_code'
        ? t('Mô phỏng: mở trang cài Claude Code trong trình duyệt', 'シミュレーション: Claude Code のインストール手順をブラウザで開く')
        : t('Mô phỏng: mở trang tạo API key trong trình duyệt', 'シミュレーション: APIキーの作成ページをブラウザで開く'),
    )
  }
  void invoke('open_help_page', { page }).catch((e) => showToast(`${t('Không mở được trình duyệt', 'ブラウザを開けません')}: ${String(e)}`))
}

/** Where step 2 is: the three ways side by side, one account path, or the API keys under "Advanced". */
type Route = 'choose' | Account | 'apikey'

/** What this PC already has, for the "Ready on this PC" badge; `null` while looking. */
type Detected = Record<Account, boolean> | null

/**
 * Step 2. The ways to use an AI are shown side by side in a fixed order: the user's Claude account, their ChatGPT
 * account, or MyTranslate's own AI for those without one; API keys are under "Advanced". What this PC already has
 * only earns a badge, the user still picks.
 */
function ConnectAi({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scenario } = useStore()
  const t = useT()
  const [route, setRoute] = useState<Route>('choose')
  const [detected, setDetected] = useState<Detected>(null)

  useEffect(() => {
    let alive = true
    const ready = (a: Account) =>
      accountStatus(a, scenario)
        .then((s) => s.installed && s.loggedIn === true)
        .catch(() => false)
    void Promise.all([ready('claude'), ready('codex')]).then(([claude, codex]) => alive && setDetected({ claude, codex }))
    return () => {
      alive = false
    }
  }, [scenario])

  const go = (r: Route) => {
    onReady(false)
    setRoute(r)
  }
  const back = (
    <button type="button" onClick={() => go('choose')} className="flex items-center gap-1 self-start text-[13px] text-accent hover:underline">
      <ChevronLeft size={15} /> {t('Chọn cách khác', '別の方法を選ぶ')}
    </button>
  )

  if (route === 'claude' || route === 'codex') {
    const { tool, name, maker } = ACCOUNT_TOOL[route]
    return (
      <div className="flex flex-col gap-4">
        <StepHeading
          title={t(`Dùng tài khoản ${name}`, `${name} アカウントを使う`)}
          detail={t(
            `MyTranslate tự cài ${tool} (công cụ chính hãng của ${maker}) và tự kiểm tra; bạn chỉ cần đăng nhập ${name} khi trang đăng nhập mở ra. Lượt dịch tính vào gói ${name} bạn đang trả; MyTranslate không đọc và không lưu thông tin đăng nhập.`,
            `MyTranslate が ${maker} 公式の ${tool} をインストールして確認します。ログインページが開いたら ${name} にログインするだけです。翻訳はご契約中の ${name} プランの利用枠で行われ、ログイン情報を読み取ったり保存したりはしません。`,
          )}
        />
        <AccountCheck key={route} account={route} onReady={onReady} />
        {route === 'codex' && (
          <p className="flex gap-2 rounded-lg bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-accent">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            {t(
              'Gói ChatGPT miễn phí không dùng được Codex. Nếu chưa có gói trả phí, chọn "Tôi chưa có tài khoản AI".',
              '無料の ChatGPT プランでは Codex を使えません。有料プランがない場合は「AIのアカウントを持っていない」を選んでください。',
            )}
          </p>
        )}
        {back}
      </div>
    )
  }

  if (route === 'apikey') {
    return (
      <div className="flex flex-col gap-4">
        <StepHeading
          title={t('Dùng API key', 'APIキーを使う')}
          detail={t(
            'Dành cho người đã có API key. Tiền tính theo lượng dùng, trả trực tiếp cho hãng AI.',
            'APIキーをお持ちの方向けです。利用量に応じて、AIの提供元に直接お支払いいただきます。',
          )}
        />
        <ApiKeyTabs onReady={onReady} />
        {back}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        title={t('Bạn muốn dịch bằng AI nào?', '翻訳に使うAIを選んでください')}
        detail={t('Chọn cách phù hợp với bạn. Sau này vẫn đổi được trong Cài đặt.', 'ご自身に合う方法を選んでください。あとから設定で変更できます。')}
      />
      <div className="grid grid-cols-2 gap-3">
        <WayCard
          provider="claude"
          title={t('Tài khoản Claude', 'Claude アカウント')}
          detail={t('Dùng gói Pro, Max, Team bạn đang trả, không tốn thêm tiền.', 'ご契約中の Pro、Max、Team プランで。追加料金なし。')}
          badge={detected?.claude ? { kind: 'ready', text: t('Sẵn sàng trên máy này', 'このPCで使えます') } : undefined}
          onClick={() => go('claude')}
        />
        <WayCard
          provider="openai"
          title={t('Tài khoản ChatGPT', 'ChatGPT アカウント')}
          detail={t('Dùng gói Plus, Pro, Business bạn đang trả, không tốn thêm tiền.', 'ご契約中の Plus、Pro、Business プランで。追加料金なし。')}
          badge={detected?.codex ? { kind: 'ready', text: t('Sẵn sàng trên máy này', 'このPCで使えます') } : undefined}
          onClick={() => go('codex')}
        />
        <div className="col-span-2 flex items-center gap-2.5 text-[12px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
          {t('hoặc', 'または')}
        </div>
        <WayCard
          provider="cloud"
          wide
          title={t('Tôi chưa có tài khoản AI', 'AIのアカウントを持っていない')}
          detail={t(
            'Dùng AI của MyTranslate: miễn phí 7 ngày, không cần thẻ; sau đó trả phí hằng tháng.',
            'MyTranslate のAIを使います。7日間無料（カード不要）、その後は月額制です。',
          )}
          badge={{ kind: 'soon', text: t('Sắp có', '近日対応') }}
        />
      </div>
      <button type="button" onClick={() => go('apikey')} className="flex items-center gap-1.5 self-start text-[13px] text-accent hover:underline">
        <KeyRound size={14} /> {t('Nâng cao: tôi có API key (Claude, ChatGPT, Gemini)', '上級者向け: APIキーを持っている（Claude、ChatGPT、Gemini）')}
      </button>
    </div>
  )
}

function StepHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{detail}</p>
    </div>
  )
}

/** One way to use an AI. Without `onClick` it is not available yet and says so in its badge. */
function WayCard({
  provider,
  title,
  detail,
  badge,
  wide = false,
  onClick,
}: {
  provider: AiProvider | 'cloud'
  title: string
  detail: string
  badge?: { kind: 'ready' | 'soon'; text: string }
  wide?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cx(
        'flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 text-left transition-colors',
        wide && 'col-span-2',
        onClick ? 'hover:border-line-strong hover:bg-hover/40' : 'cursor-default',
      )}
    >
      {provider === 'cloud' ? (
        <AppMark size={28} />
      ) : (
        <AiMark provider={provider} className={cx('size-7 rounded-md text-[14px]', !onClick && 'opacity-60')} />
      )}
      <span className="min-w-0">
        <span className={cx('block text-[14.5px] font-semibold', onClick ? 'text-ink' : 'text-ink-2')}>{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{detail}</span>
        {badge && (
          <span
            className={cx(
              'mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold',
              badge.kind === 'ready' ? 'bg-good-soft text-good' : 'bg-subtle text-ink-3',
            )}
          >
            {badge.kind === 'ready' && <Check size={12} strokeWidth={3} />}
            {badge.text}
          </span>
        )}
      </span>
    </button>
  )
}

/** "Advanced": one tab per AI that takes an API key. */
function ApiKeyTabs({ onReady }: { onReady: (ready: boolean) => void }) {
  const t = useT()
  const [provider, setProvider] = useState<ApiProvider>('anthropic')
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('AI dùng API key', 'APIキーで使うAI')} className="flex w-max gap-1 rounded-lg bg-subtle p-[3px]">
        {API_PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={provider === p}
            onClick={() => {
              onReady(false)
              setProvider(p)
            }}
            className={cx(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px]',
              provider === p ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
            )}
          >
            <AiMark provider={p} /> {vendorName(p)}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ApiKeySetup key={provider} provider={provider} onReady={onReady} />
      </div>
    </div>
  )
}

/** An AI used with an API key: save the key, then one short translation proves it works and makes it the AI. */
function ApiKeySetup({ provider, onReady }: { provider: ApiProvider; onReady: (ready: boolean) => void }) {
  const { updateSettings, showToast } = useStore()
  const t = useT()
  const lang = useLang()
  const [hasKey, setHasKey] = useState(false)
  const [draft, setDraft] = useState('')
  const [test, setTest] = useState<{ state: 'idle' | 'running' } | { state: 'done'; result: TestResult }>({ state: 'idle' })
  const name = vendorName(provider)
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
    void invoke<Record<ApiProvider, boolean>>('ai_keys_status').then((k) => {
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
      .catch((e) => showToast(`${t('Không lưu được key', 'キーを保存できません')}: ${String(e)}`))
  }

  const seconds = (ms: number) => (lang === 'ja' ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(1).replace('.', ','))

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
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
            aria-label={t(`API key ${name}`, `${name} の APIキー`)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              hasKey
                ? t('•••••••• (đã lưu, nhập để thay)', '••••••••（保存済み、入力すると置き換え）')
                : t(`Dán API key ${name} (${KEY_HELP[provider].placeholder})`, `${name} の APIキーを貼り付け（${KEY_HELP[provider].placeholder}）`)
            }
            className={cx(inputClass, 'w-full pl-8')}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!draft.trim() || test.state === 'running'}>
          {t('Lưu và dịch thử', '保存してテスト翻訳')}
        </Button>
      </form>
      <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <button
          type="button"
          onClick={() => openHelp(`${provider}_keys`, showToast, t)}
          className="flex items-center gap-1 text-accent hover:underline"
        >
          <ExternalLink size={13} /> {t(`Tạo API key ${name}`, `${name} の APIキーを作成`)}
        </button>
        {test.state === 'running' && (
          <span className="flex items-center gap-1.5 text-ink-2">
            <Loader2 size={14} className="animate-spin" /> {t('Đang dịch thử…', 'テスト翻訳中…')}
          </span>
        )}
        {test.state === 'done' && test.result.ok && (
          <span className="flex items-center gap-1.5 text-good">
            <Check size={14} />{' '}
            {t(
              `Dịch thử thành công, chữ đầu tiên sau ${seconds(test.result.firstTokenMs ?? test.result.totalMs)} giây`,
              `テスト翻訳に成功しました（最初の文字まで ${seconds(test.result.firstTokenMs ?? test.result.totalMs)} 秒）`,
            )}
          </span>
        )}
        {test.state === 'done' && !test.result.ok && (
          <span className="flex min-w-0 items-center gap-1.5 text-bad" title={test.result.error ?? ''}>
            <CircleAlert size={14} className="shrink-0" /> {testFailure(test.result.errorKind, t)}
            <button type="button" onClick={runTest} className="ml-1 text-accent hover:underline">
              {t('Thử lại', '再試行')}
            </button>
          </span>
        )}
      </div>
      {provider === 'gemini' && (
        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
          {t(
            'Gói miễn phí có thể dùng nội dung để huấn luyện AI, không dùng cho tin nhắn của khách.',
            '無料枠では内容がAIの学習に使われる場合があります。業務のメッセージには使わないでください。',
          )}
        </p>
      )}
    </div>
  )
}

/** Only "translate": the sample is the other side's message, so there is nothing of the user's own to check. */
const tryItActions: QuickActionId[] = ['translate']

function TryIt() {
  const { settings } = useStore()
  const t = useT()
  const lang = useLang()
  const sample = sampleMessage[lang]
  const [request, setRequest] = useState<PopupRequest | null>(null)
  const [bar, setBar] = useState<{ text: string; x: number; y: number } | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const sampleRef = useRef<HTMLParagraphElement>(null)

  const open = useCallback((direction: PopupRequest['direction'], text?: string) => {
    setBar(null)
    setRequest({
      id: Date.now(),
      direction,
      source: text || window.getSelection()?.toString().trim() || sample,
      origin: 'onboarding',
      conversation: '#dev-qa',
      app: 'slack',
      anchor: { x: 0, y: 0 },
      placement: 'below',
    })
  }, [sample])

  // In the real app the global hotkey opens the real popup; this covers the prototype, where it is a page key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (combo === settings.hotkeys.auto) {
        e.preventDefault()
        open(readDirection(lang))
      }
      if (e.key === 'Escape') setBar(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, settings.hotkeys, lang])

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
        <h2 className="text-[17px] font-semibold">{t('Thử ngay', '試してみる')}</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {lang === 'ja' ? (
            <>
              下のベトナム語の文をマウスで選択し、表示された小さなツールバーの <span className="font-semibold text-ink">翻訳</span> をクリックしてください。
            </>
          ) : (
            <>
              Dùng chuột bôi đen câu tiếng Nhật dưới đây, rồi bấm <span className="font-semibold text-ink">Dịch</span> trên thanh nhỏ hiện ra.
            </>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
          <Keyboard size={15} /> {t('Hoặc bôi đen rồi nhấn', 'または選択して')} <Hotkey combo={settings.hotkeys.auto} />
          {lang === 'ja' ? ' を押します' : ''}
        </p>
      </div>
      <div ref={areaRef} className="relative" onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-quick-bar]') && setBar(null)}>
        <p
          ref={sampleRef}
          lang={otherLang(lang)}
          onMouseUp={onMouseUp}
          className="cursor-text rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed selection:bg-[#b4d5fe] dark:selection:bg-[#3b5a8c]"
        >
          {sample}
        </p>
        {bar && !request && (
          <QuickActionBar
            items={items}
            display={settings.quickActions.display}
            onAction={() => open(readDirection(lang), bar.text)}
            onDismiss={() => setBar(null)}
            className="absolute z-10"
            style={{ left: bar.x, top: bar.y }}
          />
        )}
      </div>
      {request && (
        <>
          <Popup key={request.id} request={request} onClose={() => setRequest(null)} />
          <p className="text-[12.5px] text-ink-2">
            {t('Trong Teams và Slack cũng làm y như vậy. Bấm Hoàn tất để bắt đầu dùng.', 'Teams や Slack でも同じ操作です。「完了」を押して使い始めましょう。')}
          </p>
        </>
      )}
    </div>
  )
}
