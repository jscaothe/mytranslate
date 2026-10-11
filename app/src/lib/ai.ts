// Which AI translates, and the quick switcher shown in the popup (and, built by Rust, in the tray menu).
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useState } from 'react'
import type { AiProvider, Settings } from '../store'
import { isTauri } from './claude'

/** An AI and one of its models. */
export interface AiChoice {
  provider: AiProvider
  model: string
}

/** One entry of the quick switcher. */
export interface QuickChoice extends AiChoice {
  /** Claude always; ChatGPT and Gemini once an API key is saved. */
  available: boolean
  /** The current default. */
  current: boolean
}

export const AI_NAMES: Record<AiProvider, string> = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' }

/** Fastest general model each vendor documents (2026-10); the default until the user picks another. */
export const RECOMMENDED_MODELS = { openai: 'gpt-5.6-luna', gemini: 'gemini-3.6-flash' } as const

/** Where to create an API key, and what one looks like. */
export const KEY_HELP = {
  openai: { url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' },
  gemini: { url: 'https://aistudio.google.com/apikey', placeholder: 'AIza...' },
} as const

/** The answer of `ai_test`: one short translation with a key and a model. */
export interface TestResult {
  ok: boolean
  model: string
  firstTokenMs: number | null
  totalMs: number
  translation: string
  error: string | null
  errorKind: string | null
}

/** Why a test translation failed, in the user's words. */
export function testFailure(errorKind: string | null): string {
  return errorKind === 'bad_key'
    ? 'Key không đúng hoặc đã bị thu hồi'
    : errorKind === 'rate_limited'
      ? 'Hết hạn mức hoặc chưa nạp tiền'
      : errorKind === 'network'
        ? 'Không kết nối được'
        : 'Không dịch được'
}

/** The settings field holding a provider's default model. */
export function modelField(provider: AiProvider): 'model' | 'openaiModel' | 'geminiModel' {
  return provider === 'openai' ? 'openaiModel' : provider === 'gemini' ? 'geminiModel' : 'model'
}

/** The default AI and model from the settings. */
export function defaultChoice(settings: Settings): AiChoice {
  const provider = settings.aiProvider
  if (provider === 'claude') return { provider, model: settings.model }
  return { provider, model: settings[modelField(provider)] || RECOMMENDED_MODELS[provider] }
}

/** A readable model name: "Sonnet", "GPT-5.6 Luna", "Gemini 3.6 Flash". */
export function modelName(provider: AiProvider, model: string): string {
  if (provider === 'claude') return model === 'haiku' ? 'Haiku' : 'Sonnet'
  const words = model.split('-').filter(Boolean)
  if (provider === 'openai' && words[0]?.toLowerCase() === 'gpt') {
    const [, version, ...rest] = words
    return [`GPT-${version ?? ''}`.replace(/-$/, ''), ...rest.map(capitalize)].join(' ')
  }
  return words.map((w) => (/^\d/.test(w) ? w : capitalize(w))).join(' ')
}

/** "Claude Sonnet", "ChatGPT · GPT-5.6 Luna". */
export function choiceLabel(c: AiChoice): string {
  return c.provider === 'claude' ? `Claude ${modelName('claude', c.model)}` : `${AI_NAMES[c.provider]} · ${modelName(c.provider, c.model)}`
}

export function sameChoice(a: AiChoice | null, b: AiChoice | null): boolean {
  return Boolean(a && b && a.provider === b.provider && a.model === b.model)
}

function capitalize(w: string) {
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Prototype: the same list the Rust side builds, with a ChatGPT key pretending to be saved. */
function choicesFromSettings(settings: Settings): QuickChoice[] {
  const current = defaultChoice(settings)
  const out: QuickChoice[] = []
  const push = (provider: AiProvider, models: string[], available: boolean) => {
    for (const model of [...new Set(models)]) out.push({ provider, model, available, current: sameChoice(current, { provider, model }) })
  }
  push('claude', ['sonnet', 'haiku'], true)
  push('openai', [settings.openaiModel || RECOMMENDED_MODELS.openai, ...settings.aiQuickModels.openai], true)
  push('gemini', [settings.geminiModel || RECOMMENDED_MODELS.gemini, ...settings.aiQuickModels.gemini], false)
  return out
}

/** The quick switcher entries, kept fresh when the settings or the API keys change (in any window). */
export function useQuickChoices(settings: Settings): QuickChoice[] {
  const [real, setReal] = useState<QuickChoice[] | null>(null)
  const mock = useMemo(() => choicesFromSettings(settings), [settings])
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    const load = () => void invoke<QuickChoice[]>('ai_choices').then((c) => alive && setReal(c))
    load()
    const offs = [listen('settings:changed', load), listen('ai:keys-changed', load)]
    return () => {
      alive = false
      offs.forEach((o) => void o.then((f) => f()))
    }
  }, [settings])
  return isTauri ? (real ?? mock) : mock
}
