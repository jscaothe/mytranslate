import { describe, expect, it } from 'vitest'
import { diffChars } from './diff'

describe('diffChars', () => {
  it('marks a keigo correction precisely', () => {
    expect(diffChars('明日までに確認してください。', '明日までにご確認いただけますでしょうか。')).toEqual([
      { text: '明日までに', type: 'same' },
      { text: 'ご', type: 'ins' },
      { text: '確認', type: 'same' },
      { text: 'してください', type: 'del' },
      { text: 'いただけますでしょうか', type: 'ins' },
      { text: '。', type: 'same' },
    ])
  })

  it('returns one unchanged part for identical text', () => {
    expect(diffChars('確認しました。', '確認しました。')).toEqual([{ text: '確認しました。', type: 'same' }])
  })

  it('handles empty sides', () => {
    expect(diffChars('', 'はい')).toEqual([{ text: 'はい', type: 'ins' }])
    expect(diffChars('はい', '')).toEqual([{ text: 'はい', type: 'del' }])
    expect(diffChars('', '')).toEqual([])
  })

  it('falls back to a plain replace for very long text', () => {
    const long = 'あ'.repeat(2500)
    expect(diffChars(long, long + 'い')).toEqual([
      { text: long, type: 'del' },
      { text: long + 'い', type: 'ins' },
    ])
  })
})
