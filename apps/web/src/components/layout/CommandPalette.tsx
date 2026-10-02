import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { apiClient } from "../../api/client";
import type { SearchResult } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useOpenTab } from "../../hooks/useOpenTab";
import { useCurrentUser } from "../../hooks/useAuth";
import { readRecentRecords, rememberRecord, type RecentRecord } from "../../lib/recentRecords";
import { paletteFilterValue, paletteQueryWithout, parsePaletteQuery } from "../../lib/paletteQuery";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import { FRM_NCR_PATH } from "../../lib/qualityEntry";
import { faiValidationDocumentsHref } from "../../lib/folderBrowse";
import { flattenSidebarLinks, sidebarLinkOpensNewTab } from "./sidebarStructure";
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
  const user = useCurrentUser();
  const { folders } = useArrangedSidebar();
  const dialogRef = useDialogBehavior(open, onClose);
  const debouncedRaw = useDebouncedValue(query.trim(), 250);
  const debounced = useMemo(() => parsePaletteQuery(debouncedRaw), [debouncedRaw]);
  const live = useMemo(() => parsePaletteQuery(query), [query]);

  const pages = useMemo(() => flattenSidebarLinks(folders), [folders]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    setRecent(readRecentRecords(user?.id));
  }, [open, user?.id]);

  const { data, isFetching } = useQuery<{ results: SearchResult[] }>({
    queryKey: ["search", debounced.text, debounced.filters],
    queryFn: async () =>
      (
        await apiClient.get("/search", {
          params: {
            q: debounced.text,
            type: paletteFilterValue(debounced.filters, "type"),
            plant: paletteFilterValue(debounced.filters, "plant"),
            status: paletteFilterValue(debounced.filters, "status"),
            assigned: paletteFilterValue(debounced.filters, "assigned"),
          },
        })
      ).data,
    enabled: open && (debounced.text.length > 0 || debounced.filters.length > 0),
  });

  const needle = live.text.toLowerCase();
  const typeFilter = paletteFilterValue(live.filters, "type")?.toLowerCase() ?? "";

  const items = useMemo(() => {
    const actions: PaletteItem[] = [
      { id: "create-ncr", label: "Create NCR", hint: "Action", run: () => navigate(FRM_NCR_PATH) },
      { id: "schedule-audit", label: "Schedule Audit", hint: "Action", run: () => navigate("/audits?new=1") },
      { id: "log-calibration", label: "Log Calibration", hint: "Action", run: () => navigate("/calibration?new=1") },
      { id: "folder-explorer", label: "Folder Explorer", hint: "Go to", run: () => navigate("/documents/folders") },
      { id: "new-capa", label: "New CAPA", hint: "Action", run: () => navigate("/capa?new=1") },
      { id: "start-validation", label: "Start validation", hint: "Action", run: () => navigate("/workflow?template=validation") },
      { id: "upload-validation", label: "Upload to Validation Reports", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-validation-report", label: "New FRM-VAL-001 CSA VALIDATION REPORT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-fuel-pump", label: "New FRM-VAL-007 FUEL PUMP VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-air-strut", label: "New FRM-VAL-010 AIR STRUT VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-air-spring", label: "New FRM-VAL-011 AIR STRUT VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-fuel-injector", label: "New FRM-VAL-008 FUEL INJECTOR VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-brake-wear", label: "New FRM-VAL-009 BRAKE WEAR SENSOR VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-shock", label: "New FRM-VAL-002 SHOCK VALIDATION REPORT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-air-compressor", label: "New FRM-VAL-003 AIR COMPRESSOR VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-electric-lift", label: "New FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-gas-lift", label: "New FRM-VAL-005 GAS LIFT SUPPORT VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-coil-spring", label: "New FRM-VAL-006 COIL SPRING VALIDATION DOCUMENT", hint: "Action", run: () => navigate(faiValidationDocumentsHref()) },
      { id: "new-audit-summary", label: "New TMP-GEN-001 INTERNAL AUDIT SUMMARY REPORT", hint: "Action", run: () => navigate("/iso-forms/frm-gen-002") },
      { id: "new-visitor-log", label: "New LST-VIS-001 DMA Laboratory Visitor Log", hint: "Action", run: () => navigate("/iso-forms/lst-vis-001") },
      { id: "new-monthly-eng", label: "New TMP-ENG-001 MONTHLY ENGINEERING DEVELOPMENT REPORT", hint: "Action", run: () => navigate("/iso-forms/rpt-eng-001") },
      { id: "new-salt-spray", label: "New FRM-TRP-002 SALT SPRAY TEST REPORT (ASTM B117)", hint: "Action", run: () => navigate("/iso-forms/frm-trp-002") },
      { id: "new-volume-water", label: "New FRM-TST-001 ASTM E542 Gravimetric Volume Calculator (Water)", hint: "Action", run: () => navigate("/iso-forms/frm-tst-001") },
      { id: "new-volume-heptane", label: "New FRM-TST-002 ASTM E542 Gravimetric Volume Calculator (n-Heptane)", hint: "Action", run: () => navigate("/iso-forms/frm-tst-002") },
      { id: "new-prototype-strut", label: "New FRM-TRP-001 PROTOTYPE EVALUATION REPORT (STRUT ASSEMBLY)", hint: "Action", run: () => navigate("/iso-forms/frm-trp-001") },
      { id: "new-dev-csa", label: "New FRM-DEV-001 CSA DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-001") },
      { id: "new-dev-fuel-pump", label: "New FRM-DEV-002 FUEL PUMP DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-002") },
      { id: "new-dev-gas-lift", label: "New FRM-DEV-003 GAS LIFT SUPPORT DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-003") },
      { id: "new-dev-coil", label: "New FRM-DEV-004 COIL SPRING DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-004") },
      { id: "new-dev-air-spring", label: "New FRM-DEV-005 AIR SPRING DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-005") },
      { id: "new-dev-air-strut", label: "New FRM-DEV-006 AIR STRUT DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-006") },
      { id: "new-dev-brake-wear", label: "New FRM-DEV-007 BRAKE WEAR SENSOR DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-007") },
      { id: "new-dev-electronic-shock", label: "New FRM-DEV-008 ELECTRONIC SHOCK ABSORBER DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-008") },
      { id: "new-dev-air-compressor", label: "New FRM-DEV-009 AIR COMPRESSOR DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-009") },
      { id: "new-dev-fuel-injector", label: "New FRM-DEV-010 FUEL INJECTOR DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-010") },
      { id: "new-dev-electric-lift", label: "New FRM-DEV-011 ELECTRIC LIFT SUPPORT DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-011") },
      { id: "new-dev-electronic-csa", label: "New FRM-DEV-012 ELECTRONIC CSA DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-012") },
      { id: "new-dev-shock", label: "New FRM-DEV-013 SHOCK ABSORBER DEVELOPMENT DOCUMENT", hint: "Action", run: () => navigate("/iso-forms/frm-dev-013") },
      { id: "new-ecr-form", label: "New FRM-ECR-001 ENGINEERING CHANGE REQUEST (ECR)", hint: "Action", run: () => navigate("/iso-forms/frm-ecr-001") },
      { id: "new-drawing-change", label: "New FRM-DWG-001 DRAWING CHANGE REQUEST", hint: "Action", run: () => navigate("/iso-forms/frm-dwg-001") },
      { id: "new-process-change-request", label: "New FRM-PCR-001 PROCESS CHANGE REQUEST", hint: "Action", run: () => navigate("/iso-forms/frm-pcr-001") },
      { id: "new-document-change-sheet", label: "New FRM-DOC-001 DOCUMENT CHANGE REQUEST", hint: "Action", run: () => navigate("/iso-forms/frm-doc-001") },
      { id: "new-scar-request", label: "New FRM-CAR-001 SUPPLIER CORRECTIVE ACTION REQUEST (SCAR)", hint: "Action", run: () => navigate("/iso-forms/frm-car-001") },
      { id: "new-competency", label: "New FRM-TRN-001 COMPETENCY AND TRAINING RECORD", hint: "Action", run: () => navigate("/iso-forms/frm-trn-001") },
      { id: "new-cross-training", label: "New FRM-TRN-002 GRADING RUBRIC: CROSS-TRAINING EVALUATION", hint: "Action", run: () => navigate("/iso-forms/frm-trn-002") },
      { id: "assignments", label: "Go to my assignments", hint: "Action", run: () => navigate("/home") },
      { id: "theme", label: "Toggle theme", hint: "Action", run: () => window.dispatchEvent(new Event("accuqual-toggle-theme")) },
    ].filter((action) => {
      const blob = `${action.label} ${action.hint ?? ""}`.toLowerCase();
      if (needle && !blob.includes(needle)) return false;
      if (typeFilter && !blob.includes(typeFilter)) return false;
      return true;
    });

    const hideRecent = Boolean(needle) || live.filters.some((filter) => filter.key !== "type");
    const recentItems: PaletteItem[] = hideRecent
      ? []
      : recent.filter((record) => !typeFilter || record.type.toLowerCase().includes(typeFilter)).map((record) => ({
          id: `recent-${record.path}`,
          label: record.title,
          hint: "Recent",
          run: () => {
            openTab({ path: record.path, title: record.title, icon: "default" });
          },
        }));

    const pageItems: PaletteItem[] = (needle || typeFilter
      ? pages.filter((page) => {
          const blob = `${page.label} ${page.key}`.toLowerCase();
          if (needle && !blob.includes(needle)) return false;
          if (typeFilter && !blob.includes(typeFilter)) return false;
          return true;
        }).slice(0, 8)
      : []
    ).map((page) => ({
        id: `page-${page.key}`,
        label: page.label,
        hint: sidebarLinkOpensNewTab(page) ? "New tab" : "Go to",
        run: () => {
          if (sidebarLinkOpensNewTab(page)) {
            window.open(page.path, "_blank", "noopener,noreferrer");
            return;
          }
          navigate(page.path);
        },
      }));

    const recordItems: PaletteItem[] = (data?.results ?? []).map((result) => ({
      id: `record-${result.type}-${result.id}`,
      label: result.label,
      hint: result.type,
      run: () => {
        rememberRecord({ path: result.path, title: result.label, type: result.type }, user?.id);
        openTab({ path: result.path, title: result.label, icon: "default" });
      },
    }));

    return [...actions, ...recentItems, ...pageItems, ...recordItems];
  }, [data?.results, live.filters, navigate, needle, openTab, pages, recent, typeFilter, user?.id]);

  useEffect(() => {
    setActive(0);
  }, [needle, typeFilter]);

  useEffect(() => {
    const id = items[active]?.id;
    if (!id) return;
    document.getElementById(`palette-item-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

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
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
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
        {live.filters.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {live.filters.map((filter) => (
              <button
                key={`${filter.key}:${filter.value}`}
                type="button"
                onClick={() => setQuery(paletteQueryWithout(query, filter.key, filter.value))}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
              >
                <span className="font-medium text-muted-foreground">{filter.key}:</span>
                {filter.value}
                <X size={12} aria-hidden />
                <span className="sr-only">Remove {filter.key} filter</span>
              </button>
            ))}
          </div>
        )}
        <div id="palette-list" role="listbox" aria-label="Commands" className="max-h-[60vh] overflow-y-auto p-1">
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
