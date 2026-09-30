import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiClient } from "../../api/client";
import type { SearchResult } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useOpenTab } from "../../hooks/useOpenTab";
import { readRecentRecords, rememberRecord, type RecentRecord } from "../../lib/recentRecords";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import { flattenSidebarLinks } from "./sidebarStructure";
import { useArrangedSidebar } from "./sidebarOrganize";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Ctrl/Cmd+K. Pages come from the same sidebar tree as the menu (including
 * admin-only entries). Records use GET /search. Arrow keys move the
 * highlight; Enter opens it.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentRecord[]>([]);
  const navigate = useNavigate();
  const openTab = useOpenTab();
  const { folders } = useArrangedSidebar();
  const dialogRef = useDialogBehavior(open, onClose);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const pages = useMemo(() => flattenSidebarLinks(folders), [folders]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    setRecent(readRecentRecords());
  }, [open]);

  const { data, isFetching } = useQuery<{ results: SearchResult[] }>({
    queryKey: ["search", debouncedQuery],
    queryFn: async () => (await apiClient.get("/search", { params: { q: debouncedQuery } })).data,
    enabled: open && debouncedQuery.length > 0,
  });

  const needle = query.trim().toLowerCase();

  const items = useMemo(() => {
    const actions: PaletteItem[] = [
      { id: "new-ncr", label: "New NCR", hint: "Action", run: () => navigate("/ncr?new=1") },
      { id: "new-capa", label: "New CAPA", hint: "Action", run: () => navigate("/capa?new=1") },
      { id: "start-validation", label: "Start validation", hint: "Action", run: () => navigate("/workflow?template=validation") },
      { id: "upload-validation", label: "Upload to Validation Reports", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-validation-report", label: "New CSA Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-fuel-pump", label: "New Fuel Pump Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-air-strut", label: "New Air Strut Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-air-spring", label: "New Air Spring Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-fuel-injector", label: "New Fuel Injector Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-brake-wear", label: "New Brake Wear Sensor Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-shock", label: "New Shock Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-air-compressor", label: "New Air Compressor Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-electric-lift", label: "New Electric Lift Support Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-gas-lift", label: "New Gas Lift Support Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-coil-spring", label: "New Coil Spring Validation", hint: "Action", run: () => navigate("/folders/validation-reports") },
      { id: "new-audit-summary", label: "New Internal Audit Summary Report", hint: "Action", run: () => navigate("/iso-forms/frm-gen-002") },
      { id: "new-visitor-log", label: "New DMA Laboratory Visitor Log", hint: "Action", run: () => navigate("/iso-forms/lst-vis-001") },
      { id: "new-monthly-eng", label: "New Monthly Engineering Development Report", hint: "Action", run: () => navigate("/iso-forms/rpt-eng-001") },
      { id: "assignments", label: "Go to my assignments", hint: "Action", run: () => navigate("/home") },
      { id: "theme", label: "Toggle theme", hint: "Action", run: () => window.dispatchEvent(new Event("accuqual-toggle-theme")) },
    ].filter((action) => !needle || action.label.toLowerCase().includes(needle));

    const recentItems: PaletteItem[] = needle
      ? []
      : recent.map((record) => ({
          id: `recent-${record.path}`,
          label: record.title,
          hint: "Recent",
          run: () => {
            openTab({ path: record.path, title: record.title, icon: "default" });
          },
        }));

    const pageItems: PaletteItem[] = (needle ? pages.filter((page) => `${page.label} ${page.key}`.toLowerCase().includes(needle)).slice(0, 8) : []).map((page) => ({
        id: `page-${page.key}`,
        label: page.label,
        hint: "Go to",
        run: () => navigate(page.path),
      }));

    const recordItems: PaletteItem[] = (data?.results ?? []).map((result) => ({
      id: `record-${result.type}-${result.id}`,
      label: result.label,
      hint: result.type,
      run: () => {
        rememberRecord({ path: result.path, title: result.label, type: result.type });
        openTab({ path: result.path, title: result.label, icon: "default" });
      },
    }));

    return [...actions, ...recentItems, ...pageItems, ...recordItems];
  }, [data?.results, navigate, needle, openTab, pages, recent]);

  useEffect(() => {
    setActive(0);
  }, [needle]);

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [active, items.length]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    item.run();
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="aq-menu modal-in fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-border bg-card text-foreground shadow-xl outline-none"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={15} className="flex-none text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, run an action, or search records…"
            aria-label="Command palette search"
            aria-activedescendant={items[active] ? `palette-item-${items[active]!.id}` : undefined}
            aria-controls="palette-list"
            className="flex-1 bg-transparent py-1 text-sm outline-none"
          />
          <kbd className="flex-none rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-1">
          {items.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">{isFetching ? "Searching…" : "No matches. Try a page name or a record number."}</p>
          )}
          {items.map((item, index) => (
            <button
              id={`palette-item-${item.id}`}
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${index === active ? "bg-secondary" : "hover:bg-secondary"}`}
            >
              {item.hint && <span className="w-16 flex-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.hint}</span>}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
