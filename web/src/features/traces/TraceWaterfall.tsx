import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { TraceEventDto, TraceResponse, TransferResponse, TransferState } from "@/api/types";
import { StateBadge } from "@/components/shared/StateBadge";
import { useToast } from "@/components/shared/Toast";
import { cn, formatMoney, formatTimestamp } from "@/lib/utils";

function StateLifecycleStepper({ state }: { state: TransferState }) {
  const isTerminal = ["COMPLETED", "UNKNOWN", "REJECTED"].includes(state);
  const terminalState = isTerminal ? state : "TERMINAL";

  const getStepStatus = (stepName: "CREATED" | "ACCEPTED" | "IN_PROGRESS") => {
    if (state === "COMPLETED" || state === "UNKNOWN" || state === "REJECTED") {
      return "completed";
    }
    if (stepName === "CREATED") {
      return state === "CREATED" ? "current" : "completed";
    }
    if (stepName === "ACCEPTED") {
      if (state === "CREATED") return "upcoming";
      return state === "ACCEPTED" ? "current" : "completed";
    }
    if (stepName === "IN_PROGRESS") {
      return state === "IN_PROGRESS" ? "current" : "upcoming";
    }
    return "upcoming";
  };

  const steps = [
    { name: "CREATED" as const, label: "CREATED" },
    { name: "ACCEPTED" as const, label: "ACCEPTED" },
    { name: "IN_PROGRESS" as const, label: "IN_PROGRESS" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/60">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Lifecycle
      </span>
      {steps.map((st) => {
        const status = getStepStatus(st.name);
        return (
          <div key={st.name} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-medium transition",
                status === "completed" &&
                  "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                status === "current" &&
                  "border border-sky-500/30 bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-300",
                status === "upcoming" &&
                  "border border-transparent bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-600",
              )}
            >
              {status === "completed" && <Check className="h-3 w-3" />}
              {status === "current" && (
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
              )}
              {st.label}
            </span>
            <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-700" />
          </div>
        );
      })}

      {/* Terminal Step */}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold transition",
          terminalState === "COMPLETED" &&
            "border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300",
          terminalState === "UNKNOWN" &&
            "border border-amber-500/40 bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300",
          terminalState === "REJECTED" &&
            "border border-rose-500/40 bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/20 dark:text-rose-300",
          terminalState === "TERMINAL" &&
            "border border-transparent bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-600",
        )}
      >
        {terminalState === "COMPLETED" && <Check className="h-3 w-3" />}
        {terminalState === "UNKNOWN" && <AlertTriangle className="h-3 w-3" />}
        {terminalState === "REJECTED" && <X className="h-3 w-3" />}
        {terminalState === "TERMINAL" ? "COMPLETED | UNKNOWN" : terminalState}
      </span>
    </div>
  );
}

interface TraceWaterfallProps {
  transfer: TransferResponse;
  trace?: TraceResponse;
  onResolve?: (transactionId: string) => void;
  resolving?: boolean;
}

