import type { FormLayout } from "./layouts/types";

/** Stored on the filled record. Missing means Required Yes. */
export const SIGNATURE_REQUIRED_KEY = "_signatureRequired";

export const NOT_REQUIRED_LABEL = "Not required";

export type SignatureChoice = "yes" | "no";

export interface SignatureBlock {
  path: string;
  label: string;
}

export function showsRequiredControl(blockCount: number): boolean {
  return blockCount > 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same paths the API walker uses for a shared form layout. */
export function layoutSignatureBlocks(layout: FormLayout): SignatureBlock[] {
  const blocks: SignatureBlock[] = [];
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "row") {
        for (const field of block.fields) {
          if (field.kind === "signature") blocks.push({ path: field.name, label: field.label.replace(/:$/, "").trim() });
        }
        continue;
      }
      if (block.type !== "table") continue;
      const columns = block.columns.filter((column) => column.kind === "signature");
      if (columns.length === 0) continue;
      const rows = block.fixedRowLabels ?? [];
      if (rows.length === 0) {
        for (const column of columns) blocks.push({ path: `${block.name}.0.${column.key}`, label: column.label.replace(/:$/, "").trim() });
        continue;
      }
      rows.forEach((row, index) => {
        for (const column of columns) {
          blocks.push({ path: `${block.name}.${index}.${column.key}`, label: `${row} ${column.label}`.replace(/:$/, "").trim() });
        }
      });
    }
  }
  return blocks;
}

export function readRequiredMap(source: unknown): Record<string, SignatureChoice> {
  if (!isRecord(source)) return {};
  const raw = SIGNATURE_REQUIRED_KEY in source ? source[SIGNATURE_REQUIRED_KEY] : source.signatureRequired;
  if (!isRecord(raw)) return {};
  const out: Record<string, SignatureChoice> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "no" || value === "No") out[key] = "no";
    else if (value === "yes" || value === "Yes") out[key] = "yes";
  }
  return out;
}

export function choiceOf(source: unknown, path: string): SignatureChoice {
  return readRequiredMap(source)[path] === "no" ? "no" : "yes";
}

export function withChoice(source: unknown, path: string, choice: SignatureChoice): Record<string, SignatureChoice> {
  return { ...readRequiredMap(source), [path]: choice };
}
