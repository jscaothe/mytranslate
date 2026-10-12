// Canned responses that stand in for Claude. No real translation happens in the prototype.
import { diffChars } from './diff'
import type { Lang } from './i18n'
import type { IssueKind, Keigo, ReviewResult, TranslationResult } from '../types'

export function isJapanese(text: string): boolean {
  return /[぀-ヿ一-鿿]/.test(text)
}

const jaToVi: Record<string, TranslationResult> = {
  'ログイン画面でエラーが出ています。先ほどの修正は反映済みでしょうか？': {
    translation: 'Màn hình đăng nhập đang báo lỗi. Bản sửa lúc nãy (sửa lỗi session) đã được áp dụng lên môi trường chưa ạ?',
    notes: [
      { kind: 'context', text: '"先ほどの修正" là bản sửa lỗi session trong thread này.' },
      { kind: 'glossary', text: 'Glossary: 反映 = áp dụng (lên môi trường).' },
    ],
  },
  '確認しました。問題なく動作しています。ありがとうございます。': {
    translation: 'Tôi đã kiểm tra rồi. Mọi thứ đang hoạt động bình thường. Cảm ơn bên em.',
    notes: [],
  },
  '別件ですが、11月のリリース日程について相談させてください。来週の水曜日は可能でしょうか。': {
    translation: 'Một việc khác: tôi muốn trao đổi về lịch release tháng 11. Thứ Tư tuần sau có được không?',
    notes: [{ kind: 'context', text: 'Nối tiếp thread "Lịch release tháng 11" từ hôm qua.' }],
  },
  'おはようございます。本日もよろしくお願いいたします。': {
    translation: 'Chào buổi sáng. Hôm nay cũng mong mọi người giúp đỡ.',
    notes: [{ kind: 'keigo', text: 'Câu chào đầu ngày quen thuộc, không cần trả lời dài.' }],
  },
  '本日15時から定例会議を行います。議題は事前に共有いたします。': {
    translation: 'Hôm nay họp định kỳ từ 15 giờ. Nội dung họp sẽ được chia sẻ trước.',
    notes: [{ kind: 'glossary', text: 'Glossary: 定例会議 = họp định kỳ.' }],
  },
  '画面Bの入力チェック仕様を更新しましたので、ご確認ください。不明点があれば明日までにご連絡ください。': {
    translation:
      'Tôi đã cập nhật spec kiểm tra nhập liệu của màn hình B, nhờ bên em xem giúp. Nếu có điểm nào chưa rõ thì liên hệ tôi trước ngày mai nhé.',
    notes: [],
  },
  '先ほどの修正はデプロイ済みです。お手数ですが、再度ご確認いただけますでしょうか。': {
    translation: 'Bản sửa lúc nãy đã được deploy. Xin lỗi đã làm phiền, anh có thể kiểm tra lại được không ạ?',
    notes: [],
  },
}

interface ViJaEntry {
  match: RegExp
  out: Record<Keigo, { ja: string; vi: string }>
  notes: Partial<Record<Keigo, TranslationResult['notes']>>
}

