/** How a clicked file should open. Unsupported types are downloaded instead. */
export type PreviewKind = "image" | "pdf" | "office" | "download";

/** In-browser Office preview when ONLYOFFICE is not configured. `.xlsx` uses the grid; `.docx` and `.pptx` have their own. */
export type ClientOfficeKind = "docx" | "sheet" | "pptx";

/** Where an Office file opens. `onlyoffice` is used only when that server is configured and the file is one it can open. */
export type OfficePreviewRoute = "onlyoffice" | ClientOfficeKind;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLS_MIME = "application/vnd.ms-excel";
const CSV_MIME = new Set(["text/csv", "application/csv", "text/comma-separated-values"]);

/** Past this size the browser preview shows a notice instead of parsing the file. */
export const OFFICE_PREVIEW_BYTE_LIMIT = 15 * 1024 * 1024;

function mimeOf(mimeType?: string | null): string {
  return (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
}

function extension(fileName: string): string {
  const name = fileName.toLowerCase().split("?")[0] ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

/** Word, Excel, and PowerPoint files the ONLYOFFICE editor can open. Legacy `.xls` and `.csv` are not among them. */
export function onlyOfficeFile(fileName: string, mimeType?: string | null): boolean {
  const ext = extension(fileName);
  if (ext === ".xls" || ext === ".csv") return false;
  const mime = mimeOf(mimeType);
  return ext === ".docx" || ext === ".xlsx" || ext === ".pptx" || mime === DOCX_MIME || mime === XLSX_MIME || mime === PPTX_MIME;
}

export function clientOfficeKind(fileName: string, mimeType?: string | null): ClientOfficeKind | null {
  const ext = extension(fileName);
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") return "sheet";
  const mime = mimeOf(mimeType);
  if (mime === DOCX_MIME) return "docx";
  if (mime === PPTX_MIME) return "pptx";
  if (mime === XLSX_MIME || mime === XLS_MIME || CSV_MIME.has(mime)) return "sheet";
  return null;
}

export function officePreviewRoute(fileName: string, mimeType: string | null | undefined, onlyOfficeConfigured: boolean): OfficePreviewRoute | null {
  const kind = clientOfficeKind(fileName, mimeType);
  if (!kind) return null;
  if (onlyOfficeConfigured && onlyOfficeFile(fileName, mimeType)) return "onlyoffice";
  return kind;
}

export function officePreviewTooLarge(bytes: number | null | undefined): boolean {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > OFFICE_PREVIEW_BYTE_LIMIT;
}

export function previewKind(fileName: string, mimeType?: string | null): PreviewKind {
  const name = fileName.toLowerCase();
  const mime = mimeOf(mimeType);
  if (IMAGE_EXT.test(name) || IMAGE_MIME.has(mime)) return "image";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (clientOfficeKind(fileName, mimeType)) return "office";
  return "download";
}

export function canPreview(fileName: string, mimeType?: string | null): boolean {
  return previewKind(fileName, mimeType) !== "download";
}

/** Saves bytes as a file in the browser. Used by every Download button next to a preview. */
export function saveBytes(data: ArrayBuffer | Blob, fileName: string, mimeType?: string) {
  const blob = data instanceof Blob ? data : new Blob([data], mimeType ? { type: mimeType } : undefined);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
