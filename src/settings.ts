import { Schema } from 'effect'
import { described } from './config.ts'
import { BrokerLogin } from './stream/broker.ts'

export const FrameSettings = Schema.Struct({
  rig: described('The rig id on the entries Vela publishes: the id Cria\'s stream settings give the rig, which the entries from the rig program carry', Schema.String, 'fra-cria'),
  host: described('The rig computer as ssh names it from this machine; frames are copied from it with ssh, as the user this program runs as', Schema.String, 'errai'),
  spoolDir: Schema.String.annotate({
    description: 'The folder on the rig computer where the main camera driver saves frames (its UPLOAD_DIR). Only files directly in it are copied; the driver numbers them from its UPLOAD_PREFIX',
  }),
  keepDir: described('The folder on this machine where kept frames are copied to, one folder per night. Data goes on the data disk (/mnt/storage), not the system drive', Schema.String, '/mnt/storage/rig/frames'),
  nightZone: Schema.String.annotate({
    description: 'The time zone whose clock names a night, as an IANA name. A night is named for the evening it starts, by the modification time of its spool file, so a catch-up after the night lands in the same folder as the live copy would have',
  }),
  nightChangesAtHour: described(
    'The local hour a night\'s name changes: a frame saved before it belongs to the night that began the evening before. Noon, because a night starts at dusk and is over by dawn, so no night runs across noon',
    Schema.Number,
    12,
  ),
  copyAttempts: described(
    'Tries to copy and check one frame before it is left in the spool for the next scan. Not measured: no copy has failed yet (2026-11-07). A try covers a dropped ssh connection or a file read before the driver finished writing it; the next announcement or restart tries again anyway, and an exposure never repeats to repair a copy',
    Schema.Number,
    3,
  ),
  copyRetrySeconds: described(
    'Wait between two tries to copy one frame. Not measured: a guess at how long a dropped wifi link or a finishing write takes to clear (the rig computer uses wifi and ethernet); 5 s matches the delay the rig program waits before it reconnects a source',
    Schema.Number,
    5,
  ),
  sshTimeoutSeconds: described(
    'The longest one ssh command to the rig computer may run before it is stopped, so a hung connection cannot hold up every frame behind it. Copying one 52 MB frame took 1.7 s and hashing it 1.2 s over the LAN (measured 2026-11-07); 60 s allows a link thirty times slower',
    Schema.Number,
    60,
  ),
  preview: described(
    'How the preview of a frame is made',
    Schema.Struct({
      bin: described(
        'Superpixels averaged into one preview pixel, each side. The camera\'s 6248 x 4176 frame gives 3124 x 2088 superpixels, which is a larger picture than a phone or the page shows; 2 gives 1562 x 1044. A display choice, not a limit',
        Schema.Number,
        2,
      ),
      blackSigmas: described('Where each colour is cut to black, in noise spreads (1.4826 times the median absolute deviation) below its median. PixInsight\'s default screen stretch uses 2.8', Schema.Number, 2.8),
      targetMedian: described('The brightness, 0 to 1, each colour\'s median is moved to by the midtones curve, so the background shows evenly and without a colour cast. PixInsight\'s default screen stretch uses 0.25', Schema.Number, 0.25),
    }),
    {},
  ),
})

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
  frames: FrameSettings,
  historyReadBatch: described(
    'Entries asked of the broker at a time when replaying the rig connection. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban (Cria viewer, 2026-11-06)',
    Schema.Number,
    2048,
  ),
})

export type VelaSettings = typeof VelaSettings.Type
