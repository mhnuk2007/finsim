import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createFinSimApi } from "@/api/client";
import type { ConnectionMode, FaultType } from "@/api/types";
import { FaultBadge } from "@/components/shared/StateBadge";

interface FaultsViewProps {
  mode: ConnectionMode;
}

export function FaultsView({ mode }: FaultsViewProps) {
  const api = createFinSimApi(mode);
  const queryClient = useQueryClient();

  const [target, setTarget] = useState("bank-b");
  const [type, setType] = useState<FaultType>("TIMEOUT");
  const [times, setTimes] = useState("1");
  const [delayMs, setDelayMs] = useState("500");
  const [probability, setProbability] = useState("1.0");
  const [seed, setSeed] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const faultsQuery = useQuery({
    queryKey: ["faults", mode],
    queryFn: () => api.listFaults(),
  });

  const institutionsQuery = useQuery({
    queryKey: ["institutions", mode],
    queryFn: () => api.listInstitutions(),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.addFault({
        target,
        type,
        times: times ? Number(times) : undefined,
        delayMs: type === "DELAY" && delayMs ? Number(delayMs) : undefined,
        probability: probability ? Number(probability) : 1.0,
        seed: seed.trim() ? Number(seed) : undefined,
      }),
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ["faults", mode] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : "Failed to add fault"),
  });

  const deleteMutation = useMutation({
    mutationFn: (faultId: string) => api.deleteFault(faultId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faults", mode] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const current = faultsQuery.data ?? [];
      for (const f of current) {
        if (f.faultId) {
          await api.deleteFault(f.faultId);
        }
      }
    },
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ["faults", mode] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : "Failed to clear faults"),
  });

  const faults = faultsQuery.data ?? [];
  const institutions = institutionsQuery.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Add Fault Rule
        </h2>

        <label htmlFor="fault-target" className="block space-y-1 text-xs">
          <span className="text-slate-500">Target Institution</span>
          <select
            id="fault-target"
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            {(institutions.length ? institutions : [{ id: "bank-a" }, { id: "bank-b" }]).map(
              (i) => (
                <option key={i.id} value={i.id}>
                  {i.id}
                </option>
              ),
            )}
          </select>
        </label>

        <label htmlFor="fault-type" className="block space-y-1 text-xs">
          <span className="text-slate-500">Fault Type</span>
          <select
            id="fault-type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as FaultType)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="TIMEOUT">TIMEOUT</option>
            <option value="DELAY">DELAY</option>
            <option value="DUPLICATE_DELIVERY">DUPLICATE_DELIVERY</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label htmlFor="fault-times" className="space-y-1 text-xs">
            <span className="text-slate-500">Times (optional)</span>
            <input
              id="fault-times"
              name="times"
              type="number"
              min={1}
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label htmlFor="fault-probability" className="space-y-1 text-xs">
            <span className="text-slate-500">Probability (0–1)</span>
            <input
              id="fault-probability"
              name="probability"
              type="number"
              step="0.1"
              min={0}
              max={1}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        <label htmlFor="fault-seed" className="block space-y-1 text-xs">
          <span className="text-slate-500">PRNG Seed (optional, deterministic)</span>
          <input
            id="fault-seed"
            name="seed"
            type="number"
            placeholder="e.g. 42"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        {type === "DELAY" && (
          <label htmlFor="fault-delay-ms" className="block space-y-1 text-xs">
            <span className="text-slate-500">Delay (ms)</span>
            <input
              id="fault-delay-ms"
              name="delayMs"
              type="number"
              min={50}
              step={50}
              value={delayMs}
              onChange={(e) => setDelayMs(e.target.value)}
              className="tabular-nums w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        )}

        {errorMsg && <p className="font-mono text-xs text-rose-500">{errorMsg}</p>}

        <button
          type="button"
          disabled={addMutation.isPending}
          onClick={() => addMutation.mutate()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Inject Fault Rule
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Active Fault Rules ({faults.length})
          </h2>
          {faults.length > 0 && (
            <button
              type="button"
              disabled={clearAllMutation.isPending}
              onClick={() => clearAllMutation.mutate()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:border-slate-700 dark:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {clearAllMutation.isPending ? "Clearing..." : "Clear All"}
            </button>
          )}
        </div>

        {faults.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-slate-800">
            No active faults. All outbound calls to participants will proceed normally.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 font-mono text-[11px] text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="py-2 pr-3">Fault ID</th>
                  <th className="py-2 pr-3">Target</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Params</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                {faults.map((f) => (
                  <tr key={f.faultId}>
                    <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                      {f.faultId}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">{f.target}</td>
                    <td className="py-2.5 pr-3">
                      <FaultBadge type={f.type} />
                    </td>
                    <td className="tabular-nums py-2.5 pr-3 text-slate-500">
                      p={f.probability ?? 1}
                      {f.times ? `, times=${f.times}` : ""}
                      {f.delayMs ? `, delay=${f.delayMs}ms` : ""}
                      {f.seed !== undefined && f.seed !== null ? `, seed=${f.seed}` : ""}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => f.faultId && deleteMutation.mutate(f.faultId)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-rose-500 hover:bg-rose-500/10 dark:border-slate-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
