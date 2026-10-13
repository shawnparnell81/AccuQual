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

/** An image that will be imported. The bytes stay on the server; the browser only gets ExtractedImageMeta. */
export interface ExtractedImage {
  /** Position in the document, starting at 1. */
  order: number;
  /** Text of the heading it appeared under, or null before the first heading. */
  section: string | null;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  caption: string;
  bytes: Buffer;
}

export type ExtractedImageMeta = Omit<ExtractedImage, "bytes"> & { size: number };

export interface ExtractedFile {
  fileName: string;
  kind: "docx" | "xlsx" | "csv";
  title: string | null;
  blocks: ExtractedBlock[];
  sheets: ExtractedSheet[];
  /** How many pictures the document holds, imported or not. */
  images: number;
  /** The pictures that can be imported (docx only), without their bytes. */
  imageMeta?: ExtractedImageMeta[];
  /** One plain sentence per picture that was skipped, naming the file and why. */
  imageWarnings?: string[];
}

const MAX_BYTES = 8 * 1024 * 1024;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGES_PER_FILE = 30;

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

/** Relationship id -> media path (word/media/...), for image relationships only. */
function imageRelationships(rels: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    if (!/relationships\/image"/.test(tag)) continue;
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target || /TargetMode="External"/.test(tag)) continue;
    const path = target.startsWith("/") ? target.slice(1) : `word/${target}`.replace(/\/\.\//g, "/");
    out.set(id, path);
  }
  return out;
}

/** The image type from the first bytes, not the file name. Null for anything that is not png, jpeg, gif or webp. */
export function imageMimeFromBytes(bytes: Buffer): ExtractedImage["mimeType"] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

interface ImageRef {
  relId: string;
  alt: string;
}

/** Pictures placed in one paragraph or table chunk, in order: DrawingML (a:blip) and legacy VML (v:imagedata). */
function imageRefs(chunk: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const drawing of chunk.match(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g) ?? []) {
    const relId = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(drawing)?.[1];
    if (!relId) continue;
    const docPr = /<wp:docPr\b[^>]*>/.exec(drawing)?.[0] ?? "";
    const descr = /\bdescr="([^"]*)"/.exec(docPr)?.[1] ?? "";
    const title = /\btitle="([^"]*)"/.exec(docPr)?.[1] ?? "";
    refs.push({ relId, alt: decode(descr.trim() || title.trim()) });
  }
  for (const tag of chunk.match(/<v:imagedata\b[^>]*>/g) ?? []) {
    const relId = /\br:id="([^"]+)"/.exec(tag)?.[1];
    if (!relId) continue;
    refs.push({ relId, alt: decode((/\bo:title="([^"]*)"/.exec(tag)?.[1] ?? "").trim()) });
  }
  return refs;
}

function isCaptionParagraph(chunk: string, text: string): boolean {
  return /<w:pStyle w:val="Caption"/i.test(chunk) || /^(figure|fig\.)\s/i.test(text);
}

function mediaLabel(path: string): string {
  return path.split("/").pop() || path;
}

