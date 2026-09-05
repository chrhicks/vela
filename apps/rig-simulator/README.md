# Rig simulator

Development-only sky and equatorial mount foundation for offline polar alignment.
The simulator generates image pixels; it does not supply alignment answers to Vela.
The local Alpaca service and separate controls implement the approved workshop
design. Vela’s production polar-alignment operation remains follow-on work.

## Current capability

`mount.ts` models a rigid camera on an equatorial mount with altitude/azimuth
misalignment. `sky.ts` projects catalog stars through that camera and renders
monochrome exposures. `fits.ts` writes the pixels for an external solver.
`catalog.ts` reads a locally provisioned ASTAP D05 catalog. No catalog or solver
is downloaded at import, build or test time.

The ordinary path is `cameraPose(position)` → `renderSky(stars, pose, options)`.
The camera's direction, right and up vectors rotate together, preserving image
roll. Seeded image noise makes each fixture repeatable. Obscuring the camera
produces background noise without stars, so solving actually fails.

## Coordinate conventions and limits

- Angles in public mount values are degrees; elapsed time is seconds.
- The synthetic sky uses one fixed equatorial frame, with pole +Z and local
  sidereal angle zero at t=0. Latitude defaults in the proof to 40° north.
  This is a reproducible synthetic epoch, not conversion from today's UTC.
- Positive altitude error raises the polar axis; positive azimuth error turns
  it east of north. Azimuth is the mechanical angle; its contribution to total
  polar error depends on latitude. Errors are limited to ±5°.
- `raAxisDegrees` is the commanded RA-axis rotation at the reference epoch.
  Tracking subtracts elapsed sidereal rotation from the mechanical joint;
  Earth rotation then transforms the whole mount into the sky frame.
  A perfectly aligned tracking mount keeps the entire image fixed.
- Exposures have a real waiting/completion lifecycle, but their pixels are an
  instantaneous snapshot at exposure start. Duration does not yet change star
  brightness. Motion blur and photometric realism are not modeled.
- The catalog loader defaults to RA 0–70°, Dec 50–70° for the proof. This is
  deliberately a sky patch, not all-sky coverage. Later movement controls must
  honor coverage or load a larger region; an empty patch is not a cloud model.
- No refraction, precession/nutation, flexure, optical distortion, Bayer sensor,
  seeing model or physical hardware is modeled. Catalog and solver use the same
  star data. Successful simulation does not establish real-sky precision.

## Local assets