const viToJa: ViJaEntry[] = [
  {
    // A message of several lines: the translation and its reading back keep one line per line.
    match: /\n/,
    out: {
      casual: {
        ja: '・ログインのバグを直しました\n・画面Bの仕様を更新しました',
        vi: '・Đã sửa bug đăng nhập\n・Đã cập nhật spec màn hình B',
      },
      polite: {
        ja: '・ログインのバグを修正しました。\n・画面Bの仕様を更新しました。',
        vi: '・Đã sửa bug đăng nhập.\n・Đã cập nhật spec màn hình B.',
      },
      formal: {
        ja: '・ログインの不具合を修正いたしました。\n・画面Bの仕様を更新いたしました。',
        vi: '・Tôi xin phép đã sửa lỗi đăng nhập.\n・Tôi xin phép đã cập nhật spec màn hình B.',
      },
    },
    notes: {},
  },
  {
    match: /deploy|triển khai/i,
    out: {
      casual: { ja: 'さっきの修正、デプロイしました。もう一回確認してもらえますか？', vi: 'Bản sửa lúc nãy, tôi deploy rồi. Kiểm tra lại giúp được không?' },
      polite: {
        ja: '先ほどの修正はデプロイ済みです。再度ご確認いただけますか。',
        vi: 'Bản sửa lúc nãy đã được deploy. Anh kiểm tra lại giúp được không ạ?',
      },
      formal: {
        ja: '先ほどの修正はデプロイ済みです。お手数ですが、再度ご確認いただけますでしょうか。',
        vi: 'Bản sửa lúc nãy đã được deploy. Xin lỗi đã làm phiền, anh có thể kiểm tra lại được không ạ?',
      },
    },
    notes: {
      casual: [{ kind: 'keigo', text: 'Mức thân mật chỉ nên dùng với dev phía khách đã quen.' }],
      formal: [{ kind: 'keigo', text: 'Thêm お手数ですが để lịch sự hơn khi nhờ khách kiểm tra.' }],
    },
  },
  {
    match: /release|thứ tư|lịch/i,
    out: {
      casual: { ja: '来週の水曜日で大丈夫です。', vi: 'Thứ Tư tuần sau thì được.' },
      polite: {
        ja: '来週の水曜日で問題ございません。詳細なスケジュールは改めてお送りします。',
        vi: 'Thứ Tư tuần sau không có vấn đề gì. Lịch chi tiết tôi sẽ gửi lại sau.',
      },
      formal: {
        ja: '来週の水曜日にて問題ございません。詳細なスケジュールにつきましては、改めてご連絡いたします。',
        vi: 'Thứ Tư tuần sau không có vấn đề gì ạ. Về lịch chi tiết, tôi xin phép liên lạc lại sau.',
      },
    },
    notes: {
      casual: [{ kind: 'context', text: 'Trả lời câu hỏi về lịch release tháng 11 của anh Tanaka.' }],
      polite: [{ kind: 'context', text: 'Trả lời câu hỏi về lịch release tháng 11 của anh Tanaka.' }],
      formal: [
        { kind: 'context', text: 'Trả lời câu hỏi về lịch release tháng 11 của anh Tanaka.' },
        { kind: 'keigo', text: 'につきましては trang trọng hơn については.' },
      ],
    },
  },
  {
    match: /cảm ơn/i,
    out: {
      casual: { ja: 'ありがとうございます！', vi: 'Cảm ơn nhé!' },
      polite: { ja: 'ご確認ありがとうございます。', vi: 'Cảm ơn anh đã kiểm tra.' },
      formal: { ja: 'ご確認いただき、誠にありがとうございます。', vi: 'Xin chân thành cảm ơn anh đã kiểm tra.' },
    },
    notes: {},
  },
]

const viToJaFallback: ViJaEntry['out'] = {
  casual: { ja: '了解です。確認してまた連絡します。', vi: 'Hiểu rồi. Tôi kiểm tra rồi liên lạc lại.' },
  polite: { ja: '承知しました。確認のうえ、改めてご連絡します。', vi: 'Tôi đã hiểu. Tôi sẽ kiểm tra và liên lạc lại.' },
  formal: {
    ja: '承知いたしました。確認のうえ、改めてご連絡いたします。',
    vi: 'Tôi xin phép đã hiểu. Tôi sẽ kiểm tra và liên lạc lại ạ.',
  },
}

