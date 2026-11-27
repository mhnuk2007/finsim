import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Globe, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { createFinSimApi } from "@/api/client";
import type { Capability, ConnectionMode, InstitutionType } from "@/api/types";
import { SyntheticBadge } from "@/components/shared/StateBadge";
import { cn } from "@/lib/utils";

interface NetworkViewProps {
  mode: ConnectionMode;
  networkId: string;
  onSelectNetwork?: (networkId: string) => void;
}

const ALL_CAPABILITIES: Capability[] = [
  "ACCOUNT_DEBIT",
  "ACCOUNT_CREDIT",
  "STATUS_QUERY",
];

export function NetworkView({ mode, networkId, onSelectNetwork }: NetworkViewProps) {
  const api = createFinSimApi(mode);
  const queryClient = useQueryClient();

  const [id, setId] = useState("bank-c");
  const [name, setName] = useState("Synthetic Bank C");
  const [type, setType] = useState<InstitutionType>("BANK");
  const [baseUrl, setBaseUrl] = useState(
    mode === "live" ? "http://bank-c:9003" : "http://localhost:9003",
  );
  const [capabilities, setCapabilities] = useState<Capability[]>(ALL_CAPABILITIES);
  const [joinAfter, setJoinAfter] = useState(true);
  const [existingMemberId, setExistingMemberId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const directoryQuery = useQuery({
    queryKey: ["directory", mode, networkId],
    queryFn: () => api.getNetworkDirectory(networkId),
  });

  const networksQuery = useQuery({
    queryKey: ["networks", mode],
    queryFn: () => api.listNetworks(),
  });

  const institutionsQuery = useQuery({
    queryKey: ["institutions", mode],
    queryFn: () => api.listInstitutions(),
  });

  const toggleCapability = (cap: Capability) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  };

  const registerMutation = useMutation({
    mutationFn: async () => {
      const created = await api.registerInstitution({
        id,
        name,
        type,
        baseUrl,
        capabilities,
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

  const addMemberMutation = useMutation({
    mutationFn: (institutionId: string) => api.addNetworkMember(networkId, institutionId),
    onSuccess: () => {
      setErrorMsg(null);
      setExistingMemberId("");
      queryClient.invalidateQueries({ queryKey: ["directory", mode, networkId] });
      queryClient.invalidateQueries({ queryKey: ["networks", mode] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : "Failed to add member"),
  });

  const directory = directoryQuery.data;
  const networks = networksQuery.data ?? [];
  const memberIds = new Set((directory?.participants ?? []).map((p) => p.id));
  const availableToJoin = (institutionsQuery.data ?? []).filter((inst) => !memberIds.has(inst.id));
  const selectedExistingId =
    existingMemberId && availableToJoin.some((i) => i.id === existingMemberId)
      ? existingMemberId
      : (availableToJoin[0]?.id ?? "");

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
            {networks.map((n) => {
              const isActive = n.id === networkId;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onSelectNetwork?.(n.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition",
                    isActive
                      ? "border-sky-500/60 bg-sky-500/5 ring-1 ring-sky-500/30"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                      {n.id}
                      {isActive && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">
                          ACTIVE
                        </span>
                      )}
                    </span>
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
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Directory */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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

          {availableToJoin.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
              <label htmlFor="existing-member-id" className="text-slate-500">
                Add registered participant:
              </label>
              <select
                id="existing-member-id"
                name="existingInstitutionId"
                value={selectedExistingId}
                onChange={(e) => setExistingMemberId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                {availableToJoin.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.id} ({inst.name})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedExistingId || addMemberMutation.isPending}
                onClick={() => selectedExistingId && addMemberMutation.mutate(selectedExistingId)}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Join {networkId}
              </button>
            </div>
          )}

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

        <label htmlFor="inst-id" className="block space-y-1 text-xs">
          <span className="text-slate-500">Institution ID</span>
          <input
            id="inst-id"
            name="institutionId"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label htmlFor="inst-name" className="block space-y-1 text-xs">
          <span className="text-slate-500">Display Name</span>
          <input
            id="inst-name"
            name="institutionName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label htmlFor="inst-type" className="block space-y-1 text-xs">
          <span className="text-slate-500">Type</span>
          <select
            id="inst-type"
            name="institutionType"
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

        <label htmlFor="inst-base-url" className="block space-y-1 text-xs">
          <span className="text-slate-500">Base URL</span>
          <input
            id="inst-base-url"
            name="baseUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          {mode === "live" && (
            <span className="block text-[11px] leading-snug text-slate-400">
              Use a public <span className="font-mono">https://</span> URL or allowed Docker
              service hostname (loopback/private IPs are blocked by prod SSRF policy).
            </span>
          )}
        </label>

        <fieldset className="space-y-1.5 text-xs">
          <legend className="text-slate-500">Capabilities</legend>
          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950">
            {ALL_CAPABILITIES.map((cap) => (
              <label
                key={cap}
                htmlFor={`cap-${cap}`}
                className="flex items-center gap-2 font-mono text-[11px] text-slate-700 dark:text-slate-300"
              >
                <input
                  id={`cap-${cap}`}
                  name={`capability_${cap}`}
                  type="checkbox"
                  checked={capabilities.includes(cap)}
                  onChange={() => toggleCapability(cap)}
                />
                {cap}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="inst-auto-join" className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            id="inst-auto-join"
            name="joinAfter"
            type="checkbox"
            checked={joinAfter}
            onChange={(e) => setJoinAfter(e.target.checked)}
          />
          Auto-join <span className="font-mono">{networkId}</span> network
        </label>

        {errorMsg && <p className="font-mono text-xs text-rose-500">{errorMsg}</p>}

        <button
          type="button"
          disabled={registerMutation.isPending || capabilities.length === 0}
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
