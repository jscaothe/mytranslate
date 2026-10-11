import { invoke } from '@tauri-apps/api/core'
import { ArrowUpCircle, Loader2, RefreshCw, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { InstallProgress, UpToDate } from '../../components/UpdatePanel'
import type { useUpdates } from '../../lib/updates'
import { Button, Hotkey, Segmented, Switch } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { keigoLabels } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { DEFAULT_QUICK_ACTION_ITEMS, useStore, type HotkeyMap } from '../../store'
import { AppScopeEditor } from './AppScopeEditor'
import { QuickActionOrderEditor } from './QuickActionOrderEditor'
import { AiProvidersGroup } from './AiProvidersGroup'

const hotkeyRows: { key: keyof HotkeyMap; label: string }[] = [
  { key: 'auto', label: 'Dịch, tự nhận diện hướng' },
  { key: 'jaVi', label: 'Dịch tiếng Nhật sang tiếng Việt' },
  { key: 'viJa', label: 'Dịch tiếng Việt sang tiếng Nhật' },
  { key: 'review', label: 'Kiểm tra câu tiếng Nhật' },
  { key: 'main', label: 'Mở cửa sổ chính' },
]

export function SettingsView({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  const { settings, updateSettings, showToast, setScreen } = useStore()
  const [recording, setRecording] = useState<keyof HotkeyMap | null>(null)
  const [confirm, setConfirm] = useState<'restore' | 'wipe' | null>(null)
  const [newBlocked, setNewBlocked] = useState('')
  const qa = settings.quickActions
  const setQa = (patch: Partial<typeof qa>) => updateSettings({ quickActions: { ...qa, ...patch } })
  const failed = (what: string) => (e: unknown) => showToast(`${what}: ${String(e)}`)
  const backup = () => {
    if (!isTauri) return showToast('Mô phỏng: lưu file mytranslate-YYYY-MM-DD.db')
    invoke<string | null>('data_backup')
      .then((path) => path && showToast(`Đã sao lưu vào ${path}`))
      .catch(failed('Không sao lưu được'))
  }
  const restore = () => {
    setConfirm(null)
    if (!isTauri) return showToast('Mô phỏng: đã khôi phục từ bản sao lưu')
    invoke<boolean>('data_restore')
      .then((done) => done && showToast('Đã khôi phục dữ liệu'))
      .catch(failed('Không khôi phục được'))
  }
  const wipe = () => {
    setConfirm(null)
    if (!isTauri) return showToast('Mô phỏng: đã xóa dữ liệu (prototype không xóa thật)')
    invoke('data_wipe')
      .then(() => showToast('Đã xóa toàn bộ dữ liệu'))
      .catch(failed('Không xóa được'))
  }
  const previewAction = () => showToast('Đây là bản xem trước, hãy thử ở màn hình Mô phỏng sử dụng')

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-6 py-6">
        <h2 className="text-[20px] font-semibold">Cài đặt</h2>

        <Group title="Phím tắt" hint="Phím tắt hoạt động trong mọi ứng dụng. Bấm vào một tổ hợp để đổi.">
          {hotkeyRows.map((row) => (
            <Row key={row.key} label={row.label}>
              <button
                type="button"
                onClick={() => setRecording(row.key)}
                onBlur={() => setRecording((r) => (r === row.key ? null : r))}
                onKeyDown={(e) => {
                  if (recording !== row.key) return
                  e.preventDefault()
                  if (e.key === 'Escape') {
                    setRecording(null)
                    return
                  }
                  const combo = comboFromEvent(e)
                  if (!combo) return
                  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                    showToast('Phím tắt toàn cục cần có Ctrl, Alt hoặc Win')
                    return
                  }
                  const clash = hotkeyRows.find((r) => r.key !== row.key && settings.hotkeys[r.key] === combo)
                  if (clash) {
                    showToast(`${combo} đang dùng cho "${clash.label}"`)
                    return
                  }
                  updateSettings({ hotkeys: { ...settings.hotkeys, [row.key]: combo } })
                  setRecording(null)
                }}
                className={cx(
                  'flex h-8 min-w-[150px] items-center justify-center rounded-md border px-3',
                  recording === row.key ? 'border-accent bg-accent-soft text-[12.5px] text-accent' : 'border-line bg-surface hover:bg-hover',
                )}
              >
                {recording === row.key ? 'Nhấn tổ hợp phím mới...' : <Hotkey combo={settings.hotkeys[row.key]} />}
              </button>
            </Row>
          ))}
        </Group>

        <Group
          title="Thao tác nhanh khi bôi đen"
          hint="Bôi đen chữ bằng chuột sẽ hiện một thanh nhỏ để chọn luôn thao tác, không cần chuyển sang bàn phím."
        >
          <Row label="Hiện thanh thao tác khi bôi đen bằng chuột">
            <Switch
              label="Hiện thanh thao tác khi bôi đen bằng chuột"
              checked={qa.enabled}
              onChange={(v) => setQa({ enabled: v })}
            />
          </Row>
          {qa.enabled && (
            <>
              <div className="flex flex-col gap-3 px-4 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13.5px] text-ink">Hiện trong ứng dụng nào</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {qa.appScope === 'all'
                        ? 'Mọi ứng dụng, trừ các ứng dụng bị chặn ở mục Giao diện và hệ thống.'
                        : 'Chỉ các ứng dụng trong danh sách dưới đây.'}
                    </div>
                  </div>
                  <Segmented
                    label="Hiện trong ứng dụng nào"
                    value={qa.appScope}
                    onChange={(v) => setQa({ appScope: v })}
                    options={[
                      { value: 'selected', label: 'Ứng dụng đã chọn' },
                      { value: 'all', label: 'Mọi ứng dụng' },
                    ]}
                  />
                </div>
                {qa.appScope === 'selected' && <AppScopeEditor apps={qa.apps} onChange={(apps) => setQa({ apps })} onError={showToast} />}
              </div>
              <div className="px-4 pt-3.5 pb-1">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13.5px] text-ink">Các nút và thứ tự hiển thị</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">Kéo tay nắm hoặc dùng mũi tên để sắp xếp. Nút đứng đầu nằm gần con trỏ nhất.</div>
                  </div>
                  <Segmented
                    label="Kiểu hiển thị nút"
                    value={qa.display}
                    onChange={(v) => setQa({ display: v })}
                    options={[
                      { value: 'iconText', label: 'Icon và chữ' },
                      { value: 'iconOnly', label: 'Chỉ icon' },
                    ]}
                  />
                </div>
                <div className="mt-2.5 rounded-md border border-line">
                  <QuickActionOrderEditor items={qa.items} onChange={(items) => setQa({ items })} onBlocked={showToast} />
                </div>
                <div className="mt-1.5 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={JSON.stringify(qa.items) === JSON.stringify(DEFAULT_QUICK_ACTION_ITEMS)}
                    onClick={() => setQa({ items: DEFAULT_QUICK_ACTION_ITEMS })}
                  >
                    Khôi phục thứ tự mặc định
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-3.5">
                <div className="text-[13.5px] text-ink">Xem trước</div>
                <PreviewLine label="Khi bôi đen tiếng Nhật">
                  <QuickActionBar japanese items={qa.items} display={qa.display} onAction={previewAction} onDismiss={() => undefined} className="animate-none" />
                </PreviewLine>
                <PreviewLine label="Khi bôi đen tiếng Việt">
                  <QuickActionBar japanese={false} items={qa.items} display={qa.display} onAction={previewAction} onDismiss={() => undefined} className="animate-none" />
                </PreviewLine>
              </div>
            </>
          )}
        </Group>

        <Group title="Dịch">
          <Row label="Mức kính ngữ mặc định">
            <Segmented
              label="Mức kính ngữ mặc định"
              value={settings.defaultKeigo}
              onChange={(k) => updateSettings({ defaultKeigo: k })}
              options={(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabels[k] }))}
            />
          </Row>
        </Group>

        <AiProvidersGroup group={Group} row={Row} />

        <Group title="Giao diện và hệ thống">
          <Row label="Chủ đề">
            <Segmented
              label="Chủ đề"
              value={settings.theme}
              onChange={(t) => updateSettings({ theme: t })}
              options={[
                { value: 'system', label: 'Theo hệ thống' },
                { value: 'light', label: 'Sáng' },
                { value: 'dark', label: 'Tối' },
              ]}
            />
          </Row>
          <Row label="Khởi động cùng Windows">
            <Switch label="Khởi động cùng Windows" checked={settings.autostart} onChange={(v) => updateSettings({ autostart: v })} />
          </Row>
          <Row label="Ứng dụng bị chặn" hint="Phím tắt không hoạt động trong các ứng dụng này.">
            <div className="flex w-80 flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {settings.blockedApps.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
                    {a}
                    <button
                      type="button"
                      aria-label={`Bỏ chặn ${a}`}
                      onClick={() => updateSettings({ blockedApps: settings.blockedApps.filter((x) => x !== a) })}
                      className="flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const v = newBlocked.trim()
                  if (v && !settings.blockedApps.includes(v)) updateSettings({ blockedApps: [...settings.blockedApps, v] })
                  setNewBlocked('')
                }}
              >
                <input className={cx(inputClass, 'flex-1')} placeholder="vd: Bitwarden.exe" value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} />
                <Button type="submit" disabled={!newBlocked.trim()}>
                  Thêm
                </Button>
              </form>
            </div>
          </Row>
        </Group>

        <UpdatesGroup updates={updates} auto={settings.autoUpdateCheck} onAuto={(v) => updateSettings({ autoUpdateCheck: v })} />

        <Group
          title="Dữ liệu"
          hint={
            isTauri
              ? 'Lịch sử dịch, thread và glossary nằm trên máy này, trong %LOCALAPPDATA%\\com.mytranslate.desktop\\history.db.'
              : 'Toàn bộ lịch sử dịch nằm trên máy này.'
          }
        >
          <Row label="Hướng dẫn ban đầu" hint="Kiểm tra lại kết nối Claude Code và thử dịch.">
            <Button onClick={() => (isTauri ? updateSettings({ onboarded: false }) : setScreen('onboarding'))}>Xem lại</Button>
          </Row>
          <Row label="Giữ lịch sử" hint="Tin cũ hơn thời hạn này được tự xóa, thread không còn tin nào cũng bị xóa.">
            <Segmented
              label="Giữ lịch sử"
              value={String(settings.retentionMonths)}
              onChange={(v) => updateSettings({ retentionMonths: Number(v) })}
              options={[
                { value: '0', label: 'Luôn giữ' },
                { value: '3', label: '3 tháng' },
                { value: '6', label: '6 tháng' },
                { value: '12', label: '1 năm' },
              ]}
            />
          </Row>
          <Row label="Sao lưu" hint="Một file .db chứa toàn bộ lịch sử, thread, người liên hệ và glossary cá nhân.">
            <Button onClick={backup}>Sao lưu...</Button>
          </Row>
          <Row label="Khôi phục" hint="Thay toàn bộ dữ liệu hiện tại bằng một bản sao lưu.">
            {confirm === 'restore' ? (
              <div className="flex gap-2">
                <Button onClick={() => setConfirm(null)}>Hủy</Button>
                <Button variant="primary" onClick={restore}>
                  Chọn file và thay dữ liệu
                </Button>
              </div>
            ) : (
              <Button onClick={() => setConfirm('restore')}>Khôi phục...</Button>
            )}
          </Row>
          <Row label="Xóa toàn bộ dữ liệu" hint="Xóa lịch sử, thread, người liên hệ và glossary cá nhân. Cài đặt được giữ lại. Không thể hoàn tác.">
            {confirm === 'wipe' ? (
              <div className="flex gap-2">
                <Button onClick={() => setConfirm(null)}>Hủy</Button>
                <Button variant="danger" onClick={wipe}>
                  Xác nhận xóa
                </Button>
              </div>
            ) : (
              <Button className="text-bad" onClick={() => setConfirm('wipe')}>
                Xóa dữ liệu...
              </Button>
            )}
          </Row>
        </Group>
      </div>
    </div>
  )
}

