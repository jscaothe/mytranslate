import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { QuickActionBar } from '../../components/QuickActionBar'
import { useStore } from '../../store'

/** Hide after this long without the pointer on the toolbar. */
const IDLE_MS = 4000

/**
 * The page in the "quickbar" window: the toolbar shown next to a mouse selection in a chat app.
 * The language of the selection is not known until a button is pressed, so the translate button says "Dịch".
 */
export function QuickbarWindow() {
  const { settings } = useStore()
  const barRef = useRef<HTMLDivElement>(null)
  const [shownAt, setShownAt] = useState(0)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    const off = listen('quickbar:shown', () => setShownAt(Date.now()))
    return () => void off.then((f) => f())
  }, [])

  // Report the toolbar's real size so the window fits it exactly.
  useEffect(() => {
    const el = barRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const fit = () => void invoke('quickbar_fit', { width: el.offsetWidth, height: el.offsetHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [settings.quickActions.items, settings.quickActions.display])

  useEffect(() => {
    if (!shownAt || hover) return
    const t = window.setTimeout(() => void invoke('quickbar_hide'), IDLE_MS)
    return () => window.clearTimeout(t)
  }, [shownAt, hover])

  return (
    <div ref={barRef} className="inline-block">
      <QuickActionBar
        bare
        japanese={null}
        items={settings.quickActions.items}
        display={settings.quickActions.display}
        onAction={(action) => void invoke('quickbar_action', { action })}
        onDismiss={() => void invoke('quickbar_hide')}
        onHoverChange={setHover}
      />
    </div>
  )
}
