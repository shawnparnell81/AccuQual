/**
 * Reads a validation form's Excel workbook and writes its layout as data: cell text, formulas, fonts, fills, borders,
 * column widths, row heights, merged ranges, dropdown lists, conditional formats and pictures. The form is then drawn from
 * that file, so it matches the workbook.
 *
 *   npx tsx scripts/extract-validation-workbook.ts <workbook.xlsx> <slug> [sheet name or number]
 *
 * writes src/lib/validation-forms/layouts/<slug>.layout.ts. See docs/validation-forms/ADDING-A-FORM.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addr, columnLetters, parseAddr, shiftFormula } from "../src/lib/validation-forms/engine.ts";
import type { BorderStyle, LayoutConditional, LayoutImage, LayoutStyle, WorkbookLayout } from "../src/lib/validation-forms/layoutTypes.ts";

const [, , workbookPath, slug, sheetArg] = process.argv;
if (!workbookPath || !slug) {
  console.error("Usage: npx tsx scripts/extract-validation-workbook.ts <workbook.xlsx> <slug> [sheet name or number]");
  process.exit(1);
}

/* ---------------- colors ---------------- */

/** The workbook theme, in Excel's index order: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink. */
async function readTheme(path: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const xml = (await zip.file("xl/theme/theme1.xml")?.async("string")) ?? "";
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
  const pick = (name: string): string => {
    const block = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme)?.[1] ?? "";
    const rgb = /(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
    return rgb ? `#${rgb.toUpperCase()}` : "#000000";
  };
  return [pick("lt1"), pick("dk1"), pick("lt2"), pick("dk2"), pick("accent1"), pick("accent2"), pick("accent3"), pick("accent4"), pick("accent5"), pick("accent6"), pick("hlink"), pick("folHlink")];
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const two = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${two(r)}${two(g)}${two(b)}`.toUpperCase();
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const [h, s, l] = hexToHsl(hex);
  const next = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToHex(h, s, Math.min(1, Math.max(0, next)));
}

const INDEXED: Record<number, string> = { 0: "#000000", 1: "#FFFFFF", 2: "#FF0000", 3: "#00FF00", 4: "#0000FF", 5: "#FFFF00", 6: "#FF00FF", 7: "#00FFFF", 8: "#000000", 9: "#FFFFFF", 10: "#FF0000", 11: "#00FF00", 12: "#0000FF", 13: "#FFFF00", 14: "#FF00FF", 15: "#00FFFF", 64: "#000000" };

let theme: string[] = [];

function resolveColor(color: Partial<ExcelJS.Color> | undefined): string | undefined {
  if (!color) return undefined;
  const c = color as { argb?: string; theme?: number; tint?: number; indexed?: number };
  if (c.argb) return `#${c.argb.slice(-6).toUpperCase()}`;
  if (c.theme != null) return applyTint(theme[c.theme] ?? "#000000", c.tint ?? 0);
  if (c.indexed != null) return INDEXED[c.indexed];
  return undefined;
}

/* ---------------- styles ---------------- */

function styleOf(cell: ExcelJS.Cell): LayoutStyle {
  const style: LayoutStyle = {};
  const font = cell.font;
  if (font?.bold) style.b = 1;
  if (font?.italic) style.i = 1;
  if (font?.underline) style.u = 1;
  if (font?.size) style.sz = font.size;
  if (font?.name) style.font = font.name;
  const fg = resolveColor(font?.color);
  if (fg && fg !== "#000000") style.fg = fg;
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = resolveColor(fill.fgColor);
    if (bg) style.bg = bg;
  }
  const alignment = cell.alignment;
  if (alignment?.horizontal === "left" || alignment?.horizontal === "center" || alignment?.horizontal === "right") style.h = alignment.horizontal;
  if (alignment?.vertical === "top") style.v = "top";
  else if (alignment?.vertical === "middle" || alignment?.vertical === "center") style.v = "middle";
  else if (alignment?.vertical === "bottom") style.v = "bottom";
  if (alignment?.wrapText) style.wrap = 1;
  if (alignment?.indent) style.indent = alignment.indent;
  const border = cell.border;
  if (border) {
    const side = (b: Partial<ExcelJS.Border> | undefined): BorderStyle | undefined => {
      const kind = b?.style;
      return kind === "thin" || kind === "medium" || kind === "thick" || kind === "dashed" || kind === "dotted" || kind === "double" || kind === "hair" ? kind : undefined;
    };
    const out = { l: side(border.left), r: side(border.right), t: side(border.top), b: side(border.bottom) };
    if (out.l || out.r || out.t || out.b) style.border = Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as LayoutStyle["border"];
  }
  if (cell.numFmt && cell.numFmt !== "General") style.nf = cell.numFmt;
  return style;
}

