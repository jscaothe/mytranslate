import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { useStore } from '../../store'

/**
 * The page in the "quickbar" window: the toolbar shown next to a mouse selection in a chat app.
 * The language of the selection is not known until a button is pressed, so the translate button says "Dịch"
 * ("翻訳" for a Japanese user).
 * It stays until the user clicks somewhere else (or presses one of its buttons).
 */
export function QuickbarWindow() {
  const { settings } = useStore()
  const barRef = useRef<HTMLDivElement>(null)
  // A fresh bar each time it is shown: a shortcut hint left open when it was hidden does not come back with it.
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const off = listen('quickbar:shown', () => setShown((n) => n + 1))
    return () => void off.then((f) => f())
  }, [])
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
  }, [settings.quickActions.items, settings.quickActions.display, settings.language, shown])

  return (
    <div ref={barRef} className="flex w-max">
      <QuickActionBar
        key={shown}
        bare
        items={settings.quickActions.items}
        display={settings.quickActions.display}
        onAction={(action) => void invoke('quickbar_action', { action })}
        onDismiss={() => void invoke('quickbar_hide')}
      />
    </div>
  )
}
