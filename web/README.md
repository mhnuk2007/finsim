# FinSim Simulation Cockpit (`web/`)

Interactive frontend workbench for **FinSim** — visualize network topologies, inject deterministic faults (`DELAY`, `TIMEOUT`, `DUPLICATE_DELIVERY`), run transfers, inspect execution trace waterfalls, and resolve `UNKNOWN` transactions per ADR 0001.

## Quickstart (30 seconds — Zero Backend Required)

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. The Cockpit starts in **Demo Mode** with a stateful in-browser FinSim engine (seeded with `bank-a`, `bank-b`, and `sandbox`), so you can test the full `TIMEOUT → UNKNOWN → Resolve` loop immediately without Java or Docker.

## Connecting to Live `finsim-api`

1. Start the backend stack from the repository root:
   ```bash
   docker compose up -d
   ```
2. Run `npm run dev` inside `web/` and switch the top-bar toggle from **Demo Mode** to **Live API**.
3. Vite proxies `/api/*` and `/actuator/*` to `http://localhost:8080` by default (override via `VITE_API_TARGET`), or set `VITE_API_BASE_URL` to point directly at a hosted Oracle Cloud Caddy endpoint (with your origin added to `FINSIM_CORS_ALLOWED_ORIGINS`).

## Build, Typecheck & Test

```bash
npm run typecheck
npm run test
npm run build
```

## Docker & Caddy (Oracle Cloud ARM64 / AMD64)

`web/Dockerfile` uses `caddy:2-alpine` (matching `deploy/caddy/Caddyfile` and `docker-compose.prod.yml`) to serve the built static Cockpit with gzip/zstd compression, SPA fallback, and `/healthz`:

```bash
docker build -t finsim-web ./web
docker run -p 3000:80 finsim-web
```

In production behind `deploy/caddy/Caddyfile`, route `/api/*`, `/actuator/*`, `/swagger-ui/*`, and `/v3/api-docs*` to `finsim-api:8080` and the root fallback `handle` to `finsim-web:80`.
