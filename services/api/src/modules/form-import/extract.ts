import ExcelJS from "exceljs";
import { AppError } from "../../utils/appError.js";
import { sniffUpload } from "../../utils/fileSniff.js";
import { readDocxParts } from "../form-builder/docx.js";
import { MAX_IMPORT_RECORDS, parseImportFile } from "./formImport.parse.js";

export type ExtractedBlock =
  | { kind: "heading"; level: number; text: string; path: string }
  | { kind: "para"; text: string; path: string; section: string | null }
  | { kind: "table"; path: string; section: string | null; rows: string[][] };

export interface ExtractedSheet {
  name: string;
  /** A1 address -> trimmed text, non-empty cells only. */
  cells: Record<string, string>;
  /** Defined (named) cell -> trimmed text. xlsx only. */
  named: Record<string, string>;
}

export interface ExtractedFile {
  fileName: string;
  kind: "docx" | "xlsx" | "csv";
  title: string | null;
  blocks: ExtractedBlock[];
  sheets: ExtractedSheet[];
  images: number;
}

const MAX_BYTES = 8 * 1024 * 1024;

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Runs within one block (a <w:p>...</w:p> or a <w:tc>...</w:tc>), in order. w:br becomes "\n". */
function runText(xmlChunk: string): string {
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xmlChunk))) {
    if (match[1] !== undefined) out += decode(match[1]);
    else if (match[0].startsWith("<w:br")) out += "\n";
    else out += "\t";
  }
  return out;
}

function headingLevel(chunk: string): number {
  if (/<w:pStyle w:val="Heading1"/.test(chunk)) return 1;
  if (/<w:pStyle w:val="Heading2"/.test(chunk)) return 2;
  if (/<w:pStyle w:val="Heading3"/.test(chunk)) return 3;
  return 0;
}

function isTitle(chunk: string): boolean {
  return /<w:pStyle w:val="Title"/.test(chunk);
}

function tableRows(chunk: string): string[][] {
  return [...chunk.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((cell) => runText(cell[0]).trim()),
  );
}

function countImages(xml: string): number {
  const drawings = xml.match(/<w:drawing[\s>]/g)?.length ?? 0;
  const vml = xml.match(/<v:imagedata[\s>]/g)?.length ?? 0;
  return drawings + vml;
}

function extractDocx(buffer: Buffer, fileName: string): ExtractedFile {
  const files = readDocxParts(buffer);
  const document = files.get("word/document.xml");
  if (!document) throw AppError.badRequest("That Word file has no document to read.");
  const xml = document.toString("utf8");

  let title: string | null = null;
  const blocks: ExtractedBlock[] = [];
  let section: string | null = null;
  let paraInSection = 0;
  let tableIndex = 0;

  const pattern = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const chunk = match[0];
    if (chunk.startsWith("<w:tbl")) {
      tableIndex += 1;
      const rows = tableRows(chunk).filter((row) => row.some((cell) => cell !== ""));
      if (rows.length === 0) continue;
      blocks.push({ kind: "table", path: `t:${tableIndex}`, section, rows: rows.slice(0, MAX_IMPORT_RECORDS + 1) });
      continue;
    }
    const text = runText(chunk).trim();
    if (!text) continue;
    if (isTitle(chunk)) {
      if (title == null) title = text;
      continue;
    }
    const level = headingLevel(chunk);
    if (level > 0) {
      section = text;
      paraInSection = 0;
      const num = /^\s*(\d+(?:\.\d+)*)/.exec(text);
      blocks.push({ kind: "heading", level, text, path: `h:${num ? num[1] : `idx${blocks.length}`}` });
      continue;
    }
    paraInSection += 1;
    blocks.push({ kind: "para", text, path: `p:${section ?? "root"}#${paraInSection}`, section });
  }

  return { fileName, kind: "docx", title, blocks, sheets: [], images: countImages(xml) };
}

function columnLetter(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function definedNameText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return definedNameText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("text" in value && value.text != null) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

const SINGLE_CELL_RANGE = /^(.+?)!\$?([A-Z]+)\$?(\d+)$/;

async function readNamedCells(buffer: Buffer): Promise<Record<string, Record<string, string>>> {
  const bySheet: Record<string, Record<string, string>> = {};
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    for (const definition of workbook.definedNames.model) {
      for (const range of definition.ranges) {
        const match = SINGLE_CELL_RANGE.exec(range);
        if (!match) continue;
        const sheetName = match[1]!.replace(/^'|'$/g, "");
        const worksheet = workbook.getWorksheet(sheetName);
        if (!worksheet) continue;
        const text = definedNameText(worksheet.getCell(`${match[2]}${match[3]}`).value);
        if (!text) continue;
        bySheet[sheetName] = bySheet[sheetName] ?? {};
        bySheet[sheetName]![definition.name] = text;
      }
    }
  } catch {
    // Not a readable xlsx package (e.g. legacy .xls) — no named ranges available.
  }
  return bySheet;
}

async function extractSpreadsheet(buffer: Buffer, fileName: string, kind: "xlsx" | "csv"): Promise<ExtractedFile> {
  const grid = await parseImportFile(buffer, fileName);
  const named = kind === "xlsx" ? await readNamedCells(buffer) : {};
  const rows = grid.cells.map((line) => line.map((cell) => (cell.covered ? "" : cell.text)));
  const cells: Record<string, string> = {};
  grid.cells.forEach((line, rowIndex) => {
    line.forEach((cell, colIndex) => {
      if (cell.covered || cell.text === "") return;
      cells[`${columnLetter(colIndex + 1)}${grid.originRow + rowIndex}`] = cell.text;
    });
  });
  const sheets: ExtractedSheet[] = [{ name: grid.sheetName, cells, named: named[grid.sheetName] ?? {} }];
  const blocks: ExtractedBlock[] =
    rows.length > 0 ? [{ kind: "table", path: `s:${grid.sheetName}`, section: null, rows: rows.slice(0, MAX_IMPORT_RECORDS + 1) }] : [];
  return { fileName, kind, title: null, blocks, sheets, images: 0 };
}

export async function extractFile(buffer: Buffer, fileName: string): Promise<ExtractedFile> {
  if (buffer.length === 0) throw AppError.badRequest("That file is empty.");
  if (buffer.length > MAX_BYTES) throw AppError.badRequest("That file is too large. Keep it under 8 MB.");
  const sniffed = sniffUpload(buffer, fileName);
  if (!sniffed || (sniffed.ext !== ".docx" && sniffed.ext !== ".xlsx" && sniffed.ext !== ".xls" && sniffed.ext !== ".csv")) {
    throw AppError.badRequest("Upload a Word (.docx), Excel (.xls or .xlsx), or CSV file, and the file's contents must match its name.");
  }
  if (sniffed.ext === ".docx") return extractDocx(buffer, fileName);
  return extractSpreadsheet(buffer, fileName, sniffed.ext === ".csv" ? "csv" : "xlsx");
}
