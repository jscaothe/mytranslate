import { describe, expect, it } from 'vitest'
import { issueLabel, parseIssues } from './review'

describe('parseIssues', () => {
  it('reads kind, wrong words, fix and explanation', () => {
    expect(parseIssues('spelling || ko || không || Viết tắt không hợp với tin công việc.\n\n1. politeness || e || em || Xưng em với khách.')).toEqual([
      { kind: 'spelling', wrong: 'ko', fix: 'không', text: 'Viết tắt không hợp với tin công việc.' },
      { kind: 'politeness', wrong: 'e', fix: 'em', text: 'Xưng em với khách.' },
    ])
  })

  it('tolerates the older "Kind: text" lines and free text', () => {
    expect(parseIssues('Kính ngữ: nên dùng ご確認\n敬語：「ください」は命令的です\nCâu hơi dài')).toEqual([
      { kind: 'politeness', wrong: '', fix: '', text: 'nên dùng ご確認' },
      { kind: 'politeness', wrong: '', fix: '', text: '「ください」は命令的です' },
      { kind: 'other', wrong: '', fix: '', text: 'Câu hơi dài' },
    ])
  })

  it('maps an unknown kind to other and keeps missing parts empty', () => {
    expect(parseIssues('style || ||')).toEqual([{ kind: 'other', wrong: '', fix: '', text: '' }])
  })
})

describe('issueLabel', () => {
  it('names politeness after the language of the sentence', () => {
    expect(issueLabel('politeness', 'ja', 'vi')).toBe('Kính ngữ')
    expect(issueLabel('politeness', 'vi', 'vi')).toBe('Xưng hô')
    expect(issueLabel('politeness', 'vi', 'ja')).toBe('呼び方')
    expect(issueLabel('word_choice', 'ja', 'ja')).toBe('語彙')
  })
})
