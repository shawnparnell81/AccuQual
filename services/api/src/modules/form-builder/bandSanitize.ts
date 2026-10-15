import sanitizeHtml from "sanitize-html";

/** Header and footer HTML keeps only formatting, tables, images and document fields. */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "span", "div", "b", "strong", "i", "em", "u", "s", "sub", "sup", "small",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr", "img",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col",
  ],
  allowedAttributes: {
    "*": ["style", "class", "align", "width", "height", "data-*", "contenteditable"],
    img: ["src", "alt", "style", "class", "width", "height"],
    td: ["colspan", "rowspan", "style", "class", "align", "width", "height"],
    th: ["colspan", "rowspan", "style", "class", "align", "width", "height"],
    col: ["span", "style", "width"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { img: ["data", "http", "https"] },
  allowProtocolRelative: false,
};

export function sanitizeBandHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
