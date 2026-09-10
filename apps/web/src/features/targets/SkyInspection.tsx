import type { TargetSkyPath } from '@vela/model/web'
import { Button, Dialog, Panel, SkyPath, type SkyLightPhase } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { skyTime, skyWindow } from './sky-time'

// Geometric solar-altitude bands; the server supplies the Sun's position.
function lightPhase(sunAltitude: number): SkyLightPhase {
  if (sunAltitude <= -18) return 'night'

  if (sunAltitude <= -12) return 'astronomical'

  if (sunAltitude <= -6) return 'nautical'

  return sunAltitude < 0 ? 'civil' : 'daylight'
}

export function SkyInspection({ sky, targetName, stale }: { sky: TargetSkyPath | null, targetName: string, stale: boolean }) {
  if (!sky) return <Panel title="Through the night" description="Site unavailable"><p>Site unavailable · sky path unknown</p></Panel>

  return <AvailableSky key={sky.startsAt} sky={sky} targetName={targetName} stale={stale} />
}

function AvailableSky({ sky, targetName, stale }: { sky: TargetSkyPath, targetName: string, stale: boolean }) {
  const [selectedAt, setSelectedAt] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [overlayHost, setOverlayHost] = useState<Element | null>(null)
  useEffect(() => { setOverlayHost(root.current?.closest('.vela-theme') ?? null) }, [])
  useEffect(() => {
    if (!expanded || !overlayHost) return
    // Keep the portal inside the app theme but outside the composition's
    // containing block. The rest of the app is inert while inspecting the sky.
    const background = Array.from(overlayHost.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute('data-sky-overlay'))
    const previousInert = background.map(element => element.inert)
    const previousOverflow = document.body.style.overflow
    background.forEach(element => { element.inert = true })
    document.body.style.overflow = 'hidden'

    return () => {
      background.forEach((element, index) => { element.inert = previousInert[index]! })
      document.body.style.overflow = previousOverflow
    }
  }, [expanded, overlayHost])

  const start = Date.parse(sky.startsAt)
  const end = Date.parse(sky.endsAt)
  const interval = (end - start) / (sky.samples.length - 1)
  const nearest = (at: string) => Math.max(0, Math.min(sky.samples.length - 1, Math.round((Date.parse(at) - start) / interval)))
  const selectedIndex = nearest(selectedAt ?? sky.observedAt)
  const nowInSpan = Date.parse(sky.observedAt) >= start && Date.parse(sky.observedAt) <= end

  const skyProps = {
    targetName,
    samples: sky.samples.map(sample => ({ ...sample, label: skyTime(sample.at), light: lightPhase(sample.sunAltitudeDegrees) })),
    moonSamples: sky.samples.map(sample => sample.moon),
    selectedIndex,
    onSelectedIndexChange: (index: number) => setSelectedAt(sky.samples[index]!.at),
    ...(nowInSpan ? { nowIndex: nearest(sky.observedAt) } : {}),
    nowLabel: stale ? 'Last' : 'Now',
  }

  const selectedDate = new Date(sky.samples[selectedIndex]!.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  const details = <>
    <p className="vela-target-sky-time">{selectedDate} · Light boundaries approximate · 15-minute samples</p>
    {stale && <p role="status">Sky updates interrupted · last calculation shown.</p>}
  </>

  return <div ref={root}>
    <Panel title="Through the night" description={`Local time · ${stale ? 'last update' : 'calculated'} ${skyTime(sky.observedAt)}`}>
      <SkyPath {...skyProps} compact />
      {details}
      <Button className="vela-target-expand-sky" tone="quiet" onClick={() => setExpanded(true)}>Expand sky view</Button>
      <div className="vela-target-sky-facts"><strong>{skyWindow(sky)}</strong><span>{sky.highestAltitudeDegrees.toFixed(0)}° highest altitude</span></div>
    </Panel>
    {overlayHost && createPortal(<div data-sky-overlay>
      <Dialog open={expanded} title={`${targetName} · Through the night`} description="Local time · target and Moon positions" dismissLabel="Close sky view" className="vela-target-sky-dialog" onDismiss={() => setExpanded(false)}>
        <SkyPath {...skyProps} />
        {details}
      </Dialog>
    </div>, overlayHost)}
  </div>
}
