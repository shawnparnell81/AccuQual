import type { FormCell } from "./isoFormLayouts";

/**
 * Signature rows on ISO sheets that are signed with the PIN Sign control.
 * The stamp is stored on the record under `field`, not in the sheet cells.
 * `cell` is the old typed cell; text typed there before PIN signing is still
 * shown under the control so nothing that was recorded disappears.
 * The API keeps the same list (iso-quality-forms FORM_SIGNATURES).
 * The "Approved By" cell in a sheet header (Visitor Log, FRM-DEV, NCR) names
 * who approved the master form. It is document-control data, not a record
 * signature, so it is not listed here.
 */
export interface IsoSheetSignature {
  field: string;
  cell: string;
  label: string;
  certify: string;
}

export const ISO_SHEET_SIGNATURES: Record<string, IsoSheetSignature[]> = {
  ncr_report: [{ field: "engineeringManagerSignature", cell: "B29", label: "Engineering Manager Approval", certify: "I certify that I reviewed this nonconformance and approve the disposition." }],
  psw: [{ field: "organizationSignature", cell: "B48", label: "Organization Authorized Signature", certify: "I affirm that the samples represented by this warrant are representative of our parts and that the information on this warrant is accurate." }],
  quality_alert: [
    { field: "approverSignature", cell: "B13", label: "Quality Manager / Authorized Approver", certify: "I certify that I approve this quality alert." },
    { field: "extensionSignature", cell: "B15", label: "Quality Manager approval for a duration extension", certify: "I certify that I approve extending this quality alert." },
  ],
  first_article: [{ field: "inspectorSignature", cell: "B34", label: "Signature", certify: "I certify that this first article inspection was performed as recorded and the results are accurate." }],
};

export function sheetSignatureFor(formType: string, cell: string): IsoSheetSignature | undefined {
  return ISO_SHEET_SIGNATURES[formType]?.find((item) => item.cell === cell);
}

/** Stamps already recorded on the record for this form's PIN signature rows. */
export function sheetSignatures(formType: string, data: unknown): Record<string, string> {
  const source = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const item of ISO_SHEET_SIGNATURES[formType] ?? []) {
    const value = source[item.field];
    if (typeof value === "string" && value.trim()) out[item.field] = value;
  }
  return out;
}

/** A PIN signature row on a layout sheet, in place of the typed text cell. */
export function signRow(formType: string, col: number, span: number, addr: string): FormCell {
  const item = sheetSignatureFor(formType, addr);
  if (!item) throw new Error(`No signature row for ${formType} ${addr}`);
  return { col, span, addr, kind: "signature", signatureKey: item.field, certify: item.certify };
}