Use [ASTAP's official download page](https://www.hnsky.org/astap.htm) to obtain
its Linux amd64 CLI and D05 Debian star database. Unpack them without installing
a system package. Put them beneath `.local/assets/` (ignored) or another local
path. Nothing should depend on the original `/tmp` experiment.

The proof used these downloads on 2026-09-04:

| File | SHA-256 |
| --- | --- |
| `astap_command-line_version_Linux_amd64.zip` (CLI 2026.09.01) | `a563e4e210b4ca0e9099e8790a2dcc3d55f257a9b3cbbe66f290188b4ed995cc` |
| `d05_star_database.deb` | `e00b276e86c5673aef862d4fa093e739bd58cad267af916756409770fd0bd8eb` |

Official download links:

- https://sourceforge.net/projects/astap-program/files/linux_installer/astap_command-line_version_Linux_amd64.zip/download
- https://sourceforge.net/projects/astap-program/files/star_databases/d05_star_database.deb/download

Upstream download names are mutable. Check hashes before using these as the
recorded reference; if upstream changes, review and record the new version and
rerun the proof instead of assuming identical results.

From this directory, after downloading those files into `.local/assets`:

```sh
mkdir -p .local/assets/catalog
unzip .local/assets/astap_command-line_version_Linux_amd64.zip -d .local/assets
ar p .local/assets/d05_star_database.deb data.tar.xz | tar -xJ -C .local/assets/catalog
```

The database header identifies Gaia DR3 positions propagated to epoch 2025 with
additional bright Tycho2 stars. The decoder implements the five-byte D05 file
format; no third-party source is vendored. Sky Simulator's catalog projection
and Gaussian stars informed the approach, but its approximate polar-error
formulas were not adopted.

Source references:

- [Sky Simulator rendering source](https://sourceforge.net/p/sky-simulator/code/ci/default/tree/sky_annotation.pas)
- [ASTAP catalog documentation](https://www.hnsky.org/astap.htm)

External assets remain user-provisioned and untracked. Their redistribution
terms have not been established here; do not package the catalog or executable
with Vela without reviewing their applicable terms. No GPL source or example
astrophotography JPEGs from the research are included.

## Validation

Fast checks from the workspace root:

```sh
pnpm exec vitest run apps/rig-simulator/src
pnpm --filter @vela/rig-simulator build
```

Opt-in numerical proof from this directory:

```sh
VELA_STAR_CATALOG="$PWD/.local/assets/catalog/opt/astap" \
VELA_ASTAP="$PWD/.local/assets/astap_cli" \
pnpm prove
```

The proof writes FITS, solver logs and `results.json` to `.local/proof`.
`VELA_SIM_OUTPUT` can select another output directory. It invokes the real ASTAP
process with rough pointing hints (offset from truth), never embeds WCS answers
in the input FITS, and reconstructs the polar axis from three solved sightlines.
Initial, near-aligned and aligned baselines must each recover signed mechanical
error components within 5 arcseconds. This is a fixture regression tolerance,
not a product accuracy promise. An obscured exposure must genuinely fail solving.
The proof also checks the solver's reference pixel against the optical center.

The inverse measurement code is confined to this opt-in evidence harness. It is
not shared with the generator and is not the production polar-alignment engine.
Single-frame adjustment, real Alpaca transfer and operation-state integration
belong to the subsequent validation ticket.


## Run the development rig

Start the service with the provisioned catalog (from this directory):

```sh
VELA_STAR_CATALOG="$PWD/.local/assets/catalog/opt/astap" pnpm dev:server
```

In a second terminal, run `pnpm --filter @vela/rig-simulator dev:controls` from
the workspace root. Open `http://127.0.0.1:5177`. The controls proxy only
`/simulator` requests to the service at `127.0.0.1:7850`. Both listeners are
local by default. This is the developer workflow; a packaged deployment is
outside the current scope. `pnpm build` builds the server and control assets;
`pnpm start` starts the compiled Alpaca service.

In Vela, use manual host entry to add `127.0.0.1`, port `7850`. Its normal
inspection and connection flow sees a camera and telescope with stable identities.
This assumes the Vela server and simulator run on the same machine. No real rig
is involved and the simulator never forwards requests to physical devices.

The control page shows server-confirmed state. Writes disable conflicting UI
commands while pending. Failed responses are reconciled with a read, never a
repeated write. Lost connections retain a clearly marked last-known state until
read-only polling reconnects. Closing the control page does not stop the service.

## Supported device and control boundaries

The Alpaca service supports the management/identity/connection/telemetry reads
used by Vela, a fixed 1600×1200 monochrome camera (binning 1), start/abort exposure,
image readiness and JSON `ImageArray`, and RA-axis movement/tracking/stop for one
equatorial mount. JSON image arrays use Alpaca order `[x][y]`, `Type: 2`, `Rank: 2`.
Unused capabilities return unsupported errors. This is a bounded development
subset, not a claim of complete ASCOM driver conformance. No UDP discovery or
ImageBytes path is implemented yet.

Exposure images are captured from the modeled pose and camera obstruction at
start, become available after duration elapses, and remain the last completed
image until a new exposure starts or abort/reset/disconnect invalidates them.
Movement and offset changes are rejected during exposure. Camera obscuring
changes the next exposure only. Reset aborts pending exposure, removes its image,
stops axis movement, restores the preset and clears the camera; device connection
flags are preserved. In-flight browser requests are not evidence of fresh images.

The simulation-only API is separate from Alpaca:

| Endpoint | Operation |
| --- | --- |
| `GET /simulator/state` | Read current actual simulation state |
| `PUT /simulator/adjust` | Absolute signed `altitudeArcsec`, `azimuthArcsec` |
| `PUT /simulator/camera` | Set boolean `obscured` for the next exposure |
| `POST /simulator/reset` | Apply `preset`: `large-error`, `near-aligned`, `aligned` |

Mutations require JSON. Offset limits are ±18000 arcseconds. The approved presets
are (+480, −360), (+12, −9), and (0, 0). The standard Alpaca API exposes pixels and
pointing, not the true alignment offsets or a plate-solved answer. Only these
separate development controls can see and change that truth.

The current catalog patch limits useful acquisition. Movement has a bounded
nominal RA interval; requests to expose outside the supported field return an
explicit error rather than treating missing catalog stars as clouds. Production
alignment acquisition/movement adapters and full measured-correction integration
are tracked separately in CHI-153.

## HTTP acquisition and alignment proof

After provisioning the catalog and ASTAP above, run:

```sh
VELA_STAR_CATALOG=/path/to/astap-catalog \
VELA_ASTAP=/path/to/astap_cli \
pnpm --filter @vela/rig-simulator prove:http
```

This opt-in command builds the model, Alpaca boundary and server, then starts an isolated
simulator on a random loopback port. It connects using the normal provider and
acquires images and primary-axis movement through `createAlpacaAcquisition`.
The server's actual ASTAP adapter and alignment geometry fit three solved
positions, then measure partial, near, and zero adjustments against that same
baseline. The proof also obscures the camera to produce a genuine ASTAP failure,
clears it to recover, and cancels an active exposure before checking a fresh
restart. It stops acquisition and closes its own simulator when finished.

Only standard Alpaca pointing and local sidereal time supply measurement inputs;
the sidereal angle is advanced to the exposure timestamp on the shared host clock.
Configured simulator offsets are used for scenario setup and assertions only.
No physical rig, saved Vela catalog, or existing simulator process is touched.
The 36-degree baseline allows 10 arcseconds of component error. The initial
18-degree span amplified plate-solve error to about 20 arcseconds; widening the
span recovered components within 4 arcseconds in the validated run. It proves the ideal
synthetic integration, not real-world alignment accuracy or coordinate conversion.
Results are written to `.local/http-proof/results.json` (override with
`VELA_SIM_OUTPUT`). Generated server declarations must exist to typecheck this
proof; the command builds them explicitly before execution. The default test
suite does not require external catalogs, ASTAP, or a listening socket.
