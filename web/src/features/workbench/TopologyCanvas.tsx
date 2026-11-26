import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, ShieldAlert, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FaultRuleDto, Institution, TransferResponse } from "@/api/types";
import { cn, formatMoney } from "@/lib/utils";

interface StatusPillInfo {
  text: string;
  variant: "success" | "warning" | "error" | "info";
}

interface BankNodeData {
  institution: Institution;
  faults: FaultRuleDto[];
  statusPill: StatusPillInfo | null;
  accounts: { acc: string; bal: number }[];
  isSource: boolean;
  isDest: boolean;
  hasFault: boolean;
  onQuickToggleTimeout: (institutionId: string) => void;
  isLeft: boolean;
  [key: string]: unknown;
}

function BankNode({ data }: NodeProps<Node<BankNodeData>>) {
  const {
    institution,
    faults,
    statusPill,
    accounts,
    isSource,
    isDest,
    hasFault,
    onQuickToggleTimeout,
  } = data;

  return (
    <div
      className={cn(
        "relative w-[215px] rounded-xl border bg-white p-3 text-slate-900 shadow-sm transition dark:bg-slate-900 dark:text-slate-100",
        hasFault
          ? "border-rose-500 shadow-rose-500/10 ring-1 ring-rose-500"
          : isSource || isDest
            ? "border-emerald-500 shadow-emerald-500/10 ring-1 ring-emerald-500"
            : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
          <Building2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          {institution.id}
        </span>
        <div className="flex items-center gap-1">
          {hasFault && (
            <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-300">
              <ShieldAlert className="h-3 w-3" />
              {faults[0].type}
            </span>
          )}
          {statusPill && (
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                statusPill.variant === "success" &&
                  "border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                statusPill.variant === "warning" &&
                  "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
                statusPill.variant === "error" &&
                  "border border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
                statusPill.variant === "info" &&
                  "border border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300",
              )}
            >
              {statusPill.text}
            </span>
          )}
        </div>
      </div>

      <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
        {institution.name}
      </div>

      {accounts.length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-slate-200/80 bg-slate-50/90 p-1.5 font-mono text-[10px] dark:border-slate-800 dark:bg-slate-950/80">
          {accounts.map(({ acc, bal }) => (
            <div key={acc} className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">{acc}</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatMoney(bal.toFixed(2), "USD")}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onQuickToggleTimeout(institution.id)}
        className="mt-2 block w-full rounded border border-dashed border-slate-200 py-1 text-center font-mono text-[10px] text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
        title={hasFault ? "Click to clear fault" : "Click to toggle TIMEOUT fault"}
      >
        {hasFault ? "Clear fault" : "+ Inject TIMEOUT"}
      </button>

      {/* Connection handles */}
      <Handle type="target" position={Position.Left} id="left-tgt" className="!opacity-0" />
      <Handle type="source" position={Position.Left} id="left-src" className="!opacity-0" />
      <Handle type="target" position={Position.Right} id="right-tgt" className="!opacity-0" />
      <Handle type="source" position={Position.Right} id="right-src" className="!opacity-0" />
    </div>
  );
}

function HubNode() {
  return (
    <div className="relative flex w-[175px] flex-col items-center justify-center gap-1 rounded-xl border border-sky-500/50 bg-white px-3 py-3 text-center shadow-sm dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
        <Workflow className="h-4 w-4" />
        <span className="font-mono text-xs font-semibold">FinSim Switch</span>
      </div>
      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
        wf.transfer.v1
      </span>
      <Handle type="target" position={Position.Left} id="hub-left-tgt" className="!opacity-0" />
      <Handle type="source" position={Position.Left} id="hub-left-src" className="!opacity-0" />
      <Handle type="target" position={Position.Right} id="hub-right-tgt" className="!opacity-0" />
      <Handle type="source" position={Position.Right} id="hub-right-src" className="!opacity-0" />
    </div>
  );
}

const nodeTypes = {
  bank: BankNode,
  hub: HubNode,
};

interface TopologyCanvasProps {
  participants: Institution[];
  faults: FaultRuleDto[];
  activeTransfer: TransferResponse | null;
  onQuickToggleTimeout: (institutionId: string) => void;
  balances?: Record<string, number>;
}

export function TopologyCanvas({
  participants,
  faults,
  activeTransfer,
  onQuickToggleTimeout,
  balances,
}: TopologyCanvasProps) {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : true,
  );

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const { nodes, edges } = useMemo(() => {
    const faultsByTarget = new Map<string, FaultRuleDto[]>();
    for (const f of faults) {
      const list = faultsByTarget.get(f.target) ?? [];
      list.push(f);
      faultsByTarget.set(f.target, list);
    }

    const total = participants.length;
    const builtNodes: Node[] = [
      {
        id: "finsim-hub",
        type: "hub",
        position: { x: 280, y: total <= 2 ? 80 : 35 },
        draggable: false,
        data: {},
      },
    ];

    const builtEdges: Edge[] = [];

    participants.forEach((inst, index) => {
      const isLeft = index % 2 === 0;
      const row = Math.floor(index / 2);
      const x = isLeft ? 20 : 535;
      const y = total <= 2 ? 55 : 20 + row * 140;

      const instFaults = faultsByTarget.get(inst.id) ?? [];
      const hasFault = instFaults.length > 0;
      const isSource = activeTransfer?.from.institutionId === inst.id;
      const isDest = activeTransfer?.to.institutionId === inst.id;

      // Extract accounts for this bank if balances provided
      const accounts: { acc: string; bal: number }[] = [];
      if (balances) {
        const prefix = `${inst.id}:`;
        for (const [k, v] of Object.entries(balances)) {
          if (k.startsWith(prefix)) {
            accounts.push({ acc: k.slice(prefix.length), bal: v });
          }
        }
      }

      // Compute status pill reflecting active transfer (supports both Demo uppercase and Live lowercase stages)
      const stage = activeTransfer?.currentStage;
      const isDebitStage = stage === "DEBIT_LEG" || stage === "debit_source";
      const isResolutionStage =
        stage === "RESOLUTION" || stage === "resolve" || stage === "resolve_credit";
      const isReversalStage = stage === "resolve_reversal";
      const debitFailed =
        (activeTransfer?.state === "UNKNOWN" || activeTransfer?.state === "REJECTED") &&
        (isDebitStage ||
          (isResolutionStage && activeTransfer?.emittedBy !== "DESTINATION"));

      let statusPill: StatusPillInfo | null = null;
      if (activeTransfer) {
        if (isSource) {
          if (activeTransfer.state === "UNKNOWN" && (isDebitStage || isReversalStage)) {
            statusPill = {
              text: isReversalStage ? "REVERSAL UNKNOWN" : "DEBIT TIMEOUT",
              variant: "warning",
            };
          } else if (
            activeTransfer.state === "REJECTED" &&
            (isDebitStage || (isResolutionStage && activeTransfer.emittedBy !== "DESTINATION"))
          ) {
            statusPill = { text: "DEBIT REJECTED", variant: "error" };
          } else if (activeTransfer.state === "REJECTED" && isReversalStage) {
            statusPill = { text: "DEBIT REVERSED", variant: "info" };
          } else {
            statusPill = { text: "DEBIT OK", variant: "success" };
          }
        } else if (isDest && !debitFailed) {
          if (isResolutionStage && activeTransfer.state === "COMPLETED") {
            statusPill = { text: "RESOLVED", variant: "success" };
          } else if (activeTransfer.state === "UNKNOWN") {
            statusPill = { text: "CREDIT TIMEOUT", variant: "warning" };
          } else if (activeTransfer.state === "COMPLETED") {
            statusPill = { text: "CREDIT OK", variant: "success" };
          } else if (activeTransfer.state === "REJECTED") {
            statusPill = { text: "REJECTED", variant: "error" };
          } else if (
            activeTransfer.state === "IN_PROGRESS" ||
            activeTransfer.state === "ACCEPTED"
          ) {
            statusPill = { text: "IN PROGRESS", variant: "info" };
          }
        }
      }

      builtNodes.push({
        id: inst.id,
        type: "bank",
        position: { x, y },
        draggable: false,
        data: {
          institution: inst,
          faults: instFaults,
          statusPill,
          accounts,
          isSource,
          isDest,
          hasFault,
          onQuickToggleTimeout,
          isLeft,
        },
      });

      const strokeColor =
        isSource && activeTransfer?.state === "UNKNOWN" && (isDebitStage || isReversalStage)
          ? "#f59e0b"
          : isSource && activeTransfer?.state === "REJECTED" && debitFailed
            ? "#f43f5e"
            : isDest && !debitFailed && activeTransfer?.state === "UNKNOWN"
              ? "#f59e0b"
              : isDest && !debitFailed && activeTransfer?.state === "REJECTED"
                ? "#f43f5e"
                : isSource || (isDest && !debitFailed)
                  ? "#10b981"
                  : isDark
                    ? "#475569"
                    : "#94a3b8";

      builtEdges.push({
        id: `e-${inst.id}-hub`,
        source: isLeft ? inst.id : "finsim-hub",
        sourceHandle: isLeft ? "right-src" : "hub-right-src",
        target: isLeft ? "finsim-hub" : inst.id,
        targetHandle: isLeft ? "hub-left-tgt" : "left-tgt",
        animated: Boolean(isSource || isDest),
        label: isSource ? "DEBIT" : isDest ? "CREDIT" : undefined,
        labelStyle: {
          fill: isDark ? "#38bdf8" : "#0369a1",
          fontSize: 10,
          fontFamily: "JetBrains Mono",
          fontWeight: 700,
        },
        labelBgStyle: {
          fill: isDark ? "#0f172a" : "#e0f2fe",
          fillOpacity: 0.95,
          stroke: isDark ? "#0284c7" : "#bae6fd",
          strokeWidth: 1,
        },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        style: { stroke: strokeColor, strokeWidth: isSource || isDest ? 2.5 : 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
      });
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [participants, faults, activeTransfer, onQuickToggleTimeout, balances, isDark]);

  const layoutKey = `${participants.map((p) => p.id).join(",")}:${Boolean(balances)}`;

  return (
    <div className="h-[285px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={isDark ? "dark" : "light"}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
      >
        <AutoFitView layoutKey={layoutKey} />
        <Background color={isDark ? "#334155" : "#cbd5e1"} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function AutoFitView({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 150 });
    });
    return () => window.cancelAnimationFrame(id);
  }, [fitView, layoutKey]);

  return null;
}
