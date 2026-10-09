// Canned responses that stand in for Claude. No real translation happens in the prototype.
import type { Confidence, DiffPart, Keigo, ReviewResult, Thread, TranslationResult } from '../types'

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

export function translate(text: string, direction: 'ja_vi' | 'vi_ja', keigo: Keigo): TranslationResult {
  const clean = text.trim()
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

export function review(text: string): ReviewResult {
  const clean = text.trim()
  if (clean.includes('確認してください')) {
    const [before, after] = clean.split('確認してください')
    const diff: DiffPart[] = [
      { text: before, type: 'same' },
      { text: '確認してください', type: 'del' },
      { text: 'ご確認いただけますでしょうか', type: 'ins' },
      { text: after.replace(/^。/, ''), type: 'same' },
      { text: '。', type: 'same' },
    ]
    return {
      verdict: 'suggest',
      issues: [
        {
          kind: 'Kính ngữ',
          span: '確認してください',
          text: '"確認してください" nghe hơi ra lệnh với khách. Nên dùng "ご確認いただけますでしょうか".',
        },
      ],
      diff: diff.filter((p) => p.text),
      suggestion: `${before}ご確認いただけますでしょうか。`,
      suggestionVi: 'Anh có thể kiểm tra giúp được không ạ?',
    }
  }
  if (clean.includes('ありがとう') && !clean.includes('ございます')) {
    const diff: DiffPart[] = [
      { text: 'ありがとう', type: 'same' },
      { text: 'ございます', type: 'ins' },
      { text: clean.replace('ありがとう', ''), type: 'same' },
    ]
    return {
      verdict: 'error',
      issues: [{ kind: 'Kính ngữ', span: 'ありがとう', text: 'Với khách hàng cần dùng "ありがとうございます".' }],
      diff: diff.filter((p) => p.text),
      suggestion: clean.replace('ありがとう', 'ありがとうございます'),
      suggestionVi: 'Cảm ơn anh.',
    }
  }
  return {
    verdict: 'ok',
    issues: [],
    diff: [{ text: clean, type: 'same' }],
    suggestion: clean,
    suggestionVi: '(Bản dịch mô phỏng của câu bạn viết)',
  }
}

const threadHints: { threadId: string; match: RegExp }[] = [
  { threadId: 't-login', match: /ログイン|修正|反映|deploy|đăng nhập|デプロイ|session/i },
  { threadId: 't-release', match: /リリース|release|水曜|thứ tư|lịch/i },
  { threadId: 't-payment', match: /決済|API|thanh toán|timeout/i },
  { threadId: 't-meeting', match: /会議|họp|おはよう/i },
  { threadId: 't-specb', match: /画面B|màn hình B|仕様|spec/i },
]

export function detectThread(
  conversationId: string,
  text: string,
  threads: Thread[],
  forceUncertain: boolean,
): { threadId: string | null; confidence: Confidence } {
  const candidates = threads.filter((t) => t.conversationId === conversationId)
  const pinned = candidates.find((t) => t.pinned)
  if (pinned) return { threadId: pinned.id, confidence: 'high' }
  const hit = threadHints.find((h) => h.match.test(text) && candidates.some((c) => c.id === h.threadId))
  if (hit) return { threadId: hit.threadId, confidence: forceUncertain ? 'low' : 'high' }
  if (candidates.length > 0) return { threadId: candidates[0].id, confidence: 'low' }
  return { threadId: null, confidence: 'low' }
}
