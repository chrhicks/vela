# Vela

A manually configured React single-page application based on [Vite](https://vite.dev/guide/), [React Router](https://reactrouter.com/home), and [Tailwind CSS](https://tailwindcss.com/docs/installation/using-vite). It deliberately uses Vite rather than a full-stack framework: it is small, active, and purpose-built for client-rendered SPAs.

## Prerequisites

Node.js 20.19+ (or 22.12+) is required by Vite 8.

## Run

```sh
npm install
cp .env.example .env.local
npm run dev
```

Create and preview a deployable static build with:

```sh
npm run build
npm run preview
```

## Styling

Tailwind CSS v4 is installed using its official Vite plugin. The app theme lives in `src/styles.css` under `@theme`; use its `vela-*` utilities (for example, `bg-vela-surface`) instead of repeating raw color values.

## API integration

An SPA runs JavaScript in the browser, so it cannot safely make *server-side* requests or hold server secrets. Keep credentials and privileged calls in your backend/BFF. The typed browser client lives in `src/lib/api.ts` and defaults to `VITE_API_URL=/api`.

For local development, set `API_PROXY_TARGET=http://localhost:3000` in `.env.local`; Vite will forward `/api/*` requests to that backend and avoid browser CORS issues. In production, configure the hosting server or reverse proxy to route `/api` to the backend and to rewrite unknown application paths to `index.html` for React Router.

Only values intended for the browser belong in `VITE_*` variables.

## Existing prototype

The original static prototype is preserved in `legacy/index.html`; its data is available at `public/data/iau-named-stars.js`.
