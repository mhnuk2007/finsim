import { beforeEach, describe, expect, it } from "vitest";
import { DemoApiError, demoEngine, getDemoBalances, resetDemoEngine } from "./demoEngine";

describe("demoEngine (ADR 0001 invariants)", () => {
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
    expect(() =>
      demoEngine.createTransfer("sandbox", "key-timeout", {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "50.00", currency: "USD" },
        reference: "TIMEOUT-001",
      }),
    ).toThrowError(DemoApiError);

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
});
