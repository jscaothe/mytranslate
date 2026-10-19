import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './claude'

/** How to read a Japanese text, as `reading::Reading` in the real app. */
export interface Reading {
  /** The text in order, with the hiragana reading of each part written in kanji. */
  parts: { text: string; ruby: string | null }[]
  /** The whole text in hiragana, with a space between phrases. */
  kana: string
}

/** Worked out on this PC (no AI): the real app analyses the text, the prototype knows the words of its samples. */
export async function japaneseReading(text: string): Promise<Reading> {
  if (isTauri) return invoke<Reading>('japanese_reading', { text })
  return mockReading(text)
}

/** The kanji words of the prototype's canned Japanese, with their readings. */
const SAMPLE_WORDS: Record<string, string> = {
  先: 'さき',
  修正: 'しゅうせい',
  再度: 'さいど',
  確認: 'かくにん',
  手数: 'てすう',
  承知: 'しょうち',
  改: 'あらた',
  連絡: 'れんらく',
  来週: 'らいしゅう',
  水曜日: 'すいようび',
  問題: 'もんだい',
  詳細: 'しょうさい',
  送: 'おく',
  了解: 'りょうかい',
  画面: 'がめん',
  仕様: 'しよう',
  更新: 'こうしん',
  不具合: 'ふぐあい',
  直: 'なお',
  誠: 'まこと',
  大丈夫: 'だいじょうぶ',
  一回: 'いっかい',
}

export function mockReading(text: string): Reading {
  const words = Object.keys(SAMPLE_WORDS).sort((a, b) => b.length - a.length)
  const parts: Reading['parts'] = []
  let kana = ''
  for (let i = 0; i < text.length; ) {
    const word = words.find((w) => text.startsWith(w, i))
    if (word) {
      parts.push({ text: word, ruby: SAMPLE_WORDS[word] })
      kana += SAMPLE_WORDS[word]
      i += word.length
      continue
    }
    const last = parts.at(-1)
    if (last && last.ruby === null) last.text += text[i]
    else parts.push({ text: text[i], ruby: null })
    kana += text[i]
    i += 1
  }
  return { parts, kana }
}
