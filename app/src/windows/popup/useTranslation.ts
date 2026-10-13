import { useEffect, useState } from 'react'
import { emptySections, isTauri, startTranslation, type ErrorKind, type RateLimit, type Sections } from '../../lib/claude'
import { useLang } from '../../lib/i18n'
import type { Direction, Keigo, Scenario } from '../../types'

export type TranslationPhase = 'waiting' | 'thinking' | 'streaming' | 'done' | 'error'

export interface TranslationState {
  phase: TranslationPhase
  sections: Sections
  error: { kind: ErrorKind; message: string; provider: string } | null
  /** Which AI answered, and which one failed first when the answer came from a fallback. */
  answeredBy: { provider: string; model: string; fallbackFrom: string | null } | null
  /** Plan usage reported by the CLI with the result, when it reported any. */
  rateLimit: RateLimit | null
  /** Where the result was filed in the history (real app only). */
  saved: { messageId: number; threadId: number } | null
}

const initial: TranslationState = {
  phase: 'waiting',
  sections: emptySections,
  error: null,
  answeredBy: null,
  rateLimit: null,
  saved: null,
}

/** Prototype-only failures chosen in the toolbar, mapped onto the real error kinds. */
const simulatedError: Partial<Record<Scenario, ErrorKind>> = {
  not_logged_in: 'not_logged_in',
  quota: 'rate_limited',
  network: 'cli',
  blocked: 'blocked',
}

/**
 * Streams one translation and restarts it whenever an input or `runKey` changes. `enabled: false` stops it
 * (for example while a long text waits for confirmation).
 */
export function useTranslation({
  direction,
  text,
  keigo,
  keigoChosen = false,
  runKey,
  enabled,
  scenario,
  history,
  ai,
}: {
  direction: Direction
  text: string
  keigo: Keigo
  /** The user picked `keigo` for this message, rather than it being their default. */
  keigoChosen?: boolean
  runKey: number
  enabled: boolean
  scenario: Scenario
  /** Where the text came from in the history, read when a run starts (real app only). */
  history?: { conversationId: number | null; threadId: number | null }
  /** Translate with this AI and model; `null` uses the default. Changing it translates again. */
  ai?: { provider: string; model: string } | null
}) {
  const lang = useLang()
  const aiKey = ai ? `${ai.provider}:${ai.model}` : ''
  const key = enabled ? `${runKey}|${direction}|${keigo}|${aiKey}|${lang}|${text}` : null
  const [state, setState] = useState<{ key: string | null; value: TranslationState }>({ key: null, value: initial })

  useEffect(() => {
    if (key === null) return
    let cancel: (() => void) | null = null
    let alive = true
    const update = (patch: Partial<TranslationState>) => {
      if (alive) setState((s) => ({ key, value: { ...(s.key === key ? s.value : initial), ...patch } }))
    }

    // The simulated failures are Claude's; another AI picked in the popup translates normally.
    const fake = !isTauri && (ai?.provider ?? 'claude') === 'claude' ? simulatedError[scenario] : undefined
    if (fake) {
      const t = window.setTimeout(() => update({ phase: 'error', error: { kind: fake, message: 'Simulated error (prototype)', provider: 'claude' } }), 600)
      return () => window.clearTimeout(t)
    }

    void startTranslation({ direction, text, keigo, keigoChosen, ...history, ai: ai ?? null }, (e) => {
      if (e.type === 'thinking') update({ phase: 'thinking' })
      if (e.type === 'delta') update({ phase: 'streaming', sections: e.sections })
      if (e.type === 'done')
        update({
          phase: 'done',
          sections: e.sections,
          rateLimit: e.rateLimit,
          answeredBy: { provider: e.timing.provider, model: e.timing.model, fallbackFrom: e.timing.fallbackFrom },
        })
      if (e.type === 'saved') update({ saved: { messageId: e.messageId, threadId: e.threadId } })
      if (e.type === 'error' && e.kind !== 'cancelled')
        update({ phase: 'error', error: { kind: e.kind, message: e.message, provider: e.provider ?? 'claude' } })
    }, lang).then((c) => {
      if (alive) cancel = c
      else c()
    })
    return () => {
      alive = false
      cancel?.()
    }
    // `history` and `keigoChosen` are read when a run starts (a keigo change restarts it anyway). `ai` is in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.key === key ? state.value : initial
}
