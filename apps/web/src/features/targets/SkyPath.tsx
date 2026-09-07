import type { TargetSkyPath } from '@vela/model/web'
export const skyTime = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
export function skyWindow(sky: TargetSkyPath) {
  return sky.aboveHorizonDuringDarkness.length ? sky.aboveHorizonDuringDarkness.map(w => `Approx. ${skyTime(w.startsAt)}–${skyTime(w.endsAt)}`).join(' · ') : 'Not above horizon during darkness'
}
export function SkyPath({ sky, compact = false, stale = false }: { sky: TargetSkyPath | null, compact?: boolean, stale?: boolean }) {
  if (!sky) return <p className="vela-target-obstructions">Site unavailable · sky path unknown</p>
  const start = Date.parse(sky.startsAt), duration = Date.parse(sky.endsAt) - start
  const x = (at: string) => 28 + (Date.parse(at) - start) / duration * 272
  const y = (alt: number) => 106 - alt * .82
  const now = x(sky.observedAt)
  const nowInNight = now >= 28 && now <= 300
  return <svg className="vela-target-path" viewBox="0 0 320 150" role="img" aria-label={`Sky path. ${stale ? "Last calculation" : "Now"} ${sky.currentAltitudeDegrees.toFixed(0)} degrees; highest ${sky.highestAltitudeDegrees.toFixed(0)} degrees. Shading marks astronomical darkness. Obstructions unknown.`}>
    {sky.samples.slice(0, -1).map((s, i) => s.sunAltitudeDegrees <= -18 && <rect key={s.at} className="vela-target-darkness" x={x(s.at)} y="24" width={Math.max(0, x(sky.samples[i + 1]!.at) - x(s.at))} height="98" />)}
    {!compact && <><path className="vela-target-gridline" d="M28 57H300 M28 81H300" /><text x="0" y="60">60°</text><text x="0" y="84">30°</text></>}
    <path className="vela-target-horizon" d="M28 106H300" />
    <polyline className="vela-target-arc" points={sky.samples.map(s => `${x(s.at)},${Math.max(24, Math.min(122, y(s.altitudeDegrees)))}`).join(' ')} />
    {nowInNight && <g className="vela-target-time"><line x1={now} x2={now} y1="24" y2="122" /><text x={now} y="17" textAnchor="middle">{stale ? "Last" : "Now"}</text></g>}
    <text x="28" y="143">{skyTime(sky.startsAt)}</text><text x="164" y="143" textAnchor="middle">{skyTime(new Date(start + duration / 2).toISOString())}</text><text x="300" y="143" textAnchor="end">{skyTime(sky.endsAt)}</text>
    {!compact && <text x="251" y="102">Horizon</text>}
  </svg>
}
