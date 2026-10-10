import { currentCompanyLogo } from "./companyLogoCache";
import { formatDate } from "./dates";
import { bandHtmlForPage, bandHasContent, bandVaries, printBandChoice, resolveDocumentFields, type DocumentBand } from "./documentBands";
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

/**
 * Saved forms, blank copies (an empty record is still that form), the grids
 * that use the same routes, and the controlled lists (Master Document List,
 * Master Equipment List). One shared control covers each of these.
 */
export function offersScreenPrint(pathname: string): boolean {
  const kind = recordSurface(pathname)?.kind;
  if (kind === "form" || kind === "list") return true;
  return /^\/fai\/(?:records|plans|csa|fuel-pump)\/\d+$/.test(pathname);
}

export function uploadedPrintChoice(kind: PreviewKind, hasPdfRendition: boolean): UploadedPrintChoice {
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  if (kind === "office" && hasPdfRendition) return "pdf";
  return "download";
}

const REV_WORDS = new Set(["date", "issued", "number", "no", "id", "code", "level", "status", "revision", "rev", "draft", "active", "closed"]);
const ID_RANK: Record<string, number> = { FRM: 1, TMP: 2, LST: 3, DCR: 4, ECR: 5, DOC: 6, NCR: 7 };

/** A revision token such as A, C, or 1.2. A neighboring label ("Date Issued") is not a revision. */
export function revisionToken(value: unknown): string {
  const text = typeof value === "string"
    ? value.trim().replace(/^rev(?:ision)?[:\s]*/i, "")
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
  if (!text || text.length > 12 || REV_WORDS.has(text.toLowerCase())) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9.]*$/.test(text)) return "";
  return text;
}

