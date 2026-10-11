import { useT } from '../lib/i18n'
import type { ChatApp } from '../types'
import { cx } from './styles'

/** Small square badge standing in for the Slack / Teams logo. */
export function AppBadge({ app, className }: { app: ChatApp | 'other'; className?: string }) {
  const t = useT()
  return (
    <span
      aria-label={app === 'slack' ? 'Slack' : app === 'teams' ? 'Teams' : t('Ứng dụng khác', 'その他のアプリ')}
      className={cx(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9.5px] leading-none font-bold text-white',
        app === 'slack' ? 'bg-[#4a154b]' : app === 'teams' ? 'bg-[#5059c9]' : 'bg-ink-3',
        className,
      )}
    >
      {app === 'slack' ? 'S' : app === 'teams' ? 'T' : '·'}
    </span>
  )
}
