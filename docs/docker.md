# Running Vela in Docker

Two application containers from this repo: `server` (the API) and `web` (nginx serving the built
app and proxying `/api` to the server). `web` is published on the LAN. The NATS
broker publishes only on loopback. The server port stays inside the compose network.

**There is no login.** Whoever can reach `VELA_PORT` can drive the rig. By choice it is
LAN-wide, the same as `pnpm dev:observing` on port 5173.

## Layout on the host

Config and data live in XDG directories, mounted into the containers (override with
`VELA_CONFIG_DIR` / `VELA_DATA_DIR`):

| Host | In the container | What |
|---|---|---|
| `~/.config/vela/cria.json` | `/config/cria.json` (read-only) | Cria rigs; required, `{"rigs": []}` is the minimum |
| `~/.config/vela/alerts.json` | `/config/alerts.json` (read-only) | Pushover keys and alert thresholds; optional, see below |
| `~/.local/share/vela/rigs.yaml` | `/data/rigs.yaml` | rig catalog, written by Vela |
| `~/.local/share/vela/saved-images/` | `/data/saved-images` | captured frames |
| `~/.local/share/vela/survey-cache/`, `traces/`, `run-log/`, `alignment-diagnostics/` | `/data/...` | caches, trace journal, [run log](run-log.md), evidence bundles |
| `~/.local/share/vela/astap/` | `/astap` (read-only) | `astap_cli` and `catalog/opt/astap/` (D05 star database) |

The server image runs with `NODE_OPTIONS=--conditions=built` (set in `compose.yaml`). It makes
`@vela/rig-events` load from its built `dist/`, because Node does not run TypeScript source from
`node_modules`. Anything else that starts `node dist/server.js` needs the same flag; `pnpm start` has it.

The ASTAP binary and star catalog are not in git; copy them into `astap/`. Create the
directories as the user that runs the stack: the containers run as `VELA_UID:VELA_GID`
(default 1000:1000) so the files stay yours.

### Phone alerts

Without `alerts.json` alerts show in Vela only, and the alerts API says phone alerts are not
configured. To send them to Pushover, create the file with the script, which prompts for the
application token and user key without echoing them and writes the file with mode 600:

```sh
scripts/set-pushover-keys.sh
docker compose restart server
```

Never paste the keys into chat, a commit or a log. The file may also set any number the alert
rules use under `"thresholds"`; see `apps/server/src/alerts/thresholds.ts` for the names and
defaults. Unknown keys are refused at start. `GET /api/web/rigs/<rig>/alerts` shows the thresholds in
use, and `POST /api/rigs/<rig>/alerts/test` (an empty JSON object) sends a test message.

The Cria URL in `cria.json` must be reachable from the host; containers use the host's
routes, so a Tailscale address works if the host is on the tailnet.

## Run

```sh
# Complete the broker provisioning below before the first full stack start.
docker compose up -d --build     # http://<host>:5173, or VELA_PORT=...
docker compose logs -f server
```

Update: `git pull && docker compose up -d --build`. The containers restart
automatically (`unless-stopped`). The image build runs `pnpm install` and `pnpm build`
inside Docker. Manual broker provisioning needs the tools listed below. The install downloads
`@cria/primitives` and `@cria/wire` from GitHub at the commit pinned in
`pnpm-workspace.yaml`, with no credentials.

## Moving from `vela-observing` on another machine

Only one Vela may talk to a Cria at a time. With no capture running:

1. Stop the old one (`systemctl --user stop vela-observing`).
2. Copy `rigs.yaml`, `saved-images/`, `survey-cache/`, `traces/` and the ASTAP files into
   the data directory, and `cria.json` into the config directory (`rsync -a`).
3. `docker compose up -d --build`, then open the app and check the rig shows its devices.

To roll back, stop the stack and start the old unit again; its data is untouched.

## Provision the rig event broker

The official NATS image is pinned to 2.15.2 and its registry digest in `compose.yaml`.
The broker stores JetStream files in `$VELA_DATA_DIR/nats/jetstream` (by default,
`$XDG_DATA_HOME/vela/nats/jetstream`, or `$HOME/.local/share/vela/nats/jetstream`).
It runs as `VELA_UID:VELA_GID`, like the server.