export function TraceWaterfall({
  transfer,
  trace,
  onResolve,
  resolving,
}: TraceWaterfallProps) {
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const events = trace?.events ?? [];
  const maxDuration = Math.max(1, ...events.map((e) => e.durationMs ?? 0));

  const firstEventTimestamp = useMemo(() => {
    return events.length > 0 ? new Date(events[0].at).getTime() : 0;
  }, [events]);

  const expandableIndices = useMemo(() => {
    return events
      .map((e, idx) => (e.request !== undefined || e.response !== undefined ? idx : -1))
      .filter((idx) => idx !== -1);
  }, [events]);

  const allExpanded =
    expandableIndices.length > 0 &&
    expandableIndices.every((idx) => expandedIndices.has(idx));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedIndices(new Set());
    } else {
      setExpandedIndices(new Set(expandableIndices));
    }
  };

  const handleToggleRow = (idx: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleExportJson = () => {
    const payload = JSON.stringify({ transfer, trace }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${transfer.transactionId}-trace.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Trace exported to JSON", "info");
  };

  const handleCopyCurl = async () => {
    const storedBase =
      typeof window !== "undefined"
        ? (window.localStorage?.getItem("finsim.apiBaseUrl") ?? "").trim()
        : "";
    const origin =
      storedBase ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");
    const base = origin.replace(/\/+$/, "");
    const cmd = `curl -s ${base}/api/v1/transfers/${transfer.transactionId}/trace | jq`;
    await navigator.clipboard?.writeText(cmd);
    setCopied(true);
    showToast("cURL command copied to clipboard", "info");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
              {transfer.transactionId}
            </span>
            <StateBadge state={transfer.state} />
            {transfer.reasonCode && (
              <span className="rounded bg-rose-500/10 px-2 py-0.5 font-mono text-xs text-rose-600 dark:text-rose-300">
                {transfer.reasonCode}
                {transfer.emittedBy ? ` (${transfer.emittedBy})` : ""}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
            <span>
              {transfer.from.institutionId}:{transfer.from.accountReference}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>
              {transfer.to.institutionId}:{transfer.to.accountReference}
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-200">
              {formatMoney(transfer.money.amount, transfer.money.currency)}
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>ref: {transfer.reference}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyCurl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied cURL" : "Copy cURL"}
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* State Lifecycle Stepper */}
      <StateLifecycleStepper state={transfer.state} />

      {/* ADR 0001 UNKNOWN Reconciliation Banner */}
      {transfer.state === "UNKNOWN" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="space-y-0.5 text-xs">
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                Outcome uncertain — retries blocked (409 RECONCILIATION_REQUIRED)
              </p>
              <p className="text-amber-700 dark:text-amber-300/90">
                Pending action:{" "}
                <span className="font-mono font-semibold">
                  {transfer.pendingAction}
                </span>
                . Run ADR 0001 resolution to query participants for ground truth.
              </p>
            </div>
          </div>
          {onResolve && (
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve(transfer.transactionId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", resolving && "animate-spin")} />
              {resolving ? "Resolving..." : "Resolve Transfer"}
            </button>
          )}
        </div>
      )}

      {/* Trace Timeline Waterfall */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <div className="flex items-center gap-2">
            <span>Execution Trace ({events.length} events)</span>
            {expandableIndices.length > 0 && (
              <button
                type="button"
                onClick={toggleExpandAll}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-sans text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ChevronsUpDown className="h-3 w-3" />
                {allExpanded ? "Collapse All" : "Expand All"}
              </button>
            )}
          </div>
          <span>Latency</span>
        </div>

        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
            No trace events recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800/80 dark:border-slate-800">
            {events.map((ev, idx) => {
              const elapsedMs =
                firstEventTimestamp > 0
                  ? Math.max(0, new Date(ev.at).getTime() - firstEventTimestamp)
                  : 0;

              return (
                <TraceRow
                  key={`${ev.at}-${idx}`}
                  event={ev}
                  elapsedMs={elapsedMs}
                  maxDuration={maxDuration}
                  expanded={expandedIndices.has(idx)}
                  onToggle={() => handleToggleRow(idx)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TraceRow({
  event,
  elapsedMs,
  maxDuration,
  expanded,
  onToggle,
}: {
  event: TraceEventDto;
  elapsedMs: number;
  maxDuration: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasPayload = Boolean(event.request || event.response);
  const barPct = event.durationMs
    ? Math.max(8, Math.round((event.durationMs / maxDuration) * 100))
    : 0;

  return (
    <div className="text-xs">
      <button
        type="button"
        disabled={!hasPayload}
        onClick={onToggle}
        className={cn(
          "grid w-full grid-cols-[105px_125px_1fr_110px] items-center gap-2 px-3 py-2 text-left transition",
          hasPayload && "hover:bg-slate-50 dark:hover:bg-slate-800/60",
          event.kind === "FAULT_INJECTED" && "bg-rose-500/5",
        )}
      >
        <div className="flex flex-col text-left">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
            +{elapsedMs}ms
          </span>
          <span className="font-mono text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
            {formatTimestamp(event.at)}
          </span>
        </div>

        <span className="flex items-center gap-1 font-mono text-[11px] font-semibold">
          {hasPayload ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )
          ) : (
            <span className="w-3.5" />
          )}
          <span
            className={cn(
              event.kind === "FAULT_INJECTED" && "text-rose-500",
              event.kind === "OUTBOUND_CALL" && "text-sky-500",
              event.kind === "STATE_CHANGE" && "text-emerald-500",
              event.kind === "STAGE" && "text-slate-500 dark:text-slate-400",
            )}
          >
            {event.kind}
          </span>
        </span>

        <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-200">
          {event.kind === "STATE_CHANGE" && (
            <span>
              {event.stage}: {event.fromState ?? "INIT"} →{" "}
              <strong>{event.toState}</strong>
            </span>
          )}
          {event.kind === "FAULT_INJECTED" && (
            <span className="inline-flex items-center gap-1 text-rose-500">
              <ShieldAlert className="h-3.5 w-3.5" />
              {event.target} ({event.faultId})
            </span>
          )}
          {event.kind === "OUTBOUND_CALL" && (
            <span>
              {event.stage} → <strong>{event.target}</strong>
            </span>
          )}
          {event.kind === "STAGE" && <span>{event.stage}</span>}
        </span>

        <div className="flex items-center justify-end gap-2">
          {event.durationMs !== undefined && (
            <>
              <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <span className="tabular-nums font-mono text-[11px] text-slate-500">
                {event.durationMs}ms
              </span>
            </>
          )}
        </div>
      </button>

      {expanded && hasPayload && (
        <div className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70 md:grid-cols-2">
          {event.request !== undefined && (
            <div>
              <div className="mb-1 font-mono text-[10px] font-semibold uppercase text-slate-500">
                Request
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-200">
                {JSON.stringify(event.request, null, 2)}
              </pre>
            </div>
          )}
          {event.response !== undefined && (
            <div>
              <div className="mb-1 font-mono text-[10px] font-semibold uppercase text-slate-500">
                Response
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-200">
                {JSON.stringify(event.response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
