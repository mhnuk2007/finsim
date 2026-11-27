import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  HelpCircle,
  Play,
  RefreshCw,
  Repeat,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { ApiClientError, createFinSimApi } from "@/api/client";
import type { ConnectionMode, TransferResponse } from "@/api/types";
import { FaultBadge } from "@/components/shared/StateBadge";
import { useToast } from "@/components/shared/Toast";
import { TraceWaterfall } from "@/features/traces/TraceWaterfall";
import { TopologyCanvas } from "@/features/workbench/TopologyCanvas";
import { formatMoney, generateIdempotencyKey } from "@/lib/utils";
import { getDemoBalances } from "@/mocks/demoEngine";

interface WorkbenchViewProps {
  mode: ConnectionMode;
  networkId: string;
  activeTransfer: TransferResponse | null;
  onTransferCreated: (tx: TransferResponse) => void;
}

export function WorkbenchView({
  mode,
  networkId,
  activeTransfer,
  onTransferCreated,
}: WorkbenchViewProps) {
  const api = createFinSimApi(mode);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [fromInst, setFromInst] = useState("bank-a");
  const [fromAcc, setFromAcc] = useState("ACC-1");
  const [toInst, setToInst] = useState("bank-b");
  const [toAcc, setToAcc] = useState("ACC-2");
  const [amount, setAmount] = useState("100.00");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("DEMO-001");
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey("tx"));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const directoryQuery = useQuery({
    queryKey: ["directory", mode, networkId],
    queryFn: () => api.getNetworkDirectory(networkId),
  });

  const faultsQuery = useQuery({
    queryKey: ["faults", mode],
    queryFn: () => api.listFaults(),
  });

  const traceQuery = useQuery({
    queryKey: ["trace", mode, activeTransfer?.transactionId, activeTransfer?.state],
    queryFn: () => api.getTrace(activeTransfer!.transactionId),
    enabled: Boolean(activeTransfer?.transactionId),
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["faults", mode] });
    queryClient.invalidateQueries({ queryKey: ["trace", mode] });
  };

  const clearAllFaults = async () => {
    const current = faultsQuery.data ?? [];
    for (const f of current) {
      if (f.faultId) {
        await api.deleteFault(f.faultId);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["faults", mode] });
  };

  const transferMutation = useMutation({
    mutationFn: () =>
      api.createTransfer(networkId, idempotencyKey, {
        from: { institutionId: fromInst, accountReference: fromAcc },
        to: { institutionId: toInst, accountReference: toAcc },
        money: { amount, currency },
        reference,
      }),
    onSuccess: (tx) => {
      setErrorMsg(null);
      onTransferCreated(tx);
      refreshAll();
      if (tx.state === "COMPLETED") {
        showToast(
          `Transfer ${tx.transactionId} completed (${formatMoney(tx.money.amount, tx.money.currency)})`,
          "success",
        );
      } else if (tx.state === "UNKNOWN") {
        showToast(
          `Transfer ${tx.transactionId} entered UNKNOWN state (reconciliation required)`,
          "warning",
        );
      } else {
        showToast(`Transfer ${tx.transactionId} state: ${tx.state}`, "info");
      }
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        const msg = `${err.status} ${err.code}: ${err.message}`;
        setErrorMsg(msg);
        showToast(msg, "error");
      } else {
        const msg = err instanceof Error ? err.message : "Transfer failed";
        setErrorMsg(msg);
        showToast(msg, "error");
      }
    },
  });

  const replayMutation = useMutation({
    mutationFn: () =>
      api.createTransfer(networkId, idempotencyKey, {
        from: { institutionId: fromInst, accountReference: fromAcc },
        to: { institutionId: toInst, accountReference: toAcc },
        money: { amount, currency },
        reference,
      }),
    onSuccess: (tx) => {
      setErrorMsg(null);
      onTransferCreated(tx);
      refreshAll();
      showToast(
        `Replay 200 OK: returned existing transfer ${tx.transactionId}`,
        "success",
      );
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        const msg = `${err.status} ${err.code}: ${err.message}`;
        setErrorMsg(msg);
        showToast(msg, "error");
      } else {
        const msg = err instanceof Error ? err.message : "Replay failed";
        setErrorMsg(msg);
        showToast(msg, "error");
      }
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (txId: string) => api.resolveTransfer(txId),
    onSuccess: (tx) => {
      setErrorMsg(null);
      onTransferCreated(tx);
      refreshAll();
      showToast(`Transfer ${tx.transactionId} resolved (${tx.state})`, "success");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Resolve failed";
      setErrorMsg(msg);
      showToast(msg, "error");
    },
  });

  const quickToggleTimeout = async (institutionId: string) => {
    setErrorMsg(null);
    const existing = (faultsQuery.data ?? []).find((f) => f.target === institutionId);
    if (existing?.faultId) {
      await api.deleteFault(existing.faultId);
      showToast(`Cleared fault on ${institutionId}`, "info");
    } else {
      await api.addFault({
        target: institutionId,
        type: "TIMEOUT",
        times: 1,
        probability: 1.0,
      });
      showToast(`Injected 1x TIMEOUT fault on ${institutionId}`, "warning");
    }
    queryClient.invalidateQueries({ queryKey: ["faults", mode] });
  };

  const runHappyPathPreset = async () => {
    setErrorMsg(null);
    try {
      await clearAllFaults();
      setFromInst("bank-a");
      setFromAcc("ACC-1");
      setToInst("bank-b");
      setToAcc("ACC-2");
      setAmount("100.00");
      setCurrency("USD");
      setReference("HAPPY-PATH");
      const freshKey = generateIdempotencyKey("happy");
      setIdempotencyKey(freshKey);

      const tx = await api.createTransfer(networkId, freshKey, {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "100.00", currency: "USD" },
        reference: "HAPPY-PATH",
      });
      onTransferCreated(tx);
      refreshAll();
      showToast(`Transfer ${tx.transactionId} completed ($100.00)`, "success");
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? `${err.status} ${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Preset failed";
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  };

  const runTimeoutPreset = async () => {
    setErrorMsg(null);
    try {
      await clearAllFaults();
      await api.addFault({
        target: "bank-b",
        type: "TIMEOUT",
        times: 1,
        probability: 1.0,
      });
      queryClient.invalidateQueries({ queryKey: ["faults", mode] });

      setFromInst("bank-a");
      setFromAcc("ACC-1");
      setToInst("bank-b");
      setToAcc("ACC-2");
      setAmount("50.00");
      setCurrency("USD");
      setReference("TIMEOUT-DEMO");
      const freshKey = generateIdempotencyKey("chaos");
      setIdempotencyKey(freshKey);

      const tx = await api.createTransfer(networkId, freshKey, {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "50.00", currency: "USD" },
        reference: "TIMEOUT-DEMO",
      });
      onTransferCreated(tx);
      refreshAll();
      if (tx.state === "UNKNOWN") {
        showToast(
          `Transfer ${tx.transactionId} hit UNKNOWN state (reconciliation required)`,
          "warning",
        );
      } else {
        showToast(`Transfer ${tx.transactionId} finished with state ${tx.state}`, "info");
      }
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? `${err.status} ${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Scenario failed";
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  };

  const runDuplicateDeliveryPreset = async () => {
    setErrorMsg(null);
    try {
      await clearAllFaults();
      await api.addFault({
        target: "bank-b",
        type: "DUPLICATE_DELIVERY",
        times: 1,
        probability: 1.0,
      });
      queryClient.invalidateQueries({ queryKey: ["faults", mode] });

      setFromInst("bank-a");
      setFromAcc("ACC-1");
      setToInst("bank-b");
      setToAcc("ACC-2");
      setAmount("25.00");
      setCurrency("USD");
      setReference("DUP-DELIVERY");
      const freshKey = generateIdempotencyKey("dup");
      setIdempotencyKey(freshKey);

      const tx = await api.createTransfer(networkId, freshKey, {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "25.00", currency: "USD" },
        reference: "DUP-DELIVERY",
      });
      onTransferCreated(tx);
      refreshAll();
      showToast(
        `Transfer ${tx.transactionId} completed ($25.00) with duplicate delivery verified`,
        "success",
      );
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? `${err.status} ${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Scenario failed";
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  };

  const participants = directoryQuery.data?.participants ?? [];
  const faults = faultsQuery.data ?? [];
  const demoBalances = mode === "demo" ? getDemoBalances() : null;

  return (
    <div className="space-y-4">
      {/* Top Row: Topology + Guided Chaos Presets */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Network Topology — <span className="font-mono">{networkId}</span>
              </h2>
              <p className="text-xs text-slate-500">
                Click bank to toggle TIMEOUT or pick a chaos preset:
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={runHappyPathPreset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                title="Clears active faults & sends $100.00 bank-a -> bank-b"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Happy Path ($100)
              </button>
              <button
                type="button"
                onClick={runTimeoutPreset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                title="Injects 1x TIMEOUT on bank-b & sends $50.00 -> UNKNOWN"
              >
                <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Timeout → UNKNOWN ($50)
              </button>
              <button
                type="button"
                onClick={runDuplicateDeliveryPreset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-300"
                title="Injects 1x DUPLICATE_DELIVERY on bank-b & sends $25.00"
              >
                <Copy className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                Duplicate Delivery ($25)
              </button>
            </div>
          </div>

          <TopologyCanvas
            participants={participants}
            faults={faults}
            activeTransfer={activeTransfer}
            onQuickToggleTimeout={quickToggleTimeout}
            balances={demoBalances ?? undefined}
            currency={activeTransfer?.money.currency ?? currency ?? "USD"}
          />

          {demoBalances && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="font-semibold text-slate-500">Demo Balances:</span>
              {Object.entries(demoBalances).map(([acc, bal]) => (
                <span key={acc} className="tabular-nums font-mono text-slate-700 dark:text-slate-300">
                  {acc}: <strong>{formatMoney(bal.toFixed(2), activeTransfer?.money.currency ?? "USD")}</strong>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Transfer Runner */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Execute Transfer
            </h2>

            <div className="grid grid-cols-2 gap-2">
              <label htmlFor="tx-from-inst" className="space-y-1 text-xs">
                <span className="text-slate-500">From Institution</span>
                <select
                  id="tx-from-inst"
                  name="fromInstitutionId"
                  value={fromInst}
                  onChange={(e) => setFromInst(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {(participants.length ? participants : [{ id: "bank-a" }, { id: "bank-b" }]).map(
                    (p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label htmlFor="tx-from-acc" className="space-y-1 text-xs">
                <span className="text-slate-500">From Account</span>
                <input
                  id="tx-from-acc"
                  name="fromAccountReference"
                  value={fromAcc}
                  onChange={(e) => setFromAcc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label htmlFor="tx-to-inst" className="space-y-1 text-xs">
                <span className="text-slate-500">To Institution</span>
                <select
                  id="tx-to-inst"
                  name="toInstitutionId"
                  value={toInst}
                  onChange={(e) => setToInst(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {(participants.length ? participants : [{ id: "bank-a" }, { id: "bank-b" }]).map(
                    (p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label htmlFor="tx-to-acc" className="space-y-1 text-xs">
                <span className="text-slate-500">To Account</span>
                <input
                  id="tx-to-acc"
                  name="toAccountReference"
                  value={toAcc}
                  onChange={(e) => setToAcc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label htmlFor="tx-amount" className="col-span-2 space-y-1 text-xs">
                <span className="text-slate-500">Amount</span>
                <input
                  id="tx-amount"
                  name="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label htmlFor="tx-currency" className="space-y-1 text-xs">
                <span className="text-slate-500">Currency</span>
                <input
                  id="tx-currency"
                  name="currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label htmlFor="tx-reference" className="space-y-1 text-xs">
                <span className="text-slate-500">Reference</span>
                <input
                  id="tx-reference"
                  name="reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between text-slate-500">
                  <label htmlFor="tx-idempotency-key">Idempotency-Key</label>
                  <button
                    type="button"
                    onClick={() => setIdempotencyKey(generateIdempotencyKey("tx"))}
                    className="text-sky-500 hover:text-sky-400"
                    title="Generate new key"
                    aria-label="Generate new idempotency key"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
                <input
                  id="tx-idempotency-key"
                  name="idempotencyKey"
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            {faults.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Active faults:</span>
                {faults.map((f) => (
                  <span key={f.faultId} className="inline-flex items-center gap-1">
                    <span className="font-mono">{f.target}</span>
                    <FaultBadge type={f.type} />
                  </span>
                ))}
              </div>
            )}

            {errorMsg && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 font-mono text-[11px] text-rose-600 dark:text-rose-300">
                {errorMsg}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={transferMutation.isPending || replayMutation.isPending}
              onClick={() => transferMutation.mutate()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {transferMutation.isPending ? "Orchestrating..." : "Send Transfer"}
            </button>
            <button
              type="button"
              disabled={transferMutation.isPending || replayMutation.isPending}
              onClick={() => replayMutation.mutate()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
              title="Re-submit using current Idempotency-Key"
            >
              <Repeat className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              Replay Key
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Row: Active Transfer Trace Waterfall */}
      {activeTransfer ? (
        <TraceWaterfall
          transfer={activeTransfer}
          trace={traceQuery.data}
          onResolve={(id) => resolveMutation.mutate(id)}
          resolving={resolveMutation.isPending}
        />
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Send a transfer or select a preset above (e.g.{" "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              Timeout → UNKNOWN
            </span>
            ) to observe execution traces and ADR 0001 forward-recovery.
          </p>

          <div>
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/70"
            >
              <HelpCircle className="h-3.5 w-3.5 text-sky-500" />
              What is FinSim? How ADR 0001 works
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showGuide ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {showGuide && (
            <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-4 text-left text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    1. Safe Synthetic Network
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    FinSim simulates two-leg bank transfers (debit source → credit destination)
                    between synthetic banks using <span className="font-mono">wf.transfer.v1</span>.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    2. Timeout ≠ Failed (UNKNOWN)
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    When a bank times out, FinSim enters <span className="font-mono">UNKNOWN</span>{" "}
                    and blocks blind retries (<span className="font-mono">409</span>) so money is
                    never double-spent.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    3. Ground-Truth Resolution
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Clicking <strong>Resolve Transfer</strong> queries participant status endpoints
                    to forward-recover (<span className="font-mono">COMPLETED</span>) or safely
                    reverse/reject.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
