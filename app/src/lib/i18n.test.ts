import { describe, expect, it } from 'vitest'
import { isMostlyJapanese, roleOf, route } from './i18n'

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

  it('checks Japanese only, translating Vietnamese instead', () => {
    expect(route('review', ja, 'ja', 'composer')).toEqual({ direction: 'review_ja', origin: 'composer' })
    expect(route('review', vi, 'vi', 'composer')).toEqual({ direction: 'vi_ja', origin: 'composer' })
    expect(roleOf('review_ja', 'ja')).toBe('review')
  })

  it('tells Japanese with a few English words from Vietnamese naming a Japanese term', () => {
    expect(isMostlyJapanese('UATのAPIはデプロイ済みです。')).toBe(true)
    expect(isMostlyJapanese('Em đã deploy rồi, nhờ anh kiểm tra màn hình 仕訳 giúp em nhé')).toBe(false)
  })
})
