import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useNavVisibility } from "./navVisibility";
import { navSearchText, plainNav } from "../../lib/opsLanguage";
import { GlobalSearchResults } from "./GlobalSearchResults";

/**
 * Cmd/Ctrl+K quick-jump — two result groups: "Go to" (every module this
 * viewer can currently see, from the same live source TopNav's dropdowns
 * use — see navVisibility.ts) and "Records" (the existing GET /search +
 * GlobalSearchResults, unmodified — the same debounce, RBAC, and
 * open-as-a-tab behavior the header search box already has). Deliberately
 * a lightweight overlay of its own rather than Modal.tsx: that component's
 * drag handle and backdrop-click-to-close chrome is dialog UX, not the
 * type-and-go feel a palette needs.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { allVisibleLeaves } = useNavVisibility();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allVisibleLeaves.filter((l) => navSearchText(l.key, l.label).includes(q)).slice(0, 8);
  }, [allVisibleLeaves, query]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={15} className="flex-none text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page or search records…"
            className="flex-1 bg-transparent py-1 text-sm outline-none"
          />
          <kbd className="flex-none rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {navMatches.length > 0 && (
            <div className="border-b border-border p-1">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Go to</p>
              {navMatches.map((leaf) => (
                <button
                  key={leaf.key}
                  onClick={() => {
                    navigate(leaf.path);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <leaf.icon size={15} className="flex-none text-muted-foreground" />
                  {plainNav(leaf.key, leaf.label).label}
                </button>
              ))}
            </div>
          )}
          <GlobalSearchResults query={query} onSelect={onClose} />
          {!query.trim() && <p className="p-4 text-center text-sm text-muted-foreground">Start typing a page name or a record number…</p>}
        </div>
      </div>
    </>
  );
}
