# Vela

Chris's observing program. It reads the rig from its stream and sends commands as stream messages; it never talks to INDI.

The old Vela (web app, server, solver, archiver, rig model, workshop) was removed on 2026-11-07. It is in git history before the commit that removed it. This repo now holds:

- `src/catalog/`: OpenNGC target data (J2000).
- `src/sky/`: J2000 to epoch-of-date conversion.
- `src/bin/vela.ts`: the night page. It follows the rig stream (`RIG_DEV`) from the rig program's latest connection, keeps a picture of every device, and serves one page of what a night needs, updated live. Read only: no commands yet. Settings: `deploy/vela.example.json`. `deploy/install.sh thuban --commit SHA` links the user unit `deploy/vela.service`.
- Frames: the main camera's driver saves each frame into a spool folder on the rig computer (errai). Vela copies it to `/mnt/storage/rig/frames/<night>/<file>` over ssh, checks size and SHA-256 against errai's copy, and only then counts it as kept (copy to a `.part` name, then rename). Beside each frame is `<file>.json` (original path, hash, size, when kept, and the run, sequence and frame number, empty until capture exists) and, once someone asks for it, `<file>.png`, the preview. Each kept frame is also one entry on the stream, `rig-dev.vela.frame` `{ file, night, bytes, sha256 }`. A scan of the spool runs at start and after every announcement (`CCD_FILE_PATH` set), so a missed announcement or a copy that failed is picked up with the next frame. A night is named for the evening it starts, by the spool file's time in the zone `frames.nightZone`. The files stay on errai in v1 (about 418 GB free there, room for about 8,000 frames at 52 MB).
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

`UPLOAD_SETTINGS` (`UPLOAD_DIR`, `UPLOAD_PREFIX`) is not in the rig file: the rig program refuses commands to a property the file owns, so the folder and prefix are left to Vela's capture. The `frames` block of `vela.json` needs `spoolDir` (the folder the driver saves into) and `nightZone`.

```sh
pnpm install
./verify.sh
```

Needs Node 26 and pnpm.
