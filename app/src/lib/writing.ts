import { invoke } from '@tauri-apps/api/core'
import type { IssueKind } from '../types'
import { isTauri } from './claude'
import { locale, pick, type Lang } from './i18n'

/** One language's checks over a period: how many, how many needed nothing, and what went wrong. */
export interface LangStats {
  lang: Lang
  reviews: number
  /** Checks that found nothing to fix. */
  clean: number
  /** Most frequent first. */
  kinds: { kind: IssueKind; count: number }[]
  /** The same wrong words seen at least twice, most frequent first. */
  repeated: { kind: IssueKind; wrong: string; fix: string; count: number }[]
  /** Latest first. */
  recent: { kind: IssueKind; wrong: string; fix: string; explanation: string; createdAt: number }[]
}

export interface WritingStats {
  languages: LangStats[]
}

/** What the AI made of the user's mistakes in one language: a few points to work on. */
export interface WritingAdvice {
  items: { title: string; advice: string; example: string }[]
  createdAt: number
  /** New mistakes were recorded after the advice was made. */
  stale: boolean
}

/** `days: null` covers the whole history. */
export async function writingStats(days: number | null, lang: Lang): Promise<WritingStats> {
  if (isTauri) return invoke<WritingStats>('writing_stats', { days })
  return mockStats(days, lang)
}

export async function writingAdviceGet(target: Lang): Promise<WritingAdvice | null> {
  if (isTauri) return invoke<WritingAdvice | null>('writing_advice_get', { lang: target })
  return mockAdviceMade.get(target) ?? null
}

/** Asks the AI (one request) to read the recorded mistakes and say what to work on. */
export async function writingAdviceMake(target: Lang, lang: Lang): Promise<WritingAdvice> {
  if (isTauri) return invoke<WritingAdvice>('writing_advice_make', { lang: target })
  await new Promise((r) => window.setTimeout(r, 900))
  const advice = { items: MOCK_ADVICE[lang][target], createdAt: Date.now(), stale: false }
  mockAdviceMade.set(target, advice)
  return advice
}

/** "3 ngày trước", "昨日": how long ago, in the user's language. */
export function ago(ms: number, lang: Lang, now = Date.now()): string {
  const f = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' })
  const minutes = Math.round((ms - now) / 60_000)
  if (Math.abs(minutes) < 1) return pick(lang, 'vừa xong', 'たった今')
  if (Math.abs(minutes) < 60) return f.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return f.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return f.format(days, 'day')
  return f.format(Math.round(days / 30), 'month')
}

// The prototype: a few weeks of a user's checks, worded for the user's own language.

const mockAdviceMade = new Map<Lang, WritingAdvice>()

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface MockIssue {
  kind: IssueKind
  wrong: string
  fix: string
  why: Record<Lang, string>
  /** How many times, and how many days ago each one was. */
  ages: number[]
}

const MOCK_ISSUES: Record<Lang, MockIssue[]> = {
  ja: [
    {
      kind: 'politeness',
      wrong: '確認してください',
      fix: 'ご確認いただけますでしょうか',
      why: { vi: 'Nhờ khách bằng "してください" nghe như ra lệnh.', ja: '「してください」は依頼として命令的に聞こえます。' },
      ages: [0.1, 2, 6, 19, 40],
    },
    {
      kind: 'politeness',
      wrong: 'ありがとう。',
      fix: 'ありがとうございます。',
      why: { vi: 'Với khách cần dùng dạng lịch sự đầy đủ.', ja: '取引先には丁寧な形を使います。' },
      ages: [1, 12, 75],
    },
    {
      kind: 'natural',
      wrong: 'させていただきます',
      fix: 'いたします',
      why: { vi: 'Lặp "させていただきます" nhiều lần nghe nặng nề.', ja: '「させていただきます」の多用は回りくどく聞こえます。' },
      ages: [3, 33],
    },
    {
      kind: 'grammar',
      wrong: 'テストを終わりました',
      fix: 'テストが終わりました',
      why: { vi: '"終わる" là tự động từ, đi với trợ từ が.', ja: '「終わる」は自動詞なので「が」を使います。' },
      ages: [4, 50],
    },
    {
      kind: 'spelling',
      wrong: 'ログイン画面のエラ',
      fix: 'ログイン画面のエラー',
      why: { vi: 'Thiếu trường âm "ー".', ja: '長音「ー」が抜けています。' },
      ages: [9],
    },
    {
      kind: 'word_choice',
      wrong: '修理しました',
      fix: '修正しました',
      why: { vi: 'Sửa lỗi phần mềm dùng "修正", "修理" là sửa máy móc.', ja: 'ソフトの不具合には「修正」を使います。' },
      ages: [27],
    },
  ],
  vi: [
    {
      kind: 'spelling',
      wrong: 'ko',
      fix: 'không',
      why: { vi: 'Viết tắt không hợp với tin nhắn công việc.', ja: '略語は仕事のメッセージに向きません。' },
      ages: [0.2, 5, 22],
    },
    {
      kind: 'spelling',
      wrong: 'đc',
      fix: 'được',
      why: { vi: 'Viết đủ "được" cho trang trọng.', ja: '「được」と略さずに書きます。' },
      ages: [2, 45],
    },
    {
      kind: 'politeness',
      wrong: 'bạn',
      fix: 'anh',
      why: { vi: 'Gọi đồng nghiệp lớn tuổi hơn là "anh" hoặc "chị".', ja: '年上の同僚には「anh」「chị」と呼びかけます。' },
      ages: [1, 8],
    },
    {
      kind: 'word_choice',
      wrong: 'check',
      fix: 'kiểm tra',
      why: { vi: 'Dùng từ tiếng Việt thay cho "check".', ja: '英語の「check」より「kiểm tra」が自然です。' },
      ages: [6],
    },
  ],
}

