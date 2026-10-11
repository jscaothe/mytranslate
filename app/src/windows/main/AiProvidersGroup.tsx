import { invoke } from '@tauri-apps/api/core'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Segmented, Switch } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { claudeStatus, isTauri, type ClaudeStatus } from '../../lib/claude'
import { useStore, type AiProvider, type Settings } from '../../store'

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
]

/** Fastest general model each vendor documents (2026-10); the list from the API replaces it once a key works. */
const DEFAULT_MODELS = { openai: 'gpt-5.6-luna', gemini: 'gemini-3.6-flash' } as const

const KEY_HELP = {
  openai: { url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' },
  gemini: { url: 'https://aistudio.google.com/apikey', placeholder: 'AIza...' },
} as const

interface TestResult {
  ok: boolean
  model: string
  firstTokenMs: number | null
  totalMs: number
  translation: string
  error: string | null
  errorKind: string | null
}

/**
 * Settings > AI: which provider translates. Claude goes through Claude Code (the user's Claude plan); ChatGPT and
 * Gemini through their APIs with the user's own key, kept in the Windows Credential Manager.
 */
export function AiProvidersGroup({ group: Group, row: Row }: { group: GroupComponent; row: RowComponent }) {
  const { settings, updateSettings } = useStore()
  const [keys, setKeys] = useState<{ openai: boolean; gemini: boolean }>({ openai: !isTauri, gemini: false })

  useEffect(() => {
    if (!isTauri) return
    void invoke<{ openai: boolean; gemini: boolean }>('ai_keys_status').then(setKeys)
  }, [])

  const p = settings.aiProvider
  return (
    <Group
      title="Kết nối AI"
      hint="Chọn AI dùng để dịch. Claude dùng Claude Code đã đăng nhập trên máy; ChatGPT và Gemini dùng API key của bạn."
    >
      <Row label="AI dùng để dịch">
        <Segmented label="AI dùng để dịch" value={p} onChange={(v) => updateSettings({ aiProvider: v })} options={PROVIDERS} />
      </Row>
      {p === 'claude' && <ClaudeRows row={Row} settings={settings} onModel={(m) => updateSettings({ model: m })} />}
      {p !== 'claude' && (
        <ApiRows
          key={p}
          provider={p}
          row={Row}
          hasKey={keys[p]}
          model={(p === 'openai' ? settings.openaiModel : settings.geminiModel) || DEFAULT_MODELS[p]}
          onModel={(m) => updateSettings(p === 'openai' ? { openaiModel: m } : { geminiModel: m })}
          onKeySaved={(saved) => setKeys((k) => ({ ...k, [p]: saved }))}
        />
      )}
      <Row
        label="Tự chuyển sang AI khác khi lỗi"
        hint="Khi AI đang chọn hết hạn mức, sai key hoặc mất mạng trước khi kịp trả lời, dịch bằng AI khác đã cài đặt (Claude, rồi ChatGPT, rồi Gemini)."
      >
        <Switch label="Tự chuyển sang AI khác khi lỗi" checked={settings.aiFallback} onChange={(v) => updateSettings({ aiFallback: v })} />
      </Row>
      <div className="flex gap-2.5 px-4 py-3 text-[12px] leading-relaxed text-ink-2">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn" />
        <span>
          Nội dung tin nhắn được gửi tới nhà cung cấp AI đã chọn. Hãy dùng đúng loại tài khoản công ty cho phép. API trả phí của OpenAI và Google
          mặc định không dùng dữ liệu để huấn luyện; gói miễn phí của Gemini thì có thể dùng, không nên dùng cho tin nhắn của khách.
        </span>
      </div>
    </Group>
  )
}

type GroupComponent = (props: { title: string; hint?: string; children: ReactNode }) => ReactNode
type RowComponent = (props: { label: string; hint?: string; children: ReactNode }) => ReactNode

function ClaudeRows({ row: Row, settings, onModel }: { row: RowComponent; settings: Settings; onModel: (m: Settings['model']) => void }) {
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
      <Row label="Model" hint="Haiku nhanh và tiết kiệm hạn mức hơn, Sonnet dịch tốt hơn.">
        <Segmented
          label="Model Claude"
          value={settings.model}
          onChange={onModel}
          options={[
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'haiku', label: 'Haiku' },
          ]}
        />
      </Row>
      <Row label="Claude Code" hint="Dịch bằng tài khoản Claude đã đăng nhập trong Claude Code trên máy này.">
        {!status ? (
          <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <Loader2 size={15} className="animate-spin" /> Đang kiểm tra…
          </span>
        ) : status.version ? (
          <span className="flex items-center gap-1.5 text-[13px] text-good" title={status.path}>
            <CheckCircle2 size={15} /> {status.version}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="flex max-w-64 items-center gap-1.5 truncate text-[13px] text-bad" title={status.error ?? ''}>
              <AlertCircle size={15} className="shrink-0" /> Không chạy được claude
            </span>
            <Button size="sm" onClick={() => void invoke('open_claude_login')}>
              Mở Claude Code
            </Button>
          </span>
        )}
      </Row>
    </>
  )
}

