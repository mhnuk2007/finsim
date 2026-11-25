import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Globe, Plus } from "lucide-react";
import { useState } from "react";
import { createFinSimApi } from "@/api/client";
import type { Capability, ConnectionMode, InstitutionType } from "@/api/types";
import { SyntheticBadge } from "@/components/shared/StateBadge";

interface NetworkViewProps {
  mode: ConnectionMode;
  networkId: string;
}

const ALL_CAPABILITIES: Capability[] = [
  "ACCOUNT_DEBIT",
  "ACCOUNT_CREDIT",
  "STATUS_QUERY",
];

export function NetworkView({ mode, networkId }: NetworkViewProps) {
  const api = createFinSimApi(mode);
  const queryClient = useQueryClient();

  const [id, setId] = useState("bank-c");
  const [name, setName] = useState("Synthetic Bank C");
  const [type, setType] = useState<InstitutionType>("BANK");
  const [baseUrl, setBaseUrl] = useState("http://localhost:9003");
  const [joinAfter, setJoinAfter] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const directoryQuery = useQuery({
    queryKey: ["directory", mode, networkId],
    queryFn: () => api.getNetworkDirectory(networkId),
  });

  const networksQuery = useQuery({
    queryKey: ["networks", mode],
    queryFn: () => api.listNetworks(),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const created = await api.registerInstitution({
        id,
        name,
        type,
        baseUrl,
        capabilities: ALL_CAPABILITIES,
      });
      if (joinAfter) {
        await api.addNetworkMember(networkId, created.id);
      }
      return created;
    },
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ["directory", mode, networkId] });
      queryClient.invalidateQueries({ queryKey: ["institutions", mode] });
      queryClient.invalidateQueries({ queryKey: ["networks", mode] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : "Registration failed"),
  });

  const directory = directoryQuery.data;
  const networks = networksQuery.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/* Networks Summary */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 text-sky-500" />
            <h2 className="text-sm font-semibold">Registered Networks</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {networks.map((n) => (
              <div
                key={n.id}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{n.id}</span>
                  <SyntheticBadge />
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {n.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-slate-500">
                  <span>scheme: {n.scheme.id}</span>
                  <span>currencies: {n.currencies.join(", ")}</span>
                  <span>members: {n.memberIds.length}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Directory */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" />
              <h2 className="text-sm font-semibold">
                Network Directory — <span className="font-mono">{networkId}</span>
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-500">
              GET /api/v1/networks/{networkId}/directory
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(directory?.participants ?? []).map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{p.id}</span>
                    <span className="text-slate-500">{p.name}</span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                      {p.status}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {p.baseUrl} · {p.type}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Register Institution */}
      <div className="h-fit space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold">Register Participant</h2>
        <p className="text-xs text-slate-500">
          Connect any service implementing the 4-endpoint{" "}
          <span className="font-mono">finsim/v1</span> contract.
        </p>

        <label className="block space-y-1 text-xs">
          <span className="text-slate-500">Institution ID</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-slate-500">Display Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-slate-500">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InstitutionType)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="BANK">BANK</option>
            <option value="PAYMENT_GATEWAY">PAYMENT_GATEWAY</option>
            <option value="MERCHANT">MERCHANT</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-slate-500">Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={joinAfter}
            onChange={(e) => setJoinAfter(e.target.checked)}
          />
          Auto-join <span className="font-mono">{networkId}</span> network
        </label>

        {errorMsg && <p className="font-mono text-xs text-rose-500">{errorMsg}</p>}

        <button
          type="button"
          disabled={registerMutation.isPending}
          onClick={() => registerMutation.mutate()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Register Institution
        </button>
      </div>
    </div>
  );
}
