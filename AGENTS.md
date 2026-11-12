# Vela

Chris Hicks's observing program. Read `SOUL.md` for how to work on it and `/home/chicks/dev/personal/home/AGENTS.md` for the house rules. This repo is public: no personal data, no real site coordinates, no real-night data. Fixtures use the made-up Phoenix site (latitude 33.45, longitude -112.07, elevation 331).

## What is here

Vela is being rebuilt on the rig stream (plan: `bots/observer/specs/vela-next/plan-v2.md` in the home repo). The old Vela was removed on 2026-11-07; what remains:

- `state/`: what the stream means, shared by the service and the web app (architecture: `bots/observer/specs/thuban-ui/architecture.md` in the home repo). `stream.ts` names the stream and its subjects from the `environment` setting (`dev` gives `RIG_DEV` and `rig-dev.*`); `entry.ts` reads a stream message into an entry (stream position, kind, time, body; command requests become `command` entries); `entries.ts` decodes the kinds the reducers use into typed entries with Effect Schema, once; `wanted.ts` is the list of what the browser receives; `rig.ts` and one file per slice are the reducers, each with tests on made-up entries.
- `src/feed/`: the web app's event stream, in Effect. `Feed` holds the state folded from the wanted entries and passes on each new one; `GET /feed` (its own address, settings `feed.host` and `feed.port`) sends the state first with the service's commit, then each wanted entry and a heartbeat with the service's clock. A reconnect starts over with fresh state.
- `src/catalog/`: OpenNGC target data (J2000) and its row types. See its `README.md` for provenance and the license.
- `src/sky/coordinates.ts`: J2000 to epoch-of-date conversion (`toMount`, `fromMount`, `angularDistance`) on `astronomy-engine`.
- `src/bin/vela.ts`: the night page and capture controls, a Node service on thuban. `src/stream/` follows the stream (including command requests) as an Effect Stream: `Broker` is the connection as a scoped Layer, `followRig` replays from the rig's latest connection and marks when it has caught up, and its failures are typed (`BrokerUnreachable`, `StreamUnreadable`, `BrokerLost`, `FollowEnded`), `src/rig/` holds the picture (`picture.ts`) and what the page shows (`night.ts`), `src/page/` serves it. Deploy files in `deploy/`.
- `src/commands/`: the command sender (publish `rig-dev.command.<device>`, wait for the `client.command` answer). `src/capture/`: the capture run, the settings comparison, the run file and the `vela.run` entries. See the README.
- `src/prepare/`: the focuser and dew controls (`prepare.ts` checks a request against the limits on the stream and sends the commands) and the view the page draws them from (`view.ts`). PHD2's state and the time of its last guide step are on the page.
- `src/pointing/`: catalog lookup to goto: `target.ts` converts a catalog row to epoch of date (precession and nutation, no site), `pointing.ts` sends goto, Unpark, Home, tracking and Stop and follows a goto from the stream. There is no Park (parking turns the rig sideways). `src/catalog/search.ts` is the lookup, `src/sky/meridian.ts` the time to the meridian limit.
- `src/frames/`: the frames: copy from the rig computer with a check, the sidecar, the stream entry, the FITS reader and the preview. See the README.
- `compose.yaml` and `deploy/nats.conf`: the NATS broker that carries the rig stream. It has no logins and nothing to provision; the rig program creates the `RIG_DEV` stream.
- `web/`: the web app that will replace the night page: React, built by Vite, its own package in the pnpm workspace. Today it is the shell: the three routes (`/` the run, `/launch`, `/controls`), the shared components and the style tokens, drawn from stub values with no data behind them. See `web/README.md`.
- `verify.sh`: typecheck and tests, then the web app's typecheck and build.

The broker's data (`~/.local/share/vela/nats`), Vela's saved images and its archives are data on disk. Nothing in this repo deletes them.

## Rules

- The service under `src/` is run from source by Node 26 with no build step; style follows Cria's `ts/`. Only `web/` is built.
- Non-React code uses Effect: Schema decodes at every boundary, ids are branded, failures are typed errors. React gets Promises from hooks. Old code runs an Effect only through `src/edge.ts` (`runHandledSync`, `runHandledPromise`), which accept only an Effect whose errors are all handled, so an unhandled error is a compile error. The shared coding standard (TypeScript) owns the rule; files move to it as they are touched, and `src/stream/json.ts` holds the old hand-written readers until then.
- No comments in code: a limit or default is a described setting, a surprise is a better name or type.
- Run `./verify.sh` before a PR.
