/** Builds a "Ctrl+Alt+J" style combo from a keyboard event, using the physical key so AltGr layouts still work. */
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
