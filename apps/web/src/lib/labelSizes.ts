/** Label sizes for a thermal label printer (inches). The id is what Settings stores. Keep in step with services/api/src/modules/labels/labelSizes.ts. */
export const LABEL_SIZES = [
  { id: "2x1", label: "2 × 1 in", widthIn: 2, heightIn: 1 },
  { id: "2.25x1.25", label: "2.25 × 1.25 in", widthIn: 2.25, heightIn: 1.25 },
  { id: "3x2", label: "3 × 2 in", widthIn: 3, heightIn: 2 },
  { id: "4x6", label: "4 × 6 in", widthIn: 4, heightIn: 6 },
] as const;

export type LabelSizeId = (typeof LABEL_SIZES)[number]["id"];
export type LabelSize = (typeof LABEL_SIZES)[number];

export const DEFAULT_LABEL_SIZE: LabelSizeId = "2x1";

export function labelSizeById(id: string | null | undefined): LabelSize {
  return LABEL_SIZES.find((size) => size.id === id) ?? LABEL_SIZES[0];
}

/**
 * The print rules for a sheet of labels: one label per page, the page exactly the label size, no margins. Only the label sheet
 * prints; everything else on the page is hidden. The sheet itself is hidden on screen.
 */
export function labelPrintCss(size: LabelSize): string {
  const w = `${size.widthIn}in`;
  const h = `${size.heightIn}in`;
  return `
@media screen { .aq-label-print-root { display: none; } }
@media print {
  @page { size: ${w} ${h}; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.aq-label-print-root) { display: none !important; }
  .aq-label-print-root { display: block !important; }
  .aq-label-page { box-sizing: border-box; width: ${w}; height: ${h}; overflow: hidden; break-after: page; page-break-after: always; break-inside: avoid; }
  .aq-label-page:last-child { break-after: auto; page-break-after: auto; }
}`;
}
