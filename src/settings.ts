import { Schema } from 'effect'
import { described } from './config.ts'
import { BrokerLogin } from './stream/broker.ts'

export const VelaSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on, on 127.0.0.1 only; reach it from other machines through tailscale serve' }),
  broker: BrokerLogin,
  devices: described(
    "The rig file's ids for the devices the page shows (the `id` of each entry in the rig program's devices). The names come from the rig file on errai, read on 2026-11-07",
    Schema.Struct({
      mount: described('The mount', Schema.String, 'mount'),
      primary: described('The main camera', Schema.String, 'primary'),
      guide: described('The guide camera', Schema.String, 'guide'),
      focuser: described('The focuser', Schema.String, 'focuser'),
      box: described('The power box', Schema.String, 'box'),
    }),
    {},
  ),
  silenceSeconds: described(
    'How long the rig program may send nothing before every value is shown as stale. With the rig idle the mount sent its coordinates and the camera its cooler power every 1.0 s for 380 s (stream, 2026-11-07), so 10 s is ten missed beats; a value that only changes now and then, such as the sensor temperature (gaps up to 79 s in the same window), is not aged by its own silence, because the driver sends it only on a change',
    Schema.Number,
    10,
  ),
  pageRefreshSeconds: described(
    'How often the page is sent a fresh picture. The mount sends coordinates every 1.0 s when idle (stream, 2026-11-07), so a slower page would lag the mount and a faster one adds nothing; it also moves the time to the meridian limit and the stale marking forward when the rig is quiet',
    Schema.Number,
    1,
  ),
  historyReadBatch: described(
    'Entries asked of the broker at a time when replaying the rig connection. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban (Cria viewer, 2026-11-06)',
    Schema.Number,
    2048,
  ),
})

export type VelaSettings = typeof VelaSettings.Type
