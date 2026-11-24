import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import React, { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "warning" | "error" | "info";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        dismissToast(id);
      }, 3500);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {/* Toast viewport */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm w-full flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 shadow-lg transition-all",
              "bg-white dark:bg-slate-900 text-xs",
              toast.type === "success" &&
                "border-emerald-500/40 text-emerald-950 dark:text-emerald-100 dark:border-emerald-500/50",
              toast.type === "warning" &&
                "border-amber-500/40 text-amber-950 dark:text-amber-100 dark:border-amber-500/50",
              toast.type === "error" &&
                "border-rose-500/40 text-rose-950 dark:text-rose-100 dark:border-rose-500/50",
              toast.type === "info" &&
                "border-sky-500/40 text-sky-950 dark:text-sky-100 dark:border-sky-500/50",
            )}
          >
            <div className="mt-0.5 shrink-0">
              {toast.type === "success" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              )}
              {toast.type === "warning" && (
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              {toast.type === "error" && (
                <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              )}
              {toast.type === "info" && (
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              )}
            </div>

            <div className="flex-1 font-medium leading-relaxed">{toast.message}</div>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