/** A Japanese user reading the Vietnamese team's messages (the sample chat of the Japanese prototype). */
const viToJaRead: Record<string, string> = {
  'Em đã sửa lỗi màn hình đăng nhập và deploy lên staging rồi ạ. Anh kiểm tra giúp em nhé.':
    'ログイン画面の不具合を修正し、ステージングにデプロイしました。ご確認をお願いします。',
  'Em đã test lại toàn bộ luồng đăng nhập, không có vấn đề gì ạ.': 'ログインの流れをすべて再テストしましたが、問題ありませんでした。',
  'Về lịch release tháng 11, bên em đề xuất thứ Tư tuần sau. Anh thấy có được không ạ?':
    '11月のリリース日程について、来週の水曜日を提案します。いかがでしょうか。',
  'Chào buổi sáng mọi người. Hôm nay họp định kỳ lúc 15 giờ ạ.': '皆さん、おはようございます。本日15時から定例会議です。',
  'Em đã cập nhật spec màn hình B theo góp ý của anh. Anh xem giúp em trước ngày mai nhé.':
    'ご指摘に沿って画面Bの仕様を更新しました。明日までにご確認いただけますか。',
  'Tôi đã kiểm tra, không còn lỗi nữa. Cảm ơn em.': '確認しました。エラーはもう出ていません。ありがとうございます。',
}

interface JaViEntry {
  match: RegExp
  /** The Vietnamese to send, in each register, with its Japanese reading back. */
  out: Record<Keigo, { vi: string; ja: string }>
}

/** A Japanese user writing to the Vietnamese team. */
const jaToViWrite: JaViEntry[] = [
  {
    match: /水曜|リリース|日程/,
    out: {
      casual: { vi: 'Thứ Tư tuần sau ok nhé. Em gửi lịch chi tiết cho anh nha.', ja: '来週の水曜日でOK。詳しいスケジュールを送ってね。' },
      polite: {
        vi: 'Thứ Tư tuần sau được nhé. Em gửi giúp anh lịch chi tiết.',
        ja: '来週の水曜日で大丈夫です。詳しいスケジュールを送ってください。',
      },
      formal: {
        vi: 'Thứ Tư tuần sau không có vấn đề gì. Nhờ em gửi giúp anh lịch chi tiết nhé.',
        ja: '来週の水曜日で問題ありません。詳細なスケジュールを送っていただけますか。',
      },
    },
  },
  {
    match: /本番|反映|デプロイ/,
    out: {
      casual: { vi: 'Ok rồi, em đưa lên production luôn nhé.', ja: 'OK、そのまま本番に上げてね。' },
      polite: { vi: 'Anh đã kiểm tra xong. Em đưa lên production giúp anh nhé.', ja: '確認しました。本番に反映をお願いします。' },
      formal: {
        vi: 'Anh đã kiểm tra xong, không có vấn đề gì. Nhờ em đưa lên môi trường production giúp anh.',
        ja: '確認が完了し、問題ありませんでした。本番環境への反映をお願いします。',
      },
    },
  },
]

const jaToViWriteFallback: JaViEntry['out'] = {
  casual: { vi: 'Ok, anh hiểu rồi. Anh xem rồi báo lại nhé.', ja: 'OK、わかった。確認して連絡するね。' },
  polite: { vi: 'Anh hiểu rồi. Anh sẽ kiểm tra rồi báo lại em nhé.', ja: 'わかりました。確認して連絡します。' },
  formal: { vi: 'Anh đã hiểu. Anh sẽ kiểm tra và liên lạc lại với em.', ja: '承知しました。確認のうえ、改めて連絡します。' },
}

export function translate(text: string, direction: 'ja_vi' | 'vi_ja', keigo: Keigo, lang: Lang = 'vi'): TranslationResult {
  const clean = text.trim()
  if (lang === 'ja') {
    if (direction === 'vi_ja') {
      return {
        translation: viToJaRead[clean] ?? `（模擬翻訳）「${clean.slice(0, 40)}${clean.length > 40 ? '…' : ''}」の日本語訳`,
        notes: [],
      }
    }
    const out = (jaToViWrite.find((e) => e.match.test(clean))?.out ?? jaToViWriteFallback)[keigo]
    return { translation: out.vi, backTranslation: out.ja, notes: [] }
  }
  if (direction === 'ja_vi') {
    return (
      jaToVi[clean] ?? {
        translation: `(Bản dịch mô phỏng) Nội dung tiếng Việt của: "${clean.slice(0, 40)}${clean.length > 40 ? '...' : ''}"`,
        notes: [{ kind: 'context', text: 'Prototype chỉ có bản dịch mẫu cho các tin có sẵn trong kênh chat.' }],
      }
    )
  }
  const entry = viToJa.find((e) => e.match.test(clean))
  const out = (entry?.out ?? viToJaFallback)[keigo]
  return { translation: out.ja, backTranslation: out.vi, notes: entry?.notes[keigo] ?? [] }
}