/* ---------------- main ---------------- */

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
theme = await readTheme(workbookPath);
const sheetKey = sheetArg == null ? 1 : /^\d+$/.test(sheetArg) ? Number(sheetArg) : sheetArg;
const ws = workbook.getWorksheet(sheetKey) ?? workbook.worksheets[0]!;

const dims = ws.dimensions.model;
const maxRow = dims.bottom;
const maxCol = dims.right;
const styles: LayoutStyle[] = [];
const styleIndex = new Map<string, number>();
function indexOfStyle(style: LayoutStyle): number {
  const key = JSON.stringify(style);
  let found = styleIndex.get(key);
  if (found == null) {
    found = styles.length;
    styles.push(style);
    styleIndex.set(key, found);
  }
  return found;
}
indexOfStyle({});

const cells: WorkbookLayout["cells"] = {};
const sharedMasters = new Map<string, string>();
for (let row = 1; row <= maxRow; row += 1) {
  for (let col = 1; col <= maxCol; col += 1) {
    const cell = ws.getCell(row, col);
    const raw = cell.value as unknown;
    const style = styleOf(cell);
    let v: string | number | boolean | undefined;
    let f: string | undefined;
    if (raw != null && typeof raw === "object" && !(raw instanceof Date)) {
      const obj = raw as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
      if (obj.formula) {
        f = obj.formula;
        sharedMasters.set(cell.address, obj.formula);
      } else if (obj.sharedFormula) {
        const master = parseAddr(obj.sharedFormula)!;
        const masterFormula = sharedMasters.get(obj.sharedFormula) ?? (ws.getCell(obj.sharedFormula).value as { formula?: string })?.formula;
        if (masterFormula) f = shiftFormula(masterFormula, row - master.row, col - master.col);
      } else if (obj.richText) {
        v = obj.richText.map((part) => part.text).join("");
      } else if (obj.text != null) {
        v = obj.text;
      } else if (obj.error) {
        v = obj.error;
      }
    } else if (raw instanceof Date) {
      v = raw.toISOString().slice(0, 10);
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      v = raw;
    }
    // A cell inside a merged range shows its master's value in exceljs; only the master carries it here.
    if (cell.isMerged && cell.master.address !== cell.address) {
      v = undefined;
      f = undefined;
    }
    const empty = v === undefined && f === undefined && Object.keys(style).length === 0;
    if (empty) continue;
    cells[addr(col, row)] = { ...(v !== undefined ? { v } : {}), ...(f !== undefined ? { f } : {}), s: indexOfStyle(style) };
  }
}

const merges: string[] = ((ws as unknown as { model: { merges?: string[] } }).model.merges ?? []).slice().sort();

const cols: number[] = [];
const defaultWidth = ws.properties.defaultColWidth ?? 8.43;
for (let col = 1; col <= maxCol; col += 1) cols.push(ws.getColumn(col).width ?? defaultWidth);

const defaultRowHeight = ws.properties.defaultRowHeight ?? 15;
const rowHeights: Record<string, number> = {};
for (let row = 1; row <= maxRow; row += 1) {
  const height = ws.getRow(row).height;
  if (height != null && Math.abs(height - defaultRowHeight) > 0.01) rowHeights[String(row)] = height;
}

const lists: Record<string, string[]> = {};
const validations = (ws as unknown as { dataValidations: { model: Record<string, { type?: string; formulae?: string[] }> } }).dataValidations.model;
for (const [ref, rule] of Object.entries(validations)) {
  if (rule.type !== "list" || !rule.formulae?.[0]) continue;
  const source = rule.formulae[0]!;
  let items: string[] = [];
  if (/^".*"$/.test(source)) {
    items = source.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  } else {
    const range = source.replace(/^.*!/, "").replace(/\$/g, "");
    const [from, to] = range.split(":");
    const a = parseAddr(from ?? "");
    const b = parseAddr(to ?? from ?? "");
    if (a && b) {
      for (let r = a.row; r <= b.row; r += 1) for (let c = a.col; c <= b.col; c += 1) {
        const value = ws.getCell(r, c).value;
        if (value != null && String(value).trim()) items.push(String(value).trim());
      }
    }
  }
  if (items.length === 0) continue;
  // exceljs lists a validation once per cell, or once for a range ("A1:B2") when the file did.
  const [from, to] = ref.split(":");
  const a = parseAddr(from ?? "");
  const b = parseAddr(to ?? from ?? "");
  if (!a || !b) continue;
  for (let r = a.row; r <= b.row; r += 1) for (let c = a.col; c <= b.col; c += 1) lists[addr(c, r)] = items;
}

