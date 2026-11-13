import { Schema } from 'effect'
import { Environment } from '../state/stream.ts'
import { described } from './config.ts'
import { BrokerSettings } from './stream/broker.ts'

export const FrameSettings = Schema.Struct({
  rig: described('The rig id on the entries Vela publishes: the id Cria\'s stream settings give the rig, which the entries from the rig program carry', Schema.String, 'fra-cria'),
  host: described('The rig computer as ssh names it from this machine; frames are copied from it with ssh, as the user this program runs as', Schema.String, 'errai'),
  spoolDir: Schema.String.annotate({
    description: 'The folder on the rig computer where the main camera driver saves frames (its UPLOAD_DIR). Only files directly in it are copied; the driver numbers them from its UPLOAD_PREFIX',
  }),
  measureDir: Schema.String.annotate({
    description: "The folder on the rig computer where alignment and autofocus frames are saved to be measured there and not kept: the rig file's measure.folder. The rig program solves or measures each frame on request and removes it once the result is on the stream; the keeper never copies from it",
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

export const FeedConfig = Schema.Struct({
  host: described(
    "The address the web app's event stream listens on. 127.0.0.1 keeps it to this machine; other machines reach it through tailscale serve",
    Schema.String,
    '127.0.0.1',
  ),
  port: described(
    "The port the web app's event stream is served on. Its own port, apart from the night page's, so each server can go without the other",
    Schema.Number,
    8796,
  ),
  webRoot: Schema.String.annotate({
    description: "The folder of the built web app (web/dist after its build), served at every address the event stream does not answer, so the page and its event stream come from one place",
  }),
  lostAfterSeconds: described(
    "How long a page goes without a heartbeat before it says the connection is lost. Not measured: three missed heartbeats at the default 5 s, so one late beat on a phone's wifi does not raise it",
    Schema.Number,
    15,
  ),
  heartbeatSeconds: described(
    "How often the event stream sends the service's clock, so a page can tell a quiet rig from a lost connection and age readings by one clock. Not measured: 5 s lets a page see a dropped connection within seconds for 12 small messages a minute",
    Schema.Number,
    5,
  ),
})

export const CaptureSettings = Schema.Struct({
  runFile: Schema.String.annotate({
    description: 'A small file naming the run in progress, written when a run starts and removed when it ends. A run found in it at start is marked interrupted: Vela never resumes a run. Put it on this machine\'s state directory, not a temporary one, so a reboot during a run still shows',
  }),
  commandAnswerSeconds: described(
    'How long a command may go unanswered by the rig program before the page says so. Vela keeps waiting for the answer and never sends the command again; Stop is Chris\'s. Measured 2026-11-09 on RIG_DEV since 11-08 noon ET: 166 of 166 commands answered, median 1 ms, slowest 17 ms, so 10 s means the rig program or the link to it is down',
    Schema.Number,
    10,
  ),
  settleSeconds: described(
    'How long Vela waits for a written setting to show on the stream, or for the camera to stop exposing before the next frame, before the page says it is still waiting. Vela keeps waiting either way; Stop is Chris\'s. Measured 2026-11-09 on RIG_DEV since 11-08 noon ET: 154 of 154 written settings showed within 248 ms, and the camera left Busy within 5 ms of saving each of 46 frames, so 10 s means something is wrong',
    Schema.Number,
    10,
  ),
  exposureSilenceSeconds: described(
    'How long the camera driver may send no CCD_EXPOSURE update during an exposure before the page says Vela is waiting for word from the camera. Vela never aborts the frame itself; Stop is Chris\'s. While exposing, the driver sent CCD_EXPOSURE Busy with the time left at most 2.4 s apart (median 0.99 s), and a retry showed as the time left jumping back up (110 retries), with at most 1.5 s from the last Busy to Ok or Alert (Cria wire recording of 2026-11-03, 434 exposures, ASI2600MC Pro, indi-asi 2.2.5); 10 s is four times the largest gap seen',
    Schema.Number,
    10,
  ),
  failuresInRow: described(
    'Exposures in a row the driver gave up on (CCD_EXPOSURE Alert) before the page says so. The run keeps going; Stop is Chris\'s. 19 of 434 exposures (about 4.4%) went Alert on the ASI2600MC Pro (Cria wire recording of 2026-11-03), so 3 in a row by chance is about 0.0085% of exposures if independent; seeing it means something changed',
    Schema.Number,
    3,
  ),
  telescope: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description:
        "The optical tube the main camera is on, written as TELESCOP into every frame's header through the camera's FITS_HEADER. Without it the camera driver writes the name of the device it reads pointing from, which is the mount",
    }),
  ),
})

export const PrepareSettings = Schema.Struct({
  focuserNudgeSteps: described(
    'Steps one press of the focuser\'s in or out button moves it. Not measured: no nudge has been made yet (2026-11-07). The driver reports a travel of 60000 steps (ABS_FOCUS_POSITION, stream, 2026-11-07), so 100 steps is a small move that is still far larger than the 1 step the driver counts; a display choice, change it to what a focus step needs',
    Schema.Number,
    100,
  ),
})

export const PointingSettings = Schema.Struct({
  searchResults: described(
    'Targets listed for one search. A display choice, not a limit of the catalog (13,000 rows): the list is a picker for one target, and ten rows fit a phone screen without scrolling the controls away',
    Schema.Number,
    10,
  ),
})

export const StarSettings = Schema.Struct({
  program: Schema.String.annotate({ description: 'The ASTAP command-line program (astap_cli) on this machine, which counts and sizes the stars of each kept imaging frame' }),
  analyseSnr: described(
    'The signal to noise a star needs to be counted. On the 10-31 autofocus runs, 10 found the same best position as 30 with two to three times the stars, and 30 found under 6 stars once a frame was 150 steps out of focus (replay of the recorded frames, 2026-11-09)',
    Schema.Number,
    10,
  ),
  shapeMinSnr: described(
    'The signal to noise a star needs for its shape to count towards the frame\'s elongation. With 30 and the brightest 300, tracked 10 s frames of M 52 measured 1.03 to 1.05 from about 260 stars, a frame whose last 3 s were untracked 1.24 (2026-11-09)',
    Schema.Number,
    30,
  ),
  shapeStars: described('How many of the brightest strong stars are measured for the elongation; 300 gave the 2026-11-09 values above in a few tenths of a second', Schema.Int.check(Schema.isGreaterThan(0)), 300),
  saturated: described(
    "A star with any pixel at or above this is left out of the elongation, because its clipped core is flatter than the star. The ASI2600's 14-bit samples top out at 65532 in its 16-bit frames, and a core near that is already off the linear range",
    Schema.Number,
    60000,
  ),
})

export const AlignSettings = Schema.Struct({
  declinationDegrees: described(
    'The declination the three alignment frames are taken at. Every polar alignment recorded from 10-31 to 11-03 (six runs) turned the mount at declination 80 on the west side of the pier, clear of the pier and the tripod legs',
    Schema.Number,
    80,
  ),
  hourAnglesDegrees: described(
    'The hour angles of the three alignment frames, east of the meridian negative. The recorded runs swept from -130 to -16 (the same six runs); the three points are its two ends and its middle, because the wider apart they are, the less a solve error moves the fitted axis (on the 11-03 run, three adjacent points 23 degrees apart gave 2.5 arcminutes less than the ends and middle)',
    Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
    [-130, -73, -16],
  ),
})

export const LaunchSettings = Schema.Struct({
  alignExposureSeconds: described(
    'Exposure of each polar alignment frame. All 24 alignments on the nights of 11-09 and 11-10 used 2 s, and solved through the dual-band filter as well as without it',
    Schema.Number,
    2,
  ),
  autofocusStep: described('Focuser steps between two autofocus samples. Every sweep on 11-09 and 11-10 used 50; 100 steps from best focus roughly doubled HFD on those curves, so 50 keeps samples on both sides of focus', Schema.Number, 50),
  autofocusSamples: described('Samples in one autofocus sweep. Every full sweep on 11-09 and 11-10 took 9: 34 s at 2 s exposures, 114 s at 10 s', Schema.Number, 9),
  autofocusExposureSeconds: described(
    'Exposure of each autofocus sample, by the filter answer at launch. Out: 2 s, used on 11-09 and 11-11. In: 10 s, used on 11-10; Chris called it arbitrary, a guess to let more light through the dual-band filter',
    Schema.Struct({ in: Schema.Number, out: Schema.Number }),
    { in: 10, out: 2 },
  ),
})

export const CentreSettings = Schema.Struct({
  toleranceArcmin: described(
    'How far, in arcminutes, the solved centre of a centring frame may be from the target for slew and centre to finish. 1 arcminute is 31 pixels at the FRA400 and ASI2600 scale of 1.94 arcseconds per pixel, under 1% of the 6248-pixel frame width, so frames centred within it stack with no crop worth noticing. Not yet checked against how closely the AM5 repeats a goto after a sync (to measure on 2026-11-10): if passes never get under it, this is the number to change',
    Schema.Number,
    1,
  ),
})

export const AutofocusSettings = Schema.Struct({
  minStars: described(
    'Stars the best frame of a sweep must show before Vela picks a focus from it. A daylight sweep on the rig found 1 to 4 (noise and hot pixels), and frames with no stars on 11-08 0 to 4; real night frames within 150 steps of focus found 55 to 582 (10-31 replay, 2026-11-09)',
    Schema.Number,
    10,
  ),
})

export const VelaSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on, on 127.0.0.1 only; reach it from other machines through tailscale serve' }),
  broker: BrokerSettings,
  environment: described(
    "The rig environment Vela reads and writes: the stream RIG_<ENVIRONMENT> and its subjects rig-<environment>.*, lower-case letters only. The rig program's stream settings must name the same one. One broker can carry several, so a trial can run as test beside dev",
    Environment,
    'dev',
  ),
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
  feed: FeedConfig.annotate({ description: 'The web app and the event stream it reads: the state first, then each wanted entry, and a heartbeat' }),
  frames: FrameSettings,
  capture: CaptureSettings,
  prepare: described('Settings for the focuser and dew controls', PrepareSettings, {}),
  pointing: described('Settings for choosing a target and pointing the mount', PointingSettings, {}),
  align: described('Settings for polar alignment', AlignSettings, {}),
  stars: Schema.optionalKey(StarSettings.annotate({ description: 'Counting and sizing the stars of each kept imaging frame. Without it, kept frames get only their sky level and noise' })),
  autofocus: described('Settings for autofocus', AutofocusSettings, {}),
  launch: described('What the launch steps start on a tap: alignment, and autofocus after the filter answer', LaunchSettings, {}),
  centre: described('Settings for slew and centre', CentreSettings, {}),
  streamViewer: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description: "The address of Cria's stream viewer, which shows the raw INDI wire. The Activity view links to it; without it, there is no link",
    }),
  ),
  historyReadBatch: described(
    'Entries asked of the broker at a time when replaying the rig connection. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban (Cria viewer, 2026-11-06)',
    Schema.Number,
    2048,
  ),
})

export type VelaSettings = typeof VelaSettings.Type
