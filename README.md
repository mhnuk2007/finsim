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
| Sample bank (Java): in-memory bank implementing participant contract | Done (`samples/bank-java`) |
| Sample bank (Python): in-memory bank implementing participant contract | Done (`samples/bank-python`) |
| Sample bank (Node.js/TypeScript): in-memory bank implementing participant contract | Done (`samples/bank-node`) |
| Payment orchestration & ADR 0001 resolution: debit/credit orchestration, `UNKNOWN` state handling, resolve endpoint | Done |
| Fault injection & Chaos invariants: `DELAY`, `TIMEOUT`, `DUPLICATE_DELIVERY` rules, jqwik property-based conservation tests | Done |
| Participant conformance test engine: `finsim verify --url` 7-phase validation suite | Done |
| Transfer trace recording: stages, state changes, participant calls, injected faults, `finsim trace` | Done |
| Multi-container Docker Compose quickstart: PostgreSQL 17, FinSim API, Bank A, Bank B, healthchecks | Done |
| Dynamic network directory discovery: `GET /api/v1/networks/{id}/directory`, CLI `finsim directory` | Done |
| CLI transfer, resolve, & fault management: `finsim transfer`, `finsim resolve`, `finsim fault add/list/remove` | Done |
| Milestone 1: three sample banks (Java, Python, Node.js), `finsim/v1` minimal contract, payment state machine with `UNKNOWN`, fault injection, `finsim trace`, `finsim verify`, Docker Compose quickstart | In progress (final release readiness) |
| Milestone 2: card authorize/capture/refund, virtual clock, ledger | Planned |
| Milestone 3: disputes, reconciliation, scenario replay | Planned |
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

# (Optional: run the Python bank on port 9003 in samples/bank-python, or Node bank on port 9012 in samples/bank-node)

# 4. Query seeded institutions and the sandbox network using the CLI (supports --json / -j)
./gradlew :finsim-cli:run --args="institutions"
./gradlew :finsim-cli:run --args="networks --id sandbox --json"
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