/** Printed at, on the Eastern clock, with the zone written out. */
export function formatPrintStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} ET`;
}

/** Doc ID and Rev as the form already shows them. Review notes are not a revision. */
export function readFormIdentity(text: string): PrintIdentity {
  const flat = text.replace(/\s+/g, " ");
  const labeled = flat.match(/\bDoc(?:ument)?\s*(?:ID|No\.?|Number)\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]*)/i);
  const found = [...flat.matchAll(/\b((?:[A-Z0-9]+-)*(?:FRM|DCR|LST|ECR|TMP|DOC|NCR)-[A-Z0-9-]*\d[A-Z0-9-]*)\b/gi)].map((match) => match[1]!.replace(/[.,;]+$/, ""));
  const unique: string[] = [];
  for (const id of found) {
    if (!unique.some((item) => item.toLowerCase() === id.toLowerCase())) unique.push(id);
  }
  const kept = unique.filter((id) => !unique.some((other) => other.length > id.length && other.toLowerCase().endsWith(`-${id.toLowerCase()}`)));
  kept.sort((a, b) => {
    const rank = (id: string) => ID_RANK[id.slice(0, 3).toUpperCase()] ?? 9;
    return rank(a) - rank(b) || b.length - a.length;
  });
  const rev = flat.match(/\bRev(?:ision)?\s*:\s*([A-Za-z0-9.]+)/i) ?? flat.match(/\bRev(?:ision)?\s+([A-Za-z0-9.]{1,6})\b/i);
  return {
    docId: (labeled?.[1] ?? kept[0] ?? "").replace(/[.,;]+$/, ""),
    rev: revisionToken(rev?.[1] ?? ""),
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

function storedBand(root: ParentNode, name: "header" | "footer"): DocumentBand | null {
  const el = root.querySelector(`[data-print-band="${name}"]`);
  if (!(el instanceof HTMLElement)) return null;
  const variant = (slot: string) => {
    const node = el.querySelector(`[data-variant="${slot}"]`);
    return node instanceof HTMLElement ? node.innerHTML : "";
  };
  const band: DocumentBand = {
    differentFirstPage: el.getAttribute("data-different-first") === "true",
    differentOddEven: el.getAttribute("data-different-even") === "true",
    defaultHtml: variant("default"),
    firstHtml: variant("first"),
    evenHtml: variant("even"),
  };
  return bandHasContent(band) ? band : null;
}

function printIdentity(root: HTMLElement): { docId: string; rev: string } {
  const shown = readFormIdentity(root.innerText || "");
  const docId = root.querySelector("[data-doc-id]")?.getAttribute("data-doc-id")?.trim() || shown.docId;
  const revNode = root.querySelector("[data-doc-rev]");
  const rev = revNode ? revisionToken(revNode.getAttribute("data-doc-rev")) : shown.rev;
  return { docId, rev };
}

function slicePages(body: HTMLElement): string[] {
  const blocks = [...body.children];
  if (!blocks.length) return [body.innerHTML || "<p></p>"];
  const limit = 780;
  const pages: string[][] = [];
  let current: string[] = [];
  let used = 0;
  const push = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };
  for (const block of blocks) {
    if (block.classList.contains("aq-page-break")) {
      push();
      continue;
    }
    const height = Math.max(block instanceof HTMLElement ? block.offsetHeight : 24, 24);
    if (current.length && used + height > limit) push();
    current.push(block.outerHTML);
    used += height;
  }
  push();
  return pages.length ? pages.map((page) => page.join("")) : ["<p></p>"];
}

/** Puts the document's own header and footer on the pages, and puts the editor back after. */
function mountDocumentPrint(root: HTMLElement, now: Date): () => void {
  const header = storedBand(root, "header");
  const footer = storedBand(root, "footer");
  const choice = printBandChoice(header, footer);
  const identity = printIdentity(root);
  const date = formatDate(now);

  if (!bandVaries(header) && !bandVaries(footer)) {
    const saved: { kind: "header" | "footer"; html: string }[] = [];
    const paint = (kind: "header" | "footer", html: string) => {
      const body = root.querySelector(`[data-testid="document-${kind}"] .fb-band-body`);
      if (!(body instanceof HTMLElement)) return;
      saved.push({ kind, html: body.innerHTML });
      body.innerHTML = html;
    };
    if (choice.header === "custom" && header) {
      paint("header", resolveDocumentFields(header.defaultHtml, { page: "counter", pages: "counter", ...identity, date }));
    }
    if (choice.footer === "custom" && footer) {
      paint("footer", resolveDocumentFields(footer.defaultHtml, { page: "counter", pages: "counter", ...identity, date }));
    }
    return () => {
      for (const item of saved) {
        const body = root.querySelector(`[data-testid="document-${item.kind}"] .fb-band-body`);
        if (body instanceof HTMLElement) body.innerHTML = item.html;
      }
    };
  }

  document.documentElement.classList.add("aq-print-paginated");
  const flow = root.querySelector(".fb-print-flow");
  const doc = root.querySelector(".fb-print-flow .fb-doc");
  const pages = doc instanceof HTMLElement ? slicePages(doc) : ["<p></p>"];
  const host = document.createElement("div");
  host.className = "fb-print-pages";
  pages.forEach((pageHtml, index) => {
    const page = index + 1;
    const section = document.createElement("section");
    section.className = "fb-print-page";
    if (choice.header === "custom" && header) {
      const node = document.createElement("div");
      node.className = "fb-print-page-header";
      node.innerHTML = resolveDocumentFields(bandHtmlForPage(header, page), { page, pages: pages.length, ...identity, date });
      section.appendChild(node);
    }
    const body = document.createElement("div");
    body.className = "fb-doc";
    body.innerHTML = pageHtml;
    section.appendChild(body);
    if (choice.footer === "custom" && footer) {
      const node = document.createElement("div");
      node.className = "fb-print-page-footer";
      node.innerHTML = resolveDocumentFields(bandHtmlForPage(footer, page), { page, pages: pages.length, ...identity, date });
      section.appendChild(node);
    }
    host.appendChild(section);
  });
  if (flow instanceof HTMLElement && flow.parentElement) {
    flow.parentElement.insertBefore(host, flow);
    flow.classList.add("fb-flow-suppressed");
  }
  return () => {
    host.remove();
    if (flow instanceof HTMLElement) flow.classList.remove("fb-flow-suppressed");
    document.documentElement.classList.remove("aq-print-paginated");
  };
}

const PRINT_ROOT_ID = "aq-print-root";

function outermostSheets(root: HTMLElement): HTMLElement[] {
  const all = [
    ...(root.classList.contains("aq-print-sheet") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(".aq-print-sheet"),
  ].filter((sheet) => sheet === root || !sheet.closest(".no-print"));
  return all.filter((sheet) => !all.some((other) => other !== sheet && other.contains(sheet)));
}

function syncControls(from: ParentNode, to: ParentNode) {
  const live = from.querySelectorAll("input, textarea, select");
  const copy = to.querySelectorAll("input, textarea, select");
  const count = Math.min(live.length, copy.length);
  for (let index = 0; index < count; index += 1) {
    const source = live[index];
    const dest = copy[index];
    if (source instanceof HTMLInputElement && dest instanceof HTMLInputElement) {
      dest.value = source.value;
      dest.checked = source.checked;
      if (source.type === "checkbox" || source.type === "radio") {
        if (source.checked) dest.setAttribute("checked", "");
        else dest.removeAttribute("checked");
      } else dest.setAttribute("value", source.value);
    } else if (source instanceof HTMLTextAreaElement && dest instanceof HTMLTextAreaElement) {
      dest.value = source.value;
      dest.textContent = source.value;
    } else if (source instanceof HTMLSelectElement && dest instanceof HTMLSelectElement) {
      dest.value = source.value;
      const selected = source.selectedOptions[0]?.value;
      for (const option of dest.options) option.selected = option.value === selected;
    }
  }
}

function pruneChrome(node: HTMLElement) {
  node.querySelectorAll("button, .no-print, .folder-path-bar, .aq-step-trail, .record-glance, .record-related, .aq-split-bar").forEach((el) => el.remove());
}

function compactBanner(root: ParentNode): HTMLElement | null {
  const read = (name: string) => root.querySelector(`[${name}]`)?.getAttribute(name)?.trim() ?? "";
  const parts = [read("data-print-number"), read("data-print-title"), read("data-print-site")].filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  if (!unique.length) return null;
  const banner = document.createElement("p");
  banner.className = "aq-print-banner";
  banner.textContent = unique.join(" · ");
  return banner;
}

function markWide(root: HTMLElement, host: HTMLElement) {
  const wide = root.classList.contains("validation-report-print")
    || root.classList.contains("aq-print-wide")
    || root.querySelector(".validation-report-print, .aq-print-wide") != null;
  if (wide) host.classList.add("aq-print-wide");
}

async function settleImages(root: ParentNode) {
  const cached = currentCompanyLogo();
  const images = [...root.querySelectorAll("img")];
  await Promise.all(images.map(async (img) => {
    const logo = img.classList.contains("dma-form-logo") || img.classList.contains("wot-logo") || img.alt === "Company logo" || img.alt === "Logo";
    if (logo && cached) {
      img.src = cached;
      img.alt = "";
    }
    if (!img.getAttribute("src")) {
      if (logo) img.remove();
      return;
    }
    if (typeof img.decode === "function" && !img.complete) {
      try {
        await img.decode();
      } catch {
        // A missing picture is removed below when it is the company mark.
      }
    }
    if (logo && img.alt === "Company logo") img.alt = "";
    if (logo && (!img.complete || img.naturalWidth === 0)) img.remove();
  }));
}

/**
 * Print the form that is already on screen. Workflow chrome stays on the page
 * and out of the dialog. Footer text and landscape are applied first so paper
 * matches the open form, including calculated cells. Images are inlined before
 * the dialog opens. A Word-style document with its own header or footer prints
 * that side instead. Audit history has no client write for "printed".
 */
export function printScreen(root: HTMLElement, meta: { printedBy: string; now?: Date }): void {
  void runPrint(root, meta);
}

async function runPrint(root: HTMLElement, meta: { printedBy: string; now?: Date }): Promise<void> {
  const now = meta.now ?? new Date();
  const sheets = outermostSheets(root);
  let printRoot: HTMLElement | null = null;
  if (sheets.length > 0) {
    document.getElementById(PRINT_ROOT_ID)?.remove();
    printRoot = document.createElement("div");
    printRoot.id = PRINT_ROOT_ID;
    const banner = compactBanner(root);
    if (banner) printRoot.appendChild(banner);
    for (const sheet of sheets) {
      const clone = sheet.cloneNode(true) as HTMLElement;
      syncControls(sheet, clone);
      pruneChrome(clone);
      printRoot.appendChild(clone);
    }
    markWide(root, printRoot);
    document.body.appendChild(printRoot);
  }

  const target = printRoot ?? root;
  const choice = printBandChoice(storedBand(target, "header"), storedBand(target, "footer"));
  const identity = printIdentity(target);
  const printedAt = formatPrintStamp(now);
  let footer: HTMLElement | null = null;
  if (choice.footer === "standard") {
    footer = document.getElementById(PRINT_FOOTER_ID);
    if (!footer) {
      footer = document.createElement("div");
      footer.id = PRINT_FOOTER_ID;
      footer.className = "aq-print-footer";
      footer.setAttribute("aria-hidden", "true");
      document.body.appendChild(footer);
    }
    footer.textContent = formatPrintFooter({ ...identity, printedBy: meta.printedBy, printedAt });
  }
  const landscape = needsLandscape(landscapeMarks(root)) || target.classList.contains("aq-print-wide");
  document.documentElement.classList.toggle("aq-print-custom-header", choice.header === "custom");
  document.documentElement.classList.toggle("aq-print-custom-footer", choice.footer === "custom");
  document.documentElement.classList.toggle("aq-print-landscape", landscape);
  const restoreBands = choice.header === "custom" || choice.footer === "custom" ? mountDocumentPrint(target, now) : () => undefined;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.documentElement.classList.remove("aq-print-landscape", "aq-print-custom-header", "aq-print-custom-footer", "aq-print-paginated", "aq-print-isolated");
    restoreBands();
    footer?.remove();
    printRoot?.remove();
    window.removeEventListener("afterprint", cleanup);
  };

  let opened = false;
  try {
    await Promise.race([settleImages(target), new Promise((resolve) => window.setTimeout(resolve, 2000))]);
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    await Promise.race([fontsReady, new Promise((resolve) => window.setTimeout(resolve, 1200))]);
    if (printRoot) document.documentElement.classList.add("aq-print-isolated");
    window.addEventListener("afterprint", cleanup);
    window.setTimeout(cleanup, 60000);
    opened = true;
    window.print();
  } finally {
    if (!opened) cleanup();
  }
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
