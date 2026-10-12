import type { Direction, IssueKind, ReviewIssue } from '../types'
import { pick, type Lang } from './i18n'

export const ISSUE_KINDS: IssueKind[] = ['grammar', 'politeness', 'natural', 'spelling', 'word_choice', 'other']

export function isReview(direction: Direction): direction is 'review_ja' | 'review_vi' {
  return direction === 'review_ja' || direction === 'review_vi'
}

/** The language of the sentence a review checks. */
export function reviewedLang(direction: 'review_ja' | 'review_vi'): Lang {
  return direction === 'review_ja' ? 'ja' : 'vi'
}

/** Names the AI used before the kinds were fixed, in either language, mapped to a kind. */
const OLD_NAMES: Record<string, IssueKind> = {
  'ngữ pháp': 'grammar',
  文法: 'grammar',
  'kính ngữ': 'politeness',
  'xưng hô': 'politeness',
  敬語: 'politeness',
  'tự nhiên': 'natural',
  自然さ: 'natural',
  'chính tả': 'spelling',
  表記: 'spelling',
  'dùng từ': 'word_choice',
  語彙: 'word_choice',
}

function kindOf(name: string): IssueKind {
  const n = name.trim().toLowerCase()
  return (ISSUE_KINDS as string[]).includes(n) ? (n as IssueKind) : (OLD_NAMES[n] ?? 'other')
}

/**
 * The review's issues, one per line as `kind || wrong || fix || explanation`. A line without `||` is an
 * explanation only, or the older `Kind: explanation`.
 */
export function parseIssues(text: string): ReviewIssue[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes('||')) {
        const [kind = '', wrong = '', fix = '', ...rest] = line.split('||').map((p) => p.trim())
        // A "fix" that changes nothing is only a remark: keep its explanation.
        const same = wrong === fix
        return { kind: kindOf(kind), wrong: same ? '' : wrong, fix: same ? '' : fix, text: rest.join(' || ') }
      }
      const at = line.search(/[:：]/)
      if (at > 0 && at < 20) {
        const kind = kindOf(line.slice(0, at))
        if (kind !== 'other') return { kind, wrong: '', fix: '', text: line.slice(at + 1).trim() }
      }
      return { kind: 'other' as const, wrong: '', fix: '', text: line }
    })
}

/** The kind's name in the user's language. Politeness is keigo in Japanese and forms of address in Vietnamese. */
export function issueLabel(kind: IssueKind, textLang: Lang, lang: Lang): string {
  const t = (vi: string, ja: string) => pick(lang, vi, ja)
  switch (kind) {
    case 'grammar':
      return t('Ngữ pháp', '文法')
    case 'politeness':
      return textLang === 'ja' ? t('Kính ngữ', '敬語') : t('Xưng hô', '呼び方')
    case 'natural':
      return t('Tự nhiên', '自然さ')
    case 'spelling':
      return t('Chính tả', '表記')
    case 'word_choice':
      return t('Dùng từ', '語彙')
    case 'other':
      return t('Khác', 'その他')
  }
}
