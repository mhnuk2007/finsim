# Sample bank (Go)

A standalone in-memory institution implementing the FinSim `finsim/v1` participant contract
([`contract/finsim-v1.openapi.yaml`](../../contract/finsim-v1.openapi.yaml)). It uses only the Go standard library
(`net/http`) and does not depend on any Java module.

## Prerequisites

Go 1.22 or newer (the router uses method and path patterns added in 1.22).

## Setup and run

```bash
cd samples/bank-go
go run .
```

The default port is `9004`; override it with `PORT`:

```bash
PORT=9010 go run .
```

## Synthetic accounts

| Account | Initial balance | Status |
|---|---:|---|
| `ACC-1` | USD 500.00 | Active |
| `ACC-2` | USD 100.00 | Active |
| `ACC-CLOSED` | USD 0.00 | Closed |

Everything is synthetic and held in memory; restarting the bank resets all state.

## Try it

```bash
curl http://localhost:9004/finsim/v1/institution/health
curl http://localhost:9004/finsim/v1/institution/capabilities

curl -i -X POST http://localhost:9004/finsim/v1/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-0001' \
  -d '{"transactionId":"tx-1","direction":"DEBIT","accountReference":"ACC-1","money":{"amount":"100.00","currency":"USD"},"reference":"DEMO-001","provenance":"SYNTHETIC"}'

# Repeat the same command: 200 with the original result, no second debit.
# Change the amount but keep the key: 409 IDEMPOTENCY_CONFLICT.

curl 'http://localhost:9004/finsim/v1/payments/tx-1?leg=DEBIT'
```

## Test

```bash
go test ./...
go test -race ./...   # optional: also checks the concurrency tests for data races
```

## Behavior notes

- **Exact money.** Amounts are parsed from decimal strings into `int64` counts of 1e-8 units (the contract allows up
  to 8 decimal places). No floating point is used anywhere.
- **Concurrency.** Balances, leg records and the idempotency store share one `sync.RWMutex`; a payment is checked
  and applied inside a single critical section, so concurrent requests cannot double-apply or overdraw.
- **Idempotency.** `Idempotency-Key` (8 to 128 characters) is required (`400 MISSING_IDEMPOTENCY_KEY`). First use returns
  `201`; the same key with an identical body returns `200` with the original result; a different body returns
  `409 IDEMPOTENCY_CONFLICT`. Replayed rejections return the same `422`.
- **Rejections** are `422` with a reason code: `AC01` unknown account, `AC04` closed account, `AM02` non-positive
  amount, `AM03` unsupported currency, `AM04` insufficient funds, `DUPL` duplicate leg or reversal, `MS03`
  mismatched reversal. Rejected legs are visible through the status endpoint as `REJECTED`.
- **Validation.** Unknown fields, malformed JSON, non-`SYNTHETIC` provenance and bad amounts return
  `400 INVALID_REQUEST`.

To check conformance, run the shared suite: `scripts/conformance.sh http://localhost:9004`.
