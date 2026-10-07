import { formatDateTime } from "./dates";
import type { PreviewKind } from "./filePreview";
import { recordSurface } from "./recordSurface";

/** Outcome of handing a PDF to the browser. A dialog or a saved file is success. */
export type PrintPresentResult = "dialog" | "download" | "failed";

/** What an uploaded file can do. Office files print only when a PDF rendition exists. */
export type UploadedPrintChoice = "pdf" | "image" | "download";

export interface PrintIdentity {
  docId: string;
  rev: string;
}

export interface LandscapeMark {
  /** The page already asks for landscape (validation sheets, wide ISO grids). */
  wideClass: boolean;
  /** The node sizes to its content, so scrollWidth is the real grid width. */
  contentSized: boolean;
  scrollWidth: number;
  clientWidth: number;
}

export const PRINT_NOT_DOCUMENT = "AccuQual did not return a printable document.";
export const PRINT_SAVE_FAILED = "The print dialog could not be opened, and the document could not be saved.";
export const PRINT_PREPARE_FAILED = "Couldn't prepare this document for printing.";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** True when the bytes start with a PDF header. An HTML error body is not a document. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** A toast is only for a real failure. Opening the dialog, or saving the file, is not one. */
export function printShouldToast(result: PrintPresentResult): boolean {
  return result === "failed";
}

/**
 * View access is enough. "read" and "edit" are the permission levels already
 * stored for a module. "any" is a page every signed-in person can open.
 * A missing level means the check is still loading, or this page has no
 * separate module key — the route already decided they can see it.
 * Role names are not consulted.
 */
export function canPrintAccess(level: string | null | undefined): boolean {
  if (level == null || level === "any") return true;
  return level === "read" || level === "edit";
}

/** Saved forms, blank copies (an empty record is still that form), and the grids that use the same routes. */
export function offersScreenPrint(pathname: string): boolean {
  if (recordSurface(pathname)?.kind === "form") return true;
  return /^\/fai\/(?:records|plans|csa|fuel-pump)\/\d+$/.test(pathname);
}

export function uploadedPrintChoice(kind: PreviewKind, hasPdfRendition: boolean): UploadedPrintChoice {
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  if (kind === "office" && hasPdfRendition) return "pdf";
  return "download";
}

/** Doc ID and Rev as the form already shows them. Review notes are not a revision. */
export function readFormIdentity(text: string): PrintIdentity {
  const flat = text.replace(/\s+/g, " ");
  const doc =
    flat.match(/\bDoc(?:ument)?\s*(?:ID|No\.?|Number)\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]*)/i) ??
    flat.match(/\b((?:FRM|DCR|LST|ECR|NCR)-[A-Z0-9-]+)\b/i);
  const rev = flat.match(/\bRev(?:ision)?\s*:\s*([A-Za-z0-9.]+)/i) ?? flat.match(/\bRev(?:ision)?\s+([A-Za-z0-9.]{1,6})\b/);
  return {
    docId: doc?.[1]?.replace(/[.,;]+$/, "") ?? "",
    rev: rev?.[1]?.replace(/[.,;]+$/, "") ?? "",
  };
}

export function formatPrintFooter(input: { docId: string; rev: string; printedBy: string; printedAt: string }): string {
  const who = input.printedBy.trim() || "Signed-in user";
  const parts = [input.docId.trim(), input.rev.trim() ? `Rev ${input.rev.trim()}` : "", `Printed ${input.printedAt}`, who];
  return parts.filter(Boolean).join(" · ");
}

/** Portrait letter content is about 7.5in. Wider content-sized grids move to landscape. */
export function needsLandscape(marks: LandscapeMark[], limit = 760): boolean {
  return marks.some((mark) => {
    if (mark.wideClass) return true;
    if (mark.contentSized) return mark.scrollWidth > limit;
    return mark.scrollWidth > limit && mark.scrollWidth > mark.clientWidth + 8;
  });
}

const WIDE_CLASS = ["validation-report-print", "aq-print-wide"];
const CONTENT_SIZED = ["csa-sheet", "fp-sheet"];

export function landscapeMarks(root: ParentNode): LandscapeMark[] {
  const marks: LandscapeMark[] = [];
  const nodes = root instanceof Element ? [root, ...root.querySelectorAll<Element>("*")] : [...root.querySelectorAll<Element>("*")];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const wideClass = WIDE_CLASS.some((name) => node.classList.contains(name));
    const contentSized = CONTENT_SIZED.some((name) => node.classList.contains(name));
    const overflows = node.scrollWidth > node.clientWidth + 8;
    if (!wideClass && !contentSized && !overflows) continue;
    if (!wideClass && !contentSized && !node.closest(".iso, .e8-grid, .insp, .dense-log, .csa, .fp")) continue;
    marks.push({
      wideClass,
      contentSized,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    });
  }
  return marks;
}

