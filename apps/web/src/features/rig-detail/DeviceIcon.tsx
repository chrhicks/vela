import type { DeviceKind } from '@vela/model/device'
import type { ReactNode } from 'react'

export function DeviceIcon({ kind }: { readonly kind: DeviceKind }) {
  let drawing: ReactNode

  if (kind === 'telescope') {
    drawing = (
      <>
        <path d="m5 8 10-4 2.2 5.2-10 4L5 8Z" />
        <path d="m9 12 3 2m-1.5-1-3 6m3-6 5 5M3.8 6.8 6 12" />
      </>
    )
  } else if (kind === 'camera') {
    drawing = (
      <>
        <rect height="10" rx="2" width="14" x="3" y="6" />
        <circle cx="10" cy="11" r="3.2" />
        <path d="m6 6 1-2h6l1 2" />
      </>
    )
  } else if (kind === 'focuser') {
    drawing = (
      <>
        <circle cx="10" cy="10" r="5" />
        <circle cx="10" cy="10" r="2" />
        <path d="M10 2v3m0 10v3M2 10h3m10 0h3" />
      </>
    )
  } else if (kind === 'filter-wheel') {
    drawing = (
      <>
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="6" r="1.2" />
        <circle cx="6.5" cy="12" r="1.2" />
        <circle cx="13.5" cy="12" r="1.2" />
      </>
    )
  } else if (kind === 'observing-conditions') {
    drawing = (
      <>
        <path d="M6 14.5a3.5 3.5 0 1 1 1.2-6.8A5 5 0 0 1 17 9.3a2.7 2.7 0 0 1-.7 5.2H6Z" />
        <path d="M8 17h.01m4 0h.01" />
      </>
    )
  } else if (kind === 'switch') {
    drawing = <path d="m11.5 2-6 9h5l-2 7 6-9h-5l2-7Z" />
  } else {
    drawing = (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M7 10h6M10 7v6" />
      </>
    )
  }

  return <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">{drawing}</svg>
}
