/** Plain values and colors for the read-only spreadsheet preview. Kept free of the workbook parser so it can be tested on its own. */

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

export interface GridCell {
  text: string;
  rowSpan: number;
  colSpan: number;
  style: CellStyle;
}

export interface SheetGrid {
  name: string;
  /** `null` marks a cell covered by a merge that starts elsewhere. */
  rows: Array<Array<GridCell | null>>;
  colWidths: number[];
  rowCount: number;
  colCount: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export const MAX_PREVIEW_ROWS = 1000;
export const MAX_PREVIEW_COLS = 60;

/** Office theme order used when a workbook stores a theme index instead of a hex color. */
const THEME_COLORS = ["ffffff", "000000", "e7e6e6", "44546a", "4472c4", "ed7d31", "a9d08e", "ffc000", "5b9bd5", "70ad47", "0563c1", "954f72"];

/** Excel's default indexed palette (0–63). 64 and 65 are system colors and are left unset. */
const INDEXED_COLORS = [
  "000000", "ffffff", "ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff",
  "000000", "ffffff", "ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff",
  "800000", "008000", "000080", "808000", "800080", "008080", "c0c0c0", "808080",
  "9999ff", "993366", "ffffcc", "ccffff", "660066", "ff8080", "0066cc", "ccccff",
  "000080", "ff00ff", "ffff00", "00ffff", "800080", "800000", "008080", "0000ff",
  "00ccff", "ccffff", "ccffcc", "ffff99", "99ccff", "ff99cc", "cc99ff", "ffcc99",
  "3366ff", "33cccc", "99cc00", "ffcc00", "ff9900", "ff6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

export interface WorkbookColor {
  argb?: string;
  rgb?: string;
  theme?: number;
  indexed?: number;
  tint?: number;
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const apply = (channel: number) => {
    const amount = channel / 255;
    const next = tint < 0 ? amount * (1 + tint) : amount * (1 - tint) + tint;
    return clampByte(next * 255);
  };
  const r = apply(parseInt(hex.slice(0, 2), 16));
  const g = apply(parseInt(hex.slice(2, 4), 16));
  const b = apply(parseInt(hex.slice(4, 6), 16));
  return [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** `#rrggbb`, or undefined when the color is missing or fully transparent. */
export function cssColor(color?: WorkbookColor | null): string | undefined {
  if (!color) return undefined;
  let hex = "";
  const raw = color.argb || color.rgb;
  if (raw) {
    const cleaned = raw.replace(/^#/, "");
    if (cleaned.length === 8) {
      const alpha = parseInt(cleaned.slice(0, 2), 16);
      if (alpha === 0) return undefined;
      hex = cleaned.slice(2);
    } else if (cleaned.length === 6) {
      hex = cleaned;
    }
  } else if (typeof color.theme === "number" && THEME_COLORS[color.theme]) {
    hex = THEME_COLORS[color.theme]!;
  } else if (typeof color.indexed === "number" && INDEXED_COLORS[color.indexed]) {
    hex = INDEXED_COLORS[color.indexed]!;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return `#${applyTint(hex.toLowerCase(), color.tint ?? 0)}`;
}

function luminance(hex: string): number {
  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const body = hex.replace("#", "");
  return 0.2126 * channel(body.slice(0, 2)) + 0.7152 * channel(body.slice(2, 4)) + 0.0722 * channel(body.slice(4, 6));
}

/** Black or white text when a cell has a fill but the file did not set a font color. */
export function textOnFill(background: string): string {
  return luminance(background) < 0.45 ? "#ffffff" : "#1a1a1a";
}

export function borderCss(edge?: { style?: string; color?: WorkbookColor | null } | null): string | undefined {
  const style = edge?.style;
  if (!style || style === "none") return undefined;
  const width = style === "thick" ? 3 : style.startsWith("medium") || style === "double" ? 2 : 1;
  const line = style.includes("Dot") || style === "dotted" || style === "hair" ? "dotted" : style.toLowerCase().includes("dash") ? "dashed" : style === "double" ? "double" : "solid";
  return `${width}px ${line} ${cssColor(edge?.color) ?? "currentColor"}`;
}

function decimalPlaces(numFmt: string): number {
  const body = numFmt.split(";")[0] ?? numFmt;
  const dot = body.lastIndexOf(".");
  if (dot < 0) return 0;
  const fraction = body.slice(dot + 1).replace(/[^0#]/g, "");
  return fraction.length;
}

export function isDateFormat(numFmt: string | undefined | null): boolean {
  if (!numFmt || numFmt === "General") return false;
  const stripped = numFmt.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  if (/[#0]/.test(stripped) && !/[ydhs]/i.test(stripped)) return false;
  return /[ydhs]/i.test(stripped) || /m{2,}/i.test(stripped);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateValue(date: Date, numFmt?: string | null): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const fmt = (numFmt ?? "").toLowerCase();
  const yearAt = fmt.indexOf("yyyy");
  const monthAt = fmt.search(/m/);
  const isoOrder = yearAt >= 0 && (monthAt < 0 || yearAt < monthAt);
  const datePart = isoOrder ? `${y}-${pad(m)}-${pad(d)}` : `${pad(m)}/${pad(d)}/${y}`;
  if (fmt.includes("h") || (!numFmt && (hh !== 0 || mm !== 0))) return `${datePart} ${pad(hh)}:${pad(mm)}`;
  return datePart;
}

/** Excel's 1900 date system. Serial 25569 is 1970-01-01 UTC. */
export function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000));
}

export function formatNumberValue(value: number, numFmt?: string | null): string {
  if (!Number.isFinite(value)) return "";
  if (!numFmt || numFmt === "General") {
    if (Number.isInteger(value)) return String(value);
    const rounded = Math.round(value * 1e10) / 1e10;
    return String(rounded);
  }
  const section = numFmt.split(";")[0] ?? numFmt;
  const percent = section.includes("%");
  const shown = percent ? value * 100 : value;
  const places = decimalPlaces(section);
  const grouping = section.includes(",");
  const formatted = shown.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: grouping,
  });
  if (percent) return `${formatted}%`;
  const currency = section.match(/[$€£¥]/);
  return currency ? `${currency[0]}${formatted}` : formatted;
}

export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnWidthPx(width: number | undefined): number {
  const chars = width && width > 0 ? width : 10;
  return Math.round(chars * 8 + 5);
}

/** RFC 4180-ish. Quotes, escaped quotes, and line breaks inside a quoted field are kept. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

export function gridFromRows(name: string, rows: string[][], colCountHint = 0): SheetGrid {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), colCountHint);
  const truncatedRows = rows.length > MAX_PREVIEW_ROWS;
  const truncatedCols = colCount > MAX_PREVIEW_COLS;
  const shownRows = rows.slice(0, MAX_PREVIEW_ROWS);
  const width = Math.min(colCount, MAX_PREVIEW_COLS);
  return {
    name,
    rows: shownRows.map((row) =>
      Array.from({ length: width }, (_, index) => ({
        text: row[index] ?? "",
        rowSpan: 1,
        colSpan: 1,
        style: {},
      })),
    ),
    colWidths: Array.from({ length: width }, () => columnWidthPx(undefined)),
    rowCount: rows.length,
    colCount,
    truncatedRows,
    truncatedCols,
  };
}
