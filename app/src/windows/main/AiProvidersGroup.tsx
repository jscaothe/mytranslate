import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AlertCircle, Check, CheckCircle2, ChevronDown, KeyRound, Loader2, Search, ShieldAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Segmented, Switch } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { AI_NAMES, choiceLabel, defaultChoice, modelName, RECOMMENDED_MODELS } from '../../lib/ai'
import { claudeStatus, isTauri, type ClaudeStatus } from '../../lib/claude'
import { useT } from '../../lib/i18n'
import { useStore, type AiProvider } from '../../store'
import { AiMark } from '../popup/AiSwitcher'

const KEY_HELP = {
  openai: { url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' },
  gemini: { url: 'https://aistudio.google.com/apikey', placeholder: 'AIza...' },
} as const

const PROTOTYPE_MODELS = {
  openai: ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-pro'],
}

interface TestResult {
  ok: boolean
  model: string
  firstTokenMs: number | null
  totalMs: number
  translation: string
  error: string | null
  errorKind: string | null
}

type Keys = { openai: boolean; gemini: boolean }

/**
 * Settings > Kết nối AI. One card per AI, each usable to set up that AI without making it the default: its status,
 * default model and (ChatGPT, Gemini) the API key and the favourite models offered in the quick switcher. Day to day
 * the AI is switched from the popup header (Ctrl+M) or the tray menu; this page is for setting things up.
 */
export function AiProvidersGroup({ group: Group }: { group: GroupComponent; row: RowComponent }) {
  const { settings, updateSettings } = useStore()
  const t = useT()
  const [keys, setKeys] = useState<Keys>({ openai: !isTauri, gemini: false })
  const current = defaultChoice(settings)
  const [expanded, setExpanded] = useState<AiProvider | null>(current.provider)

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const load = () => void invoke<Keys>('ai_keys_status').then((k) => alive && setKeys(k))
    load()
    const off = listen('ai:keys-changed', load)
    return () => {
      alive = false
      void off.then((f) => f())
    }
  }, [])

  const available = (p: AiProvider) => p === 'claude' || keys[p]

  return (
    <Group
      title={t('Kết nối AI', 'AI接続')}
      hint={t(
        'Đổi nhanh AI và model ngay trên popup (bấm tên AI ở đầu popup hoặc Ctrl+M) hay ở menu khay > AI dịch.',
        'AIとモデルはポップアップ（上部のAI名をクリック、または Ctrl+M）やトレイメニュー > 翻訳AI からすぐに切り替えられます。',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] text-ink">{t('Đang dịch bằng', '使用中のAI')}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {t('AI và model dùng cho mọi lần dịch, trừ khi bạn đổi trên popup.', 'ポップアップで変更しない限り、すべての翻訳でこのAIとモデルを使います。')}
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-md border border-line bg-subtle px-2.5 py-1.5 text-[13px] font-medium text-ink">
          <AiMark provider={current.provider} />
          {choiceLabel(current)}
        </span>
      </div>

      {(['claude', 'openai', 'gemini'] as const).map((p) => (
        <ProviderCard
          key={p}
          provider={p}
          ready={available(p)}
          isDefault={current.provider === p}
          open={expanded === p}
          onToggle={() => setExpanded((e) => (e === p ? null : p))}
          onMakeDefault={() => updateSettings({ aiProvider: p })}
        >
          {p === 'claude' ? (
            <ClaudeBody />
          ) : (
            <ApiBody provider={p} hasKey={keys[p]} onKeySaved={(saved) => setKeys((k) => ({ ...k, [p]: saved }))} />
          )}
        </ProviderCard>
      ))}

      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] text-ink">{t('Tự chuyển sang AI khác khi lỗi', 'エラー時に別のAIに切り替える')}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {t(
              'Khi AI đang dùng hết hạn mức, sai key hoặc mất mạng trước khi kịp trả lời, dịch bằng AI khác đã cài đặt (Claude, rồi ChatGPT, rồi Gemini).',
              '使用中のAIが利用枠の上限、キーの誤り、ネットワーク切断で応答できないとき、設定済みの別のAI（Claude、ChatGPT、Gemini の順）で翻訳します。',
            )}
          </div>
        </div>
        <Switch
          label={t('Tự chuyển sang AI khác khi lỗi', 'エラー時に別のAIに切り替える')}
          checked={settings.aiFallback}
          onChange={(v) => updateSettings({ aiFallback: v })}
        />
      </div>
      <div className="flex gap-2.5 px-4 py-3 text-[12px] leading-relaxed text-ink-2">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn" />
        <span>
          {t(
            'Nội dung tin nhắn được gửi tới nhà cung cấp AI đã chọn. Hãy dùng đúng loại tài khoản công ty cho phép. API trả phí của OpenAI và Google mặc định không dùng dữ liệu để huấn luyện; gói miễn phí của Gemini thì có thể dùng, không nên dùng cho tin nhắn của khách.',
            'メッセージの内容は選択したAIの提供元に送信されます。会社が許可する種類のアカウントを使ってください。OpenAI と Google の有料APIは既定でデータを学習に使いませんが、Gemini の無料枠は使う場合があるため、業務のメッセージには使わないでください。',
          )}
        </span>
      </div>
    </Group>
  )
}

