import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * App-wide toast stack — didn't exist anywhere before this pass (see the
 * Workflow UI Components brief, section 3/4: every transition needs a
 * success/failure toast, and none of the module detail pages surfaced
 * mutation errors at all until now). Mount once in main.tsx, above <App/>.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    success: (message) => push("success", message),
    error: (message) => push("error", message),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={clsx(
              "flex items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-lg",
              t.kind === "success" ? "border-success/30" : "border-destructive/30"
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 flex-none text-success" />
            ) : (
              <XCircle size={16} className="mt-0.5 flex-none text-destructive" />
            )}
            <p className="flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="flex-none rounded p-0.5 hover:bg-muted" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws outside <ToastProvider> deliberately — catches a missing provider immediately (a wrong mount point in main.tsx) instead of every call site failing silently. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
