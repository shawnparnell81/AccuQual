import path from "node:path";

/** What the bytes actually are. The browser-supplied type is never consulted. */
export interface SniffedFile {
  mime: string;
  ext: string;
}

export const UPLOAD_TYPE_ERROR =
  "That file type isn't allowed. Upload a PDF, image (PNG, JPEG, GIF, WebP), Word, Excel, PowerPoint, or CSV file, and the file's contents must match its name.";

export const PDF_ONLY_ERROR = "Only PDF files are accepted, and the file's contents must be a PDF.";

const PDF = "application/pdf";
const PNG = "image/png";
const JPEG = "image/jpeg";
const GIF = "image/gif";
const WEBP = "image/webp";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLS = "application/vnd.ms-excel";
const CSV = "text/csv";

function extOf(name: string): string {
  return path.extname(name).toLowerCase();
}

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function isOle(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 && buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1;
}

/** True only for a PDF or a raster image. Office files, CSV, and anything else are downloads. */
export function isInlineSafe(head: Buffer): boolean {
  return inlineMime(head) !== null;
}

export function inlineMime(head: Buffer): string | null {
  if (head.length >= 4 && head.subarray(0, 4).toString("latin1") === "%PDF") return PDF;
  if (head.length >= 4 && head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return PNG;
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return JPEG;
  if (head.length >= 4 && head.subarray(0, 4).toString("latin1") === "GIF8") return GIF;
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return WEBP;
  return null;
}

function looksLikeCsv(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.length === 0 || sample.includes(0)) return false;
  if (sample.length >= 2 && sample[0] === 0x4d && sample[1] === 0x5a) return false;
  if (sample.length >= 4 && sample.subarray(0, 4).toString("latin1") === "%PDF") return false;
  if (isZip(sample) || isOle(sample)) return false;
  return true;
}

/**
 * Allow-list for evidence, portal files, and library uploads.
 * The extension and the bytes both have to agree. A renamed executable is refused.
 */
export function sniffUpload(buf: Buffer, originalName: string): SniffedFile | null {
  if (buf.length === 0) return null;
  const ext = extOf(originalName);
  const head = buf.subarray(0, Math.min(buf.length, 16));
  if (head.length >= 4 && head.subarray(0, 4).toString("latin1") === "%PDF" && ext === ".pdf") return { mime: PDF, ext: ".pdf" };
  if (head.length >= 4 && head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG" && ext === ".png") return { mime: PNG, ext: ".png" };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff && (ext === ".jpg" || ext === ".jpeg")) return { mime: JPEG, ext };
  if (head.length >= 4 && head.subarray(0, 4).toString("latin1") === "GIF8" && ext === ".gif") return { mime: GIF, ext: ".gif" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP" && ext === ".webp") return { mime: WEBP, ext: ".webp" };
  if (isZip(buf)) {
    if (ext === ".docx" && buf.includes("word/")) return { mime: DOCX, ext: ".docx" };
    if (ext === ".xlsx" && buf.includes("xl/")) return { mime: XLSX, ext: ".xlsx" };
    if (ext === ".pptx" && buf.includes("ppt/")) return { mime: PPTX, ext: ".pptx" };
    return null;
  }
  if (isOle(buf) && ext === ".xls") return { mime: XLS, ext: ".xls" };
  if (ext === ".csv" && looksLikeCsv(buf)) return { mime: CSV, ext: ".csv" };
  return null;
}

export function sniffPdf(buf: Buffer, originalName: string): SniffedFile | null {
  const found = sniffUpload(buf, originalName);
  return found?.ext === ".pdf" ? found : null;
}

export function sniffSpreadsheet(buf: Buffer, originalName: string): SniffedFile | null {
  const found = sniffUpload(buf, originalName);
  if (!found) return null;
  return found.ext === ".csv" || found.ext === ".xlsx" || found.ext === ".xls" ? found : null;
}
