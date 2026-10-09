import { ClipboardCopy, Languages, SpellCheck, type LucideIcon } from 'lucide-react'
import type { QuickActionId, QuickActionItem } from '../store'

export interface QuickActionMeta {
  /** Name in Settings. */
  name: string
  description: string
  icon: LucideIcon
  /** Button text on the toolbar; may depend on the selected language. */
  label: (japanese: boolean) => string
  /** Whether the button makes sense for the current selection. */
  applies: (japanese: boolean) => boolean
  primary?: boolean
  title?: string
}

export const quickActionMeta: Record<QuickActionId, QuickActionMeta> = {
  translate: {
    name: 'Dịch',
    description: 'Mở popup dịch; tự đổi thành "Dịch sang Việt" hoặc "Dịch sang Nhật" theo đoạn bôi đen.',
    icon: Languages,
    label: (ja) => (ja ? 'Dịch sang Việt' : 'Dịch sang Nhật'),
    applies: () => true,
    primary: true,
  },
  review: {
    name: 'Kiểm tra tiếng Nhật',
    description: 'Mở popup kiểm tra ngữ pháp và kính ngữ. Chỉ hiện khi đoạn bôi đen là tiếng Nhật.',
    icon: SpellCheck,
    label: () => 'Kiểm tra',
    applies: (ja) => ja,
  },
  copyTranslation: {
    name: 'Dịch và chép',
    description: 'Dịch rồi sao chép thẳng vào clipboard, không mở popup.',
    icon: ClipboardCopy,
    label: () => 'Dịch và chép',
    applies: () => true,
    title: 'Dịch rồi sao chép luôn, không mở popup',
  },
}

/** Buttons to draw on the toolbar, in the user's order. */
export function visibleQuickActions(items: QuickActionItem[], japanese: boolean): QuickActionId[] {
  return items.filter((i) => i.enabled && quickActionMeta[i.id].applies(japanese)).map((i) => i.id)
}
