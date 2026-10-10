import { useLayoutEffect, useRef, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { findPageScroller } from "../../lib/dragAutoScroll";
import { draftKey, isEditField, isSaveControl, subrouteHasUnsaved, subtabHasUnsaved } from "../../lib/sectionKeepAlive";
import { useDirtyPathStore } from "../../store/dirtyPathStore";

function fieldOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-draft-ignore]")) return null;
  return target.closest("input, textarea, select, [contenteditable='true'], [role='switch']");
}

function markEdit(target: EventTarget | null, key: string, setDirtyPath: (path: string, dirty: boolean) => void) {
  const field = fieldOf(target);
  if (!field) return;
  const type = field instanceof HTMLInputElement ? field.type : undefined;
  if (!isEditField(field.tagName, type, field.getAttribute("role") ?? undefined)) return;
  setDirtyPath(key, true);
}

function markSaved(target: EventTarget | null, key: string, setDirtyPath: (path: string, dirty: boolean) => void) {
  if (!(target instanceof Element)) return;
  const button = target.closest("button, [role='button']");
  if (!button) return;
  const type = button instanceof HTMLButtonElement ? button.type : (button.getAttribute("type") ?? undefined);
  const label = button.getAttribute("aria-label") || button.textContent || "";
  if (!isSaveControl(label, type ?? undefined)) return;
  queueMicrotask(() => setDirtyPath(key, false));
}

export function useDraftHandlers(key: string) {
  const setDirtyPath = useDirtyPathStore((state) => state.setDirtyPath);
  return {
    onInput: (event: FormEvent) => markEdit(event.target, key, setDirtyPath),
    onChange: (event: FormEvent) => markEdit(event.target, key, setDirtyPath),
    onClick: (event: ReactMouseEvent) => markSaved(event.target, key, setDirtyPath),
  };
}

/** Dot for a sub-route, or for one in-page tab when `subtab` is set. */
export function UnsavedDot({ path, subtab }: { path?: string; subtab?: string }) {
  const location = useLocation();
  const paths = useDirtyPathStore((state) => state.paths);
  const base = path ?? location.pathname;
  const on = subtab ? subtabHasUnsaved(paths, base, subtab) : subrouteHasUnsaved(paths, base);
  if (!on) return null;
  return <span className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />;
}

/**
 * In-page sub-tabs stay mounted after the first visit. The page scroller's
 * position is restored when the user comes back to a tab.
 */
export function KeptPanes({ active, panes }: { active: string; panes: { id: string; node: ReactNode }[] }) {
  const seenRef = useRef<string[]>([active]);
  if (!seenRef.current.includes(active)) seenRef.current = [...seenRef.current, active];
  const seen = seenRef.current;
  const hostRef = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Record<string, number>>({});
  const pathname = useLocation().pathname;

  useLayoutEffect(() => {
    const scroller = findPageScroller(hostRef.current);
    const onScroll = () => {
      scrolls.current[active] = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.scrollTop = scrolls.current[active] ?? 0;
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [active]);

  return (
    <div ref={hostRef}>
      {panes
        .filter((pane) => seen.includes(pane.id))
        .map((pane) => (
          <KeptPane key={pane.id} id={pane.id} active={active} pathname={pathname}>
            {pane.node}
          </KeptPane>
        ))}
    </div>
  );
}

function KeptPane({ id, active, pathname, children }: { id: string; active: string; pathname: string; children: ReactNode }) {
  const handlers = useDraftHandlers(draftKey(pathname, id));
  return (
    <div hidden={id !== active} {...handlers}>
      {children}
    </div>
  );
}
