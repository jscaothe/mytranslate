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
      primary: true,
    },
    review: {
      name: t('Kiểm tra câu', '文章チェック'),
      description: t(
        'Kiểm tra câu bạn viết bằng chính ngôn ngữ đó (tiếng Nhật hoặc tiếng Việt) và đề xuất cách sửa.',
        '書いた文を、その言語（日本語またはベトナム語）のままチェックし、修正案を出します。',
      ),
      icon: SpellCheck,
      label: () => t('Kiểm tra', 'チェック'),
    },
    copyTranslation: {
      name: t('Dịch và chép', '翻訳してコピー'),
      description: t('Dịch rồi sao chép thẳng vào clipboard, không mở popup.', '翻訳結果をポップアップを開かずにクリップボードへコピーします。'),
      icon: ClipboardCopy,
      label: () => t('Dịch và chép', '翻訳してコピー'),
      title: t('Dịch rồi sao chép luôn, không mở popup', 'ポップアップを開かずに翻訳してコピー'),
    },
  }
}

/** Buttons to draw on the toolbar, in the user's order. */
export function visibleQuickActions(items: QuickActionItem[]): QuickActionId[] {
  return items.filter((i) => i.enabled).map((i) => i.id)
}
