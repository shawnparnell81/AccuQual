import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useDialogBehavior } from "./useDialogBehavior";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
}

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function finish(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          tone={pending.tone}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialogBehavior(true, onCancel);
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        tabIndex={-1}
        className="modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="confirm-title" className="text-sm font-medium">
          {title}
        </h2>
        <p id="confirm-message" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={tone === "danger" ? "rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white" : "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
