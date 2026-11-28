# ADR 0003: Virtual Clock HTTP API and Shared Simulation Control Guard

- **Status:** Proposed
- **Date:** 2026-11-28
- **Deciders:** @mhnuk2007, @innocentjasmine
- **Comment period ends:** 2026-12-05

## Context

Issue #27 (merged via PR #185) added the zero-dependency discrete-event `VirtualClock` (`DiscreteVirtualClock`) and `finsim/scenario/v1` `ADVANCE_TIME` support in `finsim-sim`, implementing **Roadmap Correction 5 ("Two Clocks Rule")**. However, `finsim-api` still exposes no HTTP endpoints for integration tests, the CLI, or the Web Simulation Cockpit (`web/`) to inspect or advance simulated time.

At the same time, two architectural and security constraints shape how `finsim-api` must expose simulation controls:

1. **Unauthenticated public surface in hosted demos (#173, #177):** Per `SECURITY.md`, `/api/v1/*` intentionally carries no authentication. Because `docker-compose.prod.yml` exposes `/api/*` via Caddy (configured with `application-prod.yml`), exposing mutating simulation-control routes unconditionally in `prod` would allow anonymous visitors to skew the shared virtual clock (`POST /api/v1/clock/advance`) or reset/mutate shared simulation state in #32 (`POST /api/v1/simulations/reset`, `/restore`, `/snapshots`).
2. **Spring Modulith and ArchUnit module boundaries (`finsim-api`):** Currently `TransferConfiguration` in `finsim.transfer.internal` provides `@Bean @ConditionalOnMissingBean Clock` (`Clock.systemUTC()`), which is injected by `TransferOrchestrator` and `FaultService`. Because `transfer.internal` is module-private under `ModularityTests` (`ApplicationModules.verify()`) and `ArchitectureRulesTests`, virtual-clock REST endpoints and shared control guards must live in a dedicated top-level module rather than inside `transfer.internal`, while preserving Two Clocks separation between business/virtual time and host wall-clock observability/security time.

This ADR covers issue #173 and establishes the shared guard and Spring Modulith boundary reused by #32. Broader hardening of existing non-control routes (`/api/v1/registry`, `/api/v1/faults`, `/api/v1/transfers`) is tracked separately in #177.

## Decision

### 1. Dedicated `io.github.mhnuk2007.finsim.simulation` Top-Level Module

Add a new top-level Spring Modulith module `io.github.mhnuk2007.finsim.simulation` in `finsim-api`:

- Public module API (`io.github.mhnuk2007.finsim.simulation`): configuration properties (`finsim.simulation.*`), the shared simulation-control guard abstraction, and typed port/service contracts usable by sibling modules (including future #32 snapshot/reset/restore controllers).
- Module internals (`...simulation.internal` / `...simulation.web`): shared `VirtualClock` lifecycle/serialization lock management, guard enforcement, exception handling, and `/api/v1/clock*` REST controllers.
- Keep `TransferConfiguration`'s wall-clock `Clock.systemUTC()` bean and `System.nanoTime()` metrics untouched for host observability, latency (`durationMs`), audit telemetry, and security checks (Roadmap Correction 5: "Two Clocks Rule"). Virtual time is accessed explicitly through `VirtualClock` (or `VirtualClock.asJavaClock()` only where a domain component intentionally opts into virtual business time).

### 2. Shared Production Control Guard (`finsim.simulation.control-enabled`)

Mirroring `finsim.registry.allow-private-addresses`:

- Add `finsim.simulation.control-enabled` (env var `FINSIM_SIMULATION_CONTROL_ENABLED`):
  - Default `true` in `finsim-api/src/main/resources/application.yml` (local development, Testcontainers, CI).
  - Default `false` in `finsim-api/src/main/resources/application-prod.yml` (`${FINSIM_SIMULATION_CONTROL_ENABLED:false}`).
- When `control-enabled=false`, mutating simulation-control endpoints (`POST /api/v1/clock/advance` in #173, and future #32 `POST /api/v1/simulations/reset`, `/restore`, `/snapshots`, plus any future `POST /api/v1/scenarios/run`) reject requests with:
  - HTTP **`403 FORBIDDEN`**
  - OpenAPI `Error` JSON payload (`code: "SIMULATION_CONTROL_DISABLED"`, descriptive `message`).
- Read-only `GET /api/v1/clock` remains enabled regardless of `control-enabled` so clients can display virtual clock state safely and inspect `"controlEnabled"` to disable mutating UI controls in hosted `prod` mode.

### 3. Virtual Clock REST Endpoints (`contract/finsim-v1.openapi.yaml`)

Add two endpoints under `/api/v1/clock` documented in `contract/finsim-v1.openapi.yaml`:

| Method | Path | Behavior & Status Codes |
| :--- | :--- | :--- |
| `GET` | `/api/v1/clock` | Returns `200 OK` (`VirtualClockState`) containing `{ virtualNow, baseline, pendingEvents, controlEnabled }`. Always accessible (read-only). |
| `POST` | `/api/v1/clock/advance` | Guarded by `finsim.simulation.control-enabled` (`403 SIMULATION_CONTROL_DISABLED` when `false`). Serialized behind the clock lock, validates `AdvanceClockRequest`, advances `VirtualClock` without `Thread.sleep`, drains due scheduled events deterministically, and returns `200 OK` (`AdvanceClockResponse`) containing `{ previousVirtualTime, virtualNow, drainedEvents }`. |

#### Request & Validation Semantics (`POST /api/v1/clock/advance`)

- `AdvanceClockRequest` accepts optional ISO-8601 `advanceBy` (`Duration` string, e.g. `"PT24H"`) and optional ISO-8601 UTC `advanceTo` (`date-time` string, e.g. `"2026-01-02T00:00:00Z"`).
- **Strict XOR & monotonicity:** exactly one of `advanceBy` or `advanceTo` must be provided. Returning both, neither, malformed ISO-8601 syntax, non-positive `advanceBy` (`<= 0`), or backward `advanceTo` (`< virtualNow`) fails with HTTP **`400 BAD_REQUEST`** returning an OpenAPI `Error` payload with `code: "INVALID_REQUEST"`.
- **Concurrency safety:** clock advance operations execute atomically under the clock's serialization lock so concurrent `POST /api/v1/clock/advance` calls never double-drain scheduled events or observe torn `{ previousVirtualTime, virtualNow }` responses.

### 4. Related Cleanup (Implementation PR Scope)

The implementation PR for #173 will also fold in the two non-blocking `DiscreteVirtualClock.restore()` handle-lifecycle cleanups noted during PR #185 review (checking `entry.owner == this` before mutating state and marking evicted post-snapshot handles `cancelled = true`).

## Alternatives considered

| Option | Why not |
| :--- | :--- |
| Register `VirtualClock` and `/api/v1/clock*` inside `finsim.transfer.internal` | Violates `ModularityTests` / `ArchitectureRulesTests` boundaries once `#32` or other modules need simulation controls, and couples payment orchestration internals to clock lifecycle. |
| Replace `TransferConfiguration`'s `@Bean Clock` globally with `VirtualClock.asJavaClock()` | Violates Roadmap Correction 5 ("Two Clocks Rule"): security token/TTL checks and host telemetry (`durationMs`, audit `at`) must remain on wall-clock time. |
| Hide mutating routes with `@ConditionalOnProperty` returning Spring `404` when disabled | Conflates missing/unknown endpoints with intentionally policy-disabled controls, prevents clean `Error` (`SIMULATION_CONTROL_DISABLED`) diagnostics, and loses uniform UI discovery unless handled separately. `403 FORBIDDEN` + `controlEnabled` flag makes disabled state explicit. |
| Leave `/api/v1/clock/advance` enabled in `application-prod.yml` until #177 lands | Leaves hosted demos immediately vulnerable to anonymous clock skew; enabling `finsim.simulation.control-enabled` now provides safe defaults immediately and stays orthogonal to #177. |

## Consequences

- **Easier:** Unblocks #173 and #32 with a clear Spring Modulith boundary, shared prod safety guard, deterministic concurrent `/advance` behavior, and explicit UI readiness (`controlEnabled`) for the Web Cockpit.
- **Harder / riskier:** Operators who deploy using `prod` profile and explicitly want interactive time control in a private demo must set `FINSIM_SIMULATION_CONTROL_ENABLED=true` and restrict ingress accordingly. Meanwhile, existing routes covered by #177 remain independent of this guard.
- **Migration / docs:** Update `contract/finsim-v1.openapi.yaml`, `application.yml`, `application-prod.yml`, and `docs/architecture/virtual-clock.md` alongside the #173 implementation PR.
- **Locked rules touched:** Preserves Two Clocks Rule (Roadmap Correction 5), Spring Modulith / ArchUnit module encapsulation, and deterministic simulation timing; makes no changes to `/finsim/v1/*` participant protocol endpoints or monetary conservation/idempotency invariants.

## Verification

- **OpenAPI / Contract lint:** Spectral validation against `contract/finsim-v1.openapi.yaml` passes (`lint-contract` CI workflow).
- **Module boundaries:** `ModularityTests` and `ArchitectureRulesTests` pass with the new `finsim.simulation` top-level module.
- **Spring Boot / MockMvc & integration tests (#173 implementation PR):**
  - `GET /api/v1/clock` returns `200 OK` with `virtualNow`, `baseline`, `pendingEvents`, and `controlEnabled` under both `control-enabled=true` and `control-enabled=false`.
  - `POST /api/v1/clock/advance` advances deterministically on valid `advanceBy` and `advanceTo`, drains scheduled callbacks, and returns `{ previousVirtualTime, virtualNow, drainedEvents }`.
  - `POST /api/v1/clock/advance` returns `400 INVALID_REQUEST` when both/neither fields are supplied, syntax is invalid, `advanceBy <= 0`, or `advanceTo < virtualNow`.
  - Under `application-prod.yml` default (`control-enabled=false`), `POST /api/v1/clock/advance` returns `403 FORBIDDEN` (`code: "SIMULATION_CONTROL_DISABLED"`).
  - Concurrency test confirms parallel `/api/v1/clock/advance` requests serialize cleanly without double-draining or inconsistent timestamps.
- **Full build:** `./gradlew spotlessCheck build` passes locally and in CI with DCO sign-off.