function ApiRows({
  provider,
  row: Row,
  hasKey,
  model,
  onModel,
  onKeySaved,
}: {
  provider: 'openai' | 'gemini'
  row: RowComponent
  hasKey: boolean
  model: string
  onModel: (m: string) => void
  onKeySaved: (saved: boolean) => void
}) {
  const { showToast } = useStore()
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [test, setTest] = useState<{ state: 'idle' | 'running' } | { state: 'done'; result: TestResult }>({ state: 'idle' })
  const name = provider === 'openai' ? 'ChatGPT' : 'Gemini'

  // The models this key can use, for the picker; refreshed when a key is saved.
  useEffect(() => {
    if (!isTauri || !hasKey) return
    let alive = true
    void invoke<string[]>('ai_models', { provider })
      .then((m) => alive && setModels(m))
      .catch(() => alive && setModels([]))
    return () => {
      alive = false
    }
  }, [provider, hasKey])

  const saveKey = (key: string) => {
    if (!isTauri) {
      onKeySaved(Boolean(key))
      setDraft('')
      showToast(key ? 'Mô phỏng: đã lưu API key' : 'Mô phỏng: đã xóa API key')
      return
    }
    invoke('ai_key_set', { provider, key })
      .then(() => {
        onKeySaved(Boolean(key.trim()))
        setDraft('')
        setTest({ state: 'idle' })
        showToast(key.trim() ? `Đã lưu API key ${name} vào Windows Credential Manager` : `Đã xóa API key ${name}`)
      })
      .catch((e) => showToast(`Không lưu được key: ${String(e)}`))
  }

  const runTest = () => {
    setTest({ state: 'running' })
    if (!isTauri) {
      window.setTimeout(
        () => setTest({ state: 'done', result: { ok: true, model, firstTokenMs: 640, totalMs: 1180, translation: 'Đã xác nhận. Cảm ơn anh.', error: null, errorKind: null } }),
        700,
      )
      return
    }
    invoke<TestResult>('ai_test', { provider, model })
      .then((result) => setTest({ state: 'done', result }))
      .catch((e) => setTest({ state: 'done', result: { ok: false, model, firstTokenMs: null, totalMs: 0, translation: '', error: String(e), errorKind: null } }))
  }

  const options = models && models.length > 0 ? (models.includes(model) ? models : [model, ...models]) : [model]
  return (
    <>
      <Row label={`API key ${name}`} hint={hasKey ? 'Đã lưu trong Windows Credential Manager của máy này.' : `Tạo key tại ${KEY_HELP[provider].url}`}>
        <form
          className="flex w-80 gap-2"
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
              aria-label={`API key ${name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={hasKey ? '•••••••• (đã lưu, nhập để thay)' : KEY_HELP[provider].placeholder}
              className={cx(inputClass, 'w-full pl-8')}
            />
          </label>
          {draft.trim() ? (
            <Button type="submit" variant="primary">
              Lưu
            </Button>
          ) : (
            hasKey && (
              <Button className="text-bad" onClick={() => saveKey('')}>
                Xóa
              </Button>
            )
          )}
        </form>
      </Row>
      <Row label="Model" hint={isTauri && models === null && hasKey ? 'Đang lấy danh sách model…' : 'Model nhanh nhất được chọn sẵn; đổi nếu muốn dịch tốt hơn.'}>
        <select
          aria-label={`Model ${name}`}
          value={model}
          onChange={(e) => onModel(e.target.value)}
          className={cx(inputClass, 'w-64')}
          disabled={!hasKey}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === DEFAULT_MODELS[provider] ? ' (khuyên dùng)' : ''}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Kiểm tra" hint="Dịch thử một câu ngắn bằng key và model này.">
        <span className="flex items-center gap-3">
          {test.state === 'done' && <TestLine result={test.result} />}
          <Button disabled={!hasKey || test.state === 'running'} onClick={runTest}>
            {test.state === 'running' && <Loader2 size={14} className="animate-spin" />}
            {test.state === 'running' ? 'Đang dịch thử…' : 'Dịch thử'}
          </Button>
        </span>
      </Row>
    </>
  )
}

function TestLine({ result }: { result: TestResult }) {
  if (!result.ok) {
    const why =
      result.errorKind === 'bad_key'
        ? 'Key không đúng hoặc đã bị thu hồi'
        : result.errorKind === 'rate_limited'
          ? 'Hết hạn mức hoặc chưa nạp tiền'
          : result.errorKind === 'network'
            ? 'Không kết nối được'
            : 'Không dịch được'
    return (
      <span className="flex max-w-72 items-center gap-1.5 text-[13px] text-bad" title={result.error ?? ''}>
        <AlertCircle size={15} className="shrink-0" /> <span className="truncate">{why}</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-good" title={result.translation}>
      <CheckCircle2 size={15} /> Chữ đầu tiên sau {((result.firstTokenMs ?? result.totalMs) / 1000).toFixed(1)} s
    </span>
  )
}
