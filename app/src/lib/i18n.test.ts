import { describe, expect, it } from 'vitest'
import { isEnglish, isMostlyJapanese, roleOf, route } from './i18n'

describe('route', () => {
  const ja = '確認お願いします。'
  const vi = 'Em đã sửa xong rồi ạ.'

  it('translates either way with one key; only what a Vietnamese user writes is replaced', () => {
    expect(route('auto', ja, 'vi', 'chat')).toEqual({ direction: 'ja_vi', origin: 'chat' })
    expect(route('auto', vi, 'vi', 'composer')).toEqual({ direction: 'vi_ja', origin: 'composer' })
    expect(route('auto', ja, 'vi', 'composer')).toEqual({ direction: 'ja_vi', origin: 'chat' })
    expect(roleOf('vi_ja', 'vi')).toBe('write')
  })

  it('reads Vietnamese and writes Japanese for a Japanese user', () => {
    expect(route('auto', vi, 'ja', 'chat')).toEqual({ direction: 'vi_ja', origin: 'chat' })
    expect(route('auto', ja, 'ja', 'composer')).toEqual({ direction: 'ja_vi', origin: 'composer' })
    expect(roleOf('ja_vi', 'ja')).toBe('write')
    expect(roleOf('vi_ja', 'ja')).toBe('read')
  })

  it('checks a sentence in its own language', () => {
    expect(route('review', ja, 'ja', 'composer')).toEqual({ direction: 'review_ja', origin: 'composer' })
    expect(route('review', ja, 'vi', 'composer')).toEqual({ direction: 'review_ja', origin: 'composer' })
    expect(route('review', vi, 'vi', 'composer')).toEqual({ direction: 'review_vi', origin: 'composer' })
    expect(route('review', vi, 'ja', 'chat')).toEqual({ direction: 'review_vi', origin: 'chat' })
    expect(roleOf('review_ja', 'ja')).toBe('review')
    expect(roleOf('review_vi', 'vi')).toBe('review')
  })

  it("reads English in the user's language and writes it to the other side", () => {
    const en = 'Please check the PR.'
    expect(route('auto', en, 'vi', 'chat')).toEqual({ direction: 'en_vi', origin: 'chat' })
    expect(route('auto', en, 'vi', 'composer')).toEqual({ direction: 'en_ja', origin: 'composer' })
    expect(route('auto', en, 'ja', 'chat')).toEqual({ direction: 'en_ja', origin: 'chat' })
    // Into English: reading the other side's message, or writing the user's own.
    expect(roleOf('ja_en', 'vi')).toBe('read')
    expect(roleOf('vi_en', 'vi')).toBe('write')
    expect(roleOf('vi_en', 'ja')).toBe('read')
  })

  it('tells English from Vietnamese, with or without diacritics', () => {
    expect(isEnglish('Can you review my PR when you have time?')).toBe(true)
    expect(isEnglish('Thanks!')).toBe(true)
    expect(isEnglish('Em đã deploy rồi, nhờ anh check giúp em')).toBe(false)
    expect(isEnglish('em deploy xong roi, anh check giup em nhe')).toBe(false)
    expect(isEnglish('OK')).toBe(false)
  })

  it('tells Japanese with a few English words from Vietnamese naming a Japanese term', () => {
    expect(isMostlyJapanese('UATのAPIはデプロイ済みです。')).toBe(true)
    expect(isMostlyJapanese('Em đã deploy rồi, nhờ anh kiểm tra màn hình 仕訳 giúp em nhé')).toBe(false)
  })
})
