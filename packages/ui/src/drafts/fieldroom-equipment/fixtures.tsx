export const devices = [
  {
    id: 'main-camera', name: 'ZWO ASI2600MC Pro', kind: 'Camera',
    role: 'Camera · Main camera · Idle', summary: '−10.0°C · Cooler on', connected: true,
    details: [['Sensor temperature', '−10.0°C'], ['Cooler', 'On'], ['Cooler power', '42%']],
  },
  {
    id: 'mount', name: 'ASI Mount', kind: 'Mount',
    role: 'Mount · Tracking · Not parked', summary: 'Tracking', connected: true,
    details: [['Tracking', 'On'], ['Parked', 'No'], ['At home', 'No']],
  },
  {
    id: 'focuser', name: 'ZWO Focuser', kind: 'Focuser',
    role: 'Focuser · Position 32,842', summary: 'Idle', connected: true,
    details: [['Position', '32,842'], ['Temperature', '12.4°C'], ['Moving', 'No']],
  },
  {
    id: 'other-camera', name: 'ZWO ASI220MM Mini', kind: 'Camera',
    role: 'Other camera · Not used for imaging', summary: 'No current readings', connected: false,
    details: [['Readings', 'Unavailable while disconnected']],
  },
] as const

export function DeviceMark({ kind }: { kind: string }) {
  function geometry() {
    switch (kind) {
      case 'Mount':
        return (
          <>
            <path d="M8 6 26 17 22 24 4 13ZM19 23V28M18 28 10 35M18 28 26 35M18 28V35" />
            <circle cx="25" cy="11" r="3" />
          </>
        )
      case 'Focuser':
        return (
          <>
            <rect x="4" y="10" width="21" height="19" rx="4" />
            <circle cx="25" cy="20" r="7" />
            <path d="M6 6H18M11 6V10" />
          </>
        )
      default:
        return (
          <>
            <rect x="4" y="8" width="28" height="22" rx="4" />
            <circle cx="18" cy="19" r="7" />
            <path d="M10 8V5H18V8" />
          </>
        )
    }
  }

  return <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">{geometry()}</svg>
}

export function TelescopeMark() {
  return (
    <svg width="160" height="120" viewBox="0 0 160 120" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M36 36L116 18L128 52L48 70Z" />
      <path d="M70 66L84 82M84 82L56 112M84 82L111 112M84 82V113" />
      <circle cx="84" cy="82" r="5" fill="currentColor" stroke="none" />
    </svg>
  )
}
