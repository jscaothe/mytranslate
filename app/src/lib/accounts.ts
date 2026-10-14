// The user's own AI account (Claude through Claude Code, ChatGPT through Codex): is the tool installed and signed
// in, install it, and run its sign-in. The prototype pretends, following the simulated scenario.
import { Channel, invoke } from '@tauri-apps/api/core'
import type { AiProvider } from '../store'
import type { Scenario } from '../types'
import { isTauri } from './claude'

export type Account = 'claude' | 'codex'

/** The vendor's tool behind each account, and the provider id it translates as. */
export const ACCOUNT_TOOL: Record<Account, { tool: string; name: string; maker: string; provider: AiProvider }> = {
  claude: { tool: 'Claude Code', name: 'Claude', maker: 'Anthropic', provider: 'claude' },
  codex: { tool: 'Codex', name: 'ChatGPT', maker: 'OpenAI', provider: 'codex' },
}

export interface AccountStatus {
  installed: boolean
  version: string | null
  /** What the tool says; null when it is missing or could not tell. A test translation is the real proof. */
  loggedIn: boolean | null
}

/** Prototype: Claude follows the simulated scenario; Codex is not on this PC yet, as for most people. */
function mockStatus(account: Account, scenario: Scenario): AccountStatus {
  if (account === 'codex') return { installed: false, version: null, loggedIn: null }
  if (scenario === 'no_claude') return { installed: false, version: null, loggedIn: null }
  return { installed: true, version: '2.1.296 (Claude Code)', loggedIn: scenario !== 'not_logged_in' }
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

export async function accountStatus(account: Account, scenario: Scenario): Promise<AccountStatus> {
  if (!isTauri) {
    await wait(500)
    return mockStatus(account, scenario)
  }
  return invoke<AccountStatus>('account_status', { account })
}

/** Installs the vendor's tool; `onProgress` gets a percent, or null while it cannot be measured. */
export async function installAccount(account: Account, onProgress: (percent: number | null) => void): Promise<void> {
  if (!isTauri) {
    for (let p = 0; p <= 100; p += 10) {
      onProgress(account === 'claude' ? null : p)
      await wait(180)
    }
    return
  }
  const channel = new Channel<{ percent: number | null }>()
  channel.onmessage = (m) => onProgress(m.percent)
  await invoke('account_install', { account, onProgress: channel })
}

/** Runs the tool's own sign-in and resolves once the user has finished it on the vendor's page. */
export async function loginAccount(account: Account): Promise<void> {
  if (!isTauri) {
    await wait(2200)
    return
  }
  await invoke('account_login', { account })
}

export function cancelLogin(): void {
  if (isTauri) void invoke('account_login_cancel')
}
