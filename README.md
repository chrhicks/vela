# Vela

Chris's observing program. It reads the rig from its stream and sends commands as stream messages; it never talks to INDI.

The old Vela (web app, server, solver, archiver, rig model, workshop) was removed on 2026-11-07. It is in git history before the commit that removed it. This repo now holds:

- `src/catalog/`: OpenNGC target data (J2000).
- `src/sky/`: J2000 to epoch-of-date conversion.
- `src/bin/vela.ts`: the night page. It follows the rig stream (`RIG_DEV`) from the rig program's latest connection, keeps a picture of every device, and serves one page of what a night needs, updated live. Settings: `deploy/vela.example.json`. `deploy/install.sh thuban --commit SHA` links the user unit `deploy/vela.service`.
- Frames: the main camera's driver saves each frame into a spool folder on the rig computer (errai). Vela copies it to `/mnt/storage/rig/frames/<night>/<file>` over ssh, checks size and SHA-256 against errai's copy, and only then counts it as kept (copy to a `.part` name, then rename). Beside each frame is `<file>.json` (original path, hash, size, when kept, and the run, sequence and frame number, empty until capture exists) and, once someone asks for it, `<file>.png`, the preview. Each kept frame is also one entry on the stream, `rig-dev.vela.frame` `{ file, night, bytes, sha256 }`. A scan of the spool runs at start and after every announcement (`CCD_FILE_PATH` set), so a missed announcement or a copy that failed is picked up with the next frame. A night is named for the evening it starts, by the spool file's time in the zone `frames.nightZone`. Once the copy's size and hash match, the original is removed from errai's spool (Chris, 2026-11-08); a frame already kept whose original is still there (a removal that failed, or a frame from before this rule) is removed on the next scan after its hash is checked against the kept frame's. A spool file whose hash differs from the kept frame of that name is left in place and reported.
- Commands (`src/commands/`): Vela writes to the rig only as stream messages. It publishes `rig-dev.command.<device-id>` `{ id, property, values, by: 'vela' }` and waits for the rig program's one `client.command` answer for that id: `written`, `refused` with its reason, or, when none comes in `capture.commandAnswerSeconds`, `unknown`. The rig program has no queue, no age limit and no duplicate check, and Stop is an ordinary command. A command whose effect is not visible is never sent again.
- Capture (`src/capture/`): one run at a time of N frames of one type (light, dark, flat, bias) of one object: exposure, gain, offset, and the cooler (leave as it is, on at a setpoint, or off). Before each frame the run compares the camera's `CCD_COOLER`, `CCD_FRAME_TYPE`, `CCD_CONTROLS` (`Gain`, `Offset`) and `UPLOAD_SETTINGS` (`UPLOAD_DIR` is `frames.spoolDir`, `UPLOAD_PREFIX` is `<object>_<type>_XXX`) with the stream and commands only what differs. The setpoint (`CCD_TEMPERATURE`, which the driver does not report back) is written when the run starts and again only after the cooler is found off. It then writes `CCD_EXPOSURE` and counts the frame when `CCD_FILE_PATH` names a new file. It waits as long as the camera keeps sending `CCD_EXPOSURE` updates, so the driver's own retries (the time left jumping back up) are not cut short. A frame that goes Alert, or sends no `CCD_EXPOSURE` update for `capture.exposureSilenceSeconds`, is aborted and recorded as failed; the run goes on until the wanted frames are counted and stops after `capture.failuresInRow` failures in a row. Stop writes `CCD_ABORT_EXPOSURE`, ends the run and keeps every saved frame. A refused command ends the run as `refused`, and one with no visible effect as `unknown`. A run is never resumed: `capture.runFile` names the run in progress, and one found there at start is marked interrupted. Each run puts `vela.run.started`, `vela.run.exposed` (frame number and file), `vela.run.failed` and `vela.run.ended` (done, stopped, failures, interrupted, refused or unknown, with a detail) on `rig-dev.vela.run`, and the kept frame's sidecar carries the run id, the sequence (`<object>_<type>`) and the frame number.
- `compose.yaml`, `deploy/nats.conf`: the NATS broker for the rig stream. It has no logins (the home network is trusted, as with indiserver) and nothing to provision: the rig program creates the `RIG_DEV` stream itself. The config is the listen address and JetStream's folder and size limits.

### What the rig file must say

Vela keeps frames only if the camera saves them on errai. The rig program owns the main camera's `UPLOAD_MODE` and pins it to `UPLOAD_CLIENT` today, which would undo local saving within 5 s. In `~/.config/cria/rig.json` on errai, in the `primary` device, change

```json
"properties": { "UPLOAD_MODE": { "UPLOAD_CLIENT": true } }
```

to

```json
"properties": { "UPLOAD_MODE": { "UPLOAD_LOCAL": true } }
```

`UPLOAD_SETTINGS` (`UPLOAD_DIR`, `UPLOAD_PREFIX`) is not in the rig file: the rig program refuses commands to a property the file owns, so the folder and prefix are set by Vela's capture before each frame. The `frames` block of `vela.json` needs `spoolDir` (the folder the driver saves into) and `nightZone`.

```sh
pnpm install
./verify.sh
```

Needs Node 26 and pnpm.
