import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { DrillRows } from "../../routes/Executive/ExecutiveDrillListPage";
import { reportError } from "../../lib/errorTracking";

export interface DrillListRow {
  recordNumber: string;
  title: string;
  status: string;
  ageLabel: string;
  href: string | null;
  module: string | null;
}

/** The same record list the executive dashboard opens from a number. */
export function ExecutiveDrillPanel({
  title,
  detail,
  total,
  rows,
  denied,
  note,
  onClose,
  onDenied,
  onOpenFullList,
}: {
  title: string;
  detail?: string | null;
  total: number;
  rows: DrillListRow[];
  denied: string | null;
  note?: string | null;
  onClose: () => void;
  onDenied: (message: string) => void;
  onOpenFullList?: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside role="dialog" aria-labelledby="executive-drill-title" className="fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100%)] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id="executive-drill-title" ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
            {title}
          </h2>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>
        <button type="button" className="cursor-pointer rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "record" : "records"}
        </p>
        {onOpenFullList && (
          <button
            type="button"
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpenFullList}
          >
            Open full list
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {note && <p className="mb-3 text-xs text-muted-foreground">{note}</p>}
        {denied && <p className="mb-3 rounded-lg border border-border bg-background p-3 text-sm text-foreground">{denied}</p>}
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No records in this count.</p> : <DrillRows rows={rows} onDenied={onDenied} />}
      </div>
    </aside>
  );
}

/** Catches a render crash in the drill panel so it shows a message instead of a blank white panel. */
class DrillPanelErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Drill panel render error", error, info.componentStack);
    reportError(error, { componentStack: info.componentStack });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <aside role="dialog" aria-label="Drill panel error" className="fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100%)] flex-col border-l border-border bg-card p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Couldn't show these records</h2>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong drawing this list. Try opening it again.</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onClose();
          }}
          className="mt-4 w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Close
        </button>
      </aside>
    );
  }
}

/** The drill panel wrapped so a render error shows a message instead of white. */
export function SafeExecutiveDrillPanel(props: Parameters<typeof ExecutiveDrillPanel>[0]) {
  return (
    <DrillPanelErrorBoundary onClose={props.onClose}>
      <ExecutiveDrillPanel {...props} />
    </DrillPanelErrorBoundary>
  );
}
