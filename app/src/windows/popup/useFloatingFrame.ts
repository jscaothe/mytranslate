import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { DEFAULT_POPUP_WIDTH, type PopupGeometry } from '../../store'
import type { PopupRequest } from './types'

export const MIN_POPUP_WIDTH = 360
export const MAX_POPUP_WIDTH = 760
export const MIN_POPUP_HEIGHT = 180
/** Height limit while the popup fits its content. A dragged height may go beyond it, up to the screen. */
const AUTO_MAX_HEIGHT = 520
const MARGIN = 8
/** Keep at least the header on screen when dragging. */
const HEADER_HEIGHT = 40

export type ResizeEdge = 'left' | 'right' | 'bottom' | 'bottom-left' | 'bottom-right'

type Size = { width: number; height: number }
type Live = { left?: number; top?: number; width?: number; height?: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Places a floating popup and lets the user move it (drag the header) and resize it (drag a side, the bottom
 * edge or a bottom corner). The result is reported through `onGeometry` so the next popup in the same app
 * session opens the same way.
 */
export function useFloatingFrame({
  request,
  container,
  geometry,
  onGeometry,
  rootRef,
}: {
  request: PopupRequest
  container?: Size
  geometry: PopupGeometry
  onGeometry: (g: PopupGeometry) => void
  rootRef: RefObject<HTMLDivElement | null>
}) {
  // Overrides for this popup only, set while and after the user drags.
  const [live, setLive] = useState<Live | null>(null)
  const [dragging, setDragging] = useState<'move' | ResizeEdge | null>(null)

  const style: CSSProperties | undefined = container ? placement(request, container, geometry, live) : undefined

  const track = (kind: 'move' | ResizeEdge, onMove: (dx: number, dy: number) => Live, onDone: (l: Live) => void) => {
    return (e: ReactPointerEvent) => {
      if (!container || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      let last: Live = {}
      setDragging(kind)
      const move = (ev: PointerEvent) => {
        last = onMove(ev.clientX - startX, ev.clientY - startY)
        setLive((l) => ({ ...l, ...last }))
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging(null)
        onDone(last)
        rootRef.current?.focus()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  const current = () => {
    const el = rootRef.current
    return {
      left: el?.offsetLeft ?? 0,
      top: el?.offsetTop ?? 0,
      width: el?.offsetWidth ?? geometry.width,
      height: el?.offsetHeight ?? MIN_POPUP_HEIGHT,
    }
  }

  const onHeaderPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    if (!container) return
    const start = current()
    track(
      'move',
      (dx, dy) => ({
        left: clamp(start.left + dx, MARGIN, container.width - start.width - MARGIN),
        top: clamp(start.top + dy, MARGIN, container.height - HEADER_HEIGHT - MARGIN),
      }),
      (l) => {
        if (l.left === undefined || l.top === undefined) return
        onGeometry({ ...geometry, position: { left: l.left, top: l.top } })
      },
    )(e)
  }

  const resizeHandle = (edge: ResizeEdge) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (!container) return
      const start = current()
      const maxWidth = Math.min(MAX_POPUP_WIDTH, container.width - 2 * MARGIN)
      const horizontal = edge !== 'bottom'
      const vertical = edge.startsWith('bottom')
      const fromLeft = edge === 'left' || edge === 'bottom-left'
      track(
        edge,
        (dx, dy) => {
          const next: Live = {}
          if (horizontal && !fromLeft) {
            next.width = clamp(start.width + dx, MIN_POPUP_WIDTH, Math.min(maxWidth, container.width - start.left - MARGIN))
          }
          if (horizontal && fromLeft) {
            next.width = clamp(start.width - dx, MIN_POPUP_WIDTH, Math.min(maxWidth, start.left + start.width - MARGIN))
            next.left = start.left + start.width - next.width
          }
          if (vertical) {
            // Growing the bottom edge pins the top where it is now, even for a popup that opened above the cursor.
            next.top = start.top
            next.left ??= start.left
            next.height = clamp(start.height + dy, MIN_POPUP_HEIGHT, container.height - start.top - MARGIN)
          }
          return next
        },
        (l) => {
          // A moved popup also remembers where its edges went; a cursor-following one only remembers its size.
          const position = geometry.position ? { left: l.left ?? geometry.position.left, top: geometry.position.top } : null
          onGeometry({
            width: l.width ?? geometry.width,
            height: l.height ?? geometry.height,
            position,
          })
        },
      )(e)
    },
    onDoubleClick: () => {
      // Double-click a side for the default width, the bottom for "fit content", a corner for both.
      const resetWidth = edge !== 'bottom'
      const resetHeight = edge.startsWith('bottom')
      setLive((l) => ({
        ...l,
        width: resetWidth ? DEFAULT_POPUP_WIDTH : l?.width,
        height: resetHeight ? undefined : l?.height,
      }))
      onGeometry({
        ...geometry,
        width: resetWidth ? DEFAULT_POPUP_WIDTH : geometry.width,
        height: resetHeight ? null : geometry.height,
      })
    },
  })

  const reset = () => {
    setLive(null)
    onGeometry({ width: DEFAULT_POPUP_WIDTH, height: null, position: null })
  }

  const customized = geometry.position !== null || geometry.width !== DEFAULT_POPUP_WIDTH || geometry.height !== null

  return { style, dragging, onHeaderPointerDown, resizeHandle, reset, customized }
}

function placement(request: PopupRequest, container: Size, geometry: PopupGeometry, live: Live | null): CSSProperties {
  const width = Math.min(live?.width ?? geometry.width, container.width - 2 * MARGIN)
  const wanted = live && 'height' in live && live.height !== undefined ? live.height : geometry.height
  // A dragged height is exact (content scrolls inside); otherwise the popup fits its content up to a limit.
  const sized = (available: number): CSSProperties =>
    wanted !== null
      ? { height: clamp(wanted, Math.min(MIN_POPUP_HEIGHT, available), available) }
      : { maxHeight: Math.min(AUTO_MAX_HEIGHT, available) }

  const fixed = live?.top !== undefined ? { left: live.left ?? 0, top: live.top } : geometry.position
  if (fixed) {
    const left = clamp(live?.left ?? fixed.left, MARGIN, container.width - width - MARGIN)
    const top = clamp(fixed.top, MARGIN, container.height - HEADER_HEIGHT - MARGIN)
    return { left, top, width, ...sized(container.height - top - MARGIN) }
  }

  const left = live?.left ?? clamp(request.anchor.x - 24, MARGIN, container.width - width - MARGIN)
  const spaceAbove = request.anchor.y - 10 - MARGIN
  const above = (): CSSProperties => ({ left, bottom: container.height - request.anchor.y + 10, width, ...sized(spaceAbove) })
  if (request.placement === 'above') return above()
  const spaceBelow = container.height - request.anchor.y - 14 - MARGIN
  const needed = wanted ?? 260
  // Flip above the cursor when the bottom edge is too close.
  if (spaceBelow < needed && spaceAbove > spaceBelow) return above()
  return { left, top: request.anchor.y + 14, width, ...sized(spaceBelow) }
}
