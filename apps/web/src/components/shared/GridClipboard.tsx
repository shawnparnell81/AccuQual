import { useEffect } from "react";
import { isMultiCellPaste, normalizePastedCell, parseClipboardGrid, selectionToTsv } from "../../lib/gridPaste";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIP_TYPES = new Set(["hidden", "password", "file", "checkbox", "radio", "button", "submit", "reset", "image", "color", "range"]);
const SELECTED = "aq-grid-selected";

function isField(el: Element | null): el is Field {
  if (!el) return false;
  if (el.closest("[data-no-grid-paste]")) return false;
  if (el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    if (SKIP_TYPES.has(el.type)) return false;
    if (el.name === "signature-pin") return false;
    return true;
  }
  return false;
}

function gridRoot(el: Element): HTMLElement | null {
  const root = el.closest("table, [data-paste-grid]");
  return root instanceof HTMLElement ? root : null;
}

function fieldsIn(root: ParentNode): Field[] {
  return [...root.querySelectorAll("input, textarea, select")].filter(isField);
}

function matrixOf(root: HTMLElement): Field[][] {
  if (root instanceof HTMLTableElement) {
    return [...root.tBodies].flatMap((body) => [...body.rows]).map((row) => fieldsIn(row)).filter((row) => row.length > 0);
  }
  const fields = fieldsIn(root);
  const rows: Field[][] = [];
  let current: Field[] = [];
  let top: number | null = null;
  for (const field of fields) {
    const y = field.getBoundingClientRect().top;
    if (top == null || Math.abs(y - top) < 6) {
      current.push(field);
      top = top ?? y;
    } else {
      rows.push(current);
      current = [field];
      top = y;
    }
  }
  if (current.length) rows.push(current);
  return rows;
}

function position(matrix: Field[][], field: Field): { r: number; c: number } | null {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    const c = row.indexOf(field);
    if (c >= 0) return { r, c };
  }
  return null;
}

function hintOf(field: Field): "date" | "text" {
  if (field.getAttribute("data-value-kind") === "date") return "date";
  if (field instanceof HTMLInputElement && field.type === "date") return "date";
  return "text";
}

function writeField(field: Field, value: string) {
  const next = normalizePastedCell(value, hintOf(field));
  if (field instanceof HTMLSelectElement) {
    const match = [...field.options].find((option) => option.value === next || option.label === next || option.value.toLowerCase() === next.toLowerCase() || option.label.toLowerCase() === next.toLowerCase());
    setNativeValue(field, match ? match.value : next);
  } else {
    setNativeValue(field, next);
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeValue(field: Field, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
}

function selectedIn(root: HTMLElement): Field[] {
  return fieldsIn(root).filter((field) => field.classList.contains(SELECTED));
}

function clearSelection() {
  document.querySelectorAll(`.${SELECTED}`).forEach((el) => el.classList.remove(SELECTED));
}

let anchor: Field | null = null;

function onMouseDown(event: MouseEvent) {
  const raw = event.target instanceof Element ? event.target.closest("input, textarea, select") : null;
  if (!isField(raw)) {
    if (!event.shiftKey) {
      clearSelection();
      anchor = null;
    }
    return;
  }
  const root = gridRoot(raw);
  if (!root) return;
  if (event.shiftKey && anchor && gridRoot(anchor) === root) {
    const matrix = matrixOf(root);
    const start = position(matrix, anchor);
    const end = position(matrix, raw);
    if (!start || !end) return;
    clearSelection();
    const r1 = Math.min(start.r, end.r);
    const r2 = Math.max(start.r, end.r);
    const c1 = Math.min(start.c, end.c);
    const c2 = Math.max(start.c, end.c);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) matrix[r]?.[c]?.classList.add(SELECTED);
    }
    return;
  }
  clearSelection();
  anchor = raw;
}

function onCopy(event: ClipboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const field = target ? (isField(target) ? target : null) : null;
  if (!field) return;
  const root = gridRoot(field);
  if (!root) return;
  const selected = selectedIn(root);
  if (selected.length > 1) {
    const matrix = matrixOf(root);
    const values = matrix.map((row) => row.map((cell) => cell.value));
    const flags = matrix.map((row) => row.map((cell) => selected.includes(cell)));
    event.preventDefault();
    event.clipboardData?.setData("text/plain", selectionToTsv(values, flags));
    return;
  }
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  if (field.selectionStart !== field.selectionEnd) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", field.value);
}

function onPaste(event: ClipboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!isField(target)) return;
  const root = gridRoot(target);
  if (!root) return;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const grid = parseClipboardGrid(text);
  const selected = selectedIn(root);
  if (!isMultiCellPaste(grid)) {
    if (selected.length > 1 && grid.length === 1 && (grid[0]?.length ?? 0) === 1) {
      event.preventDefault();
      for (const field of selected) writeField(field, grid[0]?.[0] ?? "");
    }
    return;
  }
  if (target instanceof HTMLTextAreaElement && !text.includes("\t") && selected.length <= 1) return;
  const matrix = matrixOf(root);
  const start = position(matrix, target);
  if (!start) return;
  event.preventDefault();
  for (let r = 0; r < grid.length; r++) {
    const line = grid[r];
    if (!line) continue;
    for (let c = 0; c < line.length; c++) {
      const field = matrix[start.r + r]?.[start.c + c];
      if (field) writeField(field, line[c] ?? "");
    }
  }
}

/** Spreadsheet copy and paste for every table and paste grid in the app. Single-cell paste stays with the browser. */
export function GridClipboard() {
  useEffect(() => {
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
  return null;
}

export function focusFirstEditable(root: ParentNode | null | undefined) {
  if (!root) return;
  const field = [...root.querySelectorAll("input, textarea, select")].find((el) => isField(el));
  if (field instanceof HTMLElement) field.focus();
}
