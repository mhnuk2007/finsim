import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, ShieldAlert, Workflow } from "lucide-react";
import { useMemo } from "react";
import type { FaultRuleDto, Institution, TransferResponse } from "@/api/types";

interface TopologyCanvasProps {
  participants: Institution[];
  faults: FaultRuleDto[];
  activeTransfer: TransferResponse | null;
  onQuickToggleTimeout: (institutionId: string) => void;
}

export function TopologyCanvas({
  participants,
  faults,
  activeTransfer,
  onQuickToggleTimeout,
}: TopologyCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const faultsByTarget = new Map<string, FaultRuleDto[]>();
    for (const f of faults) {
      const list = faultsByTarget.get(f.target) ?? [];
      list.push(f);
      faultsByTarget.set(f.target, list);
    }

    const builtNodes: Node[] = [
      {
        id: "finsim-hub",
        position: { x: 280, y: 85 },
        draggable: false,
        data: {
          label: (
            <div className="flex flex-col items-center gap-1 px-3 py-2 text-center">
              <div className="flex items-center gap-1.5 text-sky-400">
                <Workflow className="h-4 w-4" />
                <span className="font-mono text-xs font-semibold">FinSim Switch</span>
              </div>
              <span className="font-mono text-[10px] text-slate-400">
                wf.transfer.v1
              </span>
            </div>
          ),
        },
        style: {
          background: "#0f172a",
          color: "#f8fafc",
          border: "1.5px solid #0284c7",
          borderRadius: 12,
          width: 175,
        },
      },
    ];

    const builtEdges: Edge[] = [];
    const total = participants.length;

    participants.forEach((inst, index) => {
      const isLeft = index % 2 === 0;
      const row = Math.floor(index / 2);
      const x = isLeft ? 20 : 535;
      const y = total <= 2 ? 80 : 25 + row * 125;

      const instFaults = faultsByTarget.get(inst.id) ?? [];
      const hasFault = instFaults.length > 0;
      const isSource = activeTransfer?.from.institutionId === inst.id;
      const isDest = activeTransfer?.to.institutionId === inst.id;

      builtNodes.push({
        id: inst.id,
        position: { x, y },
        draggable: false,
        data: {
          label: (
            <button
              type="button"
              onClick={() => onQuickToggleTimeout(inst.id)}
              className="flex w-full flex-col gap-1 text-left"
              title="Click to toggle a 1x TIMEOUT fault on this institution"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-100">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  {inst.id}
                </span>
                {hasFault && (
                  <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                    <ShieldAlert className="h-3 w-3" />
                    {instFaults[0].type}
                  </span>
                )}
              </div>
              <span className="truncate text-[11px] text-slate-400">{inst.name}</span>
              <span className="font-mono text-[10px] text-slate-500">
                {hasFault ? "Click to clear fault" : "Click to inject TIMEOUT"}
              </span>
            </button>
          ),
        },
        style: {
          background: "#0f172a",
          color: "#f8fafc",
          border: hasFault
            ? "1.5px solid #f43f5e"
            : isSource || isDest
              ? "1.5px solid #10b981"
              : "1px solid #334155",
          borderRadius: 12,
          padding: 10,
          width: 195,
        },
      });

      const strokeColor =
        isDest && activeTransfer?.state === "UNKNOWN"
          ? "#f59e0b"
          : isDest && activeTransfer?.state === "REJECTED"
            ? "#f43f5e"
            : isSource || isDest
              ? "#10b981"
              : "#475569";

      builtEdges.push({
        id: `e-${inst.id}-hub`,
        source: isLeft ? inst.id : "finsim-hub",
        target: isLeft ? "finsim-hub" : inst.id,
        animated: Boolean(isSource || isDest),
        label: isSource ? "DEBIT" : isDest ? "CREDIT" : undefined,
        labelStyle: { fill: "#cbd5e1", fontSize: 10, fontFamily: "JetBrains Mono" },
        labelBgStyle: { fill: "#0f172a", fillOpacity: 0.9 },
        style: { stroke: strokeColor, strokeWidth: isSource || isDest ? 2.2 : 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
      });
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [participants, faults, activeTransfer, onQuickToggleTimeout]);

  return (
    <div className="h-[255px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
      >
        <Background color="#1e293b" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
