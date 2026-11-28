# FinSim

**An open-source simulator for financial networks: connect independent services, run realistic payment flows, and break them on purpose.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange)](docs/roadmap.md)

> **Status: pre-alpha.** FinSim is in its design phase. The architecture is documented; the code is being built milestone by milestone. This README only claims what exists. Everything else lives in the [roadmap](docs/roadmap.md).

## What is FinSim?

Most payment sandboxes simulate one provider. FinSim simulates the *network*: independently built services (a bank, a merchant, a gateway) talk to each other through one versioned contract, and FinSim orchestrates the payment, injects failures, and shows you the full trace.

You write the institution, in any language. FinSim connects it, tests it, and shows what happened.

**Everything in FinSim is synthetic.** It never holds real money, never talks to real payment networks, and labels every simulated entity `SYNTHETIC`.

## Why?

Timeouts, duplicate requests, and uncertain outcomes are the hardest parts of payment engineering, and the parts most sandboxes hide. FinSim makes them reproducible:

- **`UNKNOWN` is a real outcome.** A timeout never turns into "failed". Retries are blocked until the outcome is resolved.
- **Idempotency is enforced.** Duplicate requests never create a second financial effect.
- **Fault injection.** Delays, timeouts, and duplicate deliveries on demand.
- **Full trace.** Every stage, call, and fault in one view.

## Status

