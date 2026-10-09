import { Plus } from 'lucide-react'
import { useRef } from 'react'
import { cx } from './styles'

export const PROFILE_PROMPT_LIMIT = 2000

/** Starter lines the user can insert, so a blank box is never the only guidance. */
const snippets = [
  { label: 'Tên và vai trò', text: 'Tôi là ... (tên tiếng Nhật: ...), vai trò ... tại công ty ....' },
  { label: 'Dự án và khách hàng', text: 'Tôi đang làm dự án ... cho khách hàng ..., thường trao đổi với ....' },
  { label: 'Cách xưng hô', text: 'Khi viết tiếng Nhật, hãy xưng hô khiêm nhường và gọi khách là 〇〇様.' },
  { label: 'Thuật ngữ', text: 'Giữ nguyên tiếng Anh các thuật ngữ: ....' },
  { label: 'Chữ ký', text: 'Ký tên "..." ở cuối tin nhắn dài.' },
]

export function ProfilePromptEditor({
  value,
  onChange,
  rows = 7,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const over = value.length > PROFILE_PROMPT_LIMIT

  const insert = (text: string) => {
    const next = value.trim() ? `${value.replace(/\s+$/, '')}\n${text}` : text
    onChange(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      // Select the first placeholder so the user can type over it.
      const start = next.lastIndexOf(text) + text.indexOf('...')
      if (text.includes('...')) el.setSelectionRange(start, start + 3)
      else el.setSelectionRange(next.length, next.length)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Viết tự do về bạn, dự án, khách hàng và cách bạn muốn Claude viết tiếng Nhật. Ví dụ: Tôi là BrSE, làm dự án đặt phòng cho CustomerX..."
        aria-label="Hồ sơ dạng prompt"
        className={cx(
          'w-full resize-y rounded-md border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none',
          over ? 'border-bad' : 'border-line focus:border-accent',
        )}
      />
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {snippets.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => insert(s.text)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
            >
              <Plus size={12} /> {s.label}
            </button>
          ))}
        </div>
        <span className={cx('shrink-0 pt-1 text-[12px] tabular-nums', over ? 'font-semibold text-bad' : 'text-ink-3')}>
          {value.length.toLocaleString('vi-VN')} / {PROFILE_PROMPT_LIMIT.toLocaleString('vi-VN')}
        </span>
      </div>
    </div>
  )
}
