import { CircleAlert } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { Button } from './ui'

/**
 * Keeps one broken screen from blanking the whole window: it says what went wrong and offers to try again, while
 * the navigation around it keeps working.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <ScreenError message={this.state.error.message} onRetry={() => this.setState({ error: null })} />
  }
}

function ScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <CircleAlert size={28} className="text-bad" />
      <p className="text-[14px] font-semibold text-ink">{t('Màn hình này gặp lỗi', 'この画面でエラーが発生しました')}</p>
      <p className="max-w-[420px] font-mono text-[12px] break-all text-ink-2">{message}</p>
      <Button size="sm" onClick={onRetry}>
        {t('Thử lại', '再試行')}
      </Button>
    </div>
  )
}
