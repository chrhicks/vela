import { Schema } from 'effect'
import { Environment } from '../state/stream.ts'
import { described } from './config.ts'
import { BrokerSettings } from './stream/broker.ts'
import { CatalogConfig } from './catalog/database.ts'
import { SurveyConfig } from './sky/survey.ts'
import { ReviewSettings } from './review/settings.ts'
import { SweepSettings } from './sweep/settings.ts'
import { ForecastSettings } from './forecast/settings.ts'

export const FrameSettings = Schema.Struct({
  rig: described("The rig's id on the entries Vela publishes, the same id the rig program's entries carry", Schema.String, 'fra-cria'),
  host: described('The rig computer as ssh names it from this machine; frames are copied from it with ssh', Schema.String, 'errai'),
  spoolDir: Schema.String.annotate({
    description: 'The folder on the rig computer where the main camera driver saves frames (its UPLOAD_DIR)',
  }),
  measureDir: Schema.String.annotate({
    description: "The folder on the rig computer where alignment and autofocus frames are saved to be measured there and not kept (the rig file's measure.folder)",
  }),
  keepDir: described('The folder on this machine where kept frames are copied to, one folder per night', Schema.String, '/mnt/storage/rig/frames'),
  nightZone: Schema.String.annotate({
    description: 'The time zone whose clock names a night, as an IANA name',
  }),
  nightChangesAtHour: described(
    "The local hour a night's name changes: a frame saved before it belongs to the night that began the evening before",
    Schema.Number,
    12,
  ),
  copyAttempts: described(
    'Tries to copy and check one frame before it is left in the spool for the next scan',
    Schema.Number,
    3,
  ),
  copyRetrySeconds: described(
    'Seconds between two tries to copy one frame',
    Schema.Number,
    5,
  ),
  sshTimeoutSeconds: described(
    'Seconds one ssh command to the rig computer may run before it is stopped',
    Schema.Number,
    60,
  ),
  preview: described(
    'How the preview of a frame is made',
    Schema.Struct({
      bin: described(
        'Superpixels averaged into one preview pixel, each side',
        Schema.Number,
        2,
      ),
      blackSigmas: described('Where each colour is cut to black, in noise spreads (1.4826 times the median absolute deviation) below its median', Schema.Number, 2.8),
      targetMedian: described("The brightness, 0 to 1, each colour's median is moved to by the midtones curve", Schema.Number, 0.25),
    }),
    {},
  ),
})

export const FeedConfig = Schema.Struct({
  host: described(
    "The address the web app's event stream listens on",
    Schema.String,
    '127.0.0.1',
  ),
  port: described(
    'The port the web app and its event stream are served on',
    Schema.Number,
    8796,
  ),
  webRoot: Schema.String.annotate({
    description: 'The folder of the built web app (web/dist), served at every address the event stream does not answer',
  }),
  lostAfterSeconds: described(
    'Seconds without a heartbeat before a page says the connection is lost',
    Schema.Number,
    15,
  ),
  heartbeatSeconds: described(
    "Seconds between two heartbeats, which carry the service's clock",
    Schema.Number,
    5,
  ),
})

export const CaptureSettings = Schema.Struct({
  runFile: Schema.String.annotate({
    description: 'A file naming the run in progress, written when a run starts and removed when it ends; a run found in it at start is marked interrupted',
  }),
  commandAnswerSeconds: described(
    'Seconds a command may go unanswered by the rig program before the page says so',
    Schema.Number,
    10,
  ),
  settleSeconds: described(
    'Seconds Vela waits for a written setting to show on the stream, or for the camera to stop exposing, before the page says it is still waiting',
    Schema.Number,
    10,
  ),
  exposureSilenceSeconds: described(
    'Seconds the camera driver may send no CCD_EXPOSURE update during an exposure before the page says Vela is waiting for word from the camera',
    Schema.Number,
    10,
  ),
  failuresInRow: described(
    'Exposures in a row the driver gave up on (CCD_EXPOSURE Alert) before the page says so',
    Schema.Number,
    3,
  ),
  filterNames: described(
    "What the FILTER card in each frame says for each filter answer, from the Launch filter step or a target's Start. Before an answer, frames have no FILTER card",
    Schema.Struct({ in: Schema.NonEmptyString, out: Schema.NonEmptyString }),
    { in: 'Dual band', out: 'None' },
  ),
  filterInSuffix: described("What a run's frame names end with, after the frame type, when the run is taken with the filter in", Schema.NonEmptyString, 'dual'),
  telescope: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description:
        "The optical tube the main camera is on, written as TELESCOP into every frame's header through the camera's FITS_HEADER. Without it the camera driver writes the name of the device it reads pointing from, which is the mount",
    }),
  ),
})

