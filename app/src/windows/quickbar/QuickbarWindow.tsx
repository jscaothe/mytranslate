import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { hideQuickBarIn, useStore, type AppRef } from '../../store'

/**
 * The page in the "quickbar" window: the toolbar shown next to a mouse selection in a chat app.
 * The language of the selection is not known until a button is pressed, so the translate button says "Dịch"
 * ("翻訳" for a Japanese user). Only whether it has Japanese may be known, from UI Automation: then the reading
 * button shows or not.
 * It stays until the user clicks somewhere else (or presses one of its buttons).
 */
export function QuickbarWindow() {
  const { settings, updateSettings } = useStore()
  const barRef = useRef<HTMLDivElement>(null)
  // A fresh bar each time it is shown: a shortcut hint or close menu left open when it was hidden does not come
  // back with it. It also says which app the bar is in, for "Tắt trong <app>".
  const [shown, setShown] = useState<{ n: number; app: AppRef | null; japanese: boolean | null }>({ n: 0, app: null, japanese: null })
  useEffect(() => {
    const off = listen<AppRef & { japanese: boolean | null }>('quickbar:shown', (e) => {
      const { japanese, ...app } = e.payload
      setShown((s) => ({ n: s.n + 1, app, japanese }))
    })
    return () => void off.then((f) => f())
  }, [])
  const app = shown.app
  // Report the toolbar's real size so the window fits it exactly.
  useEffect(() => {
    const el = barRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    // Rounded up: a window even a fraction of a pixel too small shows scrollbars.
    const fit = () => {
      const r = el.getBoundingClientRect()
      void invoke('quickbar_fit', { width: Math.ceil(r.width), height: Math.ceil(r.height) })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [settings.quickActions.items, settings.quickActions.display, settings.language, shown.n])

  return (
    <div ref={barRef} className="flex w-max">
      <QuickActionBar
        key={shown.n}
        bare
        items={settings.quickActions.items}
        display={settings.quickActions.display}
        japanese={shown.japanese}
        onAction={(action) => void invoke('quickbar_action', { action })}
        onDismiss={() => void invoke('quickbar_hide')}
        hideIn={
          app
            ? {
                name: app.name,
                onHide: () => {
                  updateSettings({ quickActions: hideQuickBarIn(settings.quickActions, app) })
                  void invoke('quickbar_hide')
                },
              }
            : undefined
        }
      />
    </div>
  )
}
