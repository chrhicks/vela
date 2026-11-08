export const frameSubject = 'rig-dev.vela.frame'

export interface KeptFrame {
  readonly file: string
  readonly night: string
  readonly bytes: number
  readonly sha256: string
}

export function frameEntry(frame: KeptFrame, rig: string, at: number) {
  return { v: 2, id: `vela.frame:${frame.night}:${frame.file}`, rig, kind: 'vela.frame', at, source: 'vela', body: frame }
}