type GroupComponent = (props: { title: string; hint?: string; children: ReactNode }) => ReactNode
type RowComponent = (props: { label: string; hint?: string; children: ReactNode }) => ReactNode

function ProviderCard({
  provider,
  ready,
  isDefault,
  open,
  onToggle,
  onMakeDefault,
  children,
}: {
  provider: AiProvider
  ready: boolean
  isDefault: boolean
  open: boolean
  onToggle: () => void
  onMakeDefault: () => void
  children: ReactNode
}) {
  const t = useT()
  const status =
    provider === 'claude'
      ? t('Claude Code trên máy này', 'このPCの Claude Code')
      : ready
        ? t('Đã có API key', 'APIキー設定済み')
        : t('Chưa có API key', 'APIキー未設定')
  return (
    <section aria-label={AI_NAMES[provider]}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 text-left"
        >
          <AiMark provider={provider} className="size-6 text-[12px]" />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold text-ink">{AI_NAMES[provider]}</span>
            <span className={cx('block text-[12px]', ready ? 'text-ink-3' : 'text-warn')}>{status}</span>
          </span>
          <ChevronDown size={15} className={cx('ml-1 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
        </button>
        {isDefault ? (
          <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
            <Check size={13} /> {t('Đang dùng', '使用中')}
          </span>
        ) : (
          <Button size="sm" disabled={!ready} onClick={onMakeDefault} title={ready ? undefined : t('Thêm API key trước', '先にAPIキーを追加してください')}>
            {t(`Dùng ${AI_NAMES[provider]}`, `${AI_NAMES[provider]} を使う`)}
          </Button>
        )}
      </div>
      {open && <div className="border-t border-line bg-subtle/60 px-4 py-3">{children}</div>}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2">
      <div className="w-36 shrink-0 pt-1.5">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{hint}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function ClaudeBody() {
  const { settings, updateSettings } = useStore()
  const t = useT()
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  useEffect(() => {
    let alive = true
    void claudeStatus()
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setStatus({ path: '', version: null, error: String(e) }))
    return () => {
      alive = false
    }
  }, [])
  return (
    <>
      <Field label={t('Model', 'モデル')} hint={t('Sonnet dịch tốt hơn, Haiku nhanh và tiết kiệm hạn mức hơn.', 'Sonnet は高品質、Haiku は高速で利用枠を節約できます。')}>
        <Segmented
          label={t('Model Claude', 'Claude のモデル')}
          value={settings.model}
          onChange={(m) => updateSettings({ model: m })}
          options={[
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'haiku', label: 'Haiku' },
          ]}
        />
      </Field>
      <Field label="Claude Code">
        {!status ? (
          <span className="flex items-center gap-1.5 pt-1 text-[13px] text-ink-2">
            <Loader2 size={15} className="animate-spin" /> {t('Đang kiểm tra…', '確認中…')}
          </span>
        ) : status.version ? (
          <span className="flex items-center gap-1.5 pt-1 text-[13px] text-good" title={status.path}>
            <CheckCircle2 size={15} /> {status.version}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-bad" title={status.error ?? ''}>
              <AlertCircle size={15} className="shrink-0" /> {t('Không chạy được claude', 'claude を実行できません')}
            </span>
            <Button size="sm" onClick={() => void invoke('open_claude_login')}>
              {t('Mở Claude Code', 'Claude Code を開く')}
            </Button>
          </span>
        )}
      </Field>
    </>
  )
}

function ApiBody({ provider, hasKey, onKeySaved }: { provider: 'openai' | 'gemini'; hasKey: boolean; onKeySaved: (saved: boolean) => void }) {
  const { settings, updateSettings, showToast } = useStore()
  const t = useT()
  const [draft, setDraft] = useState('')
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const [test, setTest] = useState<{ state: 'idle' | 'running' } | { state: 'done'; result: TestResult }>({ state: 'idle' })
  const name = AI_NAMES[provider]
  const field = provider === 'openai' ? 'openaiModel' : 'geminiModel'
  const model = settings[field] || RECOMMENDED_MODELS[provider]
  const favourites = settings.aiQuickModels[provider]

  // The models this key can use; refreshed when a key is saved.
  useEffect(() => {
    if (!hasKey || !isTauri) return
    let alive = true
    void invoke<string[]>('ai_models', { provider })
      .then((m) => alive && setFetched(m))
      .catch(() => alive && setFetched([]))
    return () => {
      alive = false
    }
  }, [provider, hasKey])

  const saveKey = (key: string) => {
    if (!isTauri) {
      onKeySaved(Boolean(key))
      setDraft('')
      showToast(key ? t('Mô phỏng: đã lưu API key', 'シミュレーション: APIキーを保存しました') : t('Mô phỏng: đã xóa API key', 'シミュレーション: APIキーを削除しました'))
      return
    }
    invoke('ai_key_set', { provider, key })
      .then(() => {
        onKeySaved(Boolean(key.trim()))
        setDraft('')
        setTest({ state: 'idle' })
        showToast(
          key.trim()
            ? t(`Đã lưu API key ${name} vào Windows Credential Manager`, `${name} の APIキーを Windows 資格情報マネージャーに保存しました`)
            : t(`Đã xóa API key ${name}`, `${name} の APIキーを削除しました`),
        )
      })
      .catch((e) => showToast(`${t('Không lưu được key', 'キーを保存できません')}: ${String(e)}`))
  }

  const runTest = () => {
    setTest({ state: 'running' })
    if (!isTauri) {
      window.setTimeout(
        () =>
          setTest({
            state: 'done',
            result: { ok: true, model, firstTokenMs: 640, totalMs: 1180, translation: t('Đã xác nhận. Cảm ơn anh.', '確認しました。ありがとうございます。'), error: null, errorKind: null },
          }),
        700,
      )
      return
    }
    invoke<TestResult>('ai_test', { provider, model })
      .then((result) => setTest({ state: 'done', result }))
      .catch((e) => setTest({ state: 'done', result: { ok: false, model, firstTokenMs: null, totalMs: 0, translation: '', error: String(e), errorKind: null } }))
  }

  const toggleFavourite = (m: string) => {
    const next = favourites.includes(m) ? favourites.filter((x) => x !== m) : [...favourites, m]
    updateSettings({ aiQuickModels: { ...settings.aiQuickModels, [provider]: next } })
  }

  // The prototype shows a short made-up list.
  const models = isTauri ? fetched : PROTOTYPE_MODELS[provider]
  const all = models && models.length > 0 ? (models.includes(model) ? models : [model, ...models]) : [model]
  const q = filter.trim().toLowerCase()
  const listed = all.filter((m) => !q || m.toLowerCase().includes(q) || modelName(provider, m).toLowerCase().includes(q))

  return (
    <>
      <Field
        label={t('API key', 'APIキー')}
        hint={
          hasKey
            ? t('Lưu trong Windows Credential Manager.', 'Windows 資格情報マネージャーに保存されています。')
            : `${t('Tạo key tại', 'キーの作成:')} ${KEY_HELP[provider].url}`
        }
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) saveKey(draft)
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
              placeholder={hasKey ? t('•••••••• (đã lưu, nhập để thay)', '••••••••（保存済み、入力すると置き換え）') : KEY_HELP[provider].placeholder}
              className={cx(inputClass, 'w-full pl-8')}
            />
          </label>
          {draft.trim() ? (
            <Button type="submit" variant="primary">
              {t('Lưu', '保存')}
            </Button>
          ) : (
            hasKey && (
              <Button className="text-bad" onClick={() => saveKey('')}>
                {t('Xóa', '削除')}
              </Button>
            )
          )}
        </form>
      </Field>
      {hasKey && (
        <Field
          label={t('Model', 'モデル')}
          hint={t(
            'Chọn model mặc định. Đánh dấu ☆ để model hiện trong menu chọn nhanh trên popup và khay.',
            '既定のモデルを選びます。☆ を付けたモデルはポップアップとトレイのクイック切り替えに表示されます。',
          )}
        >
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            {all.length > 8 && (
              <label className="flex h-8 items-center gap-2 border-b border-line px-2.5">
                <Search size={13} className="text-ink-3" />
                <input
                  aria-label={t(`Tìm model ${name}`, `${name} のモデルを検索`)}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('Tìm model', 'モデルを検索')}
                  className="flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none"
                />
              </label>
            )}
            <ul role="radiogroup" aria-label={t(`Model ${name}`, `${name} のモデル`)} className="scroll-thin max-h-48 overflow-y-auto py-1">
              {isTauri && models === null && (
                <li className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-ink-3">
                  <Loader2 size={13} className="animate-spin" /> {t('Đang lấy danh sách model…', 'モデル一覧を取得中…')}
                </li>
              )}
              {listed.map((m) => {
                const isDefault = m === model
                const fav = isDefault || favourites.includes(m)
                return (
                  <li key={m} className="flex items-center gap-1 px-1.5">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isDefault}
                      onClick={() => updateSettings({ [field]: m })}
                      className={cx(
                        'flex h-7 min-w-0 flex-1 items-center gap-2 rounded px-1.5 text-left text-[12.5px]',
                        isDefault ? 'font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                      )}
                    >
                      <span className={cx('flex size-3.5 shrink-0 items-center justify-center rounded-full border', isDefault ? 'border-accent bg-accent' : 'border-line-strong')}>
                        {isDefault && <span className="size-1.5 rounded-full bg-on-accent" />}
                      </span>
                      <span className="truncate">{modelName(provider, m)}</span>
                      <span className="truncate font-mono text-[11px] text-ink-3">{m}</span>
                      {m === RECOMMENDED_MODELS[provider] && <span className="shrink-0 text-[11px] text-accent">{t('khuyên dùng', 'おすすめ')}</span>}
                    </button>
                    <button
                      type="button"
                      aria-pressed={fav}
                      disabled={isDefault}
                      title={
                        isDefault
                          ? t('Model mặc định luôn có trong menu chọn nhanh', '既定のモデルは常にクイック切り替えに表示されます')
                          : fav
                            ? t('Bỏ khỏi menu chọn nhanh', 'クイック切り替えから外す')
                            : t('Thêm vào menu chọn nhanh', 'クイック切り替えに追加')
                      }
                      aria-label={
                        fav
                          ? t(`Bỏ ${m} khỏi menu chọn nhanh`, `${m} をクイック切り替えから外す`)
                          : t(`Thêm ${m} vào menu chọn nhanh`, `${m} をクイック切り替えに追加`)
                      }
                      onClick={() => toggleFavourite(m)}
                      className={cx('flex size-7 shrink-0 items-center justify-center rounded text-[15px]', fav ? 'text-warn' : 'text-ink-3 hover:bg-hover hover:text-ink', isDefault && 'opacity-60')}
                    >
                      {fav ? '★' : '☆'}
                    </button>
                  </li>
                )
              })}
              {models !== null && listed.length === 0 && (
                <li className="px-3 py-1.5 text-[12.5px] text-ink-3">{t('Không có model nào khớp', '一致するモデルはありません')}</li>
              )}
            </ul>
          </div>
        </Field>
      )}
      <Field label={t('Kiểm tra', 'テスト')} hint={t('Dịch thử một câu ngắn bằng key và model mặc định.', 'キーと既定のモデルで短い文を試しに翻訳します。')}>
        <span className="flex items-center gap-3">
          <Button disabled={!hasKey || test.state === 'running'} onClick={runTest}>
            {test.state === 'running' && <Loader2 size={14} className="animate-spin" />}
            {test.state === 'running' ? t('Đang dịch thử…', 'テスト翻訳中…') : t('Dịch thử', 'テスト翻訳')}
          </Button>
          {test.state === 'done' && <TestLine result={test.result} />}
        </span>
      </Field>
    </>
  )
}

function TestLine({ result }: { result: TestResult }) {
  const t = useT()
  if (!result.ok) {
    const why =
      result.errorKind === 'bad_key'
        ? t('Key không đúng hoặc đã bị thu hồi', 'キーが誤っているか無効です')
        : result.errorKind === 'rate_limited'
          ? t('Hết hạn mức hoặc chưa nạp tiền', '利用枠の上限、または残高がありません')
          : result.errorKind === 'network'
            ? t('Không kết nối được', '接続できません')
            : t('Không dịch được', '翻訳できませんでした')
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-bad" title={result.error ?? ''}>
        <AlertCircle size={15} className="shrink-0" /> <span className="truncate">{why}</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-good" title={result.translation}>
      <CheckCircle2 size={15} />{' '}
      {t(
        `Chữ đầu tiên sau ${((result.firstTokenMs ?? result.totalMs) / 1000).toFixed(1)} s`,
        `最初の文字まで ${((result.firstTokenMs ?? result.totalMs) / 1000).toFixed(1)} 秒`,
      )}
    </span>
  )
}
