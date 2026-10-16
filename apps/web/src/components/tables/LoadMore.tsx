import { useEffect, useRef } from "react";

/** Rows shown or fetched per step in long lists. */
export const LIST_STEP = 150;

/**
 * The end of a long list. Scrolling it into view loads the next step; the
 * button does the same for keyboard users and when the list fits on screen.
 */
export function LoadMore({
  shown,
  total,
  loading = false,
  onMore,
  noun = "rows",
}: {
  shown: number;
  total: number | null;
  loading?: boolean;
  onMore: () => void;
  noun?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const more = total == null || shown < total;
  const latest = useRef(onMore);
  latest.current = onMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !more || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    }, { rootMargin: "400px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, loading, shown]);

  if (total != null && total <= shown && shown <= LIST_STEP) return null;
  return (
    <div ref={ref} className="col-span-full flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground" data-testid="list-load-more">
      <span>
        {total == null ? `${shown.toLocaleString()} ${noun}` : `${Math.min(shown, total).toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </span>
      {more && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => onMore()}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
