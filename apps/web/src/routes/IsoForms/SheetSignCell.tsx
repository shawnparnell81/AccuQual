import { SignatureStamp } from "../../components/forms/SignatureStamp";
import type { CellValue } from "../../lib/isoFormLogic";
import { sheetSignatureFor } from "../../lib/isoSheetSignatures";

export interface SheetSignProps {
  signatures?: Record<string, string>;
  onSign?: (field: string, pin: string) => Promise<unknown>;
}

/** PIN Sign control for a signature row on a hand-built ISO sheet. Text typed there before PIN signing stays visible. */
export function SheetSignCell({ formType, cell, cells, readOnly, signatures = {}, onSign }: SheetSignProps & { formType: string; cell: string; cells: Record<string, CellValue>; readOnly?: boolean }) {
  const item = sheetSignatureFor(formType, cell);
  if (!item) return null;
  const stamp = signatures[item.field] ?? "";
  const legacy = typeof cells[cell] === "string" ? String(cells[cell]).trim() : "";
  return (
    <span className="inline-flex flex-col gap-1" data-testid={`sheet-sign-${item.field}`}>
      <SignatureStamp
        value={stamp}
        certify={item.certify}
        disabled={readOnly || !onSign}
        variant="sheet"
        onSign={async (pin) => {
          if (onSign) await onSign(item.field, pin);
        }}
      />
      {!stamp && legacy && <span className="text-xs text-muted-foreground" data-testid={`legacy-sign-${cell}`}>Typed before PIN signing: {legacy}</span>}
    </span>
  );
}
