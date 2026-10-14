import { ArrowUpCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { locale, useLang, useT } from '../lib/i18n'
import { formatBytes, type InstallState, type UpdateStatus } from '../lib/updates'
import { cx, pressable } from './styles'
import { Button } from './ui'

/** Download progress, or the reason the update failed. */
export function InstallProgress({ install }: { install: InstallState }) {
  const t = useT()
  if (install.phase === 'idle') return null
  if (install.phase === 'error') {
    return (
      <p role="alert" className="text-[12.5px] text-bad">
        {t('Không cập nhật được', 'アップデートできません')}: {install.message}
      </p>
    )
  }
  const pct = install.phase === 'downloading' && install.total ? Math.min(100, (install.downloaded / install.total) * 100) : null
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <div
          className={pct === null ? 'h-full w-1/3 animate-pulse rounded-full bg-accent' : 'h-full rounded-full bg-accent transition-[width]'}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className="text-[12px] text-ink-2">
        {install.phase === 'installing'
          ? t('Đang cài, app sẽ tự mở lại…', 'インストール中です。アプリは自動で再起動します…')
          : `${t('Đang tải', 'ダウンロード中')}${install.total ? ` ${formatBytes(install.downloaded)} / ${formatBytes(install.total)}` : '…'}`}
      </span>
    </div>
  )
}

/** A strip at the top of the main window while an update is waiting. */
export function UpdateBanner({
  status,
  install,
  onInstall,
}: {
  status: UpdateStatus | null
  install: InstallState
  onInstall: () => void
}) {
  const t = useT()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const available = status?.available
  if (!available || dismissed === available.version) return null
  const busy = install.phase === 'downloading' || install.phase === 'installing'
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/25 bg-accent-soft px-5 py-2">
      <ArrowUpCircle size={16} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink">
          {t(`Có phiên bản mới ${available.version}`, `新しいバージョン ${available.version} があります`)}
        </div>
        {busy || install.phase === 'error' ? (
          <div className="mt-1 max-w-[420px]">
            <InstallProgress install={install} />
          </div>
        ) : (
          available.notes && <div className="truncate text-[12.5px] text-ink-2">{available.notes}</div>
        )}
      </div>
      <Button size="sm" variant="primary" disabled={busy} onClick={onInstall}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {t('Cập nhật và khởi động lại', 'アップデートして再起動')}
      </Button>
      {!busy && (
        <button
          type="button"
          aria-label={t('Để sau', '後で')}
          title={t('Để sau', '後で')}
          onClick={() => setDismissed(available.version)}
          className={cx('flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink', pressable)}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/** "Bạn đang dùng bản mới nhất" and when it was checked. */
export function UpToDate({ status }: { status: UpdateStatus }) {
  const t = useT()
  const lang = useLang()
  const time = status.checkedAt
    ? new Date(status.checkedAt).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-good">
      <CheckCircle2 size={15} /> {t('Đang dùng bản mới nhất', '最新バージョンです')}
      {time && <span className="text-ink-3">{t(`(kiểm tra lúc ${time})`, `（${time} に確認）`)}</span>}
    </span>
  )
}
