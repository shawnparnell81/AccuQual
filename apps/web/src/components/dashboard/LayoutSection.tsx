import { useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import type { DashboardSectionId } from "../../hooks/useDashboardLayout";
import { useReorderDrop } from "../shared/useReorderDrop";

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
  onMove: (moving: DashboardSectionId, target: DashboardSectionId, position: "before" | "after") => void;
  dragging: DashboardSectionId | null;
  setDragging: (id: DashboardSectionId | null) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const drop = useReorderDrop(false, (position) => {
    if (!dragging || dragging === id || position === "inside") return;
    onMove(dragging, id, position);
    setDragging(null);
  }, editing && dragging !== null && dragging !== id);
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
        setOver(true);
        drop.onDragOver(e);
      }}
      onDragLeave={() => {
        setOver(false);
        drop.onDragLeave();
      }}
      onDrop={(e) => {
        setOver(false);
        drop.onDrop(e);
      }}
      className={`cursor-grab rounded-2xl border-2 border-dashed p-3 transition-all active:cursor-grabbing ${over ? drop.dropClass || "border-primary bg-primary/10" : "border-primary/30"} ${dragging === id ? "opacity-40" : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <GripVertical size={14} /> {label} <span className="font-normal normal-case tracking-normal">· drag to move</span>
      </div>
      <div className="pointer-events-none select-none">{children}</div>
    </div>
  );
}
