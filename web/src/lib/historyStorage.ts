import type { ConnectionMode, TransferResponse } from "@/api/types";

const HISTORY_STORAGE_PREFIX = "finsim.transferHistory.v1";
const MAX_STORED_TRANSFERS = 40;

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getHistoryStorageKey(mode: ConnectionMode, apiBaseUrl = ""): string {
  const scope = mode === "live" ? apiBaseUrl.trim().replace(/\/+$/, "") || "default" : "demo";
  return `${HISTORY_STORAGE_PREFIX}:${mode}:${scope}`;
}

export function loadTransferHistory(
  mode: ConnectionMode,
  apiBaseUrl = "",
  storage?: Storage,
): TransferResponse[] {
  if (mode === "demo") {
    return [];
  }
  const store = getStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(getHistoryStorageKey(mode, apiBaseUrl));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TransferResponse =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as TransferResponse).transactionId === "string",
    );
  } catch {
    return [];
  }
}

export function saveTransferHistory(
  mode: ConnectionMode,
  transfers: TransferResponse[],
  apiBaseUrl = "",
  storage?: Storage,
): void {
  if (mode === "demo") {
    return;
  }
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.setItem(
      getHistoryStorageKey(mode, apiBaseUrl),
      JSON.stringify(transfers.slice(0, MAX_STORED_TRANSFERS)),
    );
  } catch {
    // Ignore storage quota / private mode errors
  }
}

export function clearTransferHistory(
  mode: ConnectionMode,
  apiBaseUrl = "",
  storage?: Storage,
): void {
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.removeItem(getHistoryStorageKey(mode, apiBaseUrl));
  } catch {
    // Ignore storage errors
  }
}

export function upsertTransferInList(
  prev: TransferResponse[],
  tx: TransferResponse,
  limit = MAX_STORED_TRANSFERS,
): TransferResponse[] {
  const idx = prev.findIndex((t) => t.transactionId === tx.transactionId);
  if (idx === -1) {
    return [tx, ...prev].slice(0, limit);
  }
  const next = [...prev];
  next[idx] = tx;
  return next;
}