function extractDocx(buffer: Buffer, fileName: string): { file: ExtractedFile; images: ExtractedImage[] } {
  const files = readDocxParts(buffer);
  const document = files.get("word/document.xml");
  if (!document) throw AppError.badRequest("That Word file has no document to read.");
  const xml = document.toString("utf8");

  let title: string | null = null;
  const blocks: ExtractedBlock[] = [];
  let section: string | null = null;
  let paraInSection = 0;
  let tableIndex = 0;

  const rels = files.get("word/_rels/document.xml.rels")?.toString("utf8") ?? "";
  const relTargets = imageRelationships(rels);
  const images: ExtractedImage[] = [];
  const imageWarnings: string[] = [];
  const seenParts = new Set<string>();
  let totalBytes = 0;
  /** Pictures from the chunk just before this one. Only the paragraph right after them can caption them. */
  let awaitingCaption: ExtractedImage[] = [];

  const collectImages = (chunk: string): ExtractedImage[] => {
    const added: ExtractedImage[] = [];
    for (const ref of imageRefs(chunk)) {
      const path = relTargets.get(ref.relId);
      const bytes = path ? files.get(path) : undefined;
      const label = path ? mediaLabel(path) : ref.relId;
      if (!path || !bytes) {
        imageWarnings.push(`Picture "${label}" was skipped: the file is missing from the Word document.`);
        continue;
      }
      const mimeType = imageMimeFromBytes(bytes);
      if (!mimeType) {
        const ext = (label.split(".").pop() || "unknown").toUpperCase();
        imageWarnings.push(`Picture "${label}" was skipped: ${ext} pictures are not supported. Only PNG, JPEG, GIF and WEBP are imported.`);
        continue;
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        imageWarnings.push(`Picture "${label}" was skipped: it is over the 5 MB limit for one picture.`);
        continue;
      }
      if (images.length >= MAX_IMAGES_PER_FILE) {
        imageWarnings.push(`Picture "${label}" was skipped: only the first ${MAX_IMAGES_PER_FILE} pictures in a file are imported.`);
        continue;
      }
      if (totalBytes + bytes.length > MAX_IMAGES_TOTAL_BYTES) {
        imageWarnings.push(`Picture "${label}" was skipped: the pictures in one file are limited to 25 MB in total.`);
        continue;
      }
      // The same picture placed twice in a row of the document is one picture.
      if (seenParts.has(`${path}`)) continue;
      seenParts.add(path);
      totalBytes += bytes.length;
      const image: ExtractedImage = { order: images.length + 1, section, fileName: label, mimeType, caption: ref.alt, bytes };
      images.push(image);
      added.push(image);
    }
    return added;
  };

  const pattern = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const chunk = match[0];
    const waiting = awaitingCaption;
    awaitingCaption = [];
    if (chunk.startsWith("<w:tbl")) {
      collectImages(chunk);
      tableIndex += 1;
      const rows = tableRows(chunk).filter((row) => row.some((cell) => cell !== ""));
      if (rows.length === 0) continue;
      blocks.push({ kind: "table", path: `t:${tableIndex}`, section, rows: rows.slice(0, MAX_IMPORT_RECORDS + 1) });
      continue;
    }
    const text = runText(chunk).trim();
    const placed = collectImages(chunk);
    if (!text) {
      awaitingCaption = placed;
      continue;
    }
    if (waiting.length > 0 && isCaptionParagraph(chunk, text)) {
      for (const image of waiting) image.caption = text;
      continue;
    }
    awaitingCaption = [];
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

  const imageMeta: ExtractedImageMeta[] = images.map(({ bytes, ...rest }) => ({ ...rest, size: bytes.length }));
  return { file: { fileName, kind: "docx", title, blocks, sheets: [], images: countImages(xml), imageMeta, imageWarnings }, images };
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

/** Like extractFile, plus the picture bytes of a Word file (empty for spreadsheets). Server use only. */
export async function extractFileWithImages(buffer: Buffer, fileName: string): Promise<{ file: ExtractedFile; images: ExtractedImage[] }> {
  if (buffer.length === 0) throw AppError.badRequest("That file is empty.");
  if (buffer.length > MAX_BYTES) throw AppError.badRequest("That file is too large. Keep it under 8 MB.");
  const sniffed = sniffUpload(buffer, fileName);
  if (!sniffed || (sniffed.ext !== ".docx" && sniffed.ext !== ".xlsx" && sniffed.ext !== ".xls" && sniffed.ext !== ".csv")) {
    throw AppError.badRequest("Upload a Word (.docx), Excel (.xls or .xlsx), or CSV file, and the file's contents must match its name.");
  }
  if (sniffed.ext === ".docx") return extractDocx(buffer, fileName);
  return { file: await extractSpreadsheet(buffer, fileName, sniffed.ext === ".csv" ? "csv" : "xlsx"), images: [] };
}

export async function extractFile(buffer: Buffer, fileName: string): Promise<ExtractedFile> {
  return (await extractFileWithImages(buffer, fileName)).file;
}
