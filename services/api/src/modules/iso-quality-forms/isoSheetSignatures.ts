/**
 * PIN signature rows on ISO sheets that used to be typed text. Same list as
 * apps/web/src/lib/isoSheetSignatures.ts; keep the two in sync.
 */
export const ISO_SHEET_SIGNATURES: Record<string, Record<string, { label: string; certify: string }>> = {
  ncr_report: { engineeringManagerSignature: { label: "Engineering Manager Approval", certify: "I certify that I reviewed this nonconformance and approve the disposition." } },
  psw: { organizationSignature: { label: "Organization Authorized Signature", certify: "I affirm that the samples represented by this warrant are representative of our parts and that the information on this warrant is accurate." } },
  quality_alert: {
    approverSignature: { label: "Quality Manager / Authorized Approver", certify: "I certify that I approve this quality alert." },
    extensionSignature: { label: "Quality Manager approval for a duration extension", certify: "I certify that I approve extending this quality alert." },
  },
  first_article: { inspectorSignature: { label: "Signature", certify: "I certify that this first article inspection was performed as recorded and the results are accurate." } },
};

export function isoSheetCertifications(): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(ISO_SHEET_SIGNATURES).map(([type, fields]) => [type, Object.fromEntries(Object.entries(fields).map(([field, item]) => [field, item.certify]))]));
}
