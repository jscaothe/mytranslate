import { CheckCircle2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ProfilePromptEditor } from '../../components/ProfilePromptEditor'
import { QuickActionBar } from '../../components/QuickActionBar'
import { Button, Hotkey, Segmented, Switch } from '../../components/ui'
import { cx, inputClass } from '../../components/styles'
import { keigoLabels } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { DEFAULT_QUICK_ACTION_ITEMS, useStore, type HotkeyMap } from '../../store'
import { AppScopeEditor } from './AppScopeEditor'
import { QuickActionOrderEditor } from './QuickActionOrderEditor'

const hotkeyRows: { key: keyof HotkeyMap; label: string }[] = [
  { key: 'auto', label: 'Dịch, tự nhận diện hướng' },
  { key: 'jaVi', label: 'Dịch tiếng Nhật sang tiếng Việt' },
  { key: 'viJa', label: 'Dịch tiếng Việt sang tiếng Nhật' },
  { key: 'review', label: 'Kiểm tra câu tiếng Nhật' },
  { key: 'main', label: 'Mở cửa sổ chính' },
]

export function SettingsView() {
  const { settings, updateSettings, showToast, setScreen } = useStore()
  const [recording, setRecording] = useState<keyof HotkeyMap | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [newBlocked, setNewBlocked] = useState('')
  const qa = settings.quickActions
  const setQa = (patch: Partial<typeof qa>) => updateSettings({ quickActions: { ...qa, ...patch } })
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

        <Group
          title="Hồ sơ"
          hint="Viết tự do về bạn. Nội dung này được thêm vào mọi yêu cầu gửi Claude để dịch đúng giọng, đúng xưng hô."
        >
          <div className="p-4">
            <ProfilePromptEditor value={settings.profilePrompt} onChange={(v) => updateSettings({ profilePrompt: v })} />
          </div>
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
          <Row label="Model" hint="Haiku nhanh và tiết kiệm hạn mức hơn, Sonnet dịch tốt hơn.">
            <Segmented
              label="Model"
              value={settings.model}
              onChange={(m) => updateSettings({ model: m })}
              options={[
                { value: 'sonnet', label: 'Sonnet' },
                { value: 'haiku', label: 'Haiku' },
              ]}
            />
          </Row>
          <Row label="Kết nối Claude" hint={settings.provider === 'cli' ? 'Dùng Claude Code đã đăng nhập trên máy này.' : 'Dùng API key của công ty.'}>
            <Segmented
              label="Kết nối Claude"
              value={settings.provider}
              onChange={(p) => updateSettings({ provider: p })}
              options={[
                { value: 'cli', label: 'Claude Code' },
                { value: 'api', label: 'API key' },
              ]}
            />
          </Row>
          {settings.provider === 'cli' ? (
            <Row label="Trạng thái">
              <span className="flex items-center gap-1.5 text-[13px] text-good">
                <CheckCircle2 size={15} /> Đã đăng nhập (claude 2.x)
              </span>
            </Row>
          ) : (
            <Row label="API key">
              <input type="password" className={cx(inputClass, 'w-64')} placeholder="sk-ant-..." />
            </Row>
          )}
        </Group>

        <Group title="Glossary chung">
          <Row label="File glossary dự án" hint="File YAML trong repo dự án hoặc thư mục đồng bộ OneDrive / SharePoint.">
            <div className="flex w-80 gap-2">
              <input className={cx(inputClass, 'flex-1')} value={settings.glossaryPath} onChange={(e) => updateSettings({ glossaryPath: e.target.value })} />
              <Button onClick={() => showToast('Mô phỏng: mở hộp thoại chọn file')}>Chọn...</Button>
            </div>
          </Row>
        </Group>

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

        <Group
          title="Dữ liệu"
          hint={
            isTauri
              ? 'Lịch sử dịch, thread và glossary nằm trên máy này, trong %LOCALAPPDATA%\\com.mytranslate.desktop\\history.db.'
              : 'Toàn bộ lịch sử dịch nằm trên máy này.'
          }
        >
          <Row label="Hướng dẫn ban đầu" hint="Kiểm tra lại kết nối Claude Code, hồ sơ và thử dịch.">
            <Button onClick={() => (isTauri ? updateSettings({ onboarded: false }) : setScreen('onboarding'))}>Xem lại</Button>
          </Row>
          {/* Backup and wipe are not implemented in the real app yet; the prototype shows the intended design. */}
          {!isTauri && (
          <>
          <Row label="Sao lưu">
            <div className="flex gap-2">
              <Button onClick={() => showToast('Mô phỏng: xuất file data.db')}>Xuất dữ liệu</Button>
              <Button onClick={() => showToast('Mô phỏng: nhập file data.db')}>Nhập dữ liệu</Button>
            </div>
          </Row>
          <Row label="Xóa toàn bộ dữ liệu" hint="Xóa lịch sử, thread và glossary cá nhân. Không thể hoàn tác.">
            {confirmWipe ? (
              <div className="flex gap-2">
                <Button onClick={() => setConfirmWipe(false)}>Hủy</Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirmWipe(false)
                    showToast('Mô phỏng: đã xóa dữ liệu (prototype không xóa thật)')
                  }}
                >
                  Xác nhận xóa
                </Button>
              </div>
            ) : (
              <Button className="text-bad" onClick={() => setConfirmWipe(true)}>
                Xóa dữ liệu...
              </Button>
            )}
          </Row>
          </>
          )}
        </Group>
      </div>
    </div>
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