export const PrepareSettings = Schema.Struct({
  focuserNudgeSteps: described(
    "Steps one press of the focuser's in or out button moves it",
    Schema.Number,
    100,
  ),
})

export const PointingSettings = Schema.Struct({
  searchResults: described(
    'Targets listed for one search',
    Schema.Number,
    10,
  ),
  wheelPixelsPerDoubling: described("Wheel scroll, in pixels, that halves or doubles the scale of the picker's full-size view", Schema.Number, 200),
  zoomGlideMs: described("How long the picker's full-size view takes to glide to a new scale, in milliseconds", Schema.Number, 150),
  upLineDegrees: described(
    'The altitude, in degrees, a target must be above for the target list to count it as up where the horizon is unknown (no horizon file, or no measured edge at its azimuth)',
    Schema.Number,
    30,
  ),
  upStepSeconds: described(
    "The time between the points, in seconds, at which the target list checks a target against the horizon at its azimuth when it finds when the target rises above it or sets below it",
    Schema.Number.check(Schema.isGreaterThan(0)),
    60,
  ),
  upLookAheadHours: described(
    'How far ahead, in hours, the target list looks for a target to rise above the horizon or set below it. A target above it throughout is listed as up all night and one below it throughout as not up',
    Schema.Number.check(Schema.isGreaterThan(0)),
    12,
  ),
  bestPlacedRows: described(
    'Targets listed as best placed when nothing is typed',
    Schema.Number,
    30,
  ),
  sameFramingDegrees: described(
    'How far, in degrees, a centre reached before may be from a target for it to be offered as the same framing',
    Schema.Number,
    1.1,
  ),
  bestPlacedMinArcminutes: described(
    'The size, in arcminutes along its long side, a target needs to be listed as best placed',
    Schema.Number,
    10,
  ),
})

export const HorizonNightSettings = Schema.Struct({
  stepSeconds: described("The time between the points, in seconds, of a target's path from dusk to dawn on the horizon page", Schema.Number.check(Schema.isGreaterThan(0)), 60),
  decimals: described("How many decimal places, in degrees, the horizon page's path altitudes, azimuths and line altitudes are rounded to", Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 2),
  frameAngleDecimals: described("How many decimal places, in degrees, the horizon page's camera footprint angles (the direction of celestial north from straight up at the target) are rounded to", Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 1),
  frameEdgeSamples: described("How many points along each edge of the camera's footprint the server checks against the horizon when it looks for the first clean frame of a night", Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), 16),
  cloudyPercent: described("The forecast cloud cover, in percent, from which the horizon page greys the target's path and counts an hour as cloudy. A display choice, not a limit on anything Vela does", Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })), 50),
})

export const StarSettings = Schema.Struct({
  program: Schema.String.annotate({ description: 'The ASTAP command-line program (astap_cli) on this machine, which counts and sizes the stars of each kept imaging frame' }),
  catalog: Schema.optionalKey(Schema.String.annotate({ description: "The folder of ASTAP's star database on this machine. With it, each kept imaging frame is also plate solved to find where it points" })),
  solveRadiusDegrees: described('How far from the pointing in the frame header ASTAP searches when it solves a kept frame, in degrees', Schema.Number, 2),
  analyseSnr: described(
    'The signal to noise a star needs to be counted',
    Schema.Number,
    10,
  ),
  listLimit: described(
    'The most stars ASTAP lists for a kept frame',
    Schema.Int.check(Schema.isGreaterThan(0)),
    10000,
  ),
  shapeMinSnr: described(
    "The signal to noise a star needs for its shape to count towards the frame's elongation",
    Schema.Number,
    30,
  ),
  shapeStars: described('How many of the brightest strong stars are measured for the elongation', Schema.Int.check(Schema.isGreaterThan(0)), 300),
  saturated: described(
    'A star with any pixel at or above this value is left out of the elongation',
    Schema.Number,
    60000,
  ),
})

export const AlignSettings = Schema.Struct({
  declinationDegrees: described(
    'The declination the three alignment frames are taken at, in degrees',
    Schema.Number,
    80,
  ),
  hourAnglesDegrees: described(
    'The hour angles of the three alignment frames in degrees, east of the meridian negative',
    Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
    [-130, -73, -16],
  ),
})

