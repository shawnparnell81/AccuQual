import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isAxiosError } from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { RecordFrame } from "../../components/records/RecordFrame";
import { RecordReferences } from "../../components/records/WorkflowStepLinks";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { useItemFolderPath } from "../../components/documents/ItemFolderPath";
import { useConfirm } from "../../components/shared/ConfirmDialog";
import { useCanEditSurface } from "../../components/shared/RecordEditBar";
import { useToast } from "../../components/shared/ToastProvider";
import { commitAndReload, gestureFromKey, gestureSavesEdit, headerBandEnd, moveAddr, moveTab, placedCells, type EditGesture, type GridMove } from "../../lib/controlledListGrid";
import { useAuthStore } from "../../store/authStore";
import { useSiteStore } from "../../store/siteStore";
import { isLocationLine } from "../../lib/folderPath";
import { inkOnFill } from "../../lib/formGrid";
import { recordSurface } from "../../lib/recordSurface";
import {
  columnLetter,
  listOptions,
  parseEdited,
  toneFill,
  serialToIso,
  shownCell,
  type StoredCell,
  type StoredSheet,
} from "../../lib/controlledListMath";
import "./controlledList.css";

export type ControlledListKey = "lst-eqp-001" | "lst-gen-001" | "lst-gen-002" | "lst-gen-003" | "lst-dev-001" | "lst-ncr-001" | "lst-eng-001";

const LIST_ROUTES: Record<ControlledListKey, string> = {
  "lst-eqp-001": "/calibration/master-list",
  "lst-gen-001": "/documents/master-list",
  "lst-gen-002": "/documents/internal-audit-schedule",
  "lst-gen-003": "/documents/laboratory-scope",
  "lst-dev-001": "/documents/development-log",
  "lst-ncr-001": "/documents/nonconformance-log",
  "lst-eng-001": "/documents/engineering-request-log",
};

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
  dataStart?: Record<string, number>;
  canEditStructure?: boolean;
  sheets: StoredSheet[];
}

interface CellPatch {
  v: string | number | null;
}

const DATA_START: Record<ControlledListKey, Record<string, number>> = {
  "lst-eqp-001": { "LST-EQP-001 - Master Equipment ": 6 },
  "lst-gen-001": { "Internal Documents": 4, "External Documents": 3 },
  "lst-gen-002": { "LST-GEN-002 - Internal Audit Sc": 6 },
  "lst-gen-003": { "LST-GEN-003 - Scope of Laborato": 6 },
  "lst-dev-001": { "Test Reports": 5, "Validation Report": 5 },
  "lst-ncr-001": { "LST-NCR-001 - NCR": 5, "LST-NCR-001 - QTN": 5, "LST-NCR-001 - CAR": 5, "LST-NCR-001 - RPN": 5 },
  "lst-eng-001": { "LST-ENG-001 - ECR Tracker - Rev": 6 },
};

function sheetHasLocation(sheet: StoredSheet | undefined): boolean {
  if (!sheet) return false;
  return Object.entries(sheet.cells).some(([addr, cell]) => {
    const row = Number(addr.replace(/^[A-Z]+/i, ""));
    if (!Number.isFinite(row) || row > 3) return false;
    return cell?.kind === "location" || (typeof cell?.v === "string" && isLocationLine(cell.v));
  });
}

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

