import { invoke } from '@tauri-apps/api/core'
import { ArrowUpCircle, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { InstallProgress, UpToDate } from '../../components/UpdatePanel'
import type { useUpdates } from '../../lib/updates'
import { Button, Hotkey, Segmented, Switch } from '../../components/ui'
import { cx, inputClass, pressable } from '../../components/styles'
import { keigoLabel } from '../../data/mock'
import { isTauri } from '../../lib/claude'
import { comboFromEvent } from '../../lib/hotkeys'
import { useT, type T } from '../../lib/i18n'
import { DEFAULT_QUICK_ACTION_ITEMS, useStore, type HotkeyMap, type SettingsSection } from '../../store'
import { AppScopeSetting } from './AppScopeEditor'
import { QuickActionOrderEditor } from './QuickActionOrderEditor'
import { AiProvidersGroup } from './AiProvidersGroup'

/** The parts of Settings in the order listed, with words that find a whole part when searched. */
function sections(t: T): { id: SettingsSection; name: string; words: string }[] {
  return [
    {
      id: 'ai',
      name: t('AI dịch', '翻訳AI'),
      words: 'ai model claude chatgpt gpt gemini codex api key ' + t('tài khoản mô hình dịch kính ngữ', 'モデル アカウント キー 翻訳 丁寧さ 敬語'),
    },
    { id: 'general', name: t('Chung', '一般'), words: t('ngôn ngữ giao diện chặn hướng dẫn', '言語 表示 除外 ガイド') },
    {
      id: 'quick',
      name: t('Thao tác nhanh', 'クイック操作'),
      words: t('phím tắt bàn phím thanh bôi đen nút thứ tự xem trước icon', 'ショートカット キーボード ツールバー 選択 ボタン 順番 プレビュー アイコン'),
    },
    { id: 'updates', name: t('Cập nhật', 'アップデート'), words: t('phiên bản', 'バージョン') },
    { id: 'data', name: t('Dữ liệu', 'データ'), words: t('lịch sử sao lưu khôi phục xóa', '履歴 バックアップ 復元 削除') },
  ]
}

/** Lower case without Vietnamese marks, so "kinh ngu" finds "kính ngữ". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

/** While searching: the folded search words, and rows that do not contain them are left out. Empty: show all. */
const SearchContext = createContext('')

/** The name of the part a group is shown in: a group of the same name does not repeat it as its title. */
const PartContext = createContext('')

/** The hotkeys: one translates either way, the language of the text decides. */
function hotkeyRows(t: T): { key: keyof HotkeyMap; label: string }[] {
  return [
    { key: 'auto', label: t('Dịch (tự chọn ngôn ngữ đích)', '翻訳（翻訳先の言語を自動で判断）') },
    { key: 'review', label: t('Kiểm tra câu đã viết', '書いた文をチェック') },
    { key: 'main', label: t('Mở cửa sổ chính', 'メイン画面を開く') },
  ]
}

export function SettingsView({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  const { settings, updateSettings, showToast, setScreen } = useStore()
  const t = useT()
  const [recording, setRecording] = useState<keyof HotkeyMap | null>(null)
  const [confirm, setConfirm] = useState<'restore' | 'wipe' | null>(null)
  const [newBlocked, setNewBlocked] = useState('')
  const qa = settings.quickActions
  const rows = hotkeyRows(t)
  const setQa = (patch: Partial<typeof qa>) => updateSettings({ quickActions: { ...qa, ...patch } })
  const failed = (what: string) => (e: unknown) => showToast(`${what}: ${String(e)}`)
  const backup = () => {
    if (!isTauri) return showToast(t('Mô phỏng: lưu file mytranslate-YYYY-MM-DD.db', 'シミュレーション: mytranslate-YYYY-MM-DD.db を保存'))
    invoke<string | null>('data_backup')
      .then((path) => path && showToast(t(`Đã sao lưu vào ${path}`, `${path} にバックアップしました`)))
      .catch(failed(t('Không sao lưu được', 'バックアップできません')))
  }
  const restore = () => {
    setConfirm(null)
    if (!isTauri) return showToast(t('Mô phỏng: đã khôi phục từ bản sao lưu', 'シミュレーション: バックアップから復元しました'))
    invoke<boolean>('data_restore')
      .then((done) => done && showToast(t('Đã khôi phục dữ liệu', 'データを復元しました')))
      .catch(failed(t('Không khôi phục được', '復元できません')))
  }
  const wipe = () => {
    setConfirm(null)
    if (!isTauri) return showToast(t('Mô phỏng: đã xóa dữ liệu (prototype không xóa thật)', 'シミュレーション: データを削除しました（実際には削除しません）'))
    invoke('data_wipe')
      .then(() => showToast(t('Đã xóa toàn bộ dữ liệu', 'すべてのデータを削除しました')))
      .catch(failed(t('Không xóa được', '削除できません')))
  }
  const previewAction = () =>
    showToast(t('Đây là bản xem trước, hãy thử ở màn hình Mô phỏng sử dụng', 'これはプレビューです。「使ってみる」画面でお試しください'))

  // Every part of Settings, each a page of its own (decided 2026-10-14: settings had grown hard to search).
  const pages: Record<SettingsSection, ReactNode> = {
    ai: (
      <>
      <AiProvidersGroup group={Group} row={Row} />

      <Group title={t('Dịch', '翻訳')}>
        <Row
          label={t('Mức kính ngữ mặc định', '丁寧さ（既定）')}
          hint={t('Dùng khi dịch câu bạn viết sang tiếng Nhật.', 'ベトナム語で送るときの言葉づかいです。')}
        >
          <Segmented
            label={t('Mức kính ngữ mặc định', '丁寧さ（既定）')}
            value={settings.defaultKeigo}
            onChange={(k) => updateSettings({ defaultKeigo: k })}
            options={(['casual', 'polite', 'formal'] as const).map((k) => ({ value: k, label: keigoLabel(k, settings.language) }))}
          />
        </Row>
      </Group>
      </>
    ),
    general: (
      <>
      <Group title={t('Ngôn ngữ', '言語')}>
        <Row
          label={t('Ngôn ngữ của bạn', 'あなたの言語')}
          hint={t(
            'Ngôn ngữ của app. Bạn đọc tin của bên kia và viết trả lời bằng ngôn ngữ này.',
            'アプリの表示言語です。相手のメッセージをこの言語で読み、この言語で返信を書きます。',
          )}
        >
          <Segmented
            label={t('Ngôn ngữ của bạn', 'あなたの言語')}
            value={settings.language}
            onChange={(language) => updateSettings({ language })}
            options={[
              { value: 'vi', label: 'Tiếng Việt' },
              { value: 'ja', label: '日本語' },
            ]}
          />
        </Row>
      </Group>

      <Group title={t('Giao diện và hệ thống', '表示とシステム')}>
        <Row label={t('Chủ đề', 'テーマ')}>
          <Segmented
            label={t('Chủ đề', 'テーマ')}
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: t('Theo hệ thống', 'システムに合わせる') },
              { value: 'light', label: t('Sáng', 'ライト') },
              { value: 'dark', label: t('Tối', 'ダーク') },
            ]}
          />
        </Row>
        <Row label={t('Khởi động cùng Windows', 'Windows 起動時に開始')}>
          <Switch label={t('Khởi động cùng Windows', 'Windows 起動時に開始')} checked={settings.autostart} onChange={(v) => updateSettings({ autostart: v })} />
        </Row>
        <Row label={t('Ứng dụng bị chặn', '除外するアプリ')} hint={t('Phím tắt và thanh thao tác không hoạt động trong các ứng dụng này.', 'これらのアプリではショートカットとツールバーが動作しません。')}>
          <div className="flex w-80 flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {settings.blockedApps.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
                  {a}
                  <button
                    type="button"
                    aria-label={t(`Bỏ chặn ${a}`, `${a} の除外を解除`)}
                    onClick={() => updateSettings({ blockedApps: settings.blockedApps.filter((x) => x !== a) })}
                    className={cx('flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink', pressable)}
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
              <input
                className={cx(inputClass, 'flex-1')}
                placeholder={t('vd: Bitwarden.exe', '例: Bitwarden.exe')}
                value={newBlocked}
                onChange={(e) => setNewBlocked(e.target.value)}
              />
              <Button type="submit" disabled={!newBlocked.trim()}>
                {t('Thêm', '追加')}
              </Button>
            </form>
          </div>
        </Row>
      </Group>

      <Group title={t('Trợ giúp', 'ヘルプ')}>
        <Row
          label={t('Hướng dẫn ban đầu', '初期設定ガイド')}
          hint={t(
            'Làm lại các bước đầu: kết nối AI, thử dịch và chọn nơi thanh thao tác hiện.',
            'AIへの接続、翻訳のお試し、ツールバーを表示するアプリの選択をもう一度行います。',
          )}
        >
          <Button onClick={() => (isTauri ? updateSettings({ onboarded: false }) : setScreen('onboarding'))}>{t('Xem lại', 'もう一度見る')}</Button>
        </Row>
      </Group>
      </>
    ),
    quick: (
      <>
      <Group
        title={t('Phím tắt', 'ショートカット')}
        hint={t('Phím tắt hoạt động trong mọi ứng dụng. Bấm vào một tổ hợp để đổi.', 'どのアプリでも使えます。組み合わせをクリックすると変更できます。')}
      >
        {rows.map((row) => (
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
                  showToast(t('Phím tắt toàn cục cần có Ctrl, Alt hoặc Win', 'ショートカットには Ctrl、Alt、Win のいずれかが必要です'))
                  return
                }
                const clash = rows.find((r) => r.key !== row.key && settings.hotkeys[r.key] === combo)
                if (clash) {
                  showToast(t(`${combo} đang dùng cho "${clash.label}"`, `${combo} は「${clash.label}」で使用中です`))
                  return
                }
                updateSettings({ hotkeys: { ...settings.hotkeys, [row.key]: combo } })
                setRecording(null)
              }}
              aria-label={t(`Phím tắt: ${row.label}`, `ショートカット: ${row.label}`)}
              className={cx(
                'flex h-8 min-w-[150px] items-center justify-center rounded-md border px-3',
                recording === row.key ? 'border-accent bg-accent-soft text-[12.5px] text-accent' : 'border-line bg-surface hover:bg-hover',
              )}
            >
              {recording === row.key ? t('Nhấn tổ hợp phím mới...', '新しい組み合わせを押してください…') : <Hotkey combo={settings.hotkeys[row.key]} />}
            </button>
          </Row>
        ))}
      </Group>

      <Group
        title={t('Thanh thao tác khi bôi đen', '選択時のツールバー')}
        hint={t(
          'Bôi đen chữ bằng chuột sẽ hiện một thanh nhỏ để chọn luôn thao tác, không cần chuyển sang bàn phím.',
          'マウスで文字を選択すると小さなツールバーが表示され、キーボードを使わずに操作できます。',
        )}
      >
        <Row label={t('Hiện thanh thao tác khi bôi đen bằng chuột', 'マウスで選択したときにツールバーを表示')}>
          <Switch
            label={t('Hiện thanh thao tác khi bôi đen bằng chuột', 'マウスで選択したときにツールバーを表示')}
            checked={qa.enabled}
            onChange={(v) => setQa({ enabled: v })}
          />
        </Row>
        {qa.enabled && (
          <>
            <div className="px-4 py-3.5">
              <AppScopeSetting />
            </div>
            <div className="px-4 pt-3.5 pb-1">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13.5px] text-ink">{t('Các nút và thứ tự hiển thị', 'ボタンと表示順')}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    {t(
                      'Kéo tay nắm hoặc dùng mũi tên để sắp xếp. Nút đứng đầu nằm gần con trỏ nhất.',
                      'つまみをドラッグするか矢印で並べ替えます。先頭のボタンがカーソルの一番近くに表示されます。',
                    )}
                  </div>
                </div>
                <Segmented
                  label={t('Kiểu hiển thị nút', 'ボタンの表示')}
                  value={qa.display}
                  onChange={(v) => setQa({ display: v })}
                  options={[
                    { value: 'iconText', label: t('Icon và chữ', 'アイコンと文字') },
                    { value: 'iconOnly', label: t('Chỉ icon', 'アイコンのみ') },
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
                  {t('Khôi phục thứ tự mặc định', '既定の順番に戻す')}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="text-[13.5px] text-ink">{t('Xem trước', 'プレビュー')}</div>
              <PreviewLine label={t('Khi bôi đen tiếng Nhật', '日本語を選択したとき')}>
                <QuickActionBar items={qa.items} display={qa.display} onAction={previewAction} onDismiss={() => undefined} className="animate-none" />
              </PreviewLine>
              <PreviewLine label={t('Khi bôi đen tiếng Việt', 'ベトナム語を選択したとき')}>
                <QuickActionBar items={qa.items} display={qa.display} onAction={previewAction} onDismiss={() => undefined} className="animate-none" />
              </PreviewLine>
            </div>
          </>
        )}
      </Group>
      </>
    ),
    updates: (
      <>
      <UpdatesGroup updates={updates} auto={settings.autoUpdateCheck} onAuto={(v) => updateSettings({ autoUpdateCheck: v })} />
      </>
    ),
    data: (
      <>
      <Group
        title={t('Dữ liệu', 'データ')}
        hint={
          isTauri
            ? t(
                'Lịch sử dịch và glossary (thuật ngữ, người) nằm trên máy này, trong %LOCALAPPDATA%\\com.mytranslate.desktop\\history.db.',
                '翻訳履歴と用語集（用語・人物）はこのPCの %LOCALAPPDATA%\\com.mytranslate.desktop\\history.db にあります。',
              )
            : t('Toàn bộ lịch sử dịch nằm trên máy này.', '翻訳履歴はすべてこのPCにあります。')
        }
      >
        <Row
          label={t('Giữ lịch sử', '履歴の保存期間')}
          hint={t(
            'Tin đã dịch và kết quả kiểm tra câu cũ hơn thời hạn này được tự xóa. App dùng các tin gần đây làm ngữ cảnh khi dịch.',
            '期間より古い翻訳済みメッセージと文章チェックの結果は自動で削除されます。最近のやり取りは翻訳の文脈に使われます。',
          )}
        >
          <Segmented
            label={t('Giữ lịch sử', '履歴の保存期間')}
            value={String(settings.retentionMonths)}
            onChange={(v) => updateSettings({ retentionMonths: Number(v) })}
            options={[
              { value: '0', label: t('Luôn giữ', '無期限') },
              { value: '3', label: t('3 tháng', '3か月') },
              { value: '6', label: t('6 tháng', '6か月') },
              { value: '12', label: t('1 năm', '1年') },
            ]}
          />
        </Row>
        <Row
          label={t('Sao lưu', 'バックアップ')}
          hint={t('Một file .db chứa toàn bộ lịch sử dịch, kết quả kiểm tra câu và glossary cá nhân (thuật ngữ, người).', '翻訳履歴、文章チェックの結果、個人用語集（用語・人物）をすべて含む .db ファイルです。')}
        >
          <Button onClick={backup}>{t('Sao lưu...', 'バックアップ…')}</Button>
        </Row>
        <Row label={t('Khôi phục', '復元')} hint={t('Thay toàn bộ dữ liệu hiện tại bằng một bản sao lưu.', '現在のデータをすべてバックアップの内容に置き換えます。')}>
          {confirm === 'restore' ? (
            <div className="flex gap-2">
              <Button onClick={() => setConfirm(null)}>{t('Hủy', 'キャンセル')}</Button>
              <Button variant="primary" onClick={restore}>
                {t('Chọn file và thay dữ liệu', 'ファイルを選んで置き換える')}
              </Button>
            </div>
          ) : (
            <Button onClick={() => setConfirm('restore')}>{t('Khôi phục...', '復元…')}</Button>
          )}
        </Row>
        <Row
          label={t('Xóa toàn bộ dữ liệu', 'すべてのデータを削除')}
          hint={t(
            'Xóa lịch sử dịch, kết quả kiểm tra câu và glossary cá nhân (thuật ngữ, người). Cài đặt được giữ lại. Không thể hoàn tác.',
            '翻訳履歴、文章チェックの結果、個人用語集（用語・人物）を削除します。設定は残ります。元に戻せません。',
          )}
        >
          {confirm === 'wipe' ? (
            <div className="flex gap-2">
              <Button onClick={() => setConfirm(null)}>{t('Hủy', 'キャンセル')}</Button>
              <Button variant="danger" onClick={wipe}>
                {t('Xác nhận xóa', '削除する')}
              </Button>
            </div>
          ) : (
            <Button className="text-bad" onClick={() => setConfirm('wipe')}>
              {t('Xóa dữ liệu...', 'データを削除…')}
            </Button>
          )}
        </Row>
      </Group>
      </>
    ),
  }

  return <SettingsLayout pages={pages} />
}

