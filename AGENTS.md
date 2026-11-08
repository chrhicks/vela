# Vela

Chris Hicks's observing program. Read `SOUL.md` for how to work on it and `/home/chicks/dev/personal/home/AGENTS.md` for the house rules. This repo is public: no personal data, no real site coordinates, no real-night data. Fixtures use the made-up Phoenix site (latitude 33.45, longitude -112.07, elevation 331).

## What is here

Vela is being rebuilt on the rig stream (plan: `bots/observer/specs/vela-next/plan-v2.md` in the home repo). The old Vela was removed on 2026-11-07; what remains:

- `src/catalog/`: OpenNGC target data (J2000) and its row types. See its `README.md` for provenance and the license.
- `src/sky/coordinates.ts`: J2000 to epoch-of-date conversion (`toMount`, `fromMount`, `angularDistance`) on `astronomy-engine`.
- `src/bin/vela.ts`: the night page and capture controls, a Node service on thuban. `src/stream/` follows the stream, `src/rig/` holds the picture (`picture.ts`) and what the page shows (`night.ts`), `src/page/` serves it. Deploy files in `deploy/`.
- `src/commands/`: the command sender (publish `rig-dev.command.<device>`, wait for the `client.command` answer). `src/capture/`: the capture run, the settings comparison, the run file and the `vela.run` entries. See the README.
- `src/prepare/`: the focuser and dew controls (`prepare.ts` checks a request against the limits on the stream and sends the commands) and the view the page draws them from (`view.ts`). PHD2's state and the time of its last guide step are on the page.
- `src/frames/`: the frames: copy from the rig computer with a check, the sidecar, the stream entry, the FITS reader and the preview. See the README.
- `compose.yaml` and `deploy/nats.conf`: the NATS broker that carries the rig stream. It has no logins and nothing to provision; the rig program creates the `RIG_DEV` stream.
- `verify.sh`: typecheck and tests.

The broker's data (`~/.local/share/vela/nats`), Vela's saved images and its archives are data on disk. Nothing in this repo deletes them.

## Rules

- One package, run from source by Node 26; no build step. Style follows Cria's `ts/`.
- No comments in code: a limit or default is a described setting, a surprise is a better name or type.
- Run `./verify.sh` before a PR.