function UpdatesGroup({ updates, auto, onAuto }: { updates: ReturnType<typeof useUpdates>; auto: boolean; onAuto: (v: boolean) => void }) {
  const { status, checking, check, install, installNow } = updates
  const busy = install.phase === 'downloading' || install.phase === 'installing'
  return (
    <Group title="Cập nhật" hint={status ? `Phiên bản đang dùng: ${status.current}` : undefined}>
      {status && !status.configured ? (
        <Row label="Kiểm tra cập nhật" hint="Bản cài này không có nguồn cập nhật. Hãy cài bản do team phát hành.">
          <span className="text-[13px] text-ink-3">Không có</span>
        </Row>
      ) : (
        <>
          <Row label="Tự kiểm tra cập nhật" hint="Sau khi mở app và mỗi 6 giờ. Chỉ cài khi bạn bấm cập nhật.">
            <Switch label="Tự kiểm tra cập nhật" checked={auto} onChange={onAuto} />
          </Row>
          {status?.available ? (
            <div className="flex flex-col gap-2.5 px-4 py-3">
              <div className="flex items-center gap-3">
                <ArrowUpCircle size={18} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">Có phiên bản mới {status.available.version}</div>
                  {status.available.notes && <p className="mt-0.5 text-[12.5px] whitespace-pre-wrap text-ink-2">{status.available.notes}</p>}
                </div>
                <Button variant="primary" disabled={busy} onClick={() => void installNow()}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  Cập nhật và khởi động lại
                </Button>
              </div>
              <InstallProgress install={install} />
            </div>
          ) : (
            <Row label="Trạng thái" hint={status?.error ? `Lần kiểm tra trước bị lỗi: ${status.error}` : undefined}>
              <span className="flex items-center gap-3">
                {status?.checkedAt && !status.error && <UpToDate status={status} />}
                <Button disabled={checking} onClick={() => void check()}>
                  {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {checking ? 'Đang kiểm tra…' : 'Kiểm tra ngay'}
                </Button>
              </span>
            </Row>
          )}
        </>
      )}
    </Group>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      <div className="mt-2.5 divide-y divide-line rounded-lg border border-line bg-surface">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function PreviewLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-40 shrink-0 text-[12.5px] text-ink-3">{label}</span>
      {children}
    </div>
  )
}
