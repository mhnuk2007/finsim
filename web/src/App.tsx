import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronDown,
  GitFork,
  Globe,
  Menu,
  Moon,
  Network as NetworkIcon,
  RotateCcw,
  ShieldAlert,
  Sun,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createFinSimApi,
  getStoredApiBaseUrl,
  setStoredApiBaseUrl,
} from "@/api/client";
import type { ConnectionMode, TransferResponse } from "@/api/types";
import { SyntheticBadge } from "@/components/shared/StateBadge";
import { ToastProvider, useToast } from "@/components/shared/Toast";
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

function AppContent() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabId>("workbench");
  const [mode, setMode] = useState<ConnectionMode>(
    import.meta.env.VITE_DEFAULT_MODE === "live" ? "live" : "demo",
  );
  const [dark, setDark] = useState(true);
  const [networkId] = useState("sandbox");
  const [history, setHistory] = useState<TransferResponse[]>([]);
  const [activeTransfer, setActiveTransfer] = useState<TransferResponse | null>(null);

  // Responsive sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Runtime Base URL configuration for Live Mode
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getStoredApiBaseUrl());
  const [isUrlPopoverOpen, setIsUrlPopoverOpen] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState(apiBaseUrl);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Click outside to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsUrlPopoverOpen(false);
      }
    }
    if (isUrlPopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUrlPopoverOpen]);

  // Health check polling for Live API mode (every 15s)
  const healthQuery = useQuery({
    queryKey: ["health", mode, apiBaseUrl],
    queryFn: () => createFinSimApi(mode, apiBaseUrl).checkHealth(),
    refetchInterval: mode === "live" ? 15000 : false,
    enabled: mode === "live",
  });

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
    showToast(`Switched to ${nextMode === "live" ? "Live API" : "Demo"} mode`, "info");
  };

  const handleResetDemo = () => {
    resetDemoEngine();
    setActiveTransfer(null);
    setHistory([]);
    queryClient.invalidateQueries();
    showToast("Demo balances, faults, and history reset", "info");
  };

  const handleSaveBaseUrl = () => {
    const trimmed = tempUrlInput.trim();
    setStoredApiBaseUrl(trimmed);
    setApiBaseUrl(trimmed);
    setIsUrlPopoverOpen(false);
    queryClient.invalidateQueries({ queryKey: ["health"] });
    showToast(`API Base URL updated: ${trimmed || "default (proxy)"}`, "info");
  };

  const renderNavLinks = () => (
    <nav className="flex-1 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setSidebarOpen(false);
            }}
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
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setSidebarOpen(false);
          }}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Mobile Drawer Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white p-3 shadow-2xl transition-transform duration-200 ease-in-out dark:border-slate-800 dark:bg-slate-900 md:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-5 flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              <GitFork className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight">FinSim</div>
              <div className="font-mono text-[10px] text-slate-500">Cockpit v0.1</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {renderNavLinks()}
      </aside>

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2 pt-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
            <GitFork className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">FinSim</div>
            <div className="font-mono text-[10px] text-slate-500">Cockpit v0.1</div>
          </div>
        </div>

        {renderNavLinks()}
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            {/* Hamburger button on mobile */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="mr-1 rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
              title="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <span className="font-mono text-xs font-semibold text-slate-500">
              network:
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
              {networkId}
            </span>
            <SyntheticBadge />
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

            {/* Live Mode Health Status & URL Popover */}
            {mode === "live" && (
              <div className="relative" ref={popoverRef}>
                <button
                  type="button"
                  onClick={() => {
                    setTempUrlInput(apiBaseUrl);
                    setIsUrlPopoverOpen((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Configure Live API Base URL"
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      healthQuery.data === true
                        ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                        : "bg-rose-500 ring-2 ring-rose-500/20",
                    )}
                  />
                  <span className="font-mono text-[11px]">
                    {healthQuery.data === true ? "Connected" : "Unreachable"}
                  </span>
                  <Globe className="ml-0.5 h-3.5 w-3.5 text-slate-400" />
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>

                {isUrlPopoverOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Live API Base URL
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsUrlPopoverOpen(false)}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Configure target backend URL without rebuilding:
                    </p>

                    <input
                      type="text"
                      placeholder="e.g. http://localhost:8080"
                      value={tempUrlInput}
                      onChange={(e) => setTempUrlInput(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTempUrlInput("http://localhost:8080")}
                        className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        localhost:8080
                      </button>
                      <button
                        type="button"
                        onClick={() => setTempUrlInput("")}
                        className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        default (proxy)
                      </button>
                    </div>

                    <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsUrlPopoverOpen(false)}
                        className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveBaseUrl}
                        className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500"
                      >
                        <Check className="h-3 w-3" />
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
