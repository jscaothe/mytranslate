import { ClipboardCopy, Languages, SpellCheck, type LucideIcon } from 'lucide-react'
import { pick, type Lang } from '../lib/i18n'
import type { QuickActionId, QuickActionItem } from '../store'

export interface QuickActionMeta {
  /** Name in Settings. */
  name: string
  description: string
  icon: LucideIcon
  /** Button text on the toolbar; may depend on the selected language (`null`: not known yet). */
  label: (japanese: boolean | null) => string
  /** Whether the button makes sense for the current selection. */
  applies: (japanese: boolean | null) => boolean
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
        'Mở popup dịch; tự đổi thành "Dịch sang Việt" hoặc "Dịch sang Nhật" theo đoạn bôi đen.',
        '翻訳ポップアップを開きます。選択した文に合わせて「日本語に翻訳」「ベトナム語に翻訳」に変わります。',
      ),
      icon: Languages,
      label: (ja) =>
        ja === null ? t('Dịch', '翻訳') : ja ? t('Dịch sang Việt', 'ベトナム語に翻訳') : t('Dịch sang Nhật', '日本語に翻訳'),
      applies: () => true,
      primary: true,
    },
    review: {
      name: t('Kiểm tra tiếng Nhật', '日本語チェック'),
      description: t(
        'Mở popup kiểm tra ngữ pháp và kính ngữ. Chỉ hiện khi đoạn bôi đen là tiếng Nhật.',
        '文法と敬語をチェックするポップアップを開きます。日本語を選択したときだけ表示されます。',
      ),
      icon: SpellCheck,
      label: () => t('Kiểm tra', 'チェック'),
      applies: (ja) => ja !== false,
    },
    copyTranslation: {
      name: t('Dịch và chép', '翻訳してコピー'),
      description: t('Dịch rồi sao chép thẳng vào clipboard, không mở popup.', '翻訳結果をポップアップを開かずにクリップボードへコピーします。'),
      icon: ClipboardCopy,
      label: () => t('Dịch và chép', '翻訳してコピー'),
      applies: () => true,
      title: t('Dịch rồi sao chép luôn, không mở popup', 'ポップアップを開かずに翻訳してコピー'),
    },
  }
}

/** Buttons to draw on the toolbar, in the user's order. */
export function visibleQuickActions(items: QuickActionItem[], japanese: boolean | null): QuickActionId[] {
  const meta = quickActionMeta('vi')
  return items.filter((i) => i.enabled && meta[i.id].applies(japanese)).map((i) => i.id)
}
