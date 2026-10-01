import type { DeviceKind } from '@vela/model/device'
import type { ReactNode } from 'react'

export function DeviceIcon({ kind }: { readonly kind: DeviceKind }) {
  let drawing: ReactNode

  if (kind === 'telescope') {
    drawing = (
      <>
        <path d="M8 6 26 17 22 24 4 13ZM19 23V28M18 28 10 35M18 28 26 35M18 28V35" />
        <circle cx="25" cy="11" r="3" />
      </>
    )
  } else if (kind === 'camera') {
    drawing = (
      <>
        <rect x="4" y="8" width="28" height="22" rx="4" />
        <circle cx="18" cy="19" r="7" />
        <path d="M10 8V5H18V8" />
      </>
    )
  } else if (kind === 'focuser') {
    drawing = (
      <>
        <rect x="4" y="10" width="21" height="19" rx="4" />
        <circle cx="25" cy="20" r="7" />
        <path d="M6 6H18M11 6V10" />
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

  return (
    <svg aria-hidden="true" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox={kind === 'camera' || kind === 'telescope' || kind === 'focuser' ? '0 0 36 36' : '0 0 20 20'}>
      {drawing}
    </svg>
  )
}
