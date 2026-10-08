/** Header and footer stored on a Word-style form. Empty bands print with the app chrome. */

export type DocField = "page" | "pages" | "docId" | "rev" | "date";
export type BandSlot = "default" | "first" | "even";

export interface DocumentBand {
  differentFirstPage: boolean;
  differentOddEven: boolean;
  defaultHtml: string;
  firstHtml: string;
  evenHtml: string;
}

export const DOC_FIELDS: { id: DocField; label: string }[] = [
  { id: "page", label: "Page number" },
  { id: "pages", label: "Page count" },
  { id: "docId", label: "Doc ID" },
  { id: "rev", label: "Rev" },
  { id: "date", label: "Date" },
];

export function fieldToken(id: DocField, label: string): string {
  return `<span class="fb-doc-field" data-doc-field="${id}" contenteditable="false">${label}</span>`;
}

export function emptyBand(): DocumentBand {
  return { differentFirstPage: false, differentOddEven: false, defaultHtml: "", firstHtml: "", evenHtml: "" };
}

export function htmlHasContent(html: string): boolean {
  const marked = html.replace(/<img\b[^>]*>/gi, "x").replace(/data-doc-field\s*=/gi, "x");
  const text = marked.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0;
}

export function bandHasContent(band: DocumentBand | null | undefined): boolean {
  if (!band) return false;
  return htmlHasContent(band.defaultHtml) || htmlHasContent(band.firstHtml) || htmlHasContent(band.evenHtml);
}

export function bandVaries(band: DocumentBand | null | undefined): boolean {
  if (!bandHasContent(band)) return false;
  return Boolean(band?.differentFirstPage || band?.differentOddEven);
}

/** Custom replaces the app header or footer on its own. The other side stays standard. */
export function printBandChoice(header: DocumentBand | null | undefined, footer: DocumentBand | null | undefined): {
  header: "custom" | "standard";
  footer: "custom" | "standard";
} {
  return {
    header: bandHasContent(header) ? "custom" : "standard",
    footer: bandHasContent(footer) ? "custom" : "standard",
  };
}

/** Page 1 uses the first-page band when that switch is on. Even pages use the even band. */
export function bandHtmlForPage(band: DocumentBand, page: number): string {
  if (page <= 1 && band.differentFirstPage) return band.firstHtml;
  if (band.differentOddEven && page % 2 === 0) return band.evenHtml;
  return band.defaultHtml;
}

export function slotHtml(band: DocumentBand, slot: BandSlot): string {
  if (slot === "first") return band.firstHtml;
  if (slot === "even") return band.evenHtml;
  return band.defaultHtml;
}

export function withSlot(band: DocumentBand, slot: BandSlot, html: string): DocumentBand {
  if (slot === "first") return { ...band, firstHtml: html };
  if (slot === "even") return { ...band, evenHtml: html };
  return { ...band, defaultHtml: html };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Page fields become counters when the page count is not known yet. Other fields become text. */
export function resolveDocumentFields(
  html: string,
  values: { page: number | "counter"; pages: number | "counter"; docId: string; rev: string; date: string },
): string {
  return html.replace(/<span\b[^>]*\bdata-doc-field="(page|pages|docId|rev|date)"[^>]*>[\s\S]*?<\/span>/gi, (_match, name: string) => {
    if (name === "page") return values.page === "counter" ? `<span class="fb-page-num"></span>` : escapeText(String(values.page));
    if (name === "pages") return values.pages === "counter" ? `<span class="fb-page-count"></span>` : escapeText(String(values.pages));
    if (name === "docId") return escapeText(values.docId);
    if (name === "rev") return escapeText(values.rev);
    return escapeText(values.date);
  });
}