| Capability | Status |
|---|---|
| Design: architecture spec, requirements, contract sketch | Done (see `docs/`) |
| Build scaffold: Gradle modules, CI, module-boundary checks, CLI skeleton | Done |
| Database baseline: PostgreSQL + Flyway migrations, Testcontainers | Done |
| Transfer domain: aggregate root, state machine, append-only history | Done |
| Institution registry: registration, static sandbox network, seed data, CLI | Done |
| Sample bank (Java): in-memory bank implementing participant contract | Done (`samples/bank-java`, validated & 404/405 JSON errors in [#184](https://github.com/mhnuk2007/finsim/pull/184)) |
| Sample bank (Python): in-memory bank implementing participant contract | Done (`samples/bank-python`) |
| Sample bank (Node.js/TypeScript): in-memory bank implementing participant contract | Done (`samples/bank-node`) |
| Sample bank (Go): in-memory bank using stdlib `net/http` | Done (`samples/bank-go`, [#141](https://github.com/mhnuk2007/finsim/pull/141)) |
| Payment orchestration & ADR 0001 resolution: debit/credit orchestration, `UNKNOWN` state handling, resolve endpoint | Done (hardened in [#157](https://github.com/mhnuk2007/finsim/pull/157), [#181](https://github.com/mhnuk2007/finsim/pull/181), [#183](https://github.com/mhnuk2007/finsim/pull/183)) |
| Fault injection & Chaos invariants: `DELAY`, `TIMEOUT`, `DUPLICATE_DELIVERY` rules (with stage targeting & `RESPONSE_LOST_AFTER_PROCESSING`), jqwik property-based conservation tests | Done (hardened in [#157](https://github.com/mhnuk2007/finsim/pull/157), [#166](https://github.com/mhnuk2007/finsim/pull/166), [#167](https://github.com/mhnuk2007/finsim/pull/167)) |
| Declarative Scenario DSL & deterministic replay: `finsim/scenario/v1` YAML/JSON fixtures, isolated execution, canonical trace normalization, `ADVANCE_TIME` virtual clock stepping, `finsim scenario run --verify-replay` | Done (`docs/scenarios/lost-credit-timeout-and-recovery.yaml`, [#26](https://github.com/mhnuk2007/finsim/issues/26), [#167](https://github.com/mhnuk2007/finsim/pull/167), [#185](https://github.com/mhnuk2007/finsim/pull/185)) |
| Virtual clock & time-travel engine (M2 foundation): `DiscreteVirtualClock` (`finsim-sim`), Two Clocks (`TraceEvent.virtualAt`), `startTime` + `ADVANCE_TIME` scenario steps, `--live` guard | Done ([`docs/architecture/virtual-clock.md`](docs/architecture/virtual-clock.md), [#27](https://github.com/mhnuk2007/finsim/issues/27), [#185](https://github.com/mhnuk2007/finsim/pull/185); `/api/v1/clock` HTTP API & control guard in [#173](https://github.com/mhnuk2007/finsim/issues/173), ADR 0003 under review in [#186](https://github.com/mhnuk2007/finsim/pull/186)) |
| Participant conformance test engine: `finsim verify --url` 7-phase validation suite | Done |
| Transfer trace recording: stages, state changes, participant calls, injected faults, `finsim trace` | Done |
| Multi-container Docker Compose quickstart: PostgreSQL 17, FinSim API, Bank A, Bank B, healthchecks | Done |
| Dynamic network directory discovery: `GET /api/v1/networks/{id}/directory`, CLI `finsim directory` | Done |
| CLI transfer, resolve, fault, & scenario management: `finsim transfer`, `finsim resolve`, `finsim fault add/list/remove`, `finsim scenario run` | Done |
| CLI participant base URL subpaths & context path preservation | Done ([#132](https://github.com/mhnuk2007/finsim/pull/132), [#133](https://github.com/mhnuk2007/finsim/pull/133)) |
| Cloud deployment & security hardening: production Docker Compose stack, Caddy automated TLS (`ACME_EMAIL`) + Swagger/OpenAPI routing, forwarded headers, CORS for web frontends, and SSRF/metadata guards (`internal-hosts`, ULA/CGNAT) | Done (`docker-compose.prod.yml`, `docs/deployment-oracle-cloud.md`, [#157](https://github.com/mhnuk2007/finsim/pull/157), [#162](https://github.com/mhnuk2007/finsim/pull/162), [#163](https://github.com/mhnuk2007/finsim/pull/163), [#180](https://github.com/mhnuk2007/finsim/pull/180)) |
| Web Simulation Cockpit: Vite + React 19 topology, transfer runner, ADR 0001 resolution, trace waterfall, fault rules (with PRNG `seed`), network management, `localStorage` Live history, Demo & Live API modes, Caddy container | Done (`web/`, [#135](https://github.com/mhnuk2007/finsim/pull/135), [#158](https://github.com/mhnuk2007/finsim/pull/158), [#162](https://github.com/mhnuk2007/finsim/pull/162), [#164](https://github.com/mhnuk2007/finsim/pull/164)) |
| Milestone 1: four sample banks (Java, Python, Node.js, Go), `finsim/v1` minimal contract, payment state machine with `UNKNOWN`, fault injection, `finsim trace`, `finsim verify`, `finsim scenario run`, Web Cockpit, Docker Compose quickstart | In progress (final release-readiness issues tracked in [docs/milestone-1-issues.md](docs/milestone-1-issues.md) and [docs/good-first-issues.md](docs/good-first-issues.md)) |
| Milestone 2: virtual clock, card authorize/capture/refund, double-entry ledger, snapshot/reset, ATM simulation, registry CRUD | In progress (virtual clock core done in [#27](https://github.com/mhnuk2007/finsim/issues/27)/[#185](https://github.com/mhnuk2007/finsim/pull/185); HTTP clock API [#173](https://github.com/mhnuk2007/finsim/issues/173), ledger [#28](https://github.com/mhnuk2007/finsim/issues/28)/[#172](https://github.com/mhnuk2007/finsim/issues/172), card auth [#204](https://github.com/mhnuk2007/finsim/issues/204), ATM [#33](https://github.com/mhnuk2007/finsim/issues/33)/[#179](https://github.com/mhnuk2007/finsim/issues/179), history/inquiry [#170](https://github.com/mhnuk2007/finsim/issues/170)/[#171](https://github.com/mhnuk2007/finsim/issues/171), registry [#194](https://github.com/mhnuk2007/finsim/issues/194)/[#205](https://github.com/mhnuk2007/finsim/issues/205), and Cockpit scenarios [#201](https://github.com/mhnuk2007/finsim/issues/201) tracked) |
| Milestone 3: disputes, reconciliation, live recording replay | Planned |
| Clearing, RTGS, FX, screening, ISO 20022, billers, fees | Roadmap (help wanted) |

## Quickstart

See [docs/quickstart.md](docs/quickstart.md) for the full step-by-step walkthrough.

### Option A: Complete Multi-Container Stack (Fastest)

Bring up PostgreSQL 17, Bank A, Bank B, and the FinSim API with a single command:

```bash
docker compose up -d
```

Verify services:
```bash
curl http://localhost:8080/actuator/health
curl http://localhost:9001/finsim/v1/institution/health
curl http://localhost:9002/finsim/v1/institution/health
```

### Option B: Local Gradle Development

If running from source locally:

```bash
# 1. Start PostgreSQL 17
docker compose up -d postgres

# 2. Start the FinSim API (port 8080)
./gradlew :finsim-api:bootRun

# 3. In separate terminals, start Bank A (port 9001) and Bank B (port 9002)
./gradlew :sample-bank-java:bootRun
./gradlew :sample-bank-java:bootRun --args="--spring.profiles.active=bank-b"

# (Optional: run the Python bank on port 9003 in samples/bank-python, Node bank on port 9012 in samples/bank-node, or Go bank on port 9004 in samples/bank-go)

# 4. Query seeded institutions and the sandbox network using the CLI (supports --json / -j)
./gradlew :finsim-cli:run --args="institutions"
./gradlew :finsim-cli:run --args="networks --id sandbox --json"
```

### Option C: Web Simulation Cockpit (`web/`)

Run the interactive React Flow workbench at `http://localhost:3000` (starts in zero-backend **Demo Mode**, or switch the toggle to **Live API** when `finsim-api` is running; see [`web/README.md`](web/README.md)):

```bash
cd web
npm install
npm run dev
```

### Execute Transfers & Inject Faults via the CLI

FinSim's CLI orchestrates transfers, queries execution traces, injects deterministic faults, and resolves pending transactions:

```bash
# 1. Execute payment between Bank A and Bank B
finsim transfer --network sandbox --from bank-a:ACC-1 --to bank-b:ACC-2 --amount 100.00 --currency USD --reference DEMO-001

# 2. Inspect the append-only transfer execution trace
finsim trace <transactionId>

# 3. Inject a deterministic network timeout on Bank B
finsim fault add --target bank-b --type TIMEOUT --times 1

# 4. Attempt transfer: moves safely to UNKNOWN (never falsely marked FAILED or REJECTED)
finsim transfer --network sandbox --from bank-a:ACC-1 --to bank-b:ACC-2 --amount 50.00 --currency USD

# 5. List active fault rules and remove the timeout
finsim fault list
finsim fault remove <faultId>

# 6. Reconcile the hung transfer via participant status query
finsim resolve <transactionId>
finsim trace <transactionId>

# 7. Run a declarative scenario YAML with isolated deterministic replay verification
finsim scenario run docs/scenarios/lost-credit-timeout-and-recovery.yaml --verify-replay
```

## Core concepts

- **Institution:** an independently owned service (bank, merchant, gateway) that implements the `finsim/v1` contract.
- **Network:** a controlled environment where registered institutions can transact.
- **Scheme:** the rules a network applies (currencies, limits, workflow).
- **Contract (`finsim/v1`):** the versioned HTTP/JSON API an institution implements. See [docs/contract-v1.md](docs/contract-v1.md) and [contract/finsim-v1.openapi.yaml](contract/finsim-v1.openapi.yaml).

## What FinSim is not

- Not a real-money system, payment network, or bank.
- Not connected to real sanctions lists, FX feeds, or regulators.
- Not a certification of conformance to any real payment scheme.
- Not a place where uploaded code runs inside the FinSim API process.
- Not safe to expose to the public internet: the platform and registry APIs have no authentication and are designed strictly for local simulation.

## Academic & Research Use

FinSim is built as a zero-liability, reproducible experimental laboratory for researchers, professors, and university students studying **Distributed Systems**, **Financial Market Infrastructure (FMI)**, **Chaos Engineering**, and **Payment Resilience**.

- **Cite FinSim in Academic Papers:** Scholars are welcome to cite FinSim in theses, conference papers, and technical reports. Use the **"Cite this repository"** button in GitHub's sidebar or see [`CITATION.cff`](CITATION.cff).
- **University Coursework & Lab Projects:** Instructors in Computer Science, Fintech, or Software Engineering can use our ready-made semester lab modules, syllabi, and grading rubrics in the **[Academic & University Lab Guide](docs/academic-lab-guide.md)**.
- **Reproducible Benchmark Environments:** Because all entities are labeled `"provenance": "SYNTHETIC"`, peer reviewers can clone and reproduce chaos injection experiments in under 5 minutes without NDA or banking compliance barriers.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), browse our [Good First Issues](https://github.com/mhnuk2007/finsim/labels/good-first-issue), or check the [contributor issues guide](docs/good-first-issues.md). Project decisions are described in [GOVERNANCE.md](GOVERNANCE.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
