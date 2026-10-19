import { useCallback } from 'react'
import { useStore } from '../store'
import type { Direction, TextLang, TranslateDirection } from '../types'

/**
 * The user's own language. A Vietnamese user reads the client's Japanese and writes Vietnamese; a Japanese
 * user reads their Vietnamese colleagues and writes Japanese. It sets the language of every text in the app
 * and which way "read" and "write" go.
 */
export type Lang = 'vi' | 'ja'

/** Every text is written next to where it is used, as a Vietnamese and a Japanese version. */
export type T = (vi: string, ja: string) => string

export const pick = (lang: Lang, vi: string, ja: string) => (lang === 'ja' ? ja : vi)

/** Japanese when the browser (WebView2 follows Windows) is Japanese. The real app gets it from the Rust side. */
export function systemLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'vi'
}

export function useLang(): Lang {
  return useStore().settings.language
}

export function useT(): T {
  const lang = useLang()
  return useCallback((vi: string, ja: string) => pick(lang, vi, ja), [lang])
}

/** BCP 47 locale for dates and numbers. */
export const locale = (lang: Lang) => (lang === 'ja' ? 'ja-JP' : 'vi-VN')

/** What a popup does for this user: read the other side, write to them, or check a sentence they wrote. */
export type Role = 'read' | 'write' | 'review'

export function readDirection(lang: Lang): 'ja_vi' | 'vi_ja' {
  return lang === 'ja' ? 'vi_ja' : 'ja_vi'
}

export function writeDirection(lang: Lang): 'ja_vi' | 'vi_ja' {
  return lang === 'ja' ? 'ja_vi' : 'vi_ja'
}

/**
 * Reading what someone else wrote (into the user's language, or from the other side's into English), writing to
 * them (from the user's language or from English), or checking what the user wrote.
 */
export function roleOf(direction: Direction, lang: Lang): Role {
  if (!isTranslation(direction)) return 'review'
  const source = sourceLang(direction)
  if (targetLang(direction) === lang || source === otherLang(lang)) return 'read'
  return 'write'
}

export function isTranslation(direction: Direction): direction is TranslateDirection {
  return direction !== 'review_ja' && direction !== 'review_vi'
}

/** The language a translation produces; a review stays in the language of the sentence. */
export function targetLang(direction: Direction): TextLang {
  if (direction === 'review_ja') return 'ja'
  if (direction === 'review_vi') return 'vi'
  return direction.slice(3) as TextLang
}

export function sourceLang(direction: Direction): TextLang {
  if (direction === 'review_ja') return 'ja'
  if (direction === 'review_vi') return 'vi'
  return direction.slice(0, 2) as TextLang
}

/** The translation from one language into another (two different ones). */
export const translation = (from: TextLang, to: TextLang): TranslateDirection => `${from}_${to}` as TranslateDirection

/** A translation written to the other side, in their language: it follows the user's keigo level. */
export const writesToOtherSide = (direction: Direction, lang: Lang) =>
  isTranslation(direction) && targetLang(direction) === otherLang(lang)

/** The other side's language. */
export const otherLang = (lang: Lang): Lang => (lang === 'ja' ? 'vi' : 'ja')

export const TEXT_LANGS: TextLang[] = ['vi', 'ja', 'en']

/** The languages a text in `source` can be translated into. */
export const targetsFor = (source: TextLang) => TEXT_LANGS.filter((l) => l !== source)

/** A language's name, in the user's language. */
export function langName(lang: Lang, of: TextLang): string {
  const names: Record<TextLang, [string, string]> = {
    vi: ['Tiếng Việt', 'ベトナム語'],
    ja: ['Tiếng Nhật', '日本語'],
    en: ['Tiếng Anh', '英語'],
  }
  return pick(lang, ...names[of])
}

/**
 * What the user asked for: translate (Ctrl+Alt+T, the toolbar's Translate button), check what they wrote, or see how
 * to read Japanese (the toolbar's reading button).
 */
export type Action = 'auto' | 'review' | 'reading'

export function hasJapanese(text: string): boolean {
  return /[぀-ヿ一-鿿]/.test(text)
}

/** More Japanese than Latin: Japanese characters against Latin words, as `is_mostly_japanese` in popup.rs. */
export function isMostlyJapanese(text: string): boolean {
  const japanese = (text.match(/[぀-ヿ一-鿿]/g) ?? []).length
  const latinWords = text.split(/[^A-Za-zÀ-ưẠ-ỹ]+/).filter(Boolean).length
  return japanese > 0 && japanese >= latinWords
}

/**
 * Common English words that are not also Vietnamese written without diacritics ("do", "an", "to", "me") nor English
 * that Vietnamese chats mix in ("check", "fix", "ok"), as `ENGLISH_WORDS` in popup.rs.
 */
const ENGLISH_WORDS = new Set(
  ('the is are was were be been will would should could have has had this that these those with from for and of it ' +
    'its you your we our they their he she i my please thanks thank what when where which who why how not if at by ' +
    'about just also there here all any some let know need want today tomorrow yesterday sorry morning good great ' +
    'does did but or into after before yet still already us them').split(' '),
)

/** Latin text without Vietnamese diacritics in which a third of the words are common English words, as `is_english`. */
export function isEnglish(text: string): boolean {
  if (/[぀-ヿ一-鿿À-ưẠ-ỹ]/.test(text)) return false
  const words = text
    .split(/[^A-Za-z']+/)
    .map((w) => w.replace(/^'+|'+$/g, '').toLowerCase())
    .filter((w) => /[a-z]/.test(w))
  const common = words.filter((w) => ENGLISH_WORDS.has(w)).length
  return common > 0 && common * 3 >= words.length
}

/**
 * Which way to translate and where the result goes, like `popup::route` in the real app: the text's language
 * decides the way, and a check stays in that language; only what the user writes in the message box is replaced,
 * everything else is shown. English being written goes to the other side; English being read comes to the user.
 */
export function route(action: Action, text: string, lang: Lang, from: 'chat' | 'composer'): { direction: Direction; origin: 'chat' | 'composer' } {
  // Reading Japanese is reading it, wherever it was selected; without any, the reading button translates.
  if (action === 'reading' && hasJapanese(text)) return { direction: 'ja_vi', origin: 'chat' }
  const japanese = isMostlyJapanese(text)
  const direction: Direction =
    action === 'review'
      ? japanese
        ? 'review_ja'
        : 'review_vi'
      : japanese
        ? 'ja_vi'
        : isEnglish(text)
          ? translation('en', from === 'composer' ? otherLang(lang) : lang)
          : 'vi_ja'
  const writing = roleOf(direction, lang) !== 'read'
  return { direction, origin: writing && from === 'composer' ? 'composer' : 'chat' }
}
