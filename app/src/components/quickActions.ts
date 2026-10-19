import { Languages, SpellCheck } from 'lucide-react'
import type { ComponentType } from 'react'
import { pick, type Lang } from '../lib/i18n'
import type { QuickActionId, QuickActionItem } from '../store'
import { KanaIcon } from './KanaIcon'

export interface QuickActionMeta {
  /** Name in Settings. */
  name: string
  description: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  /** Button text on the toolbar. */
  label: string
  primary?: boolean
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
    reading: {
      name: t('Cách đọc', '読み方'),
      description: t(
        'Chỉ hiện khi đoạn bôi đen có tiếng Nhật: xem cách đọc bằng furigana hoặc hiragana, không cần dịch.',
        '選択した文に日本語があるときだけ表示します。ふりがな・ひらがなで読み方を表示します（翻訳はしません）。',
      ),
      icon: KanaIcon,
      label: t('Cách đọc', '読み方'),
    },
  }
}

/**
 * Buttons to draw on the toolbar, in the user's order. The reading button is left out when the selection is known
 * to have no Japanese (`japanese` false); when it is not known, it shows.
 */
export function visibleQuickActions(items: QuickActionItem[], japanese: boolean | null = null): QuickActionId[] {
  return items.filter((i) => i.enabled && (i.id !== 'reading' || japanese !== false)).map((i) => i.id)
}
