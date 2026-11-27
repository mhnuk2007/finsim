# ADR 0002: ATM participant contract and partial-dispense reconciliation

- **Status:** Proposed
- **Date:** 2026-11-27
- **Deciders:** @mhnuk2007, @innocentjasmine
- **Comment period ends:** 2026-12-04

## Context

Issue [#33](https://github.com/mhnuk2007/finsim/issues/33) introduces an ATM terminal participant archetype and physical cash dispensing fault simulation across `samples/`, `finsim-sim`, `finsim-registry`, and `finsim-api`.

Unlike bank-to-bank transfers where both legs mutate software ledgers, an ATM withdrawal pairs a **financial debit** at an issuing bank with a **physical cash dispense** at an independent ATM terminal:

1. Customer requests a withdrawal of `$200.00`.
2. FinSim debits `$200.00` from the customer's account at the issuing bank.
3. The ATM dispenser jams after delivering `$80.00` (`PARTIALLY_DISPENSED`), delivers `$0.00` (`NOT_DISPENSED`), or drops power/network before confirming physical status (putting FinSim in `UNKNOWN`).

Reversing the full `$200.00` on an ambiguous timeout or partial jam destroys `$80.00` of cash accounting; conversely, failing to verify physical outcome violates FinSim's reconciliation principle:

> **Physical truth must be established before financial compensation is calculated.**

Three constraints from the current codebase (`main`) shape this design:

- **Participant `MS03` reversal rule:** Existing `/finsim/v1/*` participants ([`contract/conformance/README.md`](../../contract/conformance/README.md) and `samples/bank-{java,python,node,go}`) enforce `original.amount().compareTo(amount) == 0` when `POST /finsim/v1/payments` carries `reversalOf`, rejecting smaller amounts with `422 MS03`.
- **Registry schema & OpenAPI drift:** [`V2__registry.sql`](../../finsim-registry/src/main/resources/db/migration/V2__registry.sql) enforces unnamed inline `CHECK` constraints restricting `institution_type` to `('BANK', 'MERCHANT', 'PAYMENT_GATEWAY', 'CUSTOM')` and `capability` to `('ACCOUNT_DEBIT', 'ACCOUNT_CREDIT', 'STATUS_QUERY')`. In [`contract/finsim-v1.openapi.yaml`](../../contract/finsim-v1.openapi.yaml), `Capabilities` (L471–474) and `ParticipantDirectoryEntry` (L740–744) duplicate these enums inline instead of using `$ref`.
- **Trace foreign key constraint:** `transfer_trace_events.transfer_id` enforces `REFERENCES transfers(id) ON DELETE CASCADE` (`V5__add_transfer_trace_events.sql`), and [`docs/roadmap.md`](../roadmap.md) §5.3 prohibits adding a `FAILED` transfer state.

## Decision

### 1. Strict separation of concerns

1. **ATM terminal (independent participant service):** Owns cassette inventory (denominations and note counts) and executes physical dispenses (`DISPENSED`, `PARTIALLY_DISPENSED`, `NOT_DISPENSED`, or non-terminal `DIAGNOSTICS_PENDING` when physical confirmation is still unsettled — preserving the contract rule that participants never report `UNKNOWN`). Maintains idempotency per `transactionId` so retries never decrement cassettes twice, and rejects impossible dispenses exceeding cassette stock. Never mutates issuing-bank balances.
2. **Issuing bank (`finsim/v1` participant):** Commits the initial customer `DEBIT` and processes compensating `CREDIT` adjustments through its existing `POST /finsim/v1/payments` and `GET /finsim/v1/payments/{id}?leg=...` endpoints.
3. **FinSim orchestrator (`finsim-api`):** Coordinates the withdrawal lifecycle via `POST /api/v1/networks/{networkId}/atm/withdrawals`, validates physical conservation invariants, computes exact `unfulfilledAmount`, dispatches compensating credits, and reconciles `UNKNOWN` states.

### 2. Registry expansion, capability gating, and OpenAPI `$ref` cleanup

- Add `ATM` to `InstitutionType` and `CASH_DISPENSE` to `Capability` (preserving the 4-endpoint `/finsim/v1/*` mandatory core for banks; only `ATM` / `CASH_DISPENSE` participants implement `/finsim/v1/atm/*`).
- ATM institutions supporting `/resolve` reconciliation **must declare both `CASH_DISPENSE` and `STATUS_QUERY`** capabilities; FinSim enforces this via `Registry.requireRoutable(...)` at withdrawal initiation, while `POST /api/v1/networks/{networkId}/transfers` continues requiring `ACCOUNT_DEBIT` / `ACCOUNT_CREDIT`.
- Refactor inline `institutionType` and `capabilities` enum definitions in `contract/finsim-v1.openapi.yaml` (`Capabilities` L471–474 and `ParticipantDirectoryEntry` L740–744) to `$ref` `#/components/schemas/InstitutionType` and `#/components/schemas/Capability`.
- In a sequential Flyway migration (`V6+`, coordinating with `#170`/`#171`), safely drop Postgres's unnamed inline constraints (`registry_institutions_institution_type_check` and `registry_institution_capabilities_capability_check` via `DROP CONSTRAINT IF EXISTS` / `pg_constraint` lookup) before re-adding updated `CHECK` constraints.

### 3. Platform entry point and capability-gated ATM contract (`/finsim/v1/atm/*`)

- **Platform API entry point (`finsim-api`):** Expose a dedicated `POST /api/v1/networks/{networkId}/atm/withdrawals` endpoint (`Idempotency-Key` required; request payload `{ "from": { "institutionId", "accountReference" }, "terminalId", "money": { "amount", "currency" }, "reference" }`, returning `201` / `200` `Transfer` response backed by `atm_withdrawals`), rather than overloading `POST /api/v1/networks/{networkId}/transfers` with placeholder destination accounts.
- **ATM participant endpoints (`/finsim/v1/atm/*`):** Institutions declaring `CASH_DISPENSE` (paired with `STATUS_QUERY`) expose two HTTP/JSON endpoints documented in `contract/finsim-v1.openapi.yaml` and Swagger UI:

- `POST /finsim/v1/atm/dispenses` (requires `Idempotency-Key` 8–128 chars; identical replay returns `200`, conflicting payload returns `409 IDEMPOTENCY_CONFLICT`):
  - Returns `201` / `200` with `DispenseResult` (including optional `reasonCode`, required when `status` is `NOT_DISPENSED` and optional on partial jam diagnostics):
    ```json
    {
      "eventType": "DISPENSE_STATUS_CONFIRMED",
      "terminalId": "atm-01",
      "transactionId": "tx-0123456789abcdef",
      "currency": "USD",
      "requestedAmount": "200.00",
      "dispensedAmount": "80.00",
      "unfulfilledAmount": "120.00",
      "status": "PARTIALLY_DISPENSED",
      "reasonCode": "ATM_HARDWARE_FAULT",
      "provenance": "SYNTHETIC"
    }
    ```
  - **Dedicated ATM reason codes:** Add FinSim-specific reason codes (`ATM_HARDWARE_FAULT`, `ATM_CASSETTE_DEPLETED`, `ATM_CONFLICTING_OUTCOME`) in `ReasonCode` rather than overloading `AM04` (which strictly denotes customer account insufficient funds), with `MS03` fallback if an external ATM participant omits a specific code.
  - Enforces strict `BigDecimal` conservation at both ATM and FinSim boundaries: negative amounts, `dispensed > requested`, scale `> 8`, invalid ISO currency codes, or `requested != dispensed + unfulfilled` are rejected (unparseable/non-conserving ATM responses fail reconciliation / trigger `needsManualReview`).
- `GET /finsim/v1/atm/dispenses/{transactionId}` (`STATUS_QUERY` for physical delivery):
  - Returns `200` with the authoritative `DispenseResult` if the ATM received the command and established an outcome (`DISPENSED`, `PARTIALLY_DISPENSED`, `NOT_DISPENSED`), `200` with `status: "DIAGNOSTICS_PENDING"` (and `eventType: "DISPENSE_DIAGNOSTICS_PENDING"`, which FinSim maps to `TransferState.UNKNOWN`) if hardware/power reconciliation has not yet settled, or `404 LEG_NOT_FOUND` if the ATM never received the dispense request.
- **Conflicting outcome protection:** Once an authoritative final outcome is recorded for a withdrawal, repeated identical confirmations are idempotent no-ops; any conflicting physical confirmation is rejected and marks the withdrawal `needsManualReview = true` (`ATM_CONFLICTING_OUTCOME`) rather than triggering a second adjustment.

### 4. Compensating `CREDIT` (`reversalOf = null`) vs. `MS03`

When physical confirmation establishes `unfulfilledAmount > 0` (`PARTIALLY_DISPENSED` or `NOT_DISPENSED`):

- FinSim generates withdrawal `transactionId` values using `tx-<16 hex>` (19 chars, strictly capped at `<= 60` chars max) so the adjustment `transactionId` (`<transactionId>-adj`, `<= 64` chars) fits `POST /finsim/v1/payments` and `transfers.id` (`VARCHAR(64)`).
- FinSim dispatches an ordinary idempotent **`CREDIT` leg with `reversalOf = null`** to the issuing bank via `POST /finsim/v1/payments`:
  - `transactionId`: `<transactionId>-adj` (`<= 64` chars)
  - `Idempotency-Key`: `finsim:adjustment:<transactionId>:reversal` (`<= 87` chars for `transactionId <= 60`, safely within the 8–128 char contract limit)
  - `money`: `{ "amount": unfulfilledAmount, "currency": currency }`
- Setting `reversalOf = null` avoids violating the exact-amount `MS03` check in `05-reversal.hurl` and keeps all existing sample banks compatible without requiring bank-level contract changes.

**Failure handling on the compensating `CREDIT` leg:**

- **Transport timeout / `5xx`:** Withdrawal transitions to `TransferState.UNKNOWN` with `pendingAction: COMPENSATE_UNFULFILLED`, preserving `unfulfilledAmount` in `atm_withdrawals`. Subsequent `POST /api/v1/transfers/{id}/resolve` calls query `GET /finsim/v1/payments/{transactionId}-adj?leg=CREDIT` at the issuing bank and resend with the exact same `finsim:adjustment:<transactionId>:reversal` key if `404 LEG_NOT_FOUND`.
- **Definitive `422 REJECTED` (e.g., account closed `AC04` before compensation):** Withdrawal stays in `TransferState.UNKNOWN` with **`needsManualReview = true`**, `reasonCode` preserved, and `emittedBy = SOURCE`, matching ADR 0001's no-silent-loss guarantee.

### 5. Mapping withdrawals to `transfers`, `TransferState`, `PendingAction`, and traces

To satisfy `transfer_trace_events.transfer_id REFERENCES transfers(id) ON DELETE CASCADE` and keep existing trace/resolve/Cockpit infrastructure working uniformly:

- **Persistence model:** Each ATM withdrawal creates a header row in `transfers` (`id = transactionId`, `<= 60` chars, `from = <issuingBank>:<account>`, `to = <atmTerminal>:TERMINAL`, `amount = requestedAmount`, `currency`, `provenance = SYNTHETIC`) paired 1:1 with a new `atm_withdrawals` table (`transfer_id PRIMARY KEY REFERENCES transfers(id) ON DELETE CASCADE`) holding `requested_amount`, `dispensed_amount`, `unfulfilled_amount`, `hardware_state`, `adjustment_transaction_id`, `adjustment_idempotency_key`, and `conflicting_event_detected`.
- **`TransferState` lifecycle (never introducing `FAILED`):**
  - `CREATED -> ACCEPTED -> IN_PROGRESS` during withdrawal orchestration.
  - `DISPENSED` (`unfulfilled = 0`): transitions `IN_PROGRESS -> COMPLETED`.
  - `PARTIALLY_DISPENSED` (`0 < dispensed < requested` + compensating credit `COMPLETED`): transitions `IN_PROGRESS -> COMPLETED` (net debit equals `dispensedAmount`).
  - `NOT_DISPENSED` (`dispensed = 0` + full compensating credit `COMPLETED`): transitions `IN_PROGRESS -> REJECTED` (`emittedBy = DESTINATION`, carrying `DispenseResult.reasonCode` such as `ATM_CASSETTE_DEPLETED` or `ATM_HARDWARE_FAULT`, falling back to `MS03`).
  - Any transport timeout or non-terminal `DIAGNOSTICS_PENDING` physical response: transitions `IN_PROGRESS -> UNKNOWN`.
- **`PendingAction` & `/resolve` decision table:** Add `QUERY_DISPENSE` and `COMPENSATE_UNFULFILLED` to `PendingAction` (and OpenAPI `Transfer.pendingAction`):

| Stage / Unknown Cause | Issuing Bank (`STATUS_QUERY`) | ATM (`GET /finsim/v1/atm/dispenses/{id}`) | Action | Outcome |
|---|---|---|---|---|
| Debit timeout (`NONE`) | `404` or `REJECTED` | Not called | None (`$0` debited) | `REJECTED` |
| Debit timeout (`NONE`) | `COMPLETED` | `404 LEG_NOT_FOUND` (not sent) | Execute compensating `CREDIT` for full `requestedAmount` (ATM timed-out flow never dispenses cash asynchronously later) | `REJECTED` (once credit `COMPLETED`) or `COMPENSATE_UNFULFILLED` if credit times out |
| ATM dispense timeout (`QUERY_DISPENSE`) | `COMPLETED` | `404 LEG_NOT_FOUND` | Request never reached ATM (`dispensed = 0`); issue full compensating `CREDIT` | `REJECTED` (once credit `COMPLETED`) |
| ATM dispense timeout (`QUERY_DISPENSE`) | `COMPLETED` | `DISPENSED` | Complete withdrawal; no compensation | `COMPLETED` |
| ATM dispense timeout (`QUERY_DISPENSE`) | `COMPLETED` | `PARTIALLY_DISPENSED` | Issue compensating `CREDIT` for `unfulfilledAmount` | `COMPLETED` (once credit `COMPLETED`) |
| ATM dispense timeout (`QUERY_DISPENSE`) | `COMPLETED` | `NOT_DISPENSED` | Issue compensating `CREDIT` for `requestedAmount` | `REJECTED` (once credit `COMPLETED`) |
| ATM dispense timeout (`QUERY_DISPENSE`) | `COMPLETED` | `DIAGNOSTICS_PENDING` or query timeout | Physical truth not yet confirmed; wait | Stays `UNKNOWN` (`QUERY_DISPENSE`) |
| Compensation timeout (`COMPENSATE_UNFULFILLED`) | Query `{id}-adj?leg=CREDIT` -> `COMPLETED` | Authoritative | Finalize terminal state | `COMPLETED` (`dispensed > 0`) or `REJECTED` (`dispensed == 0`) |
| Compensation timeout (`COMPENSATE_UNFULFILLED`) | Query `{id}-adj?leg=CREDIT` -> `404` | Authoritative | Re-send `CREDIT` `{id}-adj` with `finsim:adjustment:{id}:reversal` | Re-evaluate (`COMPLETED`/`REJECTED`/`UNKNOWN`) |
| Compensation timeout (`COMPENSATE_UNFULFILLED`) | Query `{id}-adj?leg=CREDIT` -> `REJECTED` | Authoritative | Do not retry blindly | Stays `UNKNOWN`, `needsManualReview = true` |

*(Safety rationale: unlike bank-to-bank `RETRY_CREDIT` in [ADR 0001](0001-resolving-unknown-transfers.md), `/resolve` never re-sends a physical dispense command on ATM `404`, because ejecting cash asynchronously after a customer session timed out creates real-world loss. Instead, `404` on ATM status proves `$0` dispensed and triggers full compensation.)*

- **Trace events:** Record `WITHDRAWAL_REQUESTED`, `DEBIT_COMMITTED`, `DISPENSE_STATUS_CONFIRMED`, and `COMPENSATING_CREDIT_POSTED` via `TransferTraceRecorder` (`STAGE`, `OUTBOUND_CALL`, `FAULT_INJECTED`, `STATE_CHANGE`) tied to `transfers(id)`.

### 6. Fault simulation, Compose stacks, and SSRF allowlists

- Seed deterministic ATM fault injection rules via `finsim-sim` covering all 9 required failure scenarios: full dispense, mechanical jam partial dispense, pre-dispense failure, power loss after partial dispense, timeout after full dispense, lost ack after dispense, duplicate dispense confirmation, delayed notification, and cassette depletion.
- Package the sample ATM participant (`atm-01`, port `9005`) as an independent Docker container in **both** root `docker-compose.yml` and `deploy/docker-compose.yml`.
- Include the ATM service hostname (`atm-01`) in `finsim.registry.internal-hosts` / `FINSIM_REGISTRY_INTERNAL_HOSTS` (`application-docker.yml`, `docker-compose.prod.yml`, `.env.example`) so `BaseUrlValidator` and `ParticipantClient` permit internal Docker bridge routing when `allow-private-addresses=false`.

## Alternatives considered

| Option | Why not |
|---|---|
| Relax `05-reversal.hurl` and all 4 sample banks to allow partial `reversalOf` amounts | Breaks existing bank-transfer conformance invariant (`422 MS03` on amount mismatch) and forces breaking changes across Java, Python, Node, and Go banks. Using `reversalOf = null` with deterministic key `finsim:adjustment:{transactionId}:reversal` preserves backward compatibility. |
| Overload `POST /api/v1/networks/{networkId}/transfers` for ATM withdrawals | Mixes `ACCOUNT_CREDIT` semantics with physical `CASH_DISPENSE` and forces placeholder destination accounts instead of a dedicated withdrawal schema in OpenAPI/Swagger UI. |
| Allow ATM participants to return `"UNKNOWN"` on `/finsim/v1/atm/*` | Breaks the contract invariant ("Participants never report `UNKNOWN`"); `DIAGNOSTICS_PENDING` communicates unsettled physical state while FinSim keeps sole ownership of `TransferState.UNKNOWN`. |
| Put ATM endpoints under `/api/v1/*` inside `finsim-api` | Violates Locked Rule #1 and #33's requirement for an independent ATM container owning cassette inventory without sharing a database with FinSim. |
| Store ATM withdrawals only in a separate table unrelated to `transfers` | Breaks `transfer_trace_events.transfer_id REFERENCES transfers(id)` foreign key, `/api/v1/transfers/{id}/trace`, and Cockpit TraceWaterfall reuse. |
| Re-send physical dispense command during `/resolve` when ATM reports `404` | Unsafe for physical hardware: a delayed/abandoned ATM session must compensate funds rather than ejecting cash unattended later. |
| Add a `FAILED` transfer state for `NOT_DISPENSED` | Prohibited by Roadmap §5.3 (`COMPLETED` and `REJECTED` are the only terminal states). |

## Consequences

- **Easier:** Existing 4-endpoint `/finsim/v1/*` banks participate as ATM issuing banks with zero changes; traces, `/resolve`, SSRF checks, and Cockpit trace waterfalls work out-of-the-box.
- **Harder:** Introduces a `V6+` Flyway migration touching `registry_institutions` and `registry_institution_capabilities` plus `atm_withdrawals`, two new `PendingAction` enum values, dedicated ATM `ReasonCode` constants, and a new `CASH_DISPENSE` contract surface under `/finsim/v1/atm/*`.
- **Migration & governance:** Implementation updates `contract/finsim-v1.openapi.yaml` (consolidating inline `$ref`s), `InstitutionType`, `Capability`, `PendingAction`, `ReasonCode`, `POST /api/v1/networks/{networkId}/atm/withdrawals`, `finsim-sim`, `finsim-api`, `samples/`, and both Compose files after this ADR's 7-day comment period.
- **Locked rules touched:** Enforces Locked Rule #1 (adapter-only isolation, separate cassette state), #2 (capability routing via `CASH_DISPENSE`), #3 (deterministic compensation keys), and #4 (`UNKNOWN` reconciliation before resolution).

## Verification

- Unit & property tests in `finsim-core` / `finsim-sim`: conservation formula (`Requested == Dispensed + Unfulfilled`), scale/currency validation, duplicate & conflicting dispense rejection, deterministic seed replay across all 9 ATM fault scenarios, and cassette denomination bounds.
- API & Testcontainers integration tests in `finsim-api`: every row in the withdrawal `/resolve` decision table (including timeout and `422` rejection on compensating `CREDIT`), `ModularityTests`, `ArchitectureRulesTests`, and `DatabaseMigrationTests` verifying Flyway constraint updates.
- Contract & Compose verification: Spectral lint on updated `contract/finsim-v1.openapi.yaml`, `OpenApiDocumentationTests`, and end-to-end Docker Compose test across `finsim-api`, `bank-a`, `atm-01`, and `postgres`.
