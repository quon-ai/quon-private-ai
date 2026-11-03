# QUON frontend — multi-stage build for the TanStack Start SSR bundle.
#
# Build args:
#   VITE_QUON_API_URL  Baked into the client bundle at build time. The default
#                      "/api" expects the reverse proxy to route /api/* to the
#                      scrubber service (see docker-compose.yml + the
#                      deploy/Caddyfile.example) — with same-origin /api no
#                      rebuild is needed per domain and the production CSP
#                      works out of the box.

FROM node:26-slim AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# The pinned nitro beta has a peer conflict with the vite-tanstack config —
# .npmrc carries legacy-peer-deps=true so a plain ci works.
RUN npm ci

COPY . .
ARG VITE_QUON_API_URL=/api
ENV VITE_QUON_API_URL=$VITE_QUON_API_URL
# prebuild runs scripts/copy-ort.mjs (self-hosted ONNX WASM into public/ort/).
# The SSR bundle is self-contained (vite.config.ts ssr.noExternal) and carries
# the heavy client libraries; bundling it needs more than Node's default heap
# on an 8 GB host — the build died with "Reached heap limit" on 2026-11-02.
# docs/self-hosting.md budgets ~4 GB for the build.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build /app/dist ./dist
COPY deploy/serve-frontend.mjs ./deploy/serve-frontend.mjs
EXPOSE 8080
USER node
CMD ["node", "deploy/serve-frontend.mjs"]
