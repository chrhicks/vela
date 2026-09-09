# Sky-path workshop fixtures

These are entirely invented, public-safe sample data for the draft overhead
sky-path specimen. They contain no observer location, real observing date,
private panorama, measured skyline, or calibration data. Familiar target IDs
connect the samples to the target-selection product example; their tracks are
illustrations, not predictions for those catalog objects.

`getSkySamples(targetId)` returns 49 equally spaced samples, every ten minutes
from 20:00 through 04:00. Indices 6, 18, 30, and 42 represent 21:00, 23:00,
01:00, and 03:00. Samples include below-horizon positions so a specimen can
show rising and setting without inventing a second visibility model.

The paths use the spherical equatorial-to-horizontal transform with an
explicitly invented 40° observer latitude and nominal 15° rotation per hour.
There is no longitude, date, sidereal-time lookup, refraction correction, or
external request. Azimuth is clockwise from north; altitude is above the
geometric horizon. Each synthetic target has a fixed declination and a chosen
transit time:

| Sample ID | Invented declination | Sample transit | Purpose |
| --- | ---: | --- | --- |
| `andromeda` | 42° | 01:00 | Passes within 2° of zenith |
| `m13` | 25° | 18:00 | Descends and sets during the sample night |
| `crescent` | 26° | 00:00 | High midnight pass, peaking at 76° |
| `low-target` | −32° | 00:00 | Rises and sets on a low southern arc, peaking at 18° |

`getDemoHorizon(profileState)` supplies four specimen states:

- `none`: no local horizon profile.
- `local`: a complete synthetic profile in the component's `calibrated` state.
- `incomplete`: the same synthetic profile with an unknown northeast sector.
- `uncalibrated`: invented points marked uncalibrated for state evaluation.

The skyline combines mathematical broad hill, roof, and rounded tree forms.
A short sagging wire is a separate azimuth/altitude polyline. These forms are
not a reconstruction of any actual landscape. `calibrated` describes the
component state being demonstrated only; no real calibration has occurred.
Consumers must visibly identify these tracks and horizons as sample/demo data.
Fixtures remain specimen-owned and are not exported from the UI package API.

`getMoonSamples(phase)` provides an invented evening Moon moving westward and
setting after 01:40. Samples align with the target time indices. The phase
control covers waxing/waning, new/full and missing-data states; illumination
is fixed across this short sample night. Its position and phase are illustrative,
not an ephemeris. The component computes target separation on the sphere.
The upright phase glyph shows illuminated fraction and waxing/waning only,
not the Moon's apparent rotation or bright-limb position angle.
