import { useEffect, useState } from 'react'
import { emptySections, isTauri, startTranslation, type ErrorKind, type RateLimit, type Sections } from '../../lib/claude'
import type { Keigo, Scenario } from '../../types'

export type TranslationPhase = 'waiting' | 'thinking' | 'streaming' | 'done' | 'error'

export interface TranslationState {
  phase: TranslationPhase
  sections: Sections
  error: { kind: ErrorKind; message: string } | null
  /** Plan usage reported by the CLI with the result, when it reported any. */
  rateLimit: RateLimit | null
}

const initial: TranslationState = {
  phase: 'waiting',
  sections: emptySections,
  error: null,
  rateLimit: null,
}

/** Prototype-only failures chosen in the toolbar, mapped onto the real error kinds. */
const simulatedError: Partial<Record<Scenario, ErrorKind>> = {
  not_logged_in: 'not_logged_in',
  quota: 'rate_limited',
  network: 'cli',
}

/**
 * Streams one translation and restarts it whenever an input or `runKey` changes. `enabled: false` stops it
 * (for example while a long text waits for confirmation).
 */
export function useTranslation({
  direction,
  text,
  keigo,
  profile,
  runKey,
  enabled,
  scenario,
}: {
  direction: 'ja_vi' | 'vi_ja' | 'review_ja'
  text: string
  keigo: Keigo
  profile: string
  runKey: number
  enabled: boolean
  scenario: Scenario
}) {
  const key = enabled ? `${runKey}|${direction}|${keigo}|${text}` : null
  const [state, setState] = useState<{ key: string | null; value: TranslationState }>({ key: null, value: initial })

  useEffect(() => {
    if (key === null) return
    let cancel: (() => void) | null = null
    let alive = true
    const update = (patch: Partial<TranslationState>) => {
      if (alive) setState((s) => ({ key, value: { ...(s.key === key ? s.value : initial), ...patch } }))
    }

    const fake = !isTauri ? simulatedError[scenario] : undefined
    if (fake) {
      const t = window.setTimeout(() => update({ phase: 'error', error: { kind: fake, message: 'Lỗi giả lập (prototype)' } }), 600)
      return () => window.clearTimeout(t)
    }

    void startTranslation({ direction, text, keigo, profile }, (e) => {
      if (e.type === 'thinking') update({ phase: 'thinking' })
      if (e.type === 'delta') update({ phase: 'streaming', sections: e.sections })
      if (e.type === 'done') update({ phase: 'done', sections: e.sections, rateLimit: e.rateLimit })
      if (e.type === 'error' && e.kind !== 'cancelled') update({ phase: 'error', error: { kind: e.kind, message: e.message } })
    }).then((c) => {
      if (alive) cancel = c
      else c()
    })
    return () => {
      alive = false
      cancel?.()
    }
    // `profile` is read when a run starts; editing it should not restart the current translation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.key === key ? state.value : initial
}