const PRINT_FOOTER_ID = "aq-print-footer";

/**
 * Print the page that is already on screen. The browser dialog is the same
 * path presentPdf uses after a file is ready. Footer text and landscape are
 * applied first so paper matches the open form, including calculated cells.
 * Audit history has no client write for "printed", so this does not invent one.
 */
export function printScreen(root: HTMLElement, meta: { printedBy: string; now?: Date }): void {
  const identity = readFormIdentity(root.innerText || "");
  const printedAt = formatDateTime(meta.now ?? new Date());
  let footer = document.getElementById(PRINT_FOOTER_ID);
  if (!footer) {
    footer = document.createElement("div");
    footer.id = PRINT_FOOTER_ID;
    footer.className = "aq-print-footer";
    footer.setAttribute("aria-hidden", "true");
    document.body.appendChild(footer);
  }
  footer.textContent = formatPrintFooter({ ...identity, printedBy: meta.printedBy, printedAt });
  document.documentElement.classList.toggle("aq-print-landscape", needsLandscape(landscapeMarks(root)));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.documentElement.classList.remove("aq-print-landscape");
    footer?.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 60000);
  window.print();
}

const FRAME_STYLE = [
  "position:fixed",
  "left:0",
  "top:0",
  "width:8.5in",
  "height:11in",
  "opacity:0",
  "border:0",
  "pointer-events:none",
  "z-index:-1",
].join(";");

function releaseLater(url: string, frame: HTMLIFrameElement, delayMs: number) {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    frame.remove();
  }, delayMs);
}

function saveDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Open the browser print dialog for a PDF we already fetched.
 * The object URL stays alive until afterprint (or a long fallback). Revoking
 * it in the same turn makes the viewer fail after the dialog has already opened.
 * A cross-origin PDF plugin that refuses print() falls back to a download.
 * Either path is success. This throws only when the bytes are not a PDF, or
 * when both the dialog and the download fail.
 */
export async function presentPdf(bytes: Uint8Array, filename: string): Promise<Exclude<PrintPresentResult, "failed">> {
  if (!isPdfBytes(bytes)) {
    throw new Error(PRINT_NOT_DOCUMENT);
  }

  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.title = filename;
  frame.setAttribute("style", FRAME_STYLE);
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    frame.addEventListener("load", done, { once: true });
    window.setTimeout(done, 1500);
  });
  await new Promise((resolve) => window.setTimeout(resolve, 450));

  try {
    const win = frame.contentWindow;
    if (!win) throw new Error("print frame unavailable");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
      frame.remove();
    };
    try {
      win.addEventListener("afterprint", () => window.setTimeout(release, 1500), { once: true });
    } catch {
      // A PDF plugin frame can refuse the listener. print() may still open the dialog.
    }
    window.setTimeout(release, 60000);
    win.focus();
    win.print();
    return "dialog";
  } catch {
    try {
      saveDownload(url, filename);
      releaseLater(url, frame, 60000);
      return "download";
    } catch {
      URL.revokeObjectURL(url);
      frame.remove();
      throw new Error(PRINT_SAVE_FAILED);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Print an image on a white page. The frame is the same idea as presentPdf:
 * keep the blob alive until afterprint, and save the file if print() refuses.
 */
export async function presentImage(bytes: Uint8Array, filename: string, mimeType: string): Promise<Exclude<PrintPresentResult, "failed">> {
  const mime = mimeType || "image/png";
  const src = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title><style>
    html,body{margin:0;background:#fff;color:#111;}
    img{display:block;max-width:100%;height:auto;background:#fff;}
    @page{margin:0.5in;}
  </style></head><body><img src="${src}" alt=""></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.title = filename;
  frame.setAttribute("style", FRAME_STYLE);
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    frame.addEventListener("load", done, { once: true });
    window.setTimeout(done, 1500);
  });
  await new Promise((resolve) => window.setTimeout(resolve, 450));

  try {
    const win = frame.contentWindow;
    if (!win) throw new Error("print frame unavailable");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
      frame.remove();
    };
    try {
      win.addEventListener("afterprint", () => window.setTimeout(release, 1500), { once: true });
    } catch {
      // The frame can refuse the listener. print() may still open the dialog.
    }
    window.setTimeout(release, 60000);
    win.focus();
    win.print();
    return "dialog";
  } catch {
    try {
      saveDownload(url, filename.endsWith(".html") ? filename : `${filename}.html`);
      releaseLater(url, frame, 60000);
      return "download";
    } catch {
      URL.revokeObjectURL(url);
      frame.remove();
      throw new Error(PRINT_SAVE_FAILED);
    }
  }
}
