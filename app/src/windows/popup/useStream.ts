import { useEffect, useState } from 'react'

interface Progress {
  key: string | null
  count: number
  started: boolean
}

/**
 * Reveals `full` character by character to imitate a streamed Claude reply.
 * Changing `runKey` restarts the stream (for example after a keigo change).
 */
export function useStream(full: string | null, runKey: number, startDelayMs = 650, charMs = 22) {
  const key = full === null ? null : `${runKey}:${full}`
  const [progress, setProgress] = useState<Progress>({ key: null, count: 0, started: false })

  useEffect(() => {
    if (key === null || full === null) return
    let count = 0
    let timer = window.setTimeout(function tick() {
      count = Math.min(full.length, count + 2)
      setProgress({ key, count, started: true })
      if (count < full.length) timer = window.setTimeout(tick, charMs)
    }, startDelayMs)
    return () => window.clearTimeout(timer)
  }, [key, full, startDelayMs, charMs])

  // A new key starts from scratch without waiting for the effect.
  const current = progress.key === key ? progress : { count: 0, started: false }
  return {
    key,
    text: full === null ? '' : full.slice(0, current.count),
    started: current.started,
    done: full !== null && current.started && current.count >= full.length,
  }
}
