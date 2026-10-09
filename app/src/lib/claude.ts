// Bridge to the Rust ClaudeCliProvider. In a plain browser (the prototype) it falls back to canned answers,
// so every screen still works without Tauri.
import { Channel, invoke } from '@tauri-apps/api/core'
import type { Keigo } from '../types'
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
  /** Only for a new thread: the short title Claude gave it. */
  threadTitle: string
}

export const emptySections: Sections = {
  translation: '',
  backTranslation: '',
  notes: '',
  verdict: '',
  issues: '',
  suggestion: '',
  suggestionVi: '',
  threadTitle: '',
}

export interface Timing {
  firstTokenMs: number | null
  totalMs: number
  thought: boolean
  warm: boolean
  model: string
  promptVersion: number
}

export interface RateLimit {
  status: string
  utilization: number | null
  resetsAt: number | null
  limitType: string | null
}

export type ErrorKind = 'not_installed' | 'not_logged_in' | 'rate_limited' | 'cancelled' | 'timeout' | 'cli'

export type TranslateEvent =
  | { type: 'started'; warm: boolean }
  | { type: 'thinking' }
  | { type: 'delta'; sections: Sections }
  | { type: 'done'; sections: Sections; timing: Timing; rateLimit: RateLimit | null }
  | { type: 'error'; kind: ErrorKind; message: string }
  /** After `done`: where the result was filed in the history. */
  | { type: 'saved'; messageId: number; threadId: number; threadTitle: string }

export interface TranslateRequest {
  /** `review_ja` checks Japanese the user wrote instead of translating it. */
  direction: 'ja_vi' | 'vi_ja' | 'review_ja'
  text: string
  keigo: Keigo
  profile?: string
  /** History: the chat window the text came from; the Rust side adds the thread's messages as context. */
  conversationId?: number | null
  /** History: the chosen thread; null starts a new one. */
  threadId?: number | null
  newThreadTitle?: string | null
}

/** Starts a translation; returns a function that cancels it. */
export async function startTranslation(request: TranslateRequest, onEvent: (e: TranslateEvent) => void): Promise<() => void> {
  if (!isTauri) return mockStream(request, onEvent)
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
  if (!isTauri) return { path: 'claude.exe (giả lập)', version: '2.x (giả lập)', error: null }
  return invoke<ClaudeStatus>('claude_status')
}


function mockStream(request: TranslateRequest, onEvent: (e: TranslateEvent) => void): () => void {
  const final = mockSections(request)
  // Stream the field the user reads first, like Claude does.
  const field: keyof Sections = request.direction === 'review_ja' ? 'suggestion' : 'translation'
  const full = final[field]
  const start = performance.now()
  let i = 0
  let first: number | null = null
  let timer = 0
  onEvent({ type: 'started', warm: true })
  const tick = () => {
    i = Math.min(full.length, i + 3)
    first ??= performance.now() - start
    onEvent({ type: 'delta', sections: { ...emptySections, ...(request.direction === 'review_ja' ? { verdict: final.verdict } : {}), [field]: full.slice(0, i) } })
    if (i < full.length) {
      timer = window.setTimeout(tick, 25)
      return
    }
    onEvent({
      type: 'done',
      sections: final,
      timing: { firstTokenMs: Math.round(first), totalMs: Math.round(performance.now() - start), thought: false, warm: true, model: 'mock', promptVersion: 0 },
      rateLimit: null,
    })
  }
  timer = window.setTimeout(tick, 600)
  return () => {
    window.clearTimeout(timer)
    onEvent({ type: 'error', kind: 'cancelled', message: 'cancelled' })
  }
}

function mockSections(request: TranslateRequest): Sections {
  if (request.direction === 'review_ja') {
    const r = mockReview(request.text)
    return {
      ...emptySections,
      verdict: r.verdict,
      issues: r.issues.map((i) => `${i.kind}: ${i.text}`).join('\n'),
      suggestion: r.suggestion,
      suggestionVi: r.suggestionVi,
    }
  }
  const r = mockTranslate(request.text, request.direction, request.keigo)
  return { ...emptySections, translation: r.translation, backTranslation: r.backTranslation ?? '' }
}
