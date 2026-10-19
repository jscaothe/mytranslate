/** The hiragana あ drawn at an icon's size, for the reading of Japanese: no icon set has one. */
export function KanaIcon({ size = 16, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <span
      aria-hidden
      lang="ja"
      style={{ width: size, height: size, fontSize: size }}
      className={`inline-flex shrink-0 items-center justify-center leading-none font-semibold ${className ?? ''}`}
    >
      あ
    </span>
  )
}
