import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { createFinSimApi } from "@/api/client";
import type { ConnectionMode, TransferResponse } from "@/api/types";
import { StateBadge } from "@/components/shared/StateBadge";
import { TraceWaterfall } from "@/features/traces/TraceWaterfall";
import { cn, formatMoney } from "@/lib/utils";

interface TracesViewProps {
  mode: ConnectionMode;
  history: TransferResponse[];
  selected: TransferResponse | null;
  onSelect: (tx: TransferResponse) => void;
  onUpdate: (tx: TransferResponse) => void;
}

export function TracesView({
  mode,
  history,
  selected,
  onSelect,
  onUpdate,
}: TracesViewProps) {
  const api = createFinSimApi(mode);
  const queryClient = useQueryClient();
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const traceQuery = useQuery({
    queryKey: ["trace", mode, selected?.transactionId, selected?.state],
    queryFn: () => api.getTrace(selected!.transactionId),
    enabled: Boolean(selected?.transactionId),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.resolveTransfer(id),
    onSuccess: (tx) => {
      onUpdate(tx);
      queryClient.invalidateQueries({ queryKey: ["trace", mode] });
    },
  });

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupId.trim()) return;
    setLookupError(null);
    try {
      const tx = await api.getTransfer(lookupId.trim());
      onUpdate(tx);
      onSelect(tx);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Transfer not found");
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Transfers & Lookup
        </h2>

        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            placeholder="Lookup transactionId..."
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </form>

        {lookupError && (
          <p className="font-mono text-xs text-rose-500">{lookupError}</p>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {history.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No transfers in this session yet. Execute one in Workbench or look up a transactionId above.
            </p>
          ) : (
            history.map((tx) => (
              <button
                key={tx.transactionId}
                type="button"
                onClick={() => onSelect(tx)}
                className={cn(
                  "flex w-full flex-col gap-1 py-2.5 px-2 text-left transition rounded-lg",
                  selected?.transactionId === tx.transactionId
                    ? "bg-sky-500/10"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {tx.transactionId}
                  </span>
                  <StateBadge state={tx.state} />
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                  <span>
                    {tx.from.institutionId} → {tx.to.institutionId}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(tx.money.amount, tx.money.currency)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <TraceWaterfall
            transfer={selected}
            trace={traceQuery.data}
            onResolve={(id) => resolveMutation.mutate(id)}
            resolving={resolveMutation.isPending}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-xs text-slate-500 dark:border-slate-800">
            Select a transfer to inspect its execution trace waterfall.
          </div>
        )}
      </div>
    </div>
  );
}
