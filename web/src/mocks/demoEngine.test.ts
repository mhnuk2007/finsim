import { beforeEach, describe, expect, it } from "vitest";
import { createFinSimApi } from "../api/client";
import {
  DemoApiError,
  demoEngine,
  getDemoBalances,
  resetDemoEngine,
} from "./demoEngine";

describe("demoEngine (ADR 0001 invariants & Presets)", () => {
  beforeEach(() => {
    resetDemoEngine();
  });

  it("conserves total balance on a normal transfer", () => {
    const before = Object.values(getDemoBalances()).reduce((a, b) => a + b, 0);

    const tx = demoEngine.createTransfer("sandbox", "key-1", {
      from: { institutionId: "bank-a", accountReference: "ACC-1" },
      to: { institutionId: "bank-b", accountReference: "ACC-2" },
      money: { amount: "100.00", currency: "USD" },
      reference: "TEST-001",
    });

    expect(tx.state).toBe("COMPLETED");
    const after = Object.values(getDemoBalances()).reduce((a, b) => a + b, 0);
    expect(after).toBe(before);
    expect(getDemoBalances()["bank-a:ACC-1"]).toBe(900);
    expect(getDemoBalances()["bank-b:ACC-2"]).toBe(600);
  });

  it("moves to UNKNOWN on credit TIMEOUT, blocks retry with 409, and forward-recovers on resolve", () => {
    const before = Object.values(getDemoBalances()).reduce((a, b) => a + b, 0);

    demoEngine.addFault({ target: "bank-b", type: "TIMEOUT", times: 1, probability: 1.0 });

    const tx = demoEngine.createTransfer("sandbox", "key-timeout", {
      from: { institutionId: "bank-a", accountReference: "ACC-1" },
      to: { institutionId: "bank-b", accountReference: "ACC-2" },
      money: { amount: "50.00", currency: "USD" },
      reference: "TIMEOUT-001",
    });

    expect(tx.state).toBe("UNKNOWN");
    expect(tx.pendingAction).toBe("RETRY_CREDIT");

    // Retrying while UNKNOWN must fail with 409 RECONCILIATION_REQUIRED
    try {
      demoEngine.createTransfer("sandbox", "key-timeout", {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "50.00", currency: "USD" },
        reference: "TIMEOUT-001",
      });
      expect.unreachable("should have thrown 409");
    } catch (e) {
      expect(e).toBeInstanceOf(DemoApiError);
      expect((e as DemoApiError).status).toBe(409);
      expect((e as DemoApiError).code).toBe("RECONCILIATION_REQUIRED");
    }

    // Resolve forward-recovers the credit leg
    const resolved = demoEngine.resolveTransfer(tx.transactionId);
    expect(resolved.state).toBe("COMPLETED");
    expect(resolved.pendingAction).toBe("NONE");

    const after = Object.values(getDemoBalances()).reduce((a, b) => a + b, 0);
    expect(after).toBe(before);

    const trace = demoEngine.getTrace(tx.transactionId);
    expect(trace.events.some((e) => e.kind === "FAULT_INJECTED")).toBe(true);
    expect(trace.events.some((e) => e.stage === "RESOLUTION")).toBe(true);
  });

  it("preset: duplicate delivery executes two outbound credit calls but only increases balance once", () => {
    const beforeAcc2 = getDemoBalances()["bank-b:ACC-2"];

    demoEngine.addFault({
      target: "bank-b",
      type: "DUPLICATE_DELIVERY",
      times: 1,
      probability: 1.0,
    });

    const tx = demoEngine.createTransfer("sandbox", "key-dup", {
      from: { institutionId: "bank-a", accountReference: "ACC-1" },
      to: { institutionId: "bank-b", accountReference: "ACC-2" },
      money: { amount: "25.00", currency: "USD" },
      reference: "DUP-DELIVERY",
    });

    expect(tx.state).toBe("COMPLETED");
    expect(getDemoBalances()["bank-b:ACC-2"]).toBe(beforeAcc2 + 25);

    const trace = demoEngine.getTrace(tx.transactionId);
    const creditCalls = trace.events.filter(
      (e) => e.kind === "OUTBOUND_CALL" && e.stage === "CREDIT_LEG",
    );
    expect(creditCalls.length).toBe(2);
    expect(creditCalls[1].response).toMatchObject({ idempotentReplay: true });
  });

  it("replay key: returns 200 OK on COMPLETED transfer with same idempotency key", () => {
    const tx1 = demoEngine.createTransfer("sandbox", "key-replay-ok", {
      from: { institutionId: "bank-a", accountReference: "ACC-1" },
      to: { institutionId: "bank-b", accountReference: "ACC-2" },
      money: { amount: "100.00", currency: "USD" },
      reference: "REPLAY-OK",
    });
    expect(tx1.state).toBe("COMPLETED");

    // Replay with identical key and body returns original transfer
    const tx2 = demoEngine.createTransfer("sandbox", "key-replay-ok", {
      from: { institutionId: "bank-a", accountReference: "ACC-1" },
      to: { institutionId: "bank-b", accountReference: "ACC-2" },
      money: { amount: "100.00", currency: "USD" },
      reference: "REPLAY-OK",
    });
    expect(tx2.transactionId).toBe(tx1.transactionId);
    expect(tx2.state).toBe("COMPLETED");
  });

  it("api client: checkHealth returns true in demo mode", async () => {
    const api = createFinSimApi("demo");
    const ok = await api.checkHealth();
    expect(ok).toBe(true);
  });
});
