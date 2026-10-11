import { describe, expect, it } from 'vitest'
import { isJapaneseOnly, roleOf, route } from './i18n'

describe('route', () => {
  const ja = '確認お願いします。'
  const vi = 'Em đã sửa xong rồi ạ.'

  it('reads Japanese and writes Vietnamese for a Vietnamese user', () => {
    expect(route('read', ja, 'vi')).toBe('ja_vi')
    expect(route('write', vi, 'vi')).toBe('vi_ja')
    expect(route('write', ja, 'vi')).toBe('ja_vi')
    expect(roleOf('vi_ja', 'vi')).toBe('write')
  })

  it('reads Vietnamese and writes Japanese for a Japanese user', () => {
    expect(route('read', vi, 'ja')).toBe('vi_ja')
    expect(route('write', ja, 'ja')).toBe('ja_vi')
    expect(route('write', vi, 'ja')).toBe('vi_ja')
    expect(route('auto', ja, 'ja')).toBe('ja_vi')
    expect(roleOf('ja_vi', 'ja')).toBe('write')
    expect(roleOf('vi_ja', 'ja')).toBe('read')
  })

  it('checks Japanese only, translating Vietnamese instead', () => {
    expect(route('review', ja, 'ja')).toBe('review_ja')
    expect(route('review', vi, 'vi')).toBe('vi_ja')
    expect(roleOf('review_ja', 'ja')).toBe('review')
  })

  it('tells Japanese with a few English words from Vietnamese', () => {
    expect(isJapaneseOnly('UATのAPIはデプロイ済みです。')).toBe(true)
    expect(isJapaneseOnly('Em đã deploy rồi, nhờ anh kiểm tra màn hình 仕訳')).toBe(false)
  })
})
