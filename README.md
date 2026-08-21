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

Useful focused commands:

```sh
pnpm dev:web
pnpm dev:workshop
pnpm dev:server
pnpm build
pnpm start
```

## Server safety

Fastify binds to `127.0.0.1` by default. This intentionally prevents device-control endpoints from being exposed to the LAN. Set `HOST` explicitly only after adding authentication, authorization, and device access controls.

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
