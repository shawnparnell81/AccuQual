/**
 * What a validation form's Excel workbook looks like, as plain data. scripts/extract-validation-workbook.ts writes one of
 * these per workbook (layouts/*.layout.ts) and nobody edits them by hand: change the workbook and run the script again.
 * Colors are already resolved to #RRGGBB (theme colors and tints included).
 */
export type BorderStyle = "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" | "hair";

export interface LayoutBorder {
  l?: BorderStyle;
  r?: BorderStyle;
  t?: BorderStyle;
  b?: BorderStyle;
}

export interface LayoutStyle {
  /** bold, italic, underline */
  b?: 1;
  i?: 1;
  u?: 1;
  /** font size in points, and family */
  sz?: number;
  font?: string;
  /** text color and fill color */
  fg?: string;
  bg?: string;
  h?: "left" | "center" | "right";
  v?: "top" | "middle" | "bottom";
  wrap?: 1;
  border?: LayoutBorder;
  /** Excel number format, for example "0.00" or "0%". */
  nf?: string;
  indent?: number;
}

export interface LayoutCell {
  /** a constant: text, a number, or TRUE/FALSE (a checkbox) */
  v?: string | number | boolean;
  /** a formula, without the leading = and with shared formulas already moved to this cell */
  f?: string;
  /** index into WorkbookLayout.styles */
  s: number;
}

export interface LayoutConditional {
  ranges: string[];
  /** Rules in priority order. f is true for the cell it is written for (the top-left cell of the first range). */
  rules: { f: string; bg?: string; fg?: string; b?: 1; stop?: 1 }[];
}

export interface LayoutImage {
  ext: string;
  /** the picture as a data: URL */
  src: string;
  /** top-left and bottom-right anchor, zero-based columns and rows with fractional offsets */
  from: { col: number; row: number };
  to: { col: number; row: number };
}

export interface WorkbookLayout {
  sheet: string;
  /** column widths in Excel character units, index 0 is column A */
  cols: number[];
  /** row heights in points, only rows that differ from the default */
  rowHeights: Record<string, number>;
  defaultRowHeight: number;
  styles: LayoutStyle[];
  cells: Record<string, LayoutCell>;
  merges: string[];
  /** dropdown lists by cell */
  lists: Record<string, string[]>;
  conditional: LayoutConditional[];
  images: LayoutImage[];
  maxRow: number;
  maxCol: number;
}
