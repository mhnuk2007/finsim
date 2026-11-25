import type { FaultType, TransferState } from "@/api/types";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<TransferState, string> = {
  COMPLETED:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  UNKNOWN:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  REJECTED:
    "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  IN_PROGRESS:
    "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  ACCEPTED:
    "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  CREATED:
    "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

export function StateBadge({
  state,
  className,
}: {
  state: TransferState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide",
        STATE_STYLES[state],
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          state === "COMPLETED" && "bg-emerald-500",
          state === "UNKNOWN" && "animate-pulse bg-amber-500",
          state === "REJECTED" && "bg-rose-500",
          (state === "IN_PROGRESS" || state === "ACCEPTED") && "bg-sky-500",
          state === "CREATED" && "bg-slate-400",
        )}
      />
      {state}
    </span>
  );
}

const FAULT_STYLES: Record<FaultType, string> = {
  TIMEOUT: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  DELAY: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  DUPLICATE_DELIVERY:
    "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

export function FaultBadge({
  type,
  className,
}: {
  type: FaultType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium",
        FAULT_STYLES[type],
        className,
      )}
    >
      {type}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wider text-sky-700 dark:text-sky-300">
      SYNTHETIC
    </span>
  );
}
