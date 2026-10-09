import { useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

/**
 * A name that may be cut off with an ellipsis. Hover and keyboard focus show the full text
 * in the app's own colors. The title attribute remains for browsers that only show a native tip.
 */
export function TruncatedName({ name, className, focusable = false }: { name: string; className?: string; focusable?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  function show(event: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) {
    const el = event.currentTarget;
    if (el.scrollWidth <= el.clientWidth + 1) {
      setTip(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setTip({ left, top: rect.bottom + 6 });
  }

  return (
    <>
      <span
        ref={ref}
        className={clsx("min-w-0 truncate", className)}
        title={name}
        tabIndex={focusable ? 0 : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
      >
        {name}
      </span>
      {tip &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[80] max-w-sm rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-lg"
            style={{ left: tip.left, top: tip.top }}
          >
            {name}
          </span>,
          document.body,
        )}
    </>
  );
}
