# syntax=docker/dockerfile:1
# Two images from one build: `server` (the Fastify API) and `web` (nginx serving the built app).
# See docs/docker.md.

FROM node:26-slim AS build
RUN npm install --global pnpm@11.22.0
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter '@vela/server...' build && pnpm --filter @vela/web build
# `--legacy` because the workspace does not inject its packages; this copies the built packages in.
RUN pnpm --filter @vela/server deploy --prod --legacy /out/server

FROM node:26-slim AS server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build /out/server ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]

FROM nginxinc/nginx-unprivileged:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
