import { useRef, useState, type DragEvent } from "react";
import { dropPosition, reorderDropClass, type DropPosition } from "../../lib/listReorder";

/**
 * Drop handling for one sortable row. `onPlace` receives before, after, or
 * inside. Call it from a component that renders a single row (not inside a loop).
 */
export function useReorderDrop(allowNest: boolean, onPlace: (position: DropPosition) => void, enabled = true) {
  const hint = useRef<DropPosition | null>(null);
  const [position, setPosition] = useState<DropPosition | null>(null);
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const next = dropPosition(event.clientY, rect.top, rect.height, allowNest);
    hint.current = next;
    setPosition(next);
    event.dataTransfer.dropEffect = "move";
  }

  function onDragLeave() {
    hint.current = null;
    setPosition(null);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const next = hint.current ?? dropPosition(event.clientY, rect.top, rect.height, allowNest);
    hint.current = null;
    setPosition(null);
    placeRef.current(next);
  }

  return { position, dropClass: reorderDropClass(position), onDragOver, onDragLeave, onDrop };
}
