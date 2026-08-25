# syntax=docker/dockerfile:1
# NOTE: build context is the repo root (see compose files), so that the prod
# stage can pull in ../caddy/Caddyfile alongside the frontend sources.

# ---------- shared dependency layer ----------
FROM node:26-trixie-slim AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci


# ---------- local development: Vite dev server with HMR ----------
FROM node:26-trixie-slim AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# ---------- production build ----------
FROM node:26-trixie-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
# Same-origin by default; Caddy proxies /api to the backend.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build


# ---------- production runtime: Caddy serves the SPA and proxies /api ----------
FROM caddy:2.11.4-alpine AS prod
COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/healthz || exit 1
