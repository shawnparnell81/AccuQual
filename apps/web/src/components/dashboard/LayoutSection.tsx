import { useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import type { DashboardSectionId } from "../../hooks/useDashboardLayout";

/** A dashboard block that can be dragged to a new position while the page is in customize mode. */
export function LayoutSection({
  id,
  label,
  editing,
  onMove,
  dragging,
  setDragging,
  children,
}: {
  id: DashboardSectionId;
  label: string;
  editing: boolean;
  onMove: (moving: DashboardSectionId, target: DashboardSectionId) => void;
  dragging: DashboardSectionId | null;
  setDragging: (id: DashboardSectionId | null) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  if (!editing) return <>{children}</>;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        setDragging(id);
      }}
      onDragEnd={() => {
        setDragging(null);
        setOver(false);
      }}
      onDragOver={(e) => {
        if (!dragging || dragging === id) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (dragging) onMove(dragging, id);
        setDragging(null);
      }}
      className={`cursor-grab rounded-2xl border-2 border-dashed p-3 transition-all active:cursor-grabbing ${over ? "border-primary bg-primary/10" : "border-primary/30"} ${dragging === id ? "opacity-40" : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <GripVertical size={14} /> {label} <span className="font-normal normal-case tracking-normal">· drag to move</span>
      </div>
      <div className="pointer-events-none select-none">{children}</div>
    </div>
  );
}
