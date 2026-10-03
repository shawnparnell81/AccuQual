import { useState } from "react";
import { useWorkspaceSurface } from "../../hooks/useWorkspaceLayout";

/** Show, hide, and reorder the sections this person is allowed to see. */
export function WorkspaceArrange({
  surface,
  labels,
  allowed,
}: {
  surface: "home" | "dashboard";
  labels: Record<string, string>;
  allowed: (id: string) => boolean;
}) {
  const { arrangeIds, hidden, save, reset, pending } = useWorkspaceSurface(surface, allowed);
  const [open, setOpen] = useState(false);

  function commit(order: string[], nextHidden: Set<string>) {
    save({ order, hidden: [...nextHidden] });
  }

  function move(id: string, direction: -1 | 1) {
    const index = arrangeIds.indexOf(id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= arrangeIds.length) return;
    const order = [...arrangeIds];
    const [row] = order.splice(index, 1);
    order.splice(swap, 0, row!);
    commit(order, hidden);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
          {open ? "Done" : "Arrange"}
        </button>
      </div>
      {open && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Choose which sections show, and their order. This is saved for you only.</p>
            <button type="button" disabled={pending} onClick={() => reset()} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
              Reset
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {arrangeIds.map((id, index) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!hidden.has(id)}
                  aria-label={`Show ${labels[id] ?? id}`}
                  onChange={() => {
                    const next = new Set(hidden);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    commit(arrangeIds, next);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{labels[id] ?? id}</span>
                <button type="button" disabled={index === 0 || pending} onClick={() => move(id, -1)} className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-40">
                  Up
                </button>
                <button type="button" disabled={index === arrangeIds.length - 1 || pending} onClick={() => move(id, 1)} className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-40">
                  Down
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
