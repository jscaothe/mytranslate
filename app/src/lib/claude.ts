// Bridge to the Rust ClaudeCliProvider. In a plain browser (the prototype) it falls back to canned answers,
// so every screen still works without Tauri.
import { Channel, invoke } from '@tauri-apps/api/core'
import type { Direction, Keigo } from '../types'
import type { Lang } from './i18n'
import { review as mockReview, translate as mockTranslate } from './mockEngine'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface Sections {
  translation: string
  backTranslation: string
  notes: string
  /** Review only: ok, suggest or error. */
  verdict: string
  /** Review only: one "kind: explanation" per line. */
  issues: string
  suggestion: string
  suggestionVi: string
}

export const emptySections: Sections = {
  translation: '',
  backTranslation: '',
  notes: '',
  verdict: '',
  issues: '',
  suggestion: '',
  suggestionVi: '',
}

export interface Timing {
  firstTokenMs: number | null
  totalMs: number
  thought: boolean
  warm: boolean
  model: string
  promptVersion: number
  /** claude, openai or gemini. */
  provider: string
  /** Set when this provider answered because the chosen one failed. */
  fallbackFrom: string | null
}

export interface RateLimit {
  status: string
  utilization: number | null
  resetsAt: number | null
  limitType: string | null
}

export type ErrorKind =
  | 'not_installed'
  | 'not_logged_in'
  | 'rate_limited'
  | 'cancelled'
  | 'timeout'
  | 'cli'
  /** ChatGPT or Gemini chosen without an API key. */
  | 'missing_key'
  /** The vendor rejected the API key. */
  | 'bad_key'
  | 'network'

export type TranslateEvent =
  | { type: 'started'; warm: boolean }
  | { type: 'thinking' }
  | { type: 'delta'; sections: Sections }
  | { type: 'done'; sections: Sections; timing: Timing; rateLimit: RateLimit | null }
  | { type: 'error'; kind: ErrorKind; message: string; provider?: string | null }
  /** After `done`: where the result was filed in the history. */
  | { type: 'saved'; messageId: number; threadId: number }

export interface TranslateRequest {
  /** `review_ja` and `review_vi` check a sentence the user wrote, in its own language, instead of translating it. */
  direction: Direction
  text: string
  keigo: Keigo
  /** The user picked `keigo` for this message; otherwise it is their default, which a person's note may override. */
  keigoChosen?: boolean
  /** History: the chat window the text came from; the Rust side adds the thread's messages as context. */
  conversationId?: number | null
  /** History: the thread the Rust side picked for the text; null starts a new one. */
  threadId?: number | null
  /** Translate with this AI and model instead of the default (the popup's AI switcher). */
  ai?: { provider: string; model: string } | null
}

/** Starts a translation; returns a function that cancels it. */
/** `lang` is the user's language; the real app reads it from the settings, the prototype's canned answers need it. */
export async function startTranslation(
  request: TranslateRequest,
  onEvent: (e: TranslateEvent) => void,
  lang: Lang = 'vi',
): Promise<() => void> {
  if (!isTauri) return mockStream(request, onEvent, lang)
  const requestId = await invoke<number>('next_request_id')
  const channel = new Channel<TranslateEvent>()
  channel.onmessage = onEvent
  invoke('translate', { requestId, request, onEvent: channel }).catch((e) =>
    onEvent({ type: 'error', kind: 'cli', message: String(e) }),
  )
  return () => void invoke('cancel_translation', { requestId })
}

export interface ClaudeStatus {
  path: string
  version: string | null
  error: string | null
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  if (!isTauri) return { path: 'claude.exe (mock)', version: '2.x (mock)', error: null }
  return invoke<ClaudeStatus>('claude_status')
}


function mockStream(request: TranslateRequest, onEvent: (e: TranslateEvent) => void, lang: Lang): () => void {
  const final = mockSections(request, lang)
  // Stream the field the user reads first, like Claude does.
  const reviewing = request.direction === 'review_ja' || request.direction === 'review_vi'
  const field: keyof Sections = reviewing ? 'suggestion' : 'translation'
  const full = final[field]
  const start = performance.now()
  let i = 0
  let first: number | null = null
  let timer = 0
  onEvent({ type: 'started', warm: true })
  const tick = () => {
    i = Math.min(full.length, i + 3)
    first ??= performance.now() - start
    onEvent({ type: 'delta', sections: { ...emptySections, ...(reviewing ? { verdict: final.verdict } : {}), [field]: full.slice(0, i) } })
    if (i < full.length) {
      timer = window.setTimeout(tick, 25)
      return
    }
    onEvent({
      type: 'done',
      sections: final,
      timing: { firstTokenMs: Math.round(first), totalMs: Math.round(performance.now() - start), thought: false, warm: true, model: 'mock', promptVersion: 0, provider: 'claude', fallbackFrom: null },
      rateLimit: null,
    })
  }
  timer = window.setTimeout(tick, 600)
  return () => {
    window.clearTimeout(timer)
    onEvent({ type: 'error', kind: 'cancelled', message: 'cancelled' })
  }
}

function mockSections(request: TranslateRequest, lang: Lang): Sections {
  if (request.direction === 'review_ja' || request.direction === 'review_vi') {
    const r = mockReview(request.text, request.direction, lang)
    return {
      ...emptySections,
      verdict: r.verdict,
      issues: r.issues.map((i) => [i.kind, i.wrong, i.fix, i.text].join(' || ')).join('\n'),
      suggestion: r.suggestion,
      suggestionVi: r.suggestionVi,
    }
  }
  const r = mockTranslate(request.text, request.direction, request.keigo, lang)
  return { ...emptySections, translation: r.translation, backTranslation: r.backTranslation ?? '' }
}
