# Vela

Vela is a local-first astronomy-control workspace. The React SPA is the control surface; the Fastify server is the trusted boundary for observatory devices on the local network.

## Workspace layout

```text
apps/
  web/       # Vite, React, React Router, and Tailwind CSS
  workshop/  # Source-backed component design workshop
  server/    # Fastify API and device adapters
packages/
  alpaca/    # Server-side Alpaca protocol adapter and normalized provider boundary
  model/     # Shared types for web and server
  ui/        # @vela/ui tokens, stable components, and draft workspace
```

## Prerequisites

- Node.js 20.19+ (or 22.12+)
- pnpm 11.22.0 (`npm install --global pnpm@11.22.0` if it is not installed)

## Development

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

`pnpm dev` starts the web app and Fastify together. Vite proxies `/api/*` to Fastify at `http://127.0.0.1:3001`; visit `http://localhost:5173/api` in the SPA to exercise `GET /api/health`.

The server stores added Rigs in the Git-ignored `data/rigs.yaml`. Set `VELA_RIG_CATALOG_PATH` to use a different location; [`data/rigs.example.yaml`](data/rigs.example.yaml) shows the file shape.

Useful focused commands:

```sh
pnpm dev:web
pnpm dev:workshop
pnpm dev:server
pnpm build
pnpm start
```

Run `pnpm check` for lint, tests, and the workspace build (including TypeScript
checks), in that order. It stops at the first failure and does not modify source.
Use `pnpm lint` to inspect findings or `pnpm lint --fix` to apply available fixes
for review.

## Observing from the local network

```sh
cp .env.observing.example .env.observing.local # first setup only
# Set the rig endpoint, stable device IDs, and installed ASTAP/catalogue paths.
pnpm dev:observing
```

Open `http://polaris.local:5173` on the desktop or a phone on the same trusted network. The machine must advertise `polaris.local` through mDNS (or resolve through local DNS); the command does not configure hostname resolution. Set `VELA_LAN_HOST` for a different hostname.

This command loads the Git-ignored root `.env.observing.local`, checks the solver paths and ports, then starts the normal development watchers. It uses the repository's `data/rigs.yaml` and `data/saved-images` by default, including existing rigs and retained images. Relative paths in this configuration resolve from the repository root. Ctrl+C stops this run and its watchers. Stop other servers on ports 3001 and 5173 before starting it.

Fastify stays on loopback; Vite listens on the network at port 5173 and proxies `/api` to it. This exposes device controls to the trusted local network without authentication. It is intended for Chris's home/observatory network; do not forward this development server to the internet.

## API integration

The typed browser API client is in `apps/web/src/lib/api.ts`. Browser-safe values use `VITE_*` variables. Credentials and device protocol calls belong in `apps/server`, never in the SPA.

## Design documents

- [Component Workshop Decision Record](docs/component-workshop.md)
- [Component Workshop Operations Guide](docs/component-workshop-operations.md)
- [Component Workshop Usage](apps/workshop/README.md)

## Star catalogue

Refresh the public star-name data with:

```sh
pnpm --filter @vela/web refresh-stars
```
