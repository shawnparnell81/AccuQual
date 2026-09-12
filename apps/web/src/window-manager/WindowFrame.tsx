import type { ReactNode } from "react";
import { Rnd } from "react-rnd";
import { Minus, Square, X } from "lucide-react";
import type { WindowInstance } from "../types/window";
import { useWindowStore } from "./useWindowStore";

interface WindowFrameProps {
  win: WindowInstance;
  children: ReactNode;
}

/** One draggable/resizable window: title bar with minimize/maximize/close, z-index stacking. */
export function WindowFrame({ win, children }: WindowFrameProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, updateRect } = useWindowStore();

  if (win.minimized) return null;

  const rect = win.maximized ? { x: 8, y: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 } : win;

  return (
    <Rnd
      size={{ width: rect.width, height: rect.height }}
      position={{ x: rect.x, y: rect.y }}
      onDragStop={(_e, d) => !win.maximized && updateRect(win.id, { x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, position) =>
        !win.maximized && updateRect(win.id, { width: ref.offsetWidth, height: ref.offsetHeight, ...position })
      }
      onMouseDown={() => focusWindow(win.id)}
      dragHandleClassName="accuqual-window-titlebar"
      disableDragging={win.maximized}
      enableResizing={!win.maximized}
      style={{ zIndex: win.zIndex }}
      minWidth={360}
      minHeight={240}
      bounds="window"
      className="pointer-events-auto"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="accuqual-window-titlebar flex cursor-move items-center justify-between border-b border-border bg-muted px-3 py-2">
          <span className="truncate text-sm font-medium">{win.title}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => minimizeWindow(win.id)} className="rounded p-1 hover:bg-background" aria-label="Minimize">
              <Minus size={14} />
            </button>
            <button onClick={() => toggleMaximize(win.id)} className="rounded p-1 hover:bg-background" aria-label="Maximize">
              <Square size={12} />
            </button>
            <button onClick={() => closeWindow(win.id)} className="rounded p-1 hover:bg-destructive/20" aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </Rnd>
  );
}
