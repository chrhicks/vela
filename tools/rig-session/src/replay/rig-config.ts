export interface RecordedDevice {
  id: string
  kind: string
  indiDevice: string
}

/** The kinds replay can serve to Vela. A switch needs channels that a recording does not name. */
const servedKinds = ['camera', 'mount', 'focuser', 'weather']

interface CriaConfig {
  listen: { host: string; port: number }
  indi: { host: string; port: number }
  imageDirectory: string
  commandsEnabled: boolean
  readoutAllowanceMs?: number
  devices: Array<RecordedDevice & { connect: boolean }>
}

/**
 * Cria's configuration for a replay: the recording's devices, none of them told to connect, no serial
 * ports and no site (a recording holds neither), listening on any free port.
 */
export function criaConfigFor(
  devices: ReadonlyArray<RecordedDevice>,
  { indiPort, imageDirectory, readoutAllowanceMs }: { indiPort: number; imageDirectory: string; readoutAllowanceMs?: number | undefined },
) {
  const config: CriaConfig = {
    listen: { host: '127.0.0.1', port: 0 },
    indi: { host: '127.0.0.1', port: indiPort },
    imageDirectory,
    commandsEnabled: true,
    devices: devices.flatMap(device =>
      servedKinds.includes(device.kind) ? [{ id: device.id, kind: device.kind, indiDevice: device.indiDevice, connect: false }] : [],
    ),
  }

  if (readoutAllowanceMs !== undefined) config.readoutAllowanceMs = readoutAllowanceMs

  return config
}

export function replayRigId(name: string): string {
  return `replay-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/**
 * The `cria.json` Vela reads: one rig named `replay: <name>`, so it is never mistaken for a real one.
 * The imaging camera is the one replay serves frames for.
 */
export function velaCriaConfigFor(
  name: string,
  devices: ReadonlyArray<RecordedDevice>,
  { criaUrl, imagingIndiDevice }: { criaUrl: string; imagingIndiDevice: string },
) {
  const served = devices.filter(device => servedKinds.includes(device.kind))
  const imaging = served.find(device => device.kind === 'camera' && device.indiDevice === imagingIndiDevice)

  if (!imaging) throw new Error(`The recording has no camera named ${imagingIndiDevice} to image with.`)

  return {
    rigs: [
      {
        id: replayRigId(name),
        name: `replay: ${name}`,
        url: criaUrl,
        imagingCameraId: imaging.id,
        devices: served.map(device => ({ id: device.id, kind: device.kind, expectedName: device.indiDevice })),
      },
    ],
  }
}