function SheetGrid({
  sheet,
  listKey,
  fromRow,
  toRow,
  band,
  canEdit,
  canEditStructure,
  dataStart,
  statuses,
  activeAddr,
  selectedRows,
  editing,
  onOpen,
  onPick,
  onChange,
  onRename,
  onLeave,
}: {
  sheet: StoredSheet;
  listKey: ControlledListKey;
  fromRow: number;
  toRow: number;
  band: boolean;
  canEdit: boolean;
  canEditStructure: boolean;
  dataStart: number;
  statuses: string[];
  activeAddr: string | null;
  selectedRows: number[];
  editing: string | null;
  onOpen: (addr: string) => void;
  onPick: (row: number, addr: string, extend: boolean) => void;
  onChange: (addr: string, value: string | number | null) => void;
  onRename: (col: string, name: string) => void;
  onLeave: (target: EventTarget | null, gesture?: EditGesture) => void;
}) {
  const long = !band && sheet.maxRow > 200;
  const headerRow = Math.max(1, dataStart - 1);
  const cells = placedCells(sheet.merges, sheet.maxCol, fromRow, toRow).map((place) => {
    const { addr, col, row, cols, rows } = place;
    const cell = sheet.cells[addr];
    const shown = shownCell(sheet, addr);
    const fill = toneFill(sheet, addr, shown.text);
    const legacyFill = fill === "FFFF0000" || fill === "FFB8DCAB";
    const toneHex = fill && !legacyFill ? `#${fill.slice(-6)}` : undefined;
    const toneInk = toneHex ? inkOnFill(toneHex) : undefined;
    const formula = cell?.kind === "formula" || Boolean(cell?.f);
    const columnTitle = row === headerRow;
    const editable = canEdit && !formula && (columnTitle ? canEditStructure : true);
    const choices = editable && !columnTitle ? (listKey === "lst-eqp-001" && columnLetter(col) === "J" && row >= dataStart ? statuses : listOptions(sheet, addr)) : null;
    const date = Boolean(editable && !columnTitle && cell?.nf && (cell.nf.includes("yy") || cell.nf.includes("mmm")) && !choices);
    return (
      <div
        key={addr}
        className={shown.tone ? `controlled-list-cell tone-${shown.tone}` : "controlled-list-cell"}
        data-addr={addr}
        data-header={row < dataStart ? "true" : undefined}
        data-active={activeAddr === addr ? "true" : undefined}
        data-row-selected={selectedRows.includes(row) ? "true" : undefined}
        data-fill={fill === "FFFF0000" ? "open" : fill === "FFB8DCAB" ? "closed" : fill ? "tone" : undefined}
        data-size={cell?.size ?? undefined}
        title={cell?.comment ?? (formula ? "Calculated from a formula" : undefined)}
        onMouseDown={(event) => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && !event.currentTarget.contains(active)) onLeave(active, "click");
          onPick(row, addr, event.shiftKey);
        }}
        style={{
          gridColumn: `${col} / span ${cols}`,
          gridRow: `${row - fromRow + 1} / span ${rows}`,
          fontFamily: cell?.font,
          fontWeight: cell?.bold ? 700 : undefined,
          fontSize: cell?.size ? `${cell.size}px` : "11px",
          color: toneInk ?? (cell?.color ? `#${cell.color.slice(-6)}` : undefined),
          ["--cell-fill" as string]: toneHex,
          ["--cell-ink" as string]: toneInk,
          justifyContent: cell?.align === "center" ? "center" : cell?.align === "right" ? "flex-end" : "flex-start",
          textAlign: cell?.align === "center" ? "center" : cell?.align === "right" ? "right" : "left",
          whiteSpace: band || cell?.wrap ? "pre-wrap" : "nowrap",
        }}
      >
        {formula ? (
          <span className="controlled-list-formula">{shown.text}</span>
        ) : (
          <CellBody
            addr={addr}
            column={columnLetter(col)}
            cell={cell}
            text={shown.text}
            editable={editable}
            columnTitle={columnTitle}
            choices={choices}
            date={date}
            wrap={band}
            quiet={long && editing !== addr}
            onOpen={() => onOpen(addr)}
            onChange={onChange}
            onRename={onRename}
            onLeave={onLeave}
          />
        )}
      </div>
    );
  });
  const rowCount = Math.max(0, toRow - fromRow + 1);
  return (
    <div
      className={band ? "controlled-list-sheet controlled-list-header-band" : long ? "controlled-list-sheet controlled-list-long" : "controlled-list-sheet"}
      data-testid={band ? `controlled-list-header-${sheet.name.trim()}` : `controlled-list-${sheet.name.trim()}`}
      data-paste-grid=""
      data-sheet={sheet.name}
      role="grid"
      aria-label={band ? `${sheet.name.trim()} header` : sheet.name.trim()}
      style={{
        gridTemplateColumns: band ? sheet.colWidths.map((width) => `minmax(0, ${width}fr)`).join(" ") : sheet.colWidths.map((width) => `${width * 8}px`).join(" "),
        gridTemplateRows: Array.from({ length: rowCount }, (_, index) => {
          const height = ((sheet.rowHeights[String(fromRow + index)] ?? (band ? 18 : 15)) * 1.33).toFixed(1);
          return band ? `minmax(${height}px, auto)` : `${height}px`;
        }).join(" "),
        ["--print-cols" as string]: sheet.colWidths.map((width) => `${width}fr`).join(" "),
      }}
    >
      {cells}
    </div>
  );
}

