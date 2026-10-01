import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from '@vela/ui'
import type { ImageInspection } from './useImageInspection'
import './image-inspection.css'

export function ImageViewport({ inspection, alt, empty, expanded = false, layoutKey }: {
  inspection: ImageInspection
  alt: string
  empty?: ReactNode
  expanded?: boolean
  layoutKey?: string
}) {
  const { frame, nativeVisible, native, fitUrl, pan } = inspection
  const windowRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const scrollPosition = useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  function resized(viewport: HTMLDivElement) {
    return viewport.clientWidth !== scrollPosition.current?.width ||
      viewport.clientHeight !== scrollPosition.current?.height
  }

  function restoreScroll(viewport: HTMLDivElement) {
    if (nativeVisible && frame && !pan.current)
      pan.current = { x: frame.width / 2, y: frame.height / 2 }

    viewport.scrollLeft = nativeVisible
      ? Math.max(0, (pan.current?.x ?? viewport.scrollWidth / 2) - viewport.clientWidth / 2)
      : 0
    viewport.scrollTop = nativeVisible
      ? Math.max(0, (pan.current?.y ?? viewport.scrollHeight / 2) - viewport.clientHeight / 2)
      : 0

    // Read back the browser's clamped offsets. The resulting scroll event is
    // layout restoration, not a request to replace the desired image center.
    scrollPosition.current = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }
  }

  useLayoutEffect(() => {
    const viewport = windowRef.current

    if (!viewport) return
    restoreScroll(viewport)

    const observer = new ResizeObserver(() => {
      if (resized(viewport)) restoreScroll(viewport)
    })

    observer.observe(viewport)

    return () => observer.disconnect()
  }, [
    expanded,
    nativeVisible,
    frame?.id,
    frame?.width,
    frame?.height,
    pan,
    layoutKey,
  ])

  return (
    <div className="capture-image__window" data-zoomed={nativeVisible || undefined}
      ref={windowRef} tabIndex={nativeVisible ? 0 : undefined}
      role={nativeVisible ? 'region' : undefined}
      aria-label={nativeVisible ? 'Image at 100 percent. Drag or use arrow keys to inspect.' : undefined}
      onScroll={event => {
        if (!nativeVisible) return
        const viewport = event.currentTarget

        // A resize can clamp scroll before ResizeObserver runs. Keep that
        // geometry change separate from wheel, scrollbar, keyboard or drag input.
        if (resized(viewport)) {
          restoreScroll(viewport)

          return
        }

        const previous = scrollPosition.current
        const center = pan.current

        if (!previous || !center) return
        pan.current = {
          x: viewport.scrollLeft === previous.left
            ? center.x
            : viewport.scrollLeft + viewport.clientWidth / 2,
          y: viewport.scrollTop === previous.top
            ? center.y
            : viewport.scrollTop + viewport.clientHeight / 2,
        }
        scrollPosition.current = {
          ...previous,
          left: viewport.scrollLeft,
          top: viewport.scrollTop,
        }
      }}
      onKeyDown={event => {
        if (!nativeVisible) return

        const steps = new Map<string, readonly [number, number]>([
          ['ArrowLeft', [-80, 0]], ['ArrowRight', [80, 0]],
          ['ArrowUp', [0, -80]], ['ArrowDown', [0, 80]],
        ])

        const step = steps.get(event.key)

        if (!step) return
        event.preventDefault()
        event.currentTarget.scrollBy(step[0], step[1])
      }}
      onPointerDown={event => {
        if (!nativeVisible || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }
      }}
      onPointerMove={event => {
        if (!drag.current) return
        event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX
        event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
    >
      {frame ? (
        <img src={nativeVisible ? native.result?.url : fitUrl} width={frame.width} height={frame.height}
          style={nativeVisible ? { width: frame.width, height: frame.height } : undefined}
          draggable={false} alt={alt} />
      ) : empty}
    </div>
  )
}

export function ImageEnlargement({ open, onDismiss, rootRef, returnFocusId, title, children }: {
  open: boolean
  onDismiss: () => void
  rootRef: RefObject<HTMLElement | null>
  returnFocusId: string
  title: string
  children: ReactNode
}) {
  const [overlayHost, setOverlayHost] = useState<Element | null>(null)

  useEffect(() => { setOverlayHost(rootRef.current?.closest('.vela-theme') ?? null) }, [rootRef])

  useEffect(() => {
    if (!open || !overlayHost) return

    const background = Array.from(overlayHost.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.hasAttribute('data-image-overlay'),
    )

    const previousInert = background.map(element => element.inert)
    const previousOverflow = document.body.style.overflow
    background.forEach(element => { element.inert = true })
    document.body.style.overflow = 'hidden'

    return () => {
      background.forEach((element, index) => { element.inert = previousInert[index]! })
      document.body.style.overflow = previousOverflow
    }
  }, [open, overlayHost])

  return open && overlayHost ? createPortal(
    <div data-image-overlay>
      <Dialog open title={title} returnFocusId={returnFocusId}
        onDismiss={onDismiss} className="capture-image-dialog">
        {children}
      </Dialog>
    </div>, overlayHost,
  ) : null
}
