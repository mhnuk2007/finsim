# Multi-stage build (linux/amd64 and linux/arm64 compatible — ready for Oracle Cloud Ampere A1)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
ARG VITE_DEFAULT_MODE=live
ARG VITE_API_BASE_URL=""
ENV VITE_DEFAULT_MODE=${VITE_DEFAULT_MODE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM caddy:2-alpine AS runtime
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
