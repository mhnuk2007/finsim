# Quickstart

> **Status: runnable platform baseline (milestone 1 in final release readiness).**
> The database, FinSim platform API, institution registry, payment transfer orchestration (`POST /api/v1/networks/{networkId}/transfers`), reconciliation resolution (`POST /api/v1/transfers/{id}/resolve`), trace recording (`GET /api/v1/transfers/{id}/trace`), fault injection (`POST/GET/DELETE /api/v1/faults`), property-based chaos testing (#24), CLI commands, Web Simulation Cockpit (`web/`), and four sample banks (Java, Python, Node.js, Go) are **runnable today**.
> Track detailed issue progress in [milestone-1-issues.md](milestone-1-issues.md).

---

## Prerequisites

- **Docker and Docker Compose** (for PostgreSQL)
- **Java 21+** (for building FinSim and Java sample bank from source)
- **Node.js 20+** (optional, for running the Node sample bank or `web/` Simulation Cockpit)
- **Python 3.10+** (optional, for running the Python sample bank)
- **Go 1.22+** (optional, for running the Go sample bank)
- **Git**

---

## 1. Start the System

You can run FinSim either as a full containerized multi-service stack using Docker Compose, or locally via Gradle.

### Option A: Full Multi-Container Stack (Recommended — Zero Local Setup)

To bring up the entire platform — PostgreSQL 17, FinSim API, Bank A, and Bank B — with a single command:

```bash
docker compose up -d
# or: docker compose -f deploy/docker-compose.yml up -d
```

This orchestrates:
- **`postgres`** (PostgreSQL 17, host port `5433`, internal port `5432`)
- **`bank-a`** (Sample Bank A in Java, port `9001`)
- **`bank-b`** (Sample Bank B in Java, port `9002`)
- **`finsim-api`** (FinSim Platform API, port `8080`, with database and seed endpoints configured)

Verify the stack health:
```bash
docker compose ps
# Verify individual services:
curl http://localhost:8080/actuator/health
curl http://localhost:9001/finsim/v1/institution/health
curl http://localhost:9002/finsim/v1/institution/health
```

### Option B: Local Gradle Development (Database in Docker)

If developing locally:

```bash
# 1. Start PostgreSQL 17 container on port 5433
docker compose up -d postgres

# 2. Start the FinSim API (runs on http://localhost:8080)
./gradlew :finsim-api:bootRun
```

### Option C: Using Testcontainers (No pre-existing DB needed)

```bash
# Starts FinSim API attached to an ephemeral Testcontainers PostgreSQL 17 container
./gradlew :finsim-api:bootTestRun
```

Verify that FinSim is healthy:

```bash
curl http://localhost:8080/actuator/health
# {"status":"UP"}
```

On startup, Flyway automatically runs database migrations (`V1__baseline.sql`, `V2__registry.sql`, `V3__widen_transfer_amount_scale.sql`, `V4__add_fault_rule_seed.sql`, `V5__add_transfer_trace_events.sql`), creates the `sandbox` network (USD), and seeds member institutions `bank-a` and `bank-b`.

---

## 2. Start the Sample Banks

FinSim includes independent in-memory sample banks implementing the `finsim/v1` participant contract in Java (`samples/bank-java`), Python (`samples/bank-python`), Node.js/TypeScript (`samples/bank-node`), and Go (`samples/bank-go`).

### Option A: Java Sample Banks (Bank A & Bank B)

In a new terminal, start **Bank A** on port 9001:

```bash
./gradlew :sample-bank-java:bootRun
```

In another terminal, start **Bank B** on port 9002:

```bash
./gradlew :sample-bank-java:bootRun --args="--spring.profiles.active=bank-b"
```

### Option B: Python (FastAPI) Sample Bank

FinSim also provides a standalone Python participant bank on port 9003:

```bash
cd samples/bank-python
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py              # starts on port 9003
```

### Option C: Node.js / TypeScript Sample Bank

FinSim also provides a standalone Node.js / TypeScript participant bank on port 9012:

```bash
cd samples/bank-node
npm ci
npm start                  # starts on port 9012 (or PORT=9010 npm start)
```

### Option D: Go Sample Bank

FinSim also provides a standalone Go participant bank on port 9004 using only the Go standard library (`net/http`):

```bash
cd samples/bank-go
go run .                   # starts on port 9004 (or PORT=9010 go run .)
```

### Verify Participant Endpoints

Verify their participant contract endpoints:

```bash
# Health & versioning
curl http://localhost:9001/finsim/v1/institution/health
curl http://localhost:9002/finsim/v1/institution/health
curl http://localhost:9003/finsim/v1/institution/health
curl http://localhost:9012/finsim/v1/institution/health
curl http://localhost:9004/finsim/v1/institution/health

# Capabilities
curl http://localhost:9001/finsim/v1/institution/capabilities
curl http://localhost:9003/finsim/v1/institution/capabilities
curl http://localhost:9012/finsim/v1/institution/capabilities
curl http://localhost:9004/finsim/v1/institution/capabilities

# Inspect initial synthetic balances (Java banks expose /sample/accounts)
curl http://localhost:9001/sample/accounts
curl http://localhost:9002/sample/accounts
```

You can even test a direct idempotent payment leg against Bank A:

```bash
curl -i -X POST http://localhost:9001/finsim/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-key-0001" \
  -d '{"transactionId":"tx-demo-1","direction":"DEBIT","accountReference":"ACC-1","money":{"amount":"100.00","currency":"USD"},"reference":"DEMO-001","provenance":"SYNTHETIC"}'
```

---

## 3. Interact with the Registry via the CLI

FinSim includes a CLI to manage institutions and networks. Build the CLI distribution:

```bash
./gradlew :finsim-cli:installDist
```

On Linux/macOS:
```bash
alias finsim="$(pwd)/finsim-cli/build/install/finsim/bin/finsim"
```

On Windows (PowerShell):
```powershell
Set-Alias finsim "$PWD\finsim-cli\build\install\finsim\bin\finsim.bat"
```

*(Alternatively, run commands directly via `./gradlew :finsim-cli:run --args="<command>"`)*

### List Seeded Institutions and Networks

```bash
# View institutions registered in the system
finsim institutions

# View details for a single institution
finsim institutions --id bank-a

# View the seeded sandbox network and its members
finsim networks --id sandbox

# Discover participant directory and routing capabilities
finsim directory --network sandbox
```

### Register and Join a Custom Institution

```bash
# Register a custom merchant service
finsim register --id merchant-x --name "Merchant X" --base-url http://localhost:9100 \
  --capabilities ACCOUNT_CREDIT

# Join it to the sandbox network
finsim join --network sandbox --institution merchant-x

# Verify updated network membership
finsim networks --id sandbox
```

### Validate Participant Compliance

FinSim includes a conformance test engine that checks participant banks against the 7-phase contract suite:

```bash
finsim verify --url http://localhost:9001
```

---

## 4. Transfer Execution & Fault Injection

FinSim allows operators and developers to execute payments, inspect append-only execution traces, inject deterministic faults, and reconcile uncertain outcomes directly from the CLI.

### Transfer Orchestration

Initiate a transfer across institutions in the sandbox network:

```bash
finsim transfer \
  --network sandbox \
  --from bank-a:ACC-1 --to bank-b:ACC-2 \
  --amount 100.00 --currency USD \
  --reference DEMO-001
```

*(Tip: Accounts can be specified using compound notation `--from bank-a:ACC-1` or flags `--from bank-a --from-account ACC-1`. Pass `--idempotency-key <key>` or let FinSim automatically generate a unique UUID. Append `--json` or `-j` for raw machine-readable JSON output.)*

FinSim coordinates the workflow:
1. Validates institution capabilities and network membership.
2. Executes `DEBIT` on Bank A (`http://localhost:9001/finsim/v1/payments`) with a deterministically derived stage idempotency key.
3. Executes `CREDIT` on Bank B (`http://localhost:9002/finsim/v1/payments`).
4. Moves the aggregate state from `CREATED` to `COMPLETED`.

### Inspecting Append-Only Execution Traces

Inspect the full lifecycle trace of the payment:

```bash
finsim trace <transactionId>
```

The trace captures:
- Aggregate stage transitions (`CREATED` → `ACCEPTED` → `IN_PROGRESS` → `COMPLETED`).
- Outbound HTTP participant requests, response status codes, and call durations.
- Injected faults and rule evaluations.

### Injecting Faults and Handling `UNKNOWN`

In payment networks, network timeouts and uncertain delivery cannot simply be marked "failed" — money may have already left the source account. FinSim makes this failure mode reproducible:

```bash
# 1. Simulate a network timeout on Bank B for 1 call
finsim fault add --target bank-b --type TIMEOUT --times 1

# (Other fault types include DELAY with --delay <ms> and DUPLICATE_DELIVERY, with optional --probability and --seed)

# 2. Verify registered fault rules
finsim fault list

# 3. Attempt a transfer: ends in UNKNOWN (never falsely marked FAILED or REJECTED)
finsim transfer \
  --network sandbox \
  --from bank-a:ACC-1 --to bank-b:ACC-2 \
  --amount 50.00 --currency USD \
  --reference DEMO-002

# 4. Inspect the trace: shows debit succeeded, credit timed out, and transfer state is UNKNOWN
finsim trace <transactionId>

# 5. Retrying while UNKNOWN is blocked with 409 RECONCILIATION_REQUIRED
# Remove the fault rule:
finsim fault remove <faultId>

# 6. Reconcile the uncertain transfer via participant status query (ADR 0001):
finsim resolve <transactionId>

# 7. Check the final trace: shows the query outcome and transition to COMPLETED or REJECTED
finsim trace <transactionId>
```

---

## 5. Connect Your Own Institution

You can implement the `finsim/v1` participant contract in any language:
1. Implement the four endpoints described in [contract-v1.md](contract-v1.md):
   - `GET /finsim/v1/institution/health`
   - `GET /finsim/v1/institution/capabilities`
   - `POST /finsim/v1/payments`
   - `GET /finsim/v1/payments/{transactionId}?leg=...`
2. Register your institution using `finsim register` or `POST /api/v1/institutions`.
3. Add it to a network using `finsim join` or `POST /api/v1/networks/{networkId}/members`.

---

## What's Next

- See [`web/README.md`](../web/README.md) to run the browser Simulation Cockpit (Demo Mode or Live API).
- See [deployment-oracle-cloud.md](deployment-oracle-cloud.md) for production Docker Compose + Caddy deployment.
- See [registry.md](registry.md) for details on registry APIs and SSRF URL protection.
- See [database.md](database.md) for database schema, Flyway migrations, and Testcontainers setup.
- See [roadmap.md](roadmap.md) for the long-term roadmap beyond Milestone 1.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) to contribute code or sample banks.
