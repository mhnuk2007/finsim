import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import type { TraceEventDto, TraceResponse, TransferResponse } from "@/api/types";
import { StateBadge } from "@/components/shared/StateBadge";
import { cn, formatMoney, formatTimestamp } from "@/lib/utils";

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
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const events = trace?.events ?? [];
  const maxDuration = Math.max(
    1,
    ...events.map((e) => e.durationMs ?? 0),
  );

  const handleExportJson = () => {
    const payload = JSON.stringify({ transfer, trace }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${transfer.transactionId}-trace.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCurl = async () => {
    const cmd = `curl -s http://localhost:8080/api/v1/transfers/${transfer.transactionId}/trace | jq`;
    await navigator.clipboard?.writeText(cmd);
    setCopied(true);
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied cURL" : "Copy cURL"}
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
        </div>
      </div>

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
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
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
          <span>Execution Trace ({events.length} events)</span>
          <span>Latency</span>
        </div>

        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
            No trace events recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800/80 dark:border-slate-800">
            {events.map((ev, idx) => (
              <TraceRow
                key={`${ev.at}-${idx}`}
                event={ev}
                maxDuration={maxDuration}
                expanded={expandedIdx === idx}
                onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TraceRow({
  event,
  maxDuration,
  expanded,
  onToggle,
}: {
  event: TraceEventDto;
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
          "grid w-full grid-cols-[90px_125px_1fr_110px] items-center gap-2 px-3 py-2 text-left transition",
          hasPayload && "hover:bg-slate-50 dark:hover:bg-slate-800/60",
          event.kind === "FAULT_INJECTED" && "bg-rose-500/5",
        )}
      >
        <span className="tabular-nums font-mono text-[11px] text-slate-500">
          {formatTimestamp(event.at)}
        </span>

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
