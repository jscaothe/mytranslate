// The user's own Claude or ChatGPT account, set up without asking anything: used by the first-run guide and by
// Settings > Kết nối AI.
import { invoke } from '@tauri-apps/api/core'
import { Check, CircleAlert, Loader2, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ACCOUNT_TOOL, accountStatus, cancelLogin, installAccount, loginAccount, type Account } from '../lib/accounts'
import type { TestResult } from '../lib/ai'
import { isTauri } from '../lib/claude'
import { useLang, useT, type T } from '../lib/i18n'
import { useStore } from '../store'
import { cx } from './styles'
import { Button } from './ui'

type CheckState = 'idle' | 'running' | 'ok' | 'fail'

/** One line of the account check: its state, what it says, and a button only when something went wrong. */
interface CheckRow {
  state: CheckState
  text: string
  /** 0-100 while a download can be measured. */
  percent?: number | null
  /** The sign-in is waiting for the user on the vendor's page. */
  waiting?: boolean
  retry?: boolean
}

type CheckRows = [CheckRow, CheckRow, CheckRow]

/** Before anything is known: looking for the tool. */
function initialRows(account: Account, t: T): CheckRows {
  const { tool } = ACCOUNT_TOOL[account]
  return [
    { state: 'running', text: t(`Đang tìm ${tool}…`, `${tool} を探しています…`) },
    { state: 'idle', text: t('Chờ bước trên', '前の手順を待っています') },
    { state: 'idle', text: t('Tự chạy sau khi đăng nhập', 'ログイン後に自動で実行します') },
  ]
}

/**
 * The user's own Claude or ChatGPT account, set up without asking anything: find the vendor's tool, install it
 * when missing, start its sign-in when needed, then translate one sentence. The only thing the user does is sign in
 * on the vendor's page; buttons appear only when a step fails.
 */
