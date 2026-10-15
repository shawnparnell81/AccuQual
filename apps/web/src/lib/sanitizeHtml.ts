import DOMPurify from "dompurify";

/** Cleans stored header and footer HTML before it is put on the page. */
export function sanitizeBandHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ["contenteditable"] });
}
