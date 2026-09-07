import type { FramingView, TargetPosition } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { frameCorners, offsetPosition } from './geometry'
import { isPosition } from './validation'

type Viewer = ReturnType<(typeof import('aladin-lite'))['default']['aladin']>
export function SurveyField({ target, desired, camera, actual, locked, onChange }: {
  target: TargetPosition, desired: TargetPosition, camera: FramingView['camera'], actual: FramingView['actual'], locked: boolean, onChange: (position: TargetPosition) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<SVGSVGElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const drag = useRef<{ x: number, y: number, cx: number, cy: number } | null>(null)
  useEffect(() => { if (locked) drag.current = null }, [locked])
  const initialWidth = camera?.fieldWidthDegrees ?? 2
  const geometryInitialized = useRef(false)

  useEffect(() => {
    let disposed = false
    let instance: Viewer | null = null
    setReady(false)
    setFailed(false)
    geometryInitialized.current = false
    const controller = new AbortController()
    async function open() {
      try {
        // Probe the survey before displaying an empty field as if it were sky.
        const response = await fetch('/api/survey/dss2/Norder3/Allsky.jpg', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error('Survey unavailable')
        const bitmap = await createImageBitmap(await response.blob())
        bitmap.close()
        const { default: A } = await import('aladin-lite')
        await A.init
        if (disposed || !host.current) return
        const survey = A.imageHiPS(`${location.origin}/api/survey/dss2`, { name: 'DSS2 color', cooFrame: 'equatorial', maxOrder: 9, imgFormat: 'jpeg', requestMode: 'same-origin', errorCallback: () => { if (!disposed) { setReady(false); setFailed(true) } } })
        instance = A.aladin(host.current, { survey, log: false, hipsList: [], target: `${target.raDegrees} ${target.decDegrees}`, fov: Math.min(90, initialWidth * 2.2), projection: 'TAN', cooFrame: 'ICRS',
          showLayersControl: false, showFullscreenControl: false, showZoomControl: false, showGotoControl: false, showShareControl: false, showSettingsControl: false, showSimbadPointerControl: false, showStatusBar: false, showFov: false, showCooLocation: false, showFrame: false, showReticle: false, showCooGridControl: false, showProjectionControl: false })
        viewer.current = instance
        const redraw = () => { if (!disposed) setRevision(r => r + 1) }
        instance.on('positionChanged', redraw)
        instance.on('zoomChanged', redraw)
        setReady(true)
      } catch { if (!disposed) setFailed(true) }
    }
    void open()
    const resize = new ResizeObserver(() => setRevision(r => r + 1))
    if (host.current) resize.observe(host.current)
    return () => { disposed = true; controller.abort(); resize.disconnect(); instance?.remove(); viewer.current = null }
    // Camera geometry updates the overlay without resetting a user's survey pan.
  }, [target.raDegrees, target.decDegrees, attempt])

  useEffect(() => {
    if (ready && camera && viewer.current && !geometryInitialized.current) {
      geometryInitialized.current = true
      viewer.current.setFoV(Math.min(90, camera.fieldWidthDegrees * 2.2))
    }
  }, [ready, camera?.fieldWidthDegrees])

  useEffect(() => {
    const element = overlay.current
    const canvas = host.current?.querySelector('.aladin-catalogCanvas')
    if (!ready || !element || !canvas) return
    // The draggable footprint sits above Aladin's interaction canvas. Forward
    // wheel input so its native zoom behavior is identical on both surfaces.
    const zoom = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaX: event.deltaX, deltaY: event.deltaY,
        deltaZ: event.deltaZ, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      }))
    }
    element.addEventListener('wheel', zoom, { passive: false })
    return () => element.removeEventListener('wheel', zoom)
  }, [ready])

  const project = (points: TargetPosition[]) => {
    if (!ready || !viewer.current) return ''
    try {
      const pixels = points.map(p => viewer.current!.world2pix(p.raDegrees, p.decDegrees))
      return pixels.every(p => p && p.every(Number.isFinite)) ? pixels.map(p => p!.join(',')).join(' ') : ''
    } catch { return '' }
  }
  void revision
  const points = camera ? project(frameCorners(desired, camera.fieldWidthDegrees, camera.fieldHeightDegrees, actual?.rotationDegrees ?? 0)) : ''
  const actualPoints = actual ? project(actual.corners) : ''
  const center = ready ? viewer.current?.world2pix(desired.raDegrees, desired.decDegrees) : undefined
  const move = (x: number, y: number) => {
    if (locked || !ready) return
    const position = viewer.current?.pix2world(x, y)
    if (position) {
      const next = { raDegrees: (position[0] + 360) % 360, decDegrees: position[1] }
      if (isPosition(next)) onChange(next)
    }
  }
  const nudge = (east: number, north: number) => {
    if (!locked && camera) onChange(offsetPosition(desired, east * camera.fieldWidthDegrees / 100, north * camera.fieldHeightDegrees / 100))
  }
  return <>
    <div className="vela-target-field" data-disabled={locked}>
      <div className="vela-target-survey" ref={host} aria-label="Interactive DSS2 sky survey" />
      {!ready && <div className="vela-target-survey-message" role="status"><strong>{failed ? 'Reference survey unavailable' : 'Loading reference survey…'}</strong><p>{failed ? 'Your coordinates remain available. Check the survey connection to compose visually.' : 'DSS2 color sky survey'}</p>{failed && <Button onClick={() => setAttempt(a => a + 1)}>Retry survey</Button>}</div>}
      {ready && <svg ref={overlay} className="vela-target-overlay" aria-label="Calibrated camera footprint" role="img">
        {points && <path className="vela-target-shade" fillRule="evenodd" d={`M0 0H10000V10000H0Z M${points.split(" ").join(" L")}Z`} />}
        {points && <polygon className="vela-target-footprint" points={points} tabIndex={locked ? -1 : 0} role="slider" aria-label="Camera frame position" aria-valuetext={`RA ${desired.raDegrees.toFixed(4)}, Dec ${desired.decDegrees.toFixed(4)} degrees`} aria-disabled={locked}
          onPointerDown={event => {
            if (locked || event.button !== 0 || !center) return
            event.preventDefault(); event.stopPropagation()
            drag.current = { x: event.clientX, y: event.clientY, cx: center[0], cy: center[1] }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => { if (drag.current) move(drag.current.cx + event.clientX - drag.current.x, drag.current.cy + event.clientY - drag.current.y) }}
          onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={event => {
            const delta = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key]
            if (delta) { event.preventDefault(); nudge(delta[0]!, delta[1]!) }
          }} />}
        {center && points && <text className="vela-target-cross" x={center[0]} y={center[1]} textAnchor="middle" dominantBaseline="middle">+</text>}
        {actualPoints && <polygon className="vela-target-footprint vela-target-footprint--actual" points={actualPoints} />}
      </svg>}
    </div>
    <footer><span>DSS2 color reference survey · <a href="https://github.com/cds-astro/aladin-lite/tree/v3.8.2" target="_blank" rel="noreferrer">Aladin Lite</a> · <a href="/third-party/aladin-lite-license.txt" target="_blank" rel="noreferrer">License</a></span><a href="https://archive.stsci.edu/dss/acknowledging.html" target="_blank" rel="noreferrer">Image credit ↗</a></footer>
    <div className="vela-target-adjustments">
      <div><strong>Camera orientation stays fixed</strong><Button size="small" tone="quiet" disabled={locked} onClick={() => { onChange(target); viewer.current?.gotoRaDec(target.raDegrees, target.decDegrees) }}>Reset frame</Button></div>
      <div className="vela-target-nudges"><span>Move frame</span>{[['←', 1, 0], ['→', -1, 0], ['↑', 0, 1], ['↓', 0, -1]].map(([label, east, north]) => <Button key={String(label)} size="small" disabled={locked || !camera} aria-label={`Move frame ${label}`} onClick={() => nudge(Number(east), Number(north))}>{label}</Button>)}</div>
      <div><span>Drag sky to pan · scroll to zoom</span><Button size="small" disabled={!ready} onClick={() => viewer.current?.setFoV(viewer.current.getFov()[0] / 1.5)}>Zoom in</Button><Button size="small" disabled={!ready} onClick={() => viewer.current?.setFoV(Math.min(90, viewer.current.getFov()[0] * 1.5))}>Zoom out</Button></div>
    </div>
  </>
}