function CellBody({
  addr,
  column,
  cell,
  text,
  editable,
  columnTitle,
  choices,
  date,
  wrap,
  quiet,
  onOpen,
  onChange,
  onRename,
  onLeave,
}: {
  addr: string;
  column: string;
  cell: StoredCell | undefined;
  text: string;
  editable: boolean;
  columnTitle: boolean;
  choices: string[] | null;
  date: boolean;
  wrap: boolean;
  quiet: boolean;
  onOpen: () => void;
  onChange: (addr: string, value: string | number | null) => void;
  onRename: (col: string, name: string) => void;
  onLeave: (target: EventTarget | null) => void;
}) {
  const stored = typeof cell?.v === "string" || typeof cell?.v === "number" ? String(cell.v) : "";
  const [draft, setDraft] = useState(columnTitle || (wrap && date) ? (columnTitle ? stored : text) : stored);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(columnTitle ? stored : wrap && date ? text : stored), [stored, text, columnTitle, wrap, date]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });
  if (!editable || quiet) {
    if (!editable) return <span className="controlled-list-screen-value">{text}</span>;
    return (
      <button type="button" className="controlled-list-screen-value controlled-list-pick" onClick={onOpen}>
        {text || " "}
      </button>
    );
  }
  const current = typeof cell?.v === "string" || typeof cell?.v === "number" ? cell.v : "";
  const options = choices && current !== "" && !choices.includes(String(current)) ? [String(current), ...choices] : choices ?? [];
  return (
    <>
      <span className="controlled-list-print-value">{text}</span>
      {columnTitle ? (
        <input
          className="controlled-list-editor"
          aria-label={`${addr} column title`}
          data-column-title="true"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            onLeave(event.currentTarget);
            const next = draft.trim();
            if (next && next !== stored) onRename(column, next);
          }}
        />
      ) : choices ? (
        <select
          className="controlled-list-editor"
          aria-label={addr}
          value={current === "" ? "" : String(current)}
          onChange={(event) => onChange(addr, event.target.value || null)}
          onBlur={(event) => onLeave(event.currentTarget)}
        >
          <option value="" />
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : date && !wrap ? (
        <input
          className="controlled-list-editor"
          aria-label={addr}
          type="date"
          data-value-kind="date"
          value={dateInputValue(cell?.v)}
          onChange={(event) => onChange(addr, event.target.value || null)}
          onBlur={(event) => onLeave(event.currentTarget)}
        />
      ) : wrap ? (
        <textarea
          ref={area}
          className="controlled-list-editor"
          aria-label={addr}
          rows={1}
          value={date ? draft : current === null ? "" : String(current)}
          onChange={(event) => {
            if (date) setDraft(event.target.value);
            else onChange(addr, parseEdited(event.target.value, cell?.nf));
          }}
          onBlur={(event) => onLeave(event.currentTarget)}
        />
      ) : (
        <input
          className="controlled-list-editor"
          aria-label={addr}
          value={current === null ? "" : String(current)}
          onChange={(event) => onChange(addr, parseEdited(event.target.value, cell?.nf))}
          onBlur={(event) => onLeave(event.currentTarget)}
        />
      )}
    </>
  );
}

