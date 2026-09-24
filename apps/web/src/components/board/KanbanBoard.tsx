import { useState, type ReactNode } from "react";
import { useToast } from "../shared/ToastProvider";
import type { Tone } from "../dashboard/kit";

export interface BoardColumn {
  key: string;
  label: string;
  tone: Tone;
}

const TONE_VAR: Record<Tone, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--info)",
};

/**
 * A drag-and-drop status board. It only ever lets a card move to the ONE
 * column that is its legitimate next step (`nextOf`) — the same one-step-at-a-time
 * rule the API enforces — and hands the move to `onMove`, which decides what the
 * step needs (a form, a confirmation) before any status really changes.
 */
export function KanbanBoard<T>({
  columns,
  items,
  columnOf,
  idOf,
  nextOf,
  canMove,
  onMove,
  renderCard,
  rejectMessage,
}: {
  columns: BoardColumn[];
  items: T[];
  columnOf: (item: T) => string;
  idOf: (item: T) => string | number;
  nextOf: (item: T) => string | null;
  canMove: boolean;
  onMove: (item: T, toColumn: string) => void;
  renderCard: (item: T) => ReactNode;
  rejectMessage: (item: T, toColumn: string) => string;
}) {
  const toast = useToast();
  const [dragging, setDragging] = useState<T | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const target = dragging ? nextOf(dragging) : null;

  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(15rem, 1fr))` }}>
      {columns.map((column) => {
        const cards = items.filter((item) => columnOf(item) === column.key);
        const isTarget = dragging != null && target === column.key;
        const isDim = dragging != null && !isTarget && columnOf(dragging) !== column.key;
        const tone = TONE_VAR[column.tone];
        return (
          <section
            key={column.key}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = isTarget ? "move" : "none";
              setHover(column.key);
            }}
            onDragLeave={() => setHover((h) => (h === column.key ? null : h))}
            onDrop={(e) => {
              e.preventDefault();
              const item = dragging;
              setHover(null);
              setDragging(null);
              if (!item || columnOf(item) === column.key) return;
              if (nextOf(item) === column.key) onMove(item, column.key);
              else toast.error(rejectMessage(item, column.key));
            }}
            className={`flex min-h-[16rem] flex-col rounded-xl border bg-card/60 transition-all ${isDim ? "opacity-45" : ""} ${isTarget ? "border-success ring-2 ring-success/60" : "border-border"} ${
              isTarget && hover === column.key ? "bg-success/10" : ""
            }`}
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <span className="led" style={{ ["--tone" as string]: tone, width: 8, height: 8 }} />
                {column.label}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums">{cards.length}</span>
            </header>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {isTarget && <p className="rounded-md border border-dashed border-success/60 py-2 text-center text-xs font-medium text-success">Drop here to move it forward</p>}
              {cards.map((item) => {
                const draggable = canMove && nextOf(item) != null;
                return (
                  <div
                    key={idOf(item)}
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(idOf(item)));
                      setDragging(item);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setHover(null);
                    }}
                    className={`rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md ${
                      draggable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragging && idOf(dragging) === idOf(item) ? "opacity-40" : ""}`}
                  >
                    {renderCard(item)}
                  </div>
                );
              })}
              {cards.length === 0 && !isTarget && <p className="py-6 text-center text-xs text-muted-foreground">Nothing here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
