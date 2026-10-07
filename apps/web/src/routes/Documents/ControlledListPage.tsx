import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { RecordFrame } from "../../components/records/RecordFrame";
import { RecordReferences } from "../../components/records/WorkflowStepLinks";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { useCanEditSurface } from "../../components/shared/RecordEditBar";
import { useToast } from "../../components/shared/ToastProvider";
import { recordSurface } from "../../lib/recordSurface";
import {
  columnIndex,
  columnLetter,
  parseAddr,
  parseEdited,
  serialToIso,
  shownCell,
  type StoredCell,
  type StoredSheet,
} from "../../lib/controlledListMath";
import "./controlledList.css";

export type ControlledListKey = "lst-eqp-001" | "lst-gen-001" | "lst-gen-003";

interface ControlledListView {
  id: number;
  listKey: ControlledListKey;
  title: string;
  docId: string;
  revision: string;
  route: string;
  landscape: boolean;
  resource: "documents" | "calibration";
  statuses: string[];
  sheets: StoredSheet[];
}

interface CellPatch {
  v: string | number | null;
}

const DATA_START: Record<ControlledListKey, Record<string, number>> = {
  "lst-eqp-001": { "LST-EQP-001 - Master Equipment ": 6 },
  "lst-gen-001": { "Internal Documents": 4, "External Documents": 3 },
  "lst-gen-003": { "LST-GEN-003 - Scope of Laborato": 6 },
};

function errorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message || "Could not save the list.";
  }
  return "Could not save the list.";
}

function dateInputValue(value: string | number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return serialToIso(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return "";
}

function mergeOrigin(merges: string[]): Map<string, { cols: number; rows: number }> {
  const origins = new Map<string, { cols: number; rows: number }>();
  for (const merge of merges) {
    const [start, end] = merge.split(":");
    if (!start || !end) continue;
    const a = parseAddr(start);
    const b = parseAddr(end);
    origins.set(start, {
      cols: Math.max(1, columnIndex(b.col) - columnIndex(a.col) + 1),
      rows: Math.max(1, b.row - a.row + 1),
    });
  }
  return origins;
}

function coveredCells(merges: string[]): Set<string> {
  const covered = new Set<string>();
  for (const merge of merges) {
    const [start, end] = merge.split(":");
    if (!start || !end) continue;
    const a = parseAddr(start);
    const b = parseAddr(end);
    const c1 = columnIndex(a.col);
    const c2 = columnIndex(b.col);
    for (let row = a.row; row <= b.row; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        const addr = `${columnLetter(col)}${row}`;
        if (addr !== start) covered.add(addr);
      }
    }
  }
  return covered;
}

function SheetGrid({
  sheet,
  listKey,
  canEdit,
  statuses,
  onChange,
  onDeleteRow,
}: {
  sheet: StoredSheet;
  listKey: ControlledListKey;
  canEdit: boolean;
  statuses: string[];
  onChange: (addr: string, value: string | number | null) => void;
  onDeleteRow: (row: number) => void;
}) {
  const start = DATA_START[listKey][sheet.name] ?? sheet.maxRow + 1;
  const origins = mergeOrigin(sheet.merges);
  const covered = coveredCells(sheet.merges);
  const cells = [];
  for (let row = 1; row <= sheet.maxRow; row += 1) {
    for (let col = 1; col <= sheet.maxCol; col += 1) {
      const addr = `${columnLetter(col)}${row}`;
      if (covered.has(addr)) continue;
      const cell = sheet.cells[addr];
      const span = origins.get(addr);
      const shown = shownCell(sheet, addr);
      const editable = canEdit && (cell?.kind === "input" || (!cell && row >= start));
      const status = listKey === "lst-eqp-001" && columnLetter(col) === "J" && row >= start && editable;
      const date = Boolean(editable && cell?.nf && (cell.nf.includes("yy") || cell.nf.includes("mmm")));
      cells.push(
        <div
          key={addr}
          className={shown.tone ? `controlled-list-cell tone-${shown.tone}` : "controlled-list-cell"}
          data-addr={addr}
          data-size={cell?.size ?? undefined}
          title={cell?.comment}
          style={{
            gridColumn: `${col} / span ${span?.cols ?? 1}`,
            gridRow: `${row} / span ${span?.rows ?? 1}`,
            fontWeight: cell?.bold ? 700 : undefined,
            fontSize: cell?.size ? `${cell.size}px` : "11px",
            justifyContent: cell?.align === "center" ? "center" : cell?.align === "right" ? "flex-end" : "flex-start",
            textAlign: cell?.align === "center" ? "center" : cell?.align === "right" ? "right" : "left",
            whiteSpace: cell?.wrap ? "pre-wrap" : "nowrap",
          }}
        >
          {canEdit && col === 1 && row >= start && (
            <button type="button" className="controlled-list-row-delete no-print" title={`Delete row ${row}`} onClick={() => onDeleteRow(row)}>
              ×
            </button>
          )}
          <CellBody
            addr={addr}
            cell={cell}
            text={shown.text}
            editable={editable}
            status={status}
            date={date}
            statuses={statuses}
            onChange={onChange}
          />
        </div>,
      );
    }
  }
  return (
    <div
      className="controlled-list-sheet"
      data-testid={`controlled-list-${sheet.name.trim()}`}
      role="grid"
      aria-label={sheet.name.trim()}
      style={{
        gridTemplateColumns: sheet.colWidths.map((width) => `${width * 8}px`).join(" "),
        gridTemplateRows: Array.from({ length: sheet.maxRow }, (_, index) => `${((sheet.rowHeights[String(index + 1)] ?? 15) * 1.33).toFixed(1)}px`).join(" "),
        ["--print-cols" as string]: sheet.colWidths.map((width) => `${width}fr`).join(" "),
      }}
    >
      {cells}
    </div>
  );
}

