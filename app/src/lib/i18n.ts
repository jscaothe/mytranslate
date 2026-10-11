import { useCallback } from 'react'
import { useStore } from '../store'
import type { Direction } from '../types'

/**
 * The user's own language. A Vietnamese user reads the client's Japanese and writes Vietnamese; a Japanese
 * user reads their Vietnamese colleagues and writes Japanese. It sets the language of every text in the app
 * and which way "read" (Ctrl+Alt+J) and "write" (Ctrl+Alt+K) translate.
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

/** What a popup does for this user: read the other side, write to them, or check Japanese. */
export type Role = 'read' | 'write' | 'review'

export function readDirection(lang: Lang): 'ja_vi' | 'vi_ja' {
  return lang === 'ja' ? 'vi_ja' : 'ja_vi'
}

export function writeDirection(lang: Lang): 'ja_vi' | 'vi_ja' {
  return lang === 'ja' ? 'ja_vi' : 'vi_ja'
}

export function roleOf(direction: Direction, lang: Lang): Role {
  if (direction === 'review_ja') return 'review'
  return direction === readDirection(lang) ? 'read' : 'write'
}

/** The language a translation produces. */
export function targetLang(direction: Direction): Lang {
  return direction === 'ja_vi' ? 'vi' : 'ja'
}

export function sourceLang(direction: Direction): Lang {
  return direction === 'vi_ja' ? 'vi' : 'ja'
}

/** The other side's language. */
export const otherLang = (lang: Lang): Lang => (lang === 'ja' ? 'vi' : 'ja')

/** What the user asked for: a hotkey, or a toolbar button ("translate" is `auto`). */
export type Action = 'read' | 'write' | 'auto' | 'review'

/** Latin letters with Vietnamese diacritics. */
const VIETNAMESE_LETTER = /[À-ưẠ-ỹ]/

export function hasJapanese(text: string): boolean {
  return /[぀-ヿ一-鿿]/.test(text)
}

/** Japanese with at most a few Latin words (API, UAT, file names...), as in popup.rs. */
export function isJapaneseOnly(text: string): boolean {
  const latinWords = text.split(/[^A-Za-zÀ-ưẠ-ỹ]+/).filter(Boolean).length
  return hasJapanese(text) && !VIETNAMESE_LETTER.test(text) && latinWords <= 3
}

/** Which way to translate, like `popup::route` in the real app. */
export function route(action: Action, text: string, lang: Lang): Direction {
  const read = readDirection(lang)
  const write = writeDirection(lang)
  const alreadyOther = lang === 'vi' ? isJapaneseOnly(text) : !hasJapanese(text)
  switch (action) {
    case 'read':
      return read
    // Ctrl+Alt+K on text already in the other side's language: the user wants to read it, not replace it.
    case 'write':
      return alreadyOther ? read : write
    case 'auto':
      return hasJapanese(text) ? 'ja_vi' : 'vi_ja'
    case 'review':
      return hasJapanese(text) ? 'review_ja' : 'vi_ja'
  }
}
