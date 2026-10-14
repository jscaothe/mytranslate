/**
 * What every button does when used, whatever it looks like: the background eases to the next shade on hover, the
 * button sinks a little while pressed, and a keyboard user sees where the focus is.
 */
export const pressable =
  'transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:active:scale-100'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export const inputClass =
  'h-8 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none'
