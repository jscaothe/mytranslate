import { invoke } from '@tauri-apps/api/core'
import { BookOpenText, PenLine, SpellCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { AppBadge } from '../../components/AppBadge'
import { Button, Hotkey } from '../../components/ui'
import { isTauri } from '../../lib/claude'
import { useLang, useT } from '../../lib/i18n'
import { useStore } from '../../store'

type ChatApp = 'teams' | 'slack'
const chatAppNames: Record<ChatApp, string> = { teams: 'Teams', slack: 'Slack' }

/**
 * What the Threads tab shows until the first translation: the three things the app does and where to start.
 * It goes away by itself once there is history to show.
 */
export function GettingStarted() {
  const { settings, showToast } = useStore()
  const t = useT()
  const lang = useLang()
  const { hotkeys } = settings
  // The prototype pretends both are installed.
  const [apps, setApps] = useState<ChatApp[]>(isTauri ? [] : ['teams', 'slack'])

  useEffect(() => {
    if (!isTauri) return
    let alive = true
    void invoke<ChatApp[]>('chat_apps_installed')
      .then((a) => alive && setApps(a))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const openApp = (app: ChatApp) =>
    isTauri
      ? void invoke('open_chat_app', { app }).catch((e) => showToast(`${t(`Không mở được ${chatAppNames[app]}`, `${chatAppNames[app]} を開けません`)}: ${String(e)}`))
      : showToast(t(`Mô phỏng: mở ${chatAppNames[app]}`, `シミュレーション: ${chatAppNames[app]} を開く`))

  return (
    <div className="scroll-thin flex flex-1 justify-center overflow-y-auto px-8 py-10">
      <div className="flex w-full max-w-[560px] flex-col gap-5">
        <div>
          <h1 className="text-[20px] font-semibold text-ink">{t('Bắt đầu dùng MyTranslate', 'MyTranslate を使ってみましょう')}</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-pretty text-ink-2">
            {t(
              'MyTranslate chạy ngầm ở khay hệ thống. Bạn không cần mở cửa sổ này để dịch: cứ làm việc trong Teams hoặc Slack như bình thường.',
              'MyTranslate はタスクトレイで動いています。翻訳のためにこの画面を開く必要はありません。いつも通り Teams や Slack で作業してください。',
            )}
          </p>
        </div>

        {lang === 'ja' ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            <Way icon={<BookOpenText size={18} />} title="ベトナム語のメッセージを読む" combo={hotkeys.auto}>
              マウスでメッセージを選択し、表示された小さなツールバーの <b className="font-semibold text-ink">日本語に翻訳</b> をクリックします。
            </Way>
            <Way icon={<PenLine size={18} />} title="日本語で書いてベトナム語で送る" combo={hotkeys.auto}>
              入力欄に日本語を書いて同じショートカットを押します。Enter でベトナム語訳が入力欄に入ります。
            </Way>
          </ul>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            <Way icon={<BookOpenText size={18} />} title="Đọc tin nhắn tiếng Nhật" combo={hotkeys.auto}>
              Bôi đen tin nhắn bằng chuột, rồi bấm <b className="font-semibold text-ink">Dịch sang Việt</b> trên thanh nhỏ hiện ra.
            </Way>
            <Way icon={<PenLine size={18} />} title="Trả lời bằng tiếng Nhật" combo={hotkeys.auto}>
              Gõ tiếng Việt vào ô chat rồi nhấn cùng phím tắt đó. Nhấn Enter để thay bản tiếng Nhật vào ô chat.
            </Way>
            <Way icon={<SpellCheck size={18} />} title="Kiểm tra tiếng Nhật bạn tự viết" combo={hotkeys.review}>
              Đặt con trỏ trong ô chat có câu tiếng Nhật rồi nhấn phím tắt để soát ngữ pháp và kính ngữ.
            </Way>
          </ul>
        )}

        {apps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {apps.map((a) => (
              <Button key={a} variant={a === apps[0] ? 'primary' : 'secondary'} onClick={() => openApp(a)}>
                <span aria-hidden className="contents"><AppBadge app={a} className="size-4 text-[9px]" /></span>{' '}
                {t(`Mở ${chatAppNames[a]}`, `${chatAppNames[a]} を開く`)}
              </Button>
            ))}
            <span className="text-[12.5px] text-ink-3">{t('và thử dịch một tin nhắn.', 'メッセージを翻訳してみましょう。')}</span>
          </div>
        )}

        <p className="text-[12.5px] leading-relaxed text-pretty text-ink-3">
          {lang === 'ja' ? (
            <>
              この画面は <Hotkey combo={hotkeys.main} /> またはタスクトレイの MyTranslate アイコンで再び開けます。翻訳したメッセージは会話ごとにここに整理されます。
            </>
          ) : (
            <>
              Mở lại cửa sổ này bằng <Hotkey combo={hotkeys.main} /> hoặc bấm biểu tượng MyTranslate ở khay hệ thống. Các tin bạn dịch sẽ được xếp
              theo cuộc trò chuyện ở đây.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Way({ icon, title, combo, children }: { icon: ReactNode; title: string; combo: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13.5px] font-semibold text-ink">{title}</span>
          <Hotkey combo={combo} />
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-pretty text-ink-2">{children}</p>
      </div>
    </li>
  )
}
