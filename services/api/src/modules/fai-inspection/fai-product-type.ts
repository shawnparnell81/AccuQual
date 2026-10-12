/**
 * Pure product-type inference, separated out so it's testable without a database. Case-insensitive.
 * No other inference beyond these two patterns — anything else (including empty/missing text) is null.
 */
export type FaiProductType = "csa" | "fuel_pump" | null;

export function productTypeFor(text: string | null | undefined): FaiProductType {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bcsa\b|complete strut|strut assembl/.test(t)) return "csa";
  if (/fuel\s*pump/.test(t)) return "fuel_pump";
  return null;
}