/** Checks that found nothing, days ago. */
const MOCK_CLEAN: Record<Lang, number[]> = {
  ja: [0.3, 1.5, 2, 3, 5, 8, 11, 14, 20, 26, 35, 41, 60, 80, 120],
  vi: [0.5, 4, 9, 15, 31],
}

function mockStats(days: number | null, lang: Lang): WritingStats {
  const now = Date.now()
  const within = (age: number) => days === null || age <= days
  return {
    languages: (['ja', 'vi'] as const).map((target) => {
      const issues = MOCK_ISSUES[target].map((i) => ({ ...i, ages: i.ages.filter(within) })).filter((i) => i.ages.length > 0)
      const counts = new Map<IssueKind, number>()
      for (const i of issues) counts.set(i.kind, (counts.get(i.kind) ?? 0) + i.ages.length)
      const withIssues = issues.reduce((n, i) => n + i.ages.length, 0)
      const clean = MOCK_CLEAN[target].filter(within).length
      return {
        lang: target,
        reviews: withIssues + clean,
        clean,
        kinds: [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
        repeated: issues
          .filter((i) => i.ages.length >= 2)
          .map((i) => ({ kind: i.kind, wrong: i.wrong, fix: i.fix, count: i.ages.length }))
          .sort((a, b) => b.count - a.count),
        recent: issues
          .flatMap((i) => i.ages.map((age) => ({ kind: i.kind, wrong: i.wrong, fix: i.fix, explanation: i.why[lang], createdAt: now - age * DAY })))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 20),
      }
    }),
  }
}

const MOCK_ADVICE: Record<Lang, Record<Lang, WritingAdvice['items']>> = {
  vi: {
    ja: [
      {
        title: 'Nhờ khách bằng dạng hỏi, không dùng mệnh lệnh',
        advice: 'Bạn hay kết thúc lời nhờ bằng "〜してください". Với khách, hãy hỏi lịch sự bằng "〜いただけますでしょうか" hoặc "〜お願いいたします".',
        example: '確認してください → ご確認いただけますでしょうか',
      },
      {
        title: 'Giữ đủ dạng lịch sự ở câu ngắn',
        advice: 'Các câu ngắn như cảm ơn, xin lỗi thường bị rút gọn. Với khách, luôn dùng dạng đầy đủ.',
        example: 'ありがとう。 → ありがとうございます。',
      },
      {
        title: 'Bớt "させていただきます"',
        advice: 'Dùng nhiều lần trong một tin làm câu nặng nề. Thay bằng "いたします" khi không cần xin phép.',
        example: '対応させていただきます → 対応いたします',
      },
    ],
    vi: [
      {
        title: 'Viết đủ từ, không viết tắt',
        advice: 'Các từ tắt như "ko", "đc" xuất hiện nhiều lần. Trong tin công việc, viết đủ để dễ đọc và lịch sự hơn.',
        example: 'ko thấy lỗi → không thấy lỗi',
      },
      {
        title: 'Xưng hô theo vai',
        advice: 'Gọi đồng nghiệp lớn tuổi hơn bằng "anh/chị" thay vì "bạn".',
        example: 'bạn kiểm tra giúp → anh kiểm tra giúp em',
      },
    ],
  },
  ja: {
    ja: [
      {
        title: '依頼は命令形にしない',
        advice: '「〜してください」で依頼を終えることが多いです。取引先には「〜いただけますでしょうか」を使いましょう。',
        example: '確認してください → ご確認いただけますでしょうか',
      },
      {
        title: '短い文も丁寧な形で',
        advice: 'お礼やお詫びの短い文が省略されがちです。',
        example: 'ありがとう。 → ありがとうございます。',
      },
    ],
    vi: [
      {
        title: '略語を使わない',
        advice: '「ko」「đc」などの略語が何度も出ています。仕事のメッセージでは略さずに書きましょう。',
        example: 'ko thấy lỗi → không thấy lỗi',
      },
      {
        title: '相手に合った呼びかけ',
        advice: '年上の同僚には「bạn」ではなく「anh」「chị」を使います。',
        example: 'bạn kiểm tra giúp → anh kiểm tra giúp',
      },
      {
        title: '英語の混ぜすぎに注意',
        advice: '「check」などの英語はベトナム語の「kiểm tra」に置き換えると自然です。',
        example: 'check lại → kiểm tra lại',
      },
    ],
  },
}
