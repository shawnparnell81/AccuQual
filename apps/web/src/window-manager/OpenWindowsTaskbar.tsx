import { Maximize2, Square, X } from "lucide-react";
import { useWindowStore } from "./useWindowStore";

/**
 * Multiple open windows stack with only a small cascading offset (see
 * useWindowStore's `openWindow`) — with two or more open, one covers most
 * of the other and there was previously no persistent list showing how many
 * were actually open or letting you switch between them without hunting
 * through the stack. A minimized window is worse: WindowFrame.tsx returns
 * null for one entirely (no other way back short of re-opening the exact
 * same record from wherever it was first opened).
 *
 * This strip is always visible while at least one window is open — not
 * just while one is minimized — one chip per window. Click a chip to bring
 * that window to front (restoring it first if it was minimized); each
 * chip's own × closes it without switching to it first. The currently
 * focused window (highest z-index, not minimized) is highlighted so it's
 * obvious which one you're looking at.
 */
export function OpenWindowsTaskbar() {
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  if (windows.length === 0) return null;

  const topZIndex = Math.max(...windows.filter((w) => !w.minimized).map((w) => w.zIndex));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-2">
      <div className="pointer-events-auto flex max-w-[90vw] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 shadow-xl">
        {windows.map((win) => {
          const isActive = !win.minimized && win.zIndex === topZIndex;
          return (
            <button
              key={win.id}
              onClick={() => focusWindow(win.id)}
              title={win.minimized ? `Restore ${win.title}` : `Switch to ${win.title}`}
              className={`group flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                isActive ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted"
              } ${win.minimized ? "opacity-70" : ""}`}
            >
              {win.minimized ? (
                <Maximize2 size={12} className="shrink-0 text-muted-foreground" />
              ) : (
                <Square size={9} className="shrink-0 text-muted-foreground" />
              )}
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
          );
        })}
      </div>
    </div>
  );
}
