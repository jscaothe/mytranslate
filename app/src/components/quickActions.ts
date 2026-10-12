import { Languages, SpellCheck, type LucideIcon } from 'lucide-react'
import { pick, type Lang } from '../lib/i18n'
import type { QuickActionId, QuickActionItem } from '../store'

export interface QuickActionMeta {
  /** Name in Settings. */
  name: string
  description: string
  icon: LucideIcon
  /** Button text on the toolbar. */
  label: string
  primary?: boolean
  title?: string
}

/** The toolbar buttons, worded in the user's language. */
export function quickActionMeta(lang: Lang): Record<QuickActionId, QuickActionMeta> {
  const t = (vi: string, ja: string) => pick(lang, vi, ja)
  return {
    translate: {
      name: t('Dịch', '翻訳'),
      description: t(
        'Mở popup dịch; tự nhận ra ngôn ngữ của đoạn bôi đen (tiếng Nhật dịch sang Việt, tiếng Việt dịch sang Nhật).',
        '翻訳ポップアップを開きます。選択した文の言語を自動で判別して翻訳します（日本語とベトナム語）。',
      ),
      icon: Languages,
      label: t('Dịch', '翻訳'),
      primary: true,
    },
    review: {
      name: t('Kiểm tra câu', '文章チェック'),
      description: t(
        'Kiểm tra câu bạn viết bằng chính ngôn ngữ đó (tiếng Nhật hoặc tiếng Việt) và đề xuất cách sửa.',
        '書いた文を、その言語（日本語またはベトナム語）のままチェックし、修正案を出します。',
      ),
      icon: SpellCheck,
      label: t('Kiểm tra', 'チェック'),
    },
  }
}

/** Buttons to draw on the toolbar, in the user's order. */
export function visibleQuickActions(items: QuickActionItem[]): QuickActionId[] {
  return items.filter((i) => i.enabled).map((i) => i.id)
}
