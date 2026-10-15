# Running Vela in Docker

Two containers from this repo: `server` (the API) and `web` (nginx serving the built
app and proxying `/api` to the server). Only `web` is published. The server's port is
not, so nothing but nginx can reach the rig-control API directly.

**There is no login.** Whoever can reach `VELA_PORT` can drive the rig. By choice it is
LAN-wide, the same as `pnpm dev:observing` on port 5173.

## Layout on the host

Config and data live in XDG directories, mounted into the containers (override with
`VELA_CONFIG_DIR` / `VELA_DATA_DIR`):

| Host | In the container | What |
|---|---|---|
| `~/.config/vela/cria.json` | `/config/cria.json` (read-only) | Cria rigs; required, `{"rigs": []}` is the minimum |
| `~/.local/share/vela/rigs.yaml` | `/data/rigs.yaml` | rig catalog, written by Vela |
| `~/.local/share/vela/saved-images/` | `/data/saved-images` | captured frames |
| `~/.local/share/vela/survey-cache/`, `traces/`, `alignment-diagnostics/` | `/data/...` | caches, trace journal, evidence bundles |
| `~/.local/share/vela/astap/` | `/astap` (read-only) | `astap_cli` and `catalog/opt/astap/` (D05 star database) |

The ASTAP binary and star catalog are not in git; copy them into `astap/`. Create the
directories as the user that runs the stack: the containers run as `VELA_UID:VELA_GID`
(default 1000:1000) so the files stay yours.

The Cria URL in `cria.json` must be reachable from the host; containers use the host's
routes, so a Tailscale address works if the host is on the tailnet.

## Run

```sh
docker compose up -d --build     # http://<host>:5173, or VELA_PORT=...
docker compose logs -f server
```

Update: `git pull && docker compose up -d --build`. Both containers restart
automatically (`unless-stopped`). The image build runs `pnpm install` and `pnpm build`
inside Docker; nothing is needed on the host except Docker.

## Moving from `vela-observing` on another machine

Only one Vela may talk to a Cria at a time. With no capture running:

1. Stop the old one (`systemctl --user stop vela-observing`).
2. Copy `rigs.yaml`, `saved-images/`, `survey-cache/`, `traces/` and the ASTAP files into
   the data directory, and `cria.json` into the config directory (`rsync -a`).
3. `docker compose up -d --build`, then open the app and check the rig shows its devices.

To roll back, stop the stack and start the old unit again; its data is untouched.
