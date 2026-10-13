/** The label sizes a thermal label printer is set up for. The id is what is stored (Settings default) and sent. Width and height are in inches. */
export const LABEL_SIZES = [
  { id: "2x1", label: "2 × 1 in", widthIn: 2, heightIn: 1 },
  { id: "2.25x1.25", label: "2.25 × 1.25 in", widthIn: 2.25, heightIn: 1.25 },
  { id: "3x2", label: "3 × 2 in", widthIn: 3, heightIn: 2 },
  { id: "4x6", label: "4 × 6 in", widthIn: 4, heightIn: 6 },
] as const;

export type LabelSizeId = (typeof LABEL_SIZES)[number]["id"];

export const LABEL_SIZE_IDS = LABEL_SIZES.map((size) => size.id) as [LabelSizeId, ...LabelSizeId[]];

export const DEFAULT_LABEL_SIZE: LabelSizeId = "2x1";

export function labelSizeText(id: LabelSizeId): string {
  return LABEL_SIZES.find((size) => size.id === id)?.label.replace(/×/g, "x") ?? id;
}

export function isLabelSizeId(value: unknown): value is LabelSizeId {
  return typeof value === "string" && (LABEL_SIZE_IDS as string[]).includes(value);
}
