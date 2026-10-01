import type { TargetSkyPath } from '@vela/model/web'
import { Dialog, IconButton, SkyPath, type SkyPathProps, type SkyLightPhase } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { skyTime } from './sky-time'

// Geometric solar-altitude bands; the server supplies the Sun's position.
function lightPhase(sunAltitude: number): SkyLightPhase {
  if (sunAltitude <= -18) return 'night'

  if (sunAltitude <= -12) return 'astronomical'

  if (sunAltitude <= -6) return 'nautical'

  return sunAltitude < 0 ? 'civil' : 'daylight'
}

export function SkyInspection({
  sky,
  targetName,
  stale,
  open,
  onOpenChange,
}: {
  sky: TargetSkyPath
  targetName: string
  stale: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <AvailableSky
      key={`${targetName}:${sky.startsAt}`}
      sky={sky}
      targetName={targetName}
      stale={stale}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

function AvailableSky({
  sky,
  targetName,
  stale,
  open,
  onOpenChange,
}: {
  sky: TargetSkyPath
  targetName: string
  stale: boolean
  open: boolean | undefined
  onOpenChange: ((open: boolean) => void) | undefined
}) {
  const [selectedAt, setSelectedAt] = useState<string | null>(null)
  const [localOpen, setLocalOpen] = useState(false)
  const expanded = open ?? localOpen
  const setExpanded = onOpenChange ?? setLocalOpen
  const root = useRef<HTMLDivElement>(null)
  const [overlayHost, setOverlayHost] = useState<Element | null>(null)
  useEffect(() => {
    setOverlayHost(root.current?.closest('.vela-theme') ?? null)
  }, [])
  useEffect(() => {
    if (!expanded || !overlayHost) return

    // Keep the portal inside the app theme but outside the composition's
    // containing block. The rest of the app is inert while inspecting the sky.
    const background = Array.from(overlayHost.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.hasAttribute('data-sky-overlay'),
    )

    const previousInert = background.map(element => element.inert)
    const previousOverflow = document.body.style.overflow
    background.forEach(element => {
      element.inert = true
    })
    document.body.style.overflow = 'hidden'

    return () => {
      background.forEach((element, index) => {
        element.inert = previousInert[index]!
      })
      document.body.style.overflow = previousOverflow
    }
  }, [expanded, overlayHost])

  const start = Date.parse(sky.startsAt)
  const end = Date.parse(sky.endsAt)
  const interval = (end - start) / (sky.samples.length - 1)

  const nearest = (at: string) =>
    Math.max(0, Math.min(sky.samples.length - 1, Math.round((Date.parse(at) - start) / interval)))

  const selectedIndex = nearest(selectedAt ?? sky.observedAt)
  const nowInSpan = Date.parse(sky.observedAt) >= start && Date.parse(sky.observedAt) <= end

  const skyProps: SkyPathProps = {
    targetName,
    samples: sky.samples.map(sample => ({
      ...sample,
      label: skyTime(sample.at),
      light: lightPhase(sample.sunAltitudeDegrees),
    })),
    moonSamples: sky.samples.map(sample => sample.moon),
    selectedIndex,
    onSelectedIndexChange: (index: number) => setSelectedAt(sky.samples[index]!.at),
    nowLabel: stale ? 'Last' : 'Now',
  }

  if (nowInSpan) skyProps.nowIndex = nearest(sky.observedAt)

  const selectedDate = new Date(sky.samples[selectedIndex]!.at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  return (
    <div ref={root}>
      <IconButton
        label="View sky path"
        onClick={() => setExpanded(true)}
        icon={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 19h18M4 15a8 8 0 0 1 10-9" />
            <path d="m17 3 1.1 2.9L21 7l-2.9 1.1L17 11l-1.1-2.9L13 7l2.9-1.1Z" />
            <path d="M20 13v2" />
            <circle cx="4" cy="15" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        }
      />
      {overlayHost &&
        createPortal(
          <div data-sky-overlay>
            <Dialog
              open={expanded}
              title={`${targetName} · Through the night`}
              description="Local time · target and Moon positions"
              dismissLabel="Close sky view"
              className="vela-target-sky-dialog"
              onDismiss={() => setExpanded(false)}
            >
              <SkyPath {...skyProps} />
              <p className="vela-target-sky-note">
                {selectedDate} · Light boundaries approximate · 15-minute samples
              </p>
              {stale && <p role="status">Sky updates interrupted · last calculation shown.</p>}
            </Dialog>
          </div>,
          overlayHost,
        )}
    </div>
  )
}