function CellBody({
  addr,
  cell,
  text,
  editable,
  status,
  date,
  statuses,
  onChange,
}: {
  addr: string;
  cell: StoredCell | undefined;
  text: string;
  editable: boolean;
  status: boolean;
  date: boolean;
  statuses: string[];
  onChange: (addr: string, value: string | number | null) => void;
}) {
  if (!editable) {
    return <span className="controlled-list-screen-value">{text}</span>;
  }
  const current = typeof cell?.v === "string" || typeof cell?.v === "number" ? cell.v : "";
  const options = status && current && !statuses.includes(String(current)) ? [String(current), ...statuses] : statuses;
  return (
    <>
      <span className="controlled-list-print-value">{text}</span>
      {status ? (
        <select className="controlled-list-editor" aria-label={addr} value={current === "" ? "" : String(current)} onChange={(event) => onChange(addr, event.target.value || null)}>
          <option value="" />
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : date ? (
        <input className="controlled-list-editor" aria-label={addr} type="date" value={dateInputValue(cell?.v)} onChange={(event) => onChange(addr, event.target.value || null)} />
      ) : (
        <input
          className="controlled-list-editor"
          aria-label={addr}
          value={current === null ? "" : String(current)}
          onChange={(event) => onChange(addr, parseEdited(event.target.value, cell?.nf))}
        />
      )}
    </>
  );
}

export function ControlledListPage({ listKey }: { listKey: ControlledListKey }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const surface = recordSurface(
    listKey === "lst-eqp-001" ? "/calibration/master-list" : listKey === "lst-gen-003" ? "/documents/laboratory-scope" : "/documents/master-list",
  );
  const canEdit = useCanEditSurface(surface);
  const list = useQuery({
    queryKey: ["controlled-list", listKey],
    queryFn: async () => (await apiClient.get<ControlledListView>(`/controlled-lists/${listKey}`)).data,
  });
  const [view, setView] = useState<ControlledListView | null>(null);
  const [sheetName, setSheetName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef(new Map<string, Record<string, CellPatch>>());
  const timer = useRef<number | null>(null);
  const saveSeq = useRef(0);
  const viewRef = useRef<ControlledListView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    if (!list.data) return;
    setView((current) => current ?? list.data);
    setSheetName((current) => current || list.data.sheets[0]?.name || "");
  }, [list.data]);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  async function flush() {
    const current = viewRef.current;
    if (!current || pending.current.size === 0) return;
    const id = ++saveSeq.current;
    const sheets = [...pending.current.entries()].map(([name, cells]) => ({ name, cells }));
    pending.current = new Map();
    setSaving(true);
    setSaved(false);
    try {
      const next = (await apiClient.put<ControlledListView>(`/controlled-lists/${listKey}`, { sheets })).data;
      if (id !== saveSeq.current) return;
      setView((local) => {
        if (!local || pending.current.size > 0) return local;
        return next;
      });
      setSaved(true);
      void queryClient.setQueryData(["controlled-list", listKey], next);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function queue(name: string, addr: string, value: string | number | null) {
    const sheet = pending.current.get(name) ?? {};
    sheet[addr] = { v: value };
    pending.current.set(name, sheet);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flush();
    }, 400);
  }

  function edit(name: string, addr: string, value: string | number | null) {
    setSaved(false);
    setView((current) => {
      if (!current) return current;
      return {
        ...current,
        sheets: current.sheets.map((sheet) => {
          if (sheet.name !== name) return sheet;
          const existing = sheet.cells[addr];
          if (existing && existing.kind !== "input") return sheet;
          return { ...sheet, cells: { ...sheet.cells, [addr]: { ...existing, v: value, kind: "input", nf: existing?.nf } } };
        }),
      };
    });
    queue(name, addr, value);
  }

  async function changeRows(op: "add" | "delete", row?: number) {
    if (!view || !sheetName) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    await flush();
    try {
      const next = (await apiClient.post<ControlledListView>(`/controlled-lists/${listKey}/rows`, { sheet: sheetName, op, row })).data;
      setView(next);
      void queryClient.setQueryData(["controlled-list", listKey], next);
      setSaved(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function download() {
    try {
      if (timer.current != null) window.clearTimeout(timer.current);
      await flush();
      const res = await apiClient.get(`/controlled-lists/${listKey}/xlsx`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      const header = String(res.headers["content-disposition"] ?? "");
      const named = /filename="([^"]+)"/.exec(header)?.[1];
      link.href = url;
      link.download = named || `${view?.docId ?? listKey}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const sheet = view?.sheets.find((item) => item.name === sheetName) ?? view?.sheets[0];
  const home = listKey === "lst-eqp-001" ? { label: "Calibration", to: "/calibration" } : { label: "Documents", to: "/documents" };

  return (
    <RecordFrame
      className="controlled-list-frame"
      header={
        <div className="no-print flex flex-col gap-3">
          <RecordCrumbs items={[home, { label: view?.title ?? "Controlled list" }]} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{view?.title ?? "Controlled list"}</h1>
              <p className="text-sm text-muted-foreground">
                {view ? `${view.docId} · Rev ${view.revision}` : "Loading"}
                {saving ? " · Saving…" : saved ? " · Saved" : ""}
              </p>
            </div>
            <div className="controlled-list-tools flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void download()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                Download
              </button>
            </div>
          </div>
        </div>
      }
      related={
        view ? (
          <RecordReferences modules={[view.resource === "calibration" ? "calibration" : "documents"]} step={view.title} entityType="ControlledList" entityId={view.id} />
        ) : (
          <p className="text-sm text-muted-foreground">References load with the list.</p>
        )
      }
    >
      {list.isError && <p className="text-sm text-destructive">{errorMessage(list.error)}</p>}
      {view && sheet && (
        <div className={`controlled-list-print aq-print-sheet min-w-0 ${view.landscape ? "controlled-list-landscape aq-print-wide" : "controlled-list-portrait"}`}>
          <div className="controlled-list-print-banner">
            {view.docId} · Rev {view.revision}
          </div>
          {view.sheets.length > 1 && (
            <div className="controlled-list-tools mb-3 flex flex-wrap gap-2" role="tablist">
              {view.sheets.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  role="tab"
                  aria-selected={item.name === sheet.name}
                  className={item.name === sheet.name ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" : "rounded-md border border-border px-3 py-1.5 text-sm"}
                  onClick={() => setSheetName(item.name)}
                >
                  {item.name.trim()}
                </button>
              ))}
            </div>
          )}
          {view.sheets.map((item) => {
            const active = item.name === sheet.name;
            return (
              <div key={item.name} className={active ? "mb-2" : "controlled-list-inactive"}>
                {view.sheets.length > 1 && <h2 className="controlled-list-sheet-title">{item.name.trim()}</h2>}
                <div className="overflow-x-auto">
                  <SheetGrid
                    sheet={item}
                    listKey={listKey}
                    canEdit={canEdit && active}
                    statuses={view.statuses}
                    onChange={(addr, value) => edit(item.name, addr, value)}
                    onDeleteRow={(row) => {
                      const label = item.cells[`A${row}`]?.v;
                      const name = label == null || label === "" ? `row ${row}` : String(label);
                      if (window.confirm(`Delete ${name} from ${item.name.trim()}?`)) void changeRows("delete", row);
                    }}
                  />
                </div>
              </div>
            );
          })}
          {canEdit && (
            <button type="button" className="controlled-list-tools mt-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void changeRows("add")}>
              Add row
            </button>
          )}
        </div>
      )}
    </RecordFrame>
  );
}
