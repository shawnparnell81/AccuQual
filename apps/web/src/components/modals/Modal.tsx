import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GripHorizontal, X } from "lucide-react";
import clsx from "clsx";

interface ModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** How much of the title bar must stay on screen so a dragged card can always be grabbed again. */
const MIN_VISIBLE_PX = 96;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface DragState {
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  rect: DOMRect;
}

/**
 * Every dialog card in the app. The title bar drags the card anywhere on the
 * screen (so the text or field it was covering can be read or copied);
 * double-click the title bar to put it back in the middle. While a card has
 * been moved the dark backdrop is dropped (the page behind is fully
 * readable) and clicking outside no longer closes it, so an errant click
 * while reading the page behind can't throw away half-filled form data.
 */
export function Modal({ title, isOpen, onClose, children }: ModalProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  // A click only counts as "outside" when the press ALSO began on the backdrop — releasing a drag over it must not close the card.
  const pressStartedOnBackdrop = useRef(false);
  const moved = offset.x !== 0 || offset.y !== 0;

  // A card that is closed and reopened starts centered again.
  useEffect(() => {
    if (!isOpen) setOffset({ x: 0, y: 0 });
  }, [isOpen]);

  if (!isOpen) return null;

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || !cardRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y, rect: cardRef.current.getBoundingClientRect() };
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    // Keep the title bar reachable: never let the card leave the screen entirely.
    const dx = clamp(e.clientX - d.startX, MIN_VISIBLE_PX - d.rect.width - d.rect.left, window.innerWidth - MIN_VISIBLE_PX - d.rect.left);
    const dy = clamp(e.clientY - d.startY, -d.rect.top, window.innerHeight - 48 - d.rect.top);
    setOffset({ x: d.baseX + dx, y: d.baseY + dy });
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      className={clsx("modal-in fixed inset-0 z-50 flex items-center justify-center p-3", moved ? "bg-transparent" : "bg-black/50 backdrop-blur-[2px]")}
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (!moved && pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex cursor-move touch-none select-none items-center justify-between gap-2 border-b border-border p-6 pb-4"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setOffset({ x: 0, y: 0 })}
          title="Drag to move · double-click to re-center"
        >
          <div className="flex min-w-0 items-center gap-2">
            <GripHorizontal size={16} className="flex-none text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate text-lg font-semibold">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {/* Content scrolls on its own so tall generated output (e.g. a real
            AI response) never pushes action buttons past the bottom of the
            viewport with no way to reach them — the box itself never grows
            past 85% of the viewport height, unlike before, when it had no
            height limit at all. */}
        <div className="overflow-y-auto p-6 pt-4">{children}</div>
      </div>
    </div>
  );
}