/** A mistake the prototype knows how to spot, with its explanation for each user language. */
interface MockFix {
  kind: IssueKind
  wrong: string
  fix: string
  why: Record<Lang, string>
}

const japaneseFixes: MockFix[] = [
  {
    kind: 'politeness',
    wrong: '確認してください',
    fix: 'ご確認いただけますでしょうか',
    why: {
      vi: '"確認してください" nghe hơi ra lệnh với khách. Nên dùng "ご確認いただけますでしょうか".',
      ja: '「確認してください」は命令的に聞こえます。「ご確認いただけますでしょうか」がおすすめです。',
    },
  },
  {
    kind: 'politeness',
    wrong: 'ありがとう。',
    fix: 'ありがとうございます。',
    why: { vi: 'Với khách hàng cần dùng "ありがとうございます".', ja: 'ビジネスでは「ありがとうございます」を使います。' },
  },
]

const vietnameseFixes: MockFix[] = [
  {
    kind: 'spelling',
    wrong: 'ko',
    fix: 'không',
    why: { vi: 'Viết tắt "ko" không hợp với tin nhắn công việc.', ja: '「ko」は略語です。仕事のメッセージでは「không」と書きます。' },
  },
  {
    kind: 'spelling',
    wrong: 'đc',
    fix: 'được',
    why: { vi: 'Viết đủ "được" cho trang trọng.', ja: '「đc」は略語です。「được」と書きます。' },
  },
  {
    kind: 'politeness',
    wrong: 'e',
    fix: 'em',
    why: { vi: 'Xưng "em" đầy đủ khi nhắn với anh chị.', ja: '自分を指す「em」を略さずに書きます。' },
  },
  {
    kind: 'word_choice',
    wrong: 'check',
    fix: 'kiểm tra',
    why: { vi: 'Dùng "kiểm tra" thay cho từ tiếng Anh "check".', ja: '英語の「check」より「kiểm tra」が自然です。' },
  },
]

/** The prototype's check of a sentence the user wrote: canned fixes for a few common mistakes. */
export function review(text: string, direction: 'review_ja' | 'review_vi', lang: Lang = 'vi'): ReviewResult {
  const clean = text.trim()
  const textLang: Lang = direction === 'review_ja' ? 'ja' : 'vi'
  // Vietnamese mistakes are whole words ("e", "ko"), never part of a longer one.
  const pattern = (f: MockFix) =>
    textLang === 'ja' ? new RegExp(escapeRegExp(f.wrong), 'g') : new RegExp(`(?<!\\p{L})${escapeRegExp(f.wrong)}(?!\\p{L})`, 'giu')
  const fixes = (textLang === 'ja' ? japaneseFixes : vietnameseFixes).filter((f) => pattern(f).test(clean))
  const suggestion = fixes.reduce((s, f) => s.replace(pattern(f), f.fix), clean)
  // The meaning only helps when the sentence is not in the user's own language.
  const meaning =
    textLang === lang
      ? ''
      : textLang === 'ja'
        ? clean.includes('確認')
          ? 'Anh có thể kiểm tra giúp được không ạ?'
          : '(Nghĩa mô phỏng của câu bạn viết)'
        : '（あなたが書いたベトナム語の意味の例）'
  return {
    verdict: fixes.length === 0 ? 'ok' : fixes.some((f) => f.kind === 'politeness') && textLang === 'ja' ? 'error' : 'suggest',
    issues: fixes.map((f) => ({ kind: f.kind, wrong: f.wrong, fix: f.fix, text: f.why[lang] })),
    diff: diffChars(clean, suggestion),
    suggestion,
    suggestionVi: meaning,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
