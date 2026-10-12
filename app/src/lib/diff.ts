import type { DiffPart } from '../types'

/** Beyond this size a character LCS is too slow to run on every render; show a plain replace instead. */
const MAX_CHARS = 2000

/**
 * Character-level diff from `before` to `after` (longest common subsequence). Japanese has no spaces, so a
 * word diff would mark whole sentences as changed; per character shows exactly what the review changed.
 */
export function diffChars(before: string, after: string): DiffPart[] {
  return diffTokens(before, after, (s) => [...s])
}

/**
 * Word-level diff, for Vietnamese: a corrected word is shown whole ("ko" then "không") rather than letter by
 * letter, which would mark a stray "o" as kept.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const parts = diffTokens(before, after, (s) => s.split(/(\s+)/).filter(Boolean))
  // A change that ends with the space before the next kept word gives that space back, so no space is struck.
  for (let k = 0; k + 2 < parts.length; k++) {
    const [del, ins, same] = [parts[k], parts[k + 1], parts[k + 2]]
    if (del.type !== 'del' || ins.type !== 'ins' || same.type !== 'same') continue
    const space = /\s+$/.exec(del.text)?.[0]
    if (space && ins.text.endsWith(space) && del.text.length > space.length && ins.text.length > space.length) {
      del.text = del.text.slice(0, -space.length)
      ins.text = ins.text.slice(0, -space.length)
      same.text = space + same.text
    }
  }
  return parts
}

function diffTokens(before: string, after: string, split: (s: string) => string[]): DiffPart[] {
  if (before === after) return before ? [{ text: before, type: 'same' }] : []
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) {
    return [
      { text: before, type: 'del' },
      { text: after, type: 'ins' },
    ].filter((p) => p.text) as DiffPart[]
  }

  const a = split(before)
  const b = split(after)
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  const push = (text: string, type: DiffPart['type']) => {
    const last = parts.at(-1)
    if (last && last.type === type) last.text += text
    else parts.push({ text, type })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], 'same')
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i++], 'del')
    } else {
      push(b[j++], 'ins')
    }
  }
  while (i < a.length) push(a[i++], 'del')
  while (j < b.length) push(b[j++], 'ins')
  return tidy(parts)
}

/** A single shared character between two changes is a coincidence (like one い). Two characters can already be
 * a Japanese word (確認), so those stay. */
const MAX_COINCIDENCE = 1

/**
 * Makes a minimal diff readable: tiny shared runs between changes are folded into the change, and every
 * change block reads as "deleted text, then inserted text".
 */
function tidy(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  let del = ''
  let ins = ''
  const flush = () => {
    if (del) out.push({ text: del, type: 'del' })
    if (ins) out.push({ text: ins, type: 'ins' })
    del = ''
    ins = ''
  }
  parts.forEach((part, k) => {
    const between = k > 0 && k < parts.length - 1 && parts[k - 1].type !== 'same' && parts[k + 1].type !== 'same'
    if (part.type === 'same' && !(between && [...part.text].length <= MAX_COINCIDENCE)) {
      flush()
      out.push({ ...part })
    } else if (part.type === 'same') {
      del += part.text
      ins += part.text
    } else if (part.type === 'del') {
      del += part.text
    } else {
      ins += part.text
    }
  })
  flush()
  return out
}