export function AccountCheck({
  account,
  onReady,
  makeDefault = true,
}: {
  account: Account
  onReady: (ready: boolean) => void
  /** Use this AI from now on once it works (the guide); Settings sets an AI up without switching to it. */
  makeDefault?: boolean
}) {
  const { scenario, updateSettings } = useStore()
  const t = useT()
  const lang = useLang()
  const { tool, name } = ACCOUNT_TOOL[account]
  const [attempt, setAttempt] = useState(0)
  const runKey = `${account}:${attempt}:${scenario}`
  const [progress, setProgress] = useState<{ key: string; rows: CheckRows } | null>(null)
  const rows = progress?.key === runKey ? progress.rows : initialRows(account, t)

  useEffect(() => {
    const { tool, name, maker, provider } = ACCOUNT_TOOL[account]
    const idle = (text: string): CheckRow => ({ state: 'idle', text })
    let alive = true
    let current = initialRows(account, t)
    const set = (i: 0 | 1 | 2, row: CheckRow) => {
      if (!alive) return
      current = [...current] as CheckRows
      current[i] = row
      setProgress({ key: runKey, rows: current })
    }
    const seconds = (ms: number) => (lang === 'ja' ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(1).replace('.', ','))
    const failed = (i: 0 | 1 | 2, text: string) => {
      set(i, { state: 'fail', text, retry: true })
      onReady(false)
    }

    const signIn = async (): Promise<boolean> => {
      set(1, { state: 'running', text: t(`Chưa đăng nhập. Đang mở trang đăng nhập ${name}…`, `未ログインです。${name} のログインページを開いています…`) })
      const opened = window.setTimeout(
        () => set(1, { state: 'running', waiting: true, text: t(`Mời bạn đăng nhập ${name} trên trình duyệt vừa mở.`, `開いたブラウザで ${name} にログインしてください。`) }),
        900,
      )
      try {
        await loginAccount(account)
        set(1, { state: 'ok', text: t(`Đã đăng nhập bằng tài khoản ${name} của bạn`, `ご自身の ${name} アカウントでログインしています`) })
        return true
      } catch (e) {
        if (alive && String(e) !== 'cancelled') failed(1, t(`Chưa đăng nhập được: ${String(e)}`, `ログインできませんでした: ${String(e)}`))
        return false
      } finally {
        window.clearTimeout(opened)
      }
    }

    const tryTranslation = async (): Promise<TestResult> => {
      if (!isTauri) {
        await new Promise((r) => window.setTimeout(r, 800))
        if (scenario === 'quota' || scenario === 'network')
          return { ok: false, model: '', firstTokenMs: null, totalMs: 0, translation: '', error: scenario, errorKind: scenario === 'quota' ? 'rate_limited' : 'network' }
        return { ok: true, model: '', firstTokenMs: account === 'claude' ? 900 : 1900, totalMs: 2000, translation: '', error: null, errorKind: null }
      }
      return invoke<TestResult>('ai_test', { provider, model: null }).catch((e) => ({
        ok: false,
        model: '',
        firstTokenMs: null,
        totalMs: 0,
        translation: '',
        error: String(e),
        errorKind: null,
      }))
    }

    void (async () => {
      let status = await accountStatus(account, scenario).catch(() => ({ installed: false, version: null, loggedIn: null }))
      if (!alive) return
      let installedNow = false
      if (!status.installed) {
        set(0, { state: 'running', percent: null, text: t(`Máy chưa có ${tool}, đang tự tải và cài bản chính hãng…`, `${tool} がないため、公式版をダウンロードしてインストールしています…`) })
        try {
          await installAccount(account, (percent) =>
            set(0, { state: 'running', percent, text: t(`Máy chưa có ${tool}, đang tự tải và cài bản chính hãng…`, `${tool} がないため、公式版をダウンロードしてインストールしています…`) }),
          )
        } catch (e) {
          return failed(0, t(`Không cài được ${tool}: ${String(e)}`, `${tool} をインストールできませんでした: ${String(e)}`))
        }
        installedNow = true
        status = isTauri ? await accountStatus(account, scenario) : { installed: true, version: '0.162.1', loggedIn: false }
        if (!alive) return
        if (!status.installed) return failed(0, t(`Đã cài nhưng chưa chạy được ${tool}.`, `${tool} をインストールしましたが、起動できません。`))
      }
      const version = status.version ?? ''
      set(0, {
        state: 'ok',
        text: installedNow
          ? t(`Đã cài ${tool} ${version}, bản chính hãng của ${maker}`, `${maker} 公式の ${tool} ${version} をインストールしました`)
          : t(`Đã có ${tool} ${version} trên máy`, `このPCに ${tool} ${version} があります`),
      })

      let signedIn = false
      if (status.loggedIn !== true) {
        if (!(await signIn())) return
        signedIn = true
      } else {
        set(1, { state: 'running', text: t('Đang kiểm tra đăng nhập…', 'ログインを確認しています…') })
      }

      for (;;) {
        set(2, { state: 'running', text: t('Đang tự dịch thử một câu…', 'テスト翻訳をしています…') })
        const result = await tryTranslation()
        if (!alive) return
        if (result.ok) {
          set(1, { state: 'ok', text: t(`Đã đăng nhập bằng tài khoản ${name} của bạn`, `ご自身の ${name} アカウントでログインしています`) })
          const ms = result.firstTokenMs ?? result.totalMs
          set(2, {
            state: 'ok',
            text: t(`Dịch thử thành công, chữ đầu tiên sau ${seconds(ms)} giây. Bạn đã sẵn sàng.`, `テスト翻訳に成功しました（最初の文字まで ${seconds(ms)} 秒）。準備完了です。`),
          })
          if (makeDefault) updateSettings({ aiProvider: provider })
          onReady(true)
          return
        }
        // The tool said it was signed in but the sign-in had expired: sign in once, then try again.
        if (result.errorKind === 'not_logged_in' && !signedIn) {
          set(2, idle(t('Tự chạy sau khi đăng nhập', 'ログイン後に自動で実行します')))
          if (!(await signIn())) return
          signedIn = true
          continue
        }
        set(1, { state: 'ok', text: t(`Đã đăng nhập bằng tài khoản ${name} của bạn`, `ご自身の ${name} アカウントでログインしています`) })
        return failed(2, accountFailure(result, name, t))
      }
    })()

    return () => {
      alive = false
      cancelLogin()
    }
  }, [runKey, account, scenario, lang, t, onReady, updateSettings, makeDefault])

  const retry = () => {
    onReady(false)
    setAttempt((n) => n + 1)
  }
  const titles = [t(`${tool} trên máy`, `このPCの ${tool}`), t(`Tài khoản ${name}`, `${name} アカウント`), t('Dịch thử', 'テスト翻訳')]

  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {rows.map((row, i) => (
        <li key={titles[i]} className="flex items-start gap-3 px-4 py-3">
          <StatusIcon state={row.state} />
          <div className="min-w-0 flex-1">
            <div className={cx('text-[13.5px] font-medium', row.state === 'idle' ? 'text-ink-3' : 'text-ink')}>{titles[i]}</div>
            <div className={cx('text-[12.5px] leading-relaxed break-words', row.state === 'fail' ? 'text-bad' : row.waiting ? 'font-semibold text-accent' : 'text-ink-3')}>
              {row.text}
              {row.percent != null && ` ${row.percent}%`}
            </div>
            {row.state === 'running' && row.percent !== undefined && (
              <div className="mt-2 h-1 w-64 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={row.percent ?? undefined}>
                <div
                  className={cx('h-full rounded-full bg-accent transition-[width]', row.percent == null && 'w-1/3 animate-pulse')}
                  style={row.percent == null ? undefined : { width: `${row.percent}%` }}
                />
              </div>
            )}
            {row.waiting && (
              <button type="button" onClick={retry} className="mt-1 text-[12.5px] text-accent hover:underline">
                {t('Không thấy trang đăng nhập? Mở lại', 'ログインページが見つからない場合は、もう一度開く')}
              </button>
            )}
            {row.retry && (
              <Button size="sm" className="mt-2" onClick={retry}>
                <RotateCw size={13} /> {t('Thử lại', '再試行')}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Why the test translation with the user's account failed, and what to do. */
function accountFailure(result: TestResult, name: string, t: T): string {
  switch (result.errorKind) {
    case 'rate_limited':
      return t(`Đã hết hạn mức gói ${name}. Thử lại sau khi hạn mức được làm mới.`, `${name} プランの利用枠を使い切りました。リセット後にもう一度お試しください。`)
    case 'network':
      return t('Không kết nối được. Kiểm tra mạng, VPN hoặc proxy của công ty.', '接続できません。ネットワーク、VPN、社内プロキシを確認してください。')
    case 'timeout':
      return t(`${name} không trả lời. Kiểm tra mạng rồi thử lại.`, `${name} から応答がありません。ネットワークを確認してから、もう一度お試しください。`)
    case 'not_logged_in':
      return t(`Tài khoản ${name} chưa dùng được. Gói miễn phí có thể không dùng được ở đây; cần gói trả phí.`, `${name} アカウントが使えません。無料プランでは使えない場合があり、有料プランが必要です。`)
    case 'not_installed':
      return t('Không chạy được công cụ của hãng.', '提供元のツールを起動できません。')
    default:
      return result.error ?? t('Không dịch được', '翻訳できませんでした')
  }
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

