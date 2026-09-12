import { useWindowStore } from "./useWindowStore";
import { WindowManager } from "./WindowManager";

/** Mounted once (see AppLayout) — renders every open window, floating above the routed page. */
export function WindowContainer() {
  const windows = useWindowStore((s) => s.windows);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {windows.map((win) => (
        <WindowManager key={win.id} win={win} />
      ))}
    </div>
  );
}