export const ControlsSettings = Schema.Struct({
  nudgeHoldMs: described('How often the page tells the rig program a nudge is still held, in milliseconds', Schema.Number, 250),
  nudgeSlowRate: described("The mount's TELESCOPE_SLEW_RATE element for a slow nudge", Schema.NonEmptyString, '8x'),
  nudgeFastRate: described("The mount's TELESCOPE_SLEW_RATE element for a fast nudge", Schema.NonEmptyString, '9x'),
  centreExposureSeconds: described('Seconds of exposure for each slew and centre frame', Schema.Number, 2),
  calibrationFrames: described('The number of calibration frames the controls page offers first', Schema.Int, 30),
  testFrameSeconds: described('The test frame exposure the controls page offers first, in seconds', Schema.Number, 2),
  guideSettlePixels: described('How close to the star guiding must hold before PHD2 calls it settled, in pixels', Schema.Number, 1.5),
  guideSettleSeconds: described('How long guiding must hold that close before PHD2 calls it settled, in seconds', Schema.Number, 10),
  guideSettleTimeoutSeconds: described('How long PHD2 waits for guiding to settle before it reports that it did not, in seconds', Schema.Number, 90),
  guiderReplySeconds: described('How long a guiding button waits for PHD2 to reply to one call, in seconds', Schema.Number, 30),
  guiderConnectSeconds: described('How long a guiding button waits for PHD2 to connect its camera and mount, in seconds', Schema.Number, 120),
  flatStartSeconds: described('The exposure of the first test frame when finding the flat exposure, in seconds', Schema.Number, 0.5),
  flatLowAdu: described('The lowest median a flat may have, in ADU', Schema.Number, 20000),
  flatHighAdu: described('The highest median a flat may have, in ADU', Schema.Number, 30000),
  flatMaxSeconds: described('The longest flat exposure tried before the light is called too dark, in seconds', Schema.Number, 30),
  flatTries: described('How many test frames finding the flat exposure may take before it gives up', Schema.Int, 8),
  flatMeasureSeconds: described("How long finding the flat exposure waits for a test frame's measurement, in seconds", Schema.Number, 120),
  biasExposureSeconds: described("The exposure of a bias frame, in seconds: the camera's shortest", Schema.Number, 0.000032),
  dewChannel: described("The power box's dew output the controls page switches, as its DEW_CHANNELS element", Schema.NonEmptyString, 'DEW_CHANNEL_1'),
  dewPercent: described('The fixed dew heater level the controls page offers first, in percent', Schema.Number, 60),
  coolerCelsius: described('The cooler setpoint the controls page offers first, and Start offers when no cooler is remembered for the target or any other, in degrees Celsius', Schema.Number, -10),
  focusMoveSeconds: described('How long one focuser move may take before its answer says the focuser is still moving, in seconds', Schema.Number, 300),
  focusSteps: described('Focuser steps for the Step buttons on the controls page, each shown inward and outward', Schema.Array(Schema.Int), [10, 50]),
  flipSettleSeconds: described('How long Flip now waits for the mount to finish its goto before answering, in seconds', Schema.Number, 120),
})

export const LaunchSettings = Schema.Struct({
  alignExposureSeconds: described(
    'Seconds of exposure for each polar alignment frame',
    Schema.Number,
    2,
  ),
  alignGoodArcmin: described('Total polar alignment error, in arcminutes, under which the page says good', Schema.Number, 1),
  alignMovedArcmin: described(
    'How far apart, in arcminutes, a new alignment run\'s first reading and the last reading of the run before must be for the page to say the rig moved',
    Schema.Number,
    10,
  ),
  autofocusStep: described('Focuser steps between two autofocus samples', Schema.Number, 50),
  autofocusSamples: described('Samples in one autofocus sweep', Schema.Number, 9),
  autofocusExposureSeconds: described(
    'Seconds of exposure for each autofocus sample, by the filter answer at launch',
    Schema.Struct({ in: Schema.Number, out: Schema.Number }),
    { in: 10, out: 2 },
  ),
})

export const CentreSettings = Schema.Struct({
  toleranceArcmin: described(
    'How far, in arcminutes, the solved centre of a centring frame may be from the target for slew and centre to finish',
    Schema.Number,
    1,
  ),
})

export const AutofocusSettings = Schema.Struct({
  minStars: described(
    'Stars the best frame of an autofocus sweep must show before Vela picks a focus from it',
    Schema.Number,
    50,
  ),
})

