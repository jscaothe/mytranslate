import { useCallback } from 'react'
import { useStore } from '../store'
import type { Direction } from '../types'

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

export function roleOf(direction: Direction, lang: Lang): Role {
  if (direction === 'review_ja' || direction === 'review_vi') return 'review'
  return direction === readDirection(lang) ? 'read' : 'write'
}

/** The language a translation produces; a review stays in the language of the sentence. */
export function targetLang(direction: Direction): Lang {
  return direction === 'ja_vi' || direction === 'review_vi' ? 'vi' : 'ja'
}

export function sourceLang(direction: Direction): Lang {
  return direction === 'vi_ja' || direction === 'review_vi' ? 'vi' : 'ja'
}

/** The other side's language. */
export const otherLang = (lang: Lang): Lang => (lang === 'ja' ? 'vi' : 'ja')

/** What the user asked for: translate (Ctrl+Alt+T, the toolbar's Translate button) or check what they wrote. */
export type Action = 'auto' | 'review'

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
 * Which way to translate and where the result goes, like `popup::route` in the real app: the text's language
 * decides the way, and a check stays in that language; only what the user writes in the message box is replaced,
 * everything else is shown.
 */
export function route(action: Action, text: string, lang: Lang, from: 'chat' | 'composer'): { direction: Direction; origin: 'chat' | 'composer' } {
  const japanese = isMostlyJapanese(text)
  const direction: Direction = action === 'auto' ? (japanese ? 'ja_vi' : 'vi_ja') : japanese ? 'review_ja' : 'review_vi'
  const writing = direction === writeDirection(lang) || action === 'review'
  return { direction, origin: writing && from === 'composer' ? 'composer' : 'chat' }
}
