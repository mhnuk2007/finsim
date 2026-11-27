import { describe, expect, it } from "vitest";
import type { TransferResponse } from "@/api/types";
import {
  clearTransferHistory,
  getHistoryStorageKey,
  loadTransferHistory,
  saveTransferHistory,
  upsertTransferInList,
} from "./historyStorage";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function makeTransfer(id: string, state: TransferResponse["state"] = "COMPLETED"): TransferResponse {
  return {
    transactionId: id,
    state,
    currentStage: "credit_destination",
    reasonCode: null,
    emittedBy: null,
    pendingAction: "NONE",
    needsManualReview: false,
    from: { institutionId: "bank-a", accountReference: "ACC-1" },
    to: { institutionId: "bank-b", accountReference: "ACC-2" },
    money: { amount: "100.00", currency: "USD" },
    reference: "TEST",
    stageHistory: [],
    provenance: "SYNTHETIC",
  };
}

describe("historyStorage", () => {
  it("persists and loads live transfer history per API base URL", () => {
    const store = createMemoryStorage();
    const tx1 = makeTransfer("tx-1", "UNKNOWN");
    const tx2 = makeTransfer("tx-2", "COMPLETED");

    saveTransferHistory("live", [tx2, tx1], "https://finsim.mhnuk2007.tech/", store);

    expect(loadTransferHistory("live", "https://finsim.mhnuk2007.tech", store)).toEqual([tx2, tx1]);
    expect(loadTransferHistory("live", "http://localhost:8080", store)).toEqual([]);
    expect(loadTransferHistory("demo", "", store)).toEqual([]);
  });

  it("handles corrupt storage entries gracefully and supports clearing", () => {
    const store = createMemoryStorage();
    store.setItem(getHistoryStorageKey("live", ""), "{not-json");
    expect(loadTransferHistory("live", "", store)).toEqual([]);

    saveTransferHistory("live", [makeTransfer("tx-9")], "", store);
    expect(loadTransferHistory("live", "", store)).toHaveLength(1);
    clearTransferHistory("live", "", store);
    expect(loadTransferHistory("live", "", store)).toEqual([]);
  });

  it("upserts transfers in-place when resolved without duplicating entries", () => {
    const initial = [makeTransfer("tx-2", "COMPLETED"), makeTransfer("tx-1", "UNKNOWN")];
    const updated = upsertTransferInList(initial, makeTransfer("tx-1", "COMPLETED"));
    expect(updated.map((t) => `${t.transactionId}:${t.state}`)).toEqual([
      "tx-2:COMPLETED",
      "tx-1:COMPLETED",
    ]);

    const prepended = upsertTransferInList(updated, makeTransfer("tx-3", "COMPLETED"));
    expect(prepended.map((t) => t.transactionId)).toEqual(["tx-3", "tx-2", "tx-1"]);
  });
});