export const StartRoutineSettings = Schema.Struct({
  homeSeconds: described('Seconds the start routine and Stop for the night wait for the mount to report the end of its move home before they report the step and go on', Schema.Number, 120),
  guidingSeconds: described('Seconds the start routine waits for PHD2 to report guiding settled, calibration included, before it reports the step and goes on', Schema.Number, 600),
})

export const FirstFramesSettings = Schema.Struct({
  skippedFrames: described('Frames at the start of a run that the first-frames check does not look at, taken while the mount and the guider settle', Schema.Int, 2),
  checkedFrames: described('Frames the first-frames check looks at, after the skipped ones', Schema.Int, 3),
  focusRatio: described('How many times the star size autofocus reached the stars of the checked frames may be before the check calls focus poor', Schema.Number, 1.3),
  trailedElongation: described('The star elongation, long side over short side, from which the check calls the frames trailed', Schema.Number, 1.5),
})

export const VelaSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the night page is served on, on 127.0.0.1 only' }),
  broker: BrokerSettings,
  environment: described(
    "The rig environment Vela reads and writes: the stream RIG_<ENVIRONMENT> and its subjects rig-<environment>.*, lower-case letters only. The rig program's stream settings name the same one",
    Environment,
    'dev',
  ),
  devices: described(
    "The rig file's ids for the devices the page shows",
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
    'Seconds the rig program may send nothing before every value is shown as stale',
    Schema.Number,
    10,
  ),
  pageRefreshSeconds: described(
    'Seconds between two fresh pictures sent to the night page',
    Schema.Number,
    1,
  ),
  feed: FeedConfig.annotate({ description: 'The web app and the event stream it reads: the state first, then each wanted entry, and a heartbeat' }),
  frames: FrameSettings,
  capture: CaptureSettings,
  prepare: described('Settings for the focuser and dew controls', PrepareSettings, {}),
  pointing: described('Settings for choosing a target and pointing the mount', PointingSettings, {}),
  catalog: described('The target catalog', CatalogConfig, {}),
  sky: described('The sky survey behind the picker\'s frame box, downloaded once by the sky survey setup', SurveyConfig, {}),
  skyDetail: described(
    "The finer sky survey behind the picker's full-size view, downloaded once by the sky survey setup run with detail",
    SurveyConfig,
    { tilesDir: '/mnt/storage/vela/sky/dss-colour-7', address: 'https://skies.esac.esa.int/DSSColor', order: 7, downloads: 4 },
  ),
  align: described('Settings for polar alignment', AlignSettings, {}),
  stars: Schema.optionalKey(StarSettings.annotate({ description: 'Counting and sizing the stars of each kept imaging frame. Without it, kept frames get only their sky level and noise' })),
  autofocus: described('Settings for autofocus', AutofocusSettings, {}),
  launch: described('What the launch steps start on a tap: alignment, and autofocus after the filter answer', LaunchSettings, {}),
  controls: described('The controls page', ControlsSettings, {}),
  centre: described('Settings for slew and centre', CentreSettings, {}),
  firstFrames: described('The check of the first frames of a run on a target', FirstFramesSettings, {}),
  review: described('Asking models whether each light frame is obstructed. Report only: it never acts on the rig', ReviewSettings, {}),
  rememberedFile: described('The file Vela keeps what it remembers in: the last light run, the camera angle, the centres that centring reached and the cooler each target was last started with', Schema.String, '/mnt/storage/vela/remembered.json'),
  horizonFile: described('The file the horizon is read from: the lowest altitude above which the sky is open, in each 1 degree of azimuth (version 2). Without the file, every direction is unknown', Schema.String, '/mnt/storage/vela/horizon.json'),
  horizonNight: described("A target's night on the horizon page: the path's points and their rounding", HorizonNightSettings, {}),
  forecast: described('The cloud forecast for the site the mount reports, from the National Weather Service and Open-Meteo', ForecastSettings, {}),
  sweep: described('The horizon sweep: the columns, steps and limits of its path', SweepSettings, {}),
  start: described('Starting a target from the picker: home, stop guiding, slew and centre, autofocus, guiding, then the run', StartRoutineSettings, {}),
  streamViewer: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description: "The address of Cria's stream viewer, which shows the raw INDI wire. The Activity view links to it; without it, there is no link",
    }),
  ),
  historyReadBatch: described(
    'Entries asked of the broker at a time when replaying the rig connection',
    Schema.Number,
    2048,
  ),
})

export type VelaSettings = typeof VelaSettings.Type
