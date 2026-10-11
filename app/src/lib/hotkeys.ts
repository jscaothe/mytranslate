import type { HotkeyMap } from '../store'

/** Kept in step with `Hotkeys::default` on the Rust side. */
export const DEFAULT_HOTKEYS: HotkeyMap = { auto: 'Ctrl+Alt+T', review: 'Ctrl+Alt+C', main: 'Ctrl+Alt+M' }

/** The saved hotkeys, without keys of earlier versions (the separate "read" and "write" hotkeys). */
export function knownHotkeys(saved: Partial<HotkeyMap> | undefined): HotkeyMap {
  return { auto: saved?.auto ?? DEFAULT_HOTKEYS.auto, review: saved?.review ?? DEFAULT_HOTKEYS.review, main: saved?.main ?? DEFAULT_HOTKEYS.main }
}

/** Builds a "Ctrl+Alt+T" style combo from a keyboard event, using the physical key so AltGr layouts still work. */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const ignored = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']
  if (ignored.includes(e.key)) return null
  let key: string
  if (e.code.startsWith('Key')) key = e.code.slice(3)
  else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else key = e.key
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Win')
  parts.push(key)
  return parts.join('+')
}