function UpdatesGroup({ updates, auto, onAuto }: { updates: ReturnType<typeof useUpdates>; auto: boolean; onAuto: (v: boolean) => void }) {
  const t = useT()
  const { status, checking, check, install, installNow } = updates
  const busy = install.phase === 'downloading' || install.phase === 'installing'
  return (
    <Group title={t('Cập nhật', 'アップデート')} hint={status ? t(`Phiên bản đang dùng: ${status.current}`, `現在のバージョン: ${status.current}`) : undefined}>
      {status && !status.configured ? (
        <Row
          label={t('Kiểm tra cập nhật', 'アップデートの確認')}
          hint={t('Bản cài này không có nguồn cập nhật. Hãy cài bản do team phát hành.', 'このインストール版には更新元がありません。チームが配布する版をインストールしてください。')}
        >
          <span className="text-[13px] text-ink-3">{t('Không có', 'なし')}</span>
        </Row>
      ) : (
        <>
          <Row
            label={t('Tự kiểm tra cập nhật', 'アップデートを自動で確認')}
            hint={t('Sau khi mở app và mỗi 6 giờ. Chỉ cài khi bạn bấm cập nhật.', '起動後と6時間ごとに確認します。インストールはボタンを押したときだけです。')}
          >
            <Switch label={t('Tự kiểm tra cập nhật', 'アップデートを自動で確認')} checked={auto} onChange={onAuto} />
          </Row>
          {status?.available ? (
            <div className="flex flex-col gap-2.5 px-4 py-3">
              <div className="flex items-center gap-3">
                <ArrowUpCircle size={18} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">
                    {t(`Có phiên bản mới ${status.available.version}`, `新しいバージョン ${status.available.version} があります`)}
                  </div>
                  {status.available.notes && <p className="mt-0.5 text-[12.5px] whitespace-pre-wrap text-ink-2">{status.available.notes}</p>}
                </div>
                <Button variant="primary" disabled={busy} onClick={() => void installNow()}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {t('Cập nhật và khởi động lại', 'アップデートして再起動')}
                </Button>
              </div>
              <InstallProgress install={install} />
            </div>
          ) : (
            <Row
              label={t('Trạng thái', '状態')}
              hint={status?.error ? t(`Lần kiểm tra trước bị lỗi: ${status.error}`, `前回の確認でエラー: ${status.error}`) : undefined}
            >
              <span className="flex items-center gap-3">
                {status?.checkedAt && !status.error && <UpToDate status={status} />}
                <Button disabled={checking} onClick={() => void check()}>
                  {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {checking ? t('Đang kiểm tra…', '確認中…') : t('Kiểm tra ngay', '今すぐ確認')}
                </Button>
              </span>
            </Row>
          )}
        </>
      )}
    </Group>
  )
}

/**
 * The page of Settings: the list of its parts with a search box, and the part picked. Searching shows every row
 * whose name or explanation has the words, part by part, or a whole part when its name or subject matches.
 */
function SettingsLayout({ pages }: { pages: Record<SettingsSection, ReactNode> }) {
  const { settingsSection, setSettingsSection } = useStore()
  const t = useT()
  const [query, setQuery] = useState('')
  const q = fold(query.trim())
  const list = sections(t)
  const current = list.find((s) => s.id === settingsSection) ?? list[0]
  const results = useRef<HTMLDivElement>(null)
  const [nothing, setNothing] = useState(false)
  useLayoutEffect(() => {
    setNothing(!!q && !results.current?.querySelector('[data-row], [data-whole]'))
  }, [q])

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label={t('Mục cài đặt', '設定の項目')} className="flex w-[208px] shrink-0 flex-col gap-0.5 border-r border-line p-2">
        <label className="mb-1.5 flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-ink-3 focus-within:border-accent">
          <Search size={14} className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Tìm trong cài đặt', '設定を検索')}
            aria-label={t('Tìm trong cài đặt', '設定を検索')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={!q && s.id === current.id ? 'page' : undefined}
            onClick={() => {
              setQuery('')
              setSettingsSection(s.id)
            }}
            className={cx(
              'flex h-8 items-center rounded-md px-2.5 text-left text-[13.5px]',
              pressable,
              !q && s.id === current.id ? 'bg-selected font-semibold text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            {s.name}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Next to the list of parts, as in Windows Settings: on a wide screen the page grows up to a width that still
            reads in one sweep, and the room left is on the far side rather than split around a narrow column. */}
        <div className="flex max-w-[960px] flex-col gap-6 px-8 py-6">
          {q ? (
            <>
              <h2 className="text-[20px] font-semibold">{t(`Kết quả cho "${query.trim()}"`, `「${query.trim()}」の検索結果`)}</h2>
              <div ref={results} className="flex flex-col gap-8">
                {list.map((s) => {
                  const whole = fold(`${s.name} ${s.words}`).includes(q)
                  return (
                    // A part without a matching row is left out.
                    <div key={s.id} data-whole={whole || undefined} className={cx('flex flex-col gap-6', !whole && '[&:not(:has([data-row]))]:hidden')}>
                      <div className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{s.name}</div>
                      <PartContext.Provider value={s.name}>
                        <SearchContext.Provider value={whole ? '' : q}>{pages[s.id]}</SearchContext.Provider>
                      </PartContext.Provider>
                    </div>
                  )
                })}
              </div>
              {nothing && <p className="text-[13.5px] text-ink-3">{t('Không có mục cài đặt nào khớp.', '一致する設定はありません。')}</p>}
            </>
          ) : (
            <>
              <h2 className="text-[20px] font-semibold">{current.name}</h2>
              <PartContext.Provider value={current.name}>{pages[current.id]}</PartContext.Provider>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  // While searching, only the rows that match are shown, so a group without one goes too.
  const searching = !!useContext(SearchContext)
  const part = useContext(PartContext)
  return (
    <section className={cx(searching && '[&:not(:has([data-row]))]:hidden')}>
      {title !== part && <h3 className="mb-0.5 text-[14px] font-semibold text-ink">{title}</h3>}
      {hint && !searching && <p className="text-[12.5px] text-ink-3">{hint}</p>}
      <div className={cx('mt-2.5 divide-y divide-line rounded-lg border border-line bg-surface', searching && '[&>:not([data-row])]:hidden')}>
        {children}
      </div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const q = useContext(SearchContext)
  if (q && !fold(`${label} ${hint ?? ''}`).includes(q)) return null
  return (
    <div data-row className="flex min-h-[52px] items-center gap-4 px-4 py-2.5">
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