const conditional: LayoutConditional[] = [];
const cfBlocks = (ws as unknown as { conditionalFormattings?: { ref: string; rules: Array<Record<string, unknown>> }[] }).conditionalFormattings ?? [];
for (const block of cfBlocks) {
  const ranges = block.ref.split(/\s+/).filter(Boolean);
  // A rule is written for the top-left corner of everything it covers, not necessarily the first range listed.
  const corners = ranges.map((ref) => parseAddr(ref.split(":")[0]!)).filter((pos): pos is NonNullable<ReturnType<typeof parseAddr>> => pos != null);
  const topLeft = addr(Math.min(...corners.map((pos) => pos.col)), Math.min(...corners.map((pos) => pos.row)));
  const rules: LayoutConditional["rules"] = [];
  const sorted = [...block.rules].sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0));
  for (const rule of sorted) {
    const formulae = (rule.formulae as string[] | undefined) ?? [];
    let f = formulae[0];
    const type = String(rule.type);
    if (type === "cellIs" && f != null) {
      const op = ({ equal: "=", notEqual: "<>", greaterThan: ">", lessThan: "<", greaterThanOrEqual: ">=", lessThanOrEqual: "<=" } as Record<string, string>)[String(rule.operator)];
      f = op ? `${topLeft}${op}${f}` : undefined;
    }
    if (type === "containsText" && f == null && rule.text != null) f = `NOT(ISERROR(SEARCH("${String(rule.text)}",${topLeft})))`;
    if (!f) continue;
    const dxf = (rule.style ?? {}) as { fill?: { bgColor?: ExcelJS.Color; fgColor?: ExcelJS.Color }; font?: { color?: ExcelJS.Color; bold?: boolean } };
    const bg = resolveColor(dxf.fill?.bgColor) ?? resolveColor(dxf.fill?.fgColor);
    const fg = resolveColor(dxf.font?.color);
    rules.push({ f, ...(bg ? { bg } : {}), ...(fg ? { fg } : {}), ...(dxf.font?.bold ? { b: 1 as const } : {}), ...(rule.stopIfTrue ? { stop: 1 as const } : {}) });
  }
  if (rules.length) conditional.push({ ranges, rules });
}

const images: LayoutImage[] = [];
for (const placed of ws.getImages()) {
  const image = workbook.getImage(Number(placed.imageId));
  const range = placed.range as unknown as { tl: { nativeCol: number; nativeRow: number; col: number; row: number }; br?: { col: number; row: number } };
  if (!image?.buffer || !range.br) continue;
  const ext = image.extension ?? "png";
  images.push({ ext, src: `data:image/${ext};base64,${Buffer.from(image.buffer as ArrayBuffer).toString("base64")}`, from: { col: range.tl.col, row: range.tl.row }, to: { col: range.br.col, row: range.br.row } });
}

const layout: WorkbookLayout = { sheet: ws.name, cols, rowHeights, defaultRowHeight, styles, cells, merges, lists, conditional, images, maxRow, maxCol };

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "lib", "validation-forms", "layouts");
mkdirSync(outDir, { recursive: true });
const name = slug.replace(/[^a-z0-9-]/gi, "-");
const identifier = `${name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Layout`;
const body = `/* Generated by scripts/extract-validation-workbook.ts from ${workbookPath.split(/[\\/]/).pop()} (sheet "${ws.name}"). Do not edit by hand. */\nimport type { WorkbookLayout } from "../layoutTypes";\n\nexport const ${identifier}: WorkbookLayout = ${JSON.stringify(layout)};\n`;
writeFileSync(join(outDir, `${name}.layout.ts`), body);
console.log(`${name}: ${Object.keys(cells).length} cells, ${merges.length} merges, ${Object.keys(lists).length} dropdown cells, ${conditional.length} conditional blocks, ${images.length} pictures, ${styles.length} styles -> layouts/${name}.layout.ts (${columnLetters(maxCol)}${maxRow})`);
