import { Maximize2, X } from "lucide-react";
import { useWindowStore } from "./useWindowStore";

/**
 * A minimized window vanishes from the floating-window layer entirely
 * (WindowFrame.tsx's `if (win.minimized) return null`), and until now there
 * was no other way to bring one back short of re-opening the exact same
 * record from wherever it was first opened. This strip is the missing
 * restore affordance: pinned to the bottom of the screen, rendered only
 * while at least one window is minimized.
 */
export function MinimizedWindowsTaskbar() {
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  const minimized = windows.filter((w) => w.minimized);
  if (minimized.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-2">
      <div className="pointer-events-auto flex max-w-[90vw] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 shadow-xl">
        {minimized.map((win) => (
          <button
            key={win.id}
            onClick={() => focusWindow(win.id)}
            title={`Restore ${win.title}`}
            className="group flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Maximize2 size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{win.title}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                closeWindow(win.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  closeWindow(win.id);
                }
              }}
              aria-label={`Close ${win.title}`}
              className="ml-0.5 flex-none rounded p-0.5 opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