function visibleField(root: ParentNode, addr: string): HTMLElement | null {
  const nodes = root.querySelectorAll(`[data-addr="${addr}"]`);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || node.closest(".controlled-list-inactive")) continue;
    const field = node.querySelector("input, textarea, select, button");
    if (field instanceof HTMLElement) return field;
  }
  return null;
}

function leaveField(target: EventTarget | null, key: string): boolean {
  if (target instanceof HTMLSelectElement) return key === "Enter";
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return true;
  if (target instanceof HTMLInputElement && target.type === "date") return true;
  if (key === "ArrowUp" || key === "ArrowDown" || key === "Enter") return true;
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  if (start !== end) return false;
  if (key === "ArrowLeft") return start === 0;
  if (key === "ArrowRight") return start === target.value.length;
  return false;
}

interface UndoStep {
  sheet: string;
  addr: string;
  prev: string | number | null;
}

export function ControlledListPage({ listKey }: { listKey: ControlledListKey }) {
  const toast = useToast();
  const confirm = useConfirm();
  const folderPath = useItemFolderPath();
  const queryClient = useQueryClient();
  const surface = recordSurface(LIST_ROUTES[listKey]);
  const canEdit = useCanEditSurface(surface);
  const list = useQuery({
    queryKey: ["controlled-list", listKey],
    queryFn: async () => (await apiClient.get<ControlledListView>(`/controlled-lists/${listKey}`)).data,
  });
  const [view, setView] = useState<ControlledListView | null>(null);
  const [sheetName, setSheetName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [active, setActive] = useState<{ sheet: string; addr: string; row: number } | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const pending = useRef(new Map<string, Record<string, CellPatch>>());
  const undoStack = useRef<UndoStep[]>([]);
  const undoing = useRef(false);
  const anchorRow = useRef<number | null>(null);
  const focusAddr = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const saveSeq = useRef(0);
  const viewRef = useRef<ControlledListView | null>(null);
  const inflightBody = useRef<Array<{ name: string; cells: Record<string, CellPatch> }> | null>(null);
  const lastCommit = useRef<string | null>(null);
  const mounted = useRef(true);
  viewRef.current = view;

  useEffect(() => {
    if (!list.data) return;
    setView((current) => current ?? list.data);
    setSheetName((current) => current || list.data.sheets[0]?.name || "");
  }, [list.data]);

  function takePending() {
    const sheets = [...pending.current.entries()].map(([name, cells]) => ({ name, cells: { ...cells } }));
    pending.current = new Map();
    return sheets;
  }

  function sendKeepalive(sheets: Array<{ name: string; cells: Record<string, CellPatch> }>) {
    if (sheets.length === 0) return;
    const token = useAuthStore.getState().accessToken;
    const siteId = useSiteStore.getState().currentSiteId;
    const base = apiClient.defaults.baseURL ?? "/api";
    void fetch(`${base}/controlled-lists/${listKey}`, {
      method: "PUT",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-AccuQual-Csrf": "1",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(siteId != null ? { "X-AccuQual-Site": String(siteId) } : {}),
      },
      body: JSON.stringify({ sheets }),
    });
  }

  async function flush() {
    const current = viewRef.current;
    if (!current || pending.current.size === 0) return;
    const id = ++saveSeq.current;
    const sheets = takePending();
    inflightBody.current = sheets;
    if (mounted.current) {
      setSaving(true);
      setSaved(false);
    }
    try {
      const next = (await apiClient.put<ControlledListView>(`/controlled-lists/${listKey}`, { sheets })).data;
      if (inflightBody.current === sheets) inflightBody.current = null;
      if (!mounted.current || id !== saveSeq.current) return;
      setView((local) => {
        if (!local || pending.current.size > 0) return local;
        return next;
      });
      setSaved(true);
      void queryClient.setQueryData(["controlled-list", listKey], next);
    } catch (err) {
      if (inflightBody.current === sheets) inflightBody.current = null;
      if (mounted.current) toast.error(errorMessage(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    mounted.current = true;
    function onHide() {
      const queued = [...pending.current.entries()].map(([name, cells]) => ({ name, cells: { ...cells } }));
      const sheets = queued.length > 0 ? queued : (inflightBody.current ?? []);
      if (queued.length > 0) pending.current = new Map();
      if (timer.current != null) window.clearTimeout(timer.current);
      sendKeepalive(sheets);
    }
    window.addEventListener("pagehide", onHide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onHide);
      if (timer.current != null) window.clearTimeout(timer.current);
      void flushRef.current();
    };
  }, [listKey]);

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
    const existing = viewRef.current?.sheets.find((sheet) => sheet.name === name)?.cells[addr];
    if (existing?.f || existing?.kind === "formula") return;
    const prev = existing?.v ?? null;
    if (!undoing.current && prev !== value) {
      undoStack.current.push({ sheet: name, addr, prev: prev === undefined ? null : prev });
      if (undoStack.current.length > 100) undoStack.current.shift();
    }
    setSaved(false);
    setView((current) => {
      if (!current) return current;
      return {
        ...current,
        sheets: current.sheets.map((sheet) => {
          if (sheet.name !== name) return sheet;
          const cell = sheet.cells[addr];
          if (cell?.f || cell?.kind === "formula") return sheet;
          const kind = cell?.kind ?? "input";
          return { ...sheet, cells: { ...sheet.cells, [addr]: { ...cell, v: value, kind, nf: cell?.nf } } };
        }),
      };
    });
    queue(name, addr, value);
  }

  function flushNow() {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    void flush();
  }

  function sameCellValue(prev: string | number | null | undefined, value: string | number | null): boolean {
    const left = prev == null || prev === "" ? null : prev;
    const right = value == null || value === "" ? null : value;
    return left === right;
  }

  function persistField(target: EventTarget | null, gesture: EditGesture) {
    if (!gestureSavesEdit(gesture)) return;
    const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target : null;
    if (field && field.getAttribute("data-column-title") !== "true" && !field.closest(".controlled-list-inactive")) {
      const addr = field.closest("[data-addr]")?.getAttribute("data-addr");
      const name = field.closest("[data-sheet]")?.getAttribute("data-sheet");
      const storedSheet = viewRef.current?.sheets.find((item) => item.name === name);
      if (addr && storedSheet) {
        const cell = storedSheet.cells[addr];
        if (!(cell?.f || cell?.kind === "formula")) {
          const prev = cell?.v ?? null;
          const parsed = parseEdited(field.value, cell?.nf);
          const committed = commitAndReload(
            { saved: { cells: { [addr]: prev == null || prev === "" ? null : prev } }, pending: {}, draft: { addr, value: parsed } },
            gesture,
          );
          const next = committed.cells[addr] ?? null;
          const signature = `${storedSheet.name}:${addr}:${String(next)}`;
          if (lastCommit.current !== signature) {
            lastCommit.current = signature;
            // Keydown and the blur it causes both read the field. Drop the
            // guard after this turn so a later Tab of the same value still saves.
            queueMicrotask(() => {
              if (lastCommit.current === signature) lastCommit.current = null;
            });
            if (!sameCellValue(prev, next)) edit(storedSheet.name, addr, next);
          }
        }
      }
    }
    flushNow();
  }

  function undo() {
    const step = undoStack.current.pop();
    if (!step) return;
    undoing.current = true;
    edit(step.sheet, step.addr, step.prev);
    undoing.current = false;
  }

  function remember(next: ControlledListView) {
    setView(next);
    void queryClient.setQueryData(["controlled-list", listKey], next);
    setSaved(true);
  }

  async function changeRows(body: { op: "add" | "delete" | "insert"; row?: number; rows?: number[]; place?: "above" | "below" }) {
    if (!view || !sheetName) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    await flush();
    try {
      const next = (await apiClient.post<ControlledListView>(`/controlled-lists/${listKey}/rows`, { sheet: sheetName, ...body })).data;
      remember(next);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function changeColumn(body: { op: "add" | "rename" | "remove"; col?: string; name?: string }) {
    if (!view || !sheetName) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    await flush();
    try {
      const next = (await apiClient.post<ControlledListView>(`/controlled-lists/${listKey}/columns`, { sheet: sheetName, ...body })).data;
      remember(next);
      if (next.revision !== view.revision) toast.success(`Revision is now ${next.revision}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteRows(rows: number[]) {
    const current = viewRef.current?.sheets.find((item) => item.name === sheetName);
    if (!current || rows.length === 0) return;
    const labels = rows.map((row) => {
      const label = current.cells[`A${row}`]?.v;
      return label == null || label === "" ? `row ${row}` : String(label);
    });
    const ok = await confirm({
      title: rows.length === 1 ? "Delete this row?" : `Delete ${rows.length} rows?`,
      message: `Delete ${labels.join(", ")} from ${current.name.trim()}? The audit trail records who deleted them and the values that were removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setSelectedRows([]);
    await changeRows({ op: "delete", rows });
  }

  async function insertPath() {
    if (!view || !sheetName || !folderPath) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    await flush();
    try {
      const next = (await apiClient.post<ControlledListView>(`/controlled-lists/${listKey}/location`, { sheet: sheetName, path: folderPath })).data;
      setView(next);
      void queryClient.setQueryData(["controlled-list", listKey], next);
      setSaved(true);
      toast.success("Location updated.");
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
  const dataStart = sheet ? (view?.dataStart?.[sheet.name] ?? DATA_START[listKey][sheet.name] ?? sheet.maxRow + 1) : 1;
  const activeRow = active && active.sheet === sheet?.name ? active.row : null;
  const rowsToDelete = (selectedRows.length > 0 ? selectedRows : activeRow != null ? [activeRow] : []).filter((row) => row >= dataStart);

  useEffect(() => {
    const addr = focusAddr.current;
    if (!addr) return;
    const field = visibleField(document, addr);
    if (field instanceof HTMLElement) {
      field.focus();
      focusAddr.current = null;
    }
  }, [editing, view]);

  function pick(name: string, row: number, addr: string, extend: boolean) {
    if (extend && anchorRow.current != null && active?.sheet === name) {
      const start = Math.min(anchorRow.current, row);
      const end = Math.max(anchorRow.current, row);
      setSelectedRows(Array.from({ length: end - start + 1 }, (_, index) => start + index).filter((line) => line >= dataStart));
    } else {
      anchorRow.current = row;
      setSelectedRows(row >= dataStart ? [row] : []);
    }
    setActive({ sheet: name, addr, row });
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (!sheet) return;
    const gesture = gestureFromKey(event.key, event.shiftKey);
    if (!gesture) return;
    const tab = gesture === "Tab" || gesture === "ShiftTab";
    if (!tab && !leaveField(event.target, event.key)) return;
    const host = event.target instanceof Element ? event.target.closest("[data-addr]") : null;
    const addr = host?.getAttribute("data-addr");
    if (!addr) return;
    persistField(event.target, gesture);
    const bounds = { minRow: 1, maxRow: sheet.maxRow, maxCol: sheet.maxCol };
    const move: GridMove = gesture === "Enter" ? (event.shiftKey ? "ArrowUp" : "ArrowDown") : gesture === "Tab" || gesture === "ShiftTab" ? "ArrowRight" : gesture;
    let next = addr;
    for (let step = 0; step < sheet.maxRow + sheet.maxCol; step += 1) {
      const moved = tab ? moveTab(next, gesture === "ShiftTab", bounds) : moveAddr(next, move, bounds);
      if (!moved) return;
      next = moved;
      const field = visibleField(event.currentTarget, next);
      if (!(field instanceof HTMLElement)) continue;
      event.preventDefault();
      const row = Number(next.replace(/^[A-Z]+/i, ""));
      pick(sheet.name, row, next, false);
      if (field instanceof HTMLButtonElement) {
        focusAddr.current = next;
        setEditing(next);
      }
      field.focus();
      return;
    }
  }

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
              {canEdit && sheetHasLocation(sheet) && (
                <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40" disabled={!folderPath} onClick={() => void insertPath()}>
                  Insert current path
                </button>
              )}
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
        <div className={`controlled-list-print aq-print-sheet min-w-0 ${view.landscape ? "controlled-list-landscape aq-print-wide" : "controlled-list-portrait"}`} onKeyDown={onGridKey}>
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
            const shown = item.name === sheet.name;
            const start = view.dataStart?.[item.name] ?? DATA_START[listKey][item.name] ?? item.maxRow + 1;
            const bandEnd = headerBandEnd(start);
            const gridProps = {
              sheet: item,
              listKey,
              canEdit: canEdit && shown,
              canEditStructure: Boolean(view.canEditStructure) && shown,
              dataStart: start,
              statuses: view.statuses,
              activeAddr: active && active.sheet === item.name ? active.addr : null,
              selectedRows: active && active.sheet === item.name ? selectedRows : [],
              editing,
              onOpen: (addr: string) => setEditing(addr),
              onPick: (row: number, addr: string, extend: boolean) => pick(item.name, row, addr, extend),
              onChange: (addr: string, value: string | number | null) => edit(item.name, addr, value),
              onRename: (col: string, name: string) => void changeColumn({ op: "rename", col, name }),
              onLeave: (target: EventTarget | null, gesture: EditGesture = "blur") => persistField(target, gesture),
            };
            return (
              <div key={item.name} className={shown ? "mb-2" : "controlled-list-inactive"}>
                {view.sheets.length > 1 && <h2 className="controlled-list-sheet-title">{item.name.trim()}</h2>}
                {bandEnd > 1 && <SheetGrid {...gridProps} fromRow={1} toRow={bandEnd - 1} band />}
                <div className="overflow-x-auto">
                  <SheetGrid {...gridProps} fromRow={bandEnd} toRow={item.maxRow} band={false} />
                </div>
              </div>
            );
          })}
          {canEdit && (
            <div className="controlled-list-tools mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40" disabled={activeRow == null || activeRow < dataStart} onClick={() => void changeRows({ op: "insert", row: activeRow ?? undefined, place: "above" })}>
                Insert above
              </button>
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40" disabled={activeRow == null || activeRow < dataStart} onClick={() => void changeRows({ op: "insert", row: activeRow ?? undefined, place: "below" })}>
                Insert below
              </button>
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void changeRows({ op: "add" })}>
                Add row
              </button>
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm text-destructive hover:bg-muted disabled:opacity-40" disabled={rowsToDelete.length === 0} onClick={() => void deleteRows(rowsToDelete)}>
                Delete rows
              </button>
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={undo}>
                Undo
              </button>
              {view.canEditStructure && (
                <>
                  <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void changeColumn({ op: "add", col: active ? active.addr.replace(/\d+$/, "") : undefined })}>
                    Add column
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40"
                    disabled={!active}
                    onClick={() => {
                      const col = active?.addr.replace(/\d+$/, "");
                      if (!col) return;
                      void confirm({
                        title: "Remove this column?",
                        message: `Remove column ${col}? The revision moves forward, and the audit trail records the change.`,
                        confirmLabel: "Remove column",
                        tone: "danger",
                      }).then((ok) => {
                        if (ok) void changeColumn({ op: "remove", col });
                      });
                    }}
                  >
                    Remove column
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </RecordFrame>
  );
}
