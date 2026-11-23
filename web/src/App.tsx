import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  GitFork,
  Moon,
  Network as NetworkIcon,
  RotateCcw,
  ShieldAlert,
  Sun,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ConnectionMode, TransferResponse } from "@/api/types";
import { SyntheticBadge } from "@/components/shared/StateBadge";
import { FaultsView } from "@/features/faults/FaultsView";
import { NetworkView } from "@/features/network/NetworkView";
import { TracesView } from "@/features/traces/TracesView";
import { WorkbenchView } from "@/features/workbench/WorkbenchView";
import { cn } from "@/lib/utils";
import { resetDemoEngine } from "@/mocks/demoEngine";

type TabId = "workbench" | "traces" | "faults" | "network";

const NAV_ITEMS: { id: TabId; label: string; icon: typeof Workflow }[] = [
  { id: "workbench", label: "Workbench", icon: Workflow },
  { id: "traces", label: "Traces", icon: Activity },
  { id: "faults", label: "Fault Rules", icon: ShieldAlert },
  { id: "network", label: "Network", icon: NetworkIcon },
];

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("workbench");
  const [mode, setMode] = useState<ConnectionMode>(
    import.meta.env.VITE_DEFAULT_MODE === "live" ? "live" : "demo",
  );
  const [dark, setDark] = useState(true);
  const [networkId] = useState("sandbox");
  const [history, setHistory] = useState<TransferResponse[]>([]);
  const [activeTransfer, setActiveTransfer] = useState<TransferResponse | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const upsertTransfer = (tx: TransferResponse) => {
    setActiveTransfer(tx);
    setHistory((prev) => {
      const idx = prev.findIndex((t) => t.transactionId === tx.transactionId);
      if (idx === -1) return [tx, ...prev];
      const next = [...prev];
      next[idx] = tx;
      return next;
    });
  };

  const handleModeChange = (nextMode: ConnectionMode) => {
    setMode(nextMode);
    setActiveTransfer(null);
    setHistory([]);
    queryClient.clear();
  };

  const handleResetDemo = () => {
    resetDemoEngine();
    setActiveTransfer(null);
    setHistory([]);
    queryClient.invalidateQueries();
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-5 flex items-center gap-2 px-2 pt-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
            <GitFork className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">FinSim</div>
            <div className="font-mono text-[10px] text-slate-500">Cockpit v0.1</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition",
                  active
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950">
          <div className="font-semibold text-slate-700 dark:text-slate-300">
            Milestone 1 Scope
          </div>
          <p className="mt-0.5 leading-relaxed">
            Connected to <span className="font-mono">finsim/v1</span> transfers,
            faults, traces &amp; directory.
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold text-slate-500">
              network:
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              {networkId}
            </span>
            <SyntheticBadge />
          </div>

          <div className="flex items-center gap-2">
            {/* Dual-Mode Switcher */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => handleModeChange("demo")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  mode === "demo"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-sky-600 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                )}
              >
                Demo Mode
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("live")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  mode === "live"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                )}
              >
                Live API
              </button>
            </div>

            {mode === "demo" && (
              <button
                type="button"
                onClick={handleResetDemo}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Reset Demo balances, faults, and transfers"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            )}

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Toggle theme"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-5">
          {tab === "workbench" && (
            <WorkbenchView
              mode={mode}
              networkId={networkId}
              activeTransfer={activeTransfer}
              onTransferCreated={upsertTransfer}
            />
          )}
          {tab === "traces" && (
            <TracesView
              mode={mode}
              history={history}
              selected={activeTransfer}
              onSelect={setActiveTransfer}
              onUpdate={upsertTransfer}
            />
          )}
          {tab === "faults" && <FaultsView mode={mode} />}
          {tab === "network" && <NetworkView mode={mode} networkId={networkId} />}
        </main>
      </div>
    </div>
  );
}