Provision by hand from the checkout. Use Node 22.18 or newer, the workspace
dependencies (`pnpm install --frozen-lockfile`), Python 3.11 or newer, and `uv`.
The scripts pin the official `nats-py` client to 2.16.0 without changing the
application dependency graph.

```sh
uv run --script tools/nats/provision.py init
docker compose up -d nats
uv run --script tools/nats/provision.py apply
```

`init` creates `$VELA_DATA_DIR/nats/credentials.json` and `server.conf`, both mode
0600 in a mode 0700 directory outside the checkout. It generates passwords once,
keeps them on repeat runs, and never prints them. Compose reads the generated
server configuration. Keep both files private. No password or site setting belongs
in `.env`, a command line, an issue, or a log. To select a different data directory,
set `VELA_DATA_DIR` for both compose and the tool, or pass `--data-dir` to the tool.

`apply` reconciles two bounded file streams and four durable pull consumers.
A repeat with the same registry and policy reports `0 resources changed`, preserving
messages, consumer positions, and credentials. Stream filters and data permissions
come from `packages/rig-events` through `tools/nats/policy.mjs`. Changes to the
registry require another `init`, recreation of the broker container so its bind
mount reads the new configuration, then `apply`. Do this outside an observing session.
Run provisioning commands one at a time.

The broker listens on port 4222 inside the compose network as `nats:4222`.
The host mapping is **127.0.0.1 only**, so LAN and tailnet peers have no direct
published endpoint. No monitoring, cluster, or leaf-node port is enabled.
Use an SSH tunnel over the tailnet for remote inspection. The provisioning tool
accepts only a loopback URL (`--url nats://127.0.0.1:PORT`).

Runtime connections use their role's password from the private file and set their
client inbox prefix to `_INBOX.<role>`. Give each service only its own credential.
The provisioner credential belongs only to the manual tool.

| Role | Data publication | Reading |
|---|---|---|
| publisher | Kinds whose registry producer is `vela` | Its publish acknowledgment inbox only |
| archiver | None | `archiver-v1` on both streams |
| solver | Kinds whose registry producer is `solver` | `solver-v1`, frame facts only |
| model | Kinds whose registry producer is `model` | `model-v1`, all facts |
| observer | None | Live assessment subjects only |

Each pull role may request consumer info, pull the named durable, and acknowledge
only that durable's messages. All roles receive replies only on their own inbox
prefix. Runtime roles cannot create or delete streams or consumers, purge streams,
fetch messages directly, or read another role's inbox. The registry's `operator`
and `cria` producers have no runtime credentials in this step.

Facts retain up to 20 GiB and assessments up to 2 GiB, both for at most 14 days.
Messages are limited to 1 MiB and duplicate message ids are suppressed for two
minutes. These are initial bounds, not an archive guarantee. Services added in
later steps bind the existing durables without creating them. Each durable has
explicit acknowledgments, a 30-second ack deadline, and at most 256 unacked messages.
The read-only observer is a live subscription, without a replay cursor.

To verify without the real compose project, set `TMPDIR` to a writable scratch
directory outside the checkout and run the check below. It creates a unique container
from the compose image on a random loopback port, tests every runtime role and real
pull acknowledgments, checks repeat provisioning, and removes its container and data.

```sh
uv run --script tools/nats/verify.py
```

The server publishes the run log to JetStream when both `VELA_NATS_URL` and
`VELA_NATS_CREDENTIALS_FILE` are set. Compose sets these to the internal broker
and `/data/nats/credentials.json`. The file is read once at startup; the server
uses only its `publisher` role. Without both variables the publisher is off.
`/api/health` reports `publisher` alongside `runLog`.

The publisher retains at most 128 envelopes or 5 MiB of encoded payloads,
whichever fills first. That is 128 snapshots at the step 12a estimate of 40 KiB,
about two minutes at one snapshot per second. A single in-flight publish can
retain another 1 MiB. Oversized messages are dropped. A full queue drops its
oldest event. After recovery, a `gap` per affected rig reports the dropped count
and the first and last lost observation times before the retained tail resumes.
The queue is volatile and shutdown does not flush it. JetStream uses each
envelope's id as `Nats-Msg-Id`.

Run `TMPDIR=/path/to/scratch uv run tools/nats/verify-publisher.py` to provision a
disposable broker, kill it during FakeCria capture, restart it and read the gap
and retained tail back. The check removes its container and private files.
