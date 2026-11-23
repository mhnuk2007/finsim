import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { useState } from "react";
import { ApiClientError, createFinSimApi } from "@/api/client";
import type { ConnectionMode, TransferResponse } from "@/api/types";
import { FaultBadge } from "@/components/shared/StateBadge";
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

  const [fromInst, setFromInst] = useState("bank-a");
  const [fromAcc, setFromAcc] = useState("ACC-1");
  const [toInst, setToInst] = useState("bank-b");
  const [toAcc, setToAcc] = useState("ACC-2");
  const [amount, setAmount] = useState("100.00");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("DEMO-001");
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey("tx"));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        setErrorMsg(`${err.status} ${err.code}: ${err.message}`);
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Transfer failed");
      }
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (txId: string) => api.resolveTransfer(txId),
    onSuccess: (tx) => {
      setErrorMsg(null);
      onTransferCreated(tx);
      refreshAll();
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Resolve failed");
    },
  });

  const quickToggleTimeout = async (institutionId: string) => {
    setErrorMsg(null);
    const existing = (faultsQuery.data ?? []).find((f) => f.target === institutionId);
    if (existing?.faultId) {
      await api.deleteFault(existing.faultId);
    } else {
      await api.addFault({
        target: institutionId,
        type: "TIMEOUT",
        times: 1,
        probability: 1.0,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["faults", mode] });
  };

  const runTimeoutScenario = async () => {
    setErrorMsg(null);
    const freshKey = generateIdempotencyKey("chaos");
    setIdempotencyKey(freshKey);
    await api.addFault({
      target: toInst,
      type: "TIMEOUT",
      times: 1,
      probability: 1.0,
    });
    queryClient.invalidateQueries({ queryKey: ["faults", mode] });
    try {
      const tx = await api.createTransfer(networkId, freshKey, {
        from: { institutionId: fromInst, accountReference: fromAcc },
        to: { institutionId: toInst, accountReference: toAcc },
        money: { amount: "50.00", currency },
        reference: "TIMEOUT-DEMO",
      });
      onTransferCreated(tx);
      refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Scenario failed");
    }
  };

  const participants = directoryQuery.data?.participants ?? [];
  const faults = faultsQuery.data ?? [];
  const demoBalances = mode === "demo" ? getDemoBalances() : null;

  return (
    <div className="space-y-4">
      {/* Top Row: Topology + Quick Chaos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Network Topology — <span className="font-mono">{networkId}</span>
              </h2>
              <p className="text-xs text-slate-500">
                Click any bank node to toggle a 1x <span className="font-mono">TIMEOUT</span> fault
              </p>
            </div>
            <button
              type="button"
              onClick={runTimeoutScenario}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Zap className="h-3.5 w-3.5" />
              1-Click: Timeout → UNKNOWN
            </button>
          </div>

          <TopologyCanvas
            participants={participants}
            faults={faults}
            activeTransfer={activeTransfer}
            onQuickToggleTimeout={quickToggleTimeout}
          />

          {demoBalances && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="font-semibold text-slate-500">Demo Balances:</span>
              {Object.entries(demoBalances).map(([acc, bal]) => (
                <span key={acc} className="tabular-nums font-mono text-slate-700 dark:text-slate-300">
                  {acc}: <strong>{formatMoney(bal.toFixed(2), "USD")}</strong>
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
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">From Institution</span>
                <select
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
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">From Account</span>
                <input
                  value={fromAcc}
                  onChange={(e) => setFromAcc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">To Institution</span>
                <select
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
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">To Account</span>
                <input
                  value={toAcc}
                  onChange={(e) => setToAcc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 space-y-1 text-xs">
                <span className="text-slate-500">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">Currency</span>
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span className="text-slate-500">Reference</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-500">
                  Idempotency-Key
                  <button
                    type="button"
                    onClick={() => setIdempotencyKey(generateIdempotencyKey("tx"))}
                    className="text-sky-500 hover:text-sky-400"
                    title="Generate new key"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </span>
                <input
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
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

          <button
            type="button"
            disabled={transferMutation.isPending}
            onClick={() => transferMutation.mutate()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {transferMutation.isPending ? "Orchestrating..." : "Send Transfer"}
          </button>
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
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Send a transfer or click <span className="font-semibold text-amber-500">1-Click: Timeout → UNKNOWN</span> above to watch FinSim's execution trace and ADR 0001 reconciliation.
          </p>
        </div>
      )}
    </div>
  );
}
