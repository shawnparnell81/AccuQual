import { createContext, useContext, type ReactNode } from "react";

/**
 * The record a picture is filed on. The type is the same one Evidence /
 * Attachments already uses for that record, so the file keeps that
 * record's access check.
 */
export interface PictureRecord {
  entityType: string;
  entityId: number;
}

const PictureRecordContext = createContext<PictureRecord | null>(null);

export function PictureRecordProvider({ entityType, entityId, children }: PictureRecord & { children: ReactNode }) {
  return <PictureRecordContext.Provider value={{ entityType, entityId }}>{children}</PictureRecordContext.Provider>;
}

export function usePictureRecord(): PictureRecord | null {
  return useContext(PictureRecordContext);
}

/**
 * Form windows know the form type, not always the attachment type.
 * Where the form is filled on a parent record, use that parent's type
 * (the same key the attachment access check already knows).
 */
const FORM_ATTACHMENT_TYPE: Record<string, string> = {
  ncr: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  fmea: "risk",
  calibration: "calibration",
  gage_rr: "calibration",
  maintenance_work_order: "calibration",
  audit_plan: "audit",
  audit_checklist: "audit",
  lpa: "audit",
  complaint: "complaint",
  pcn: "change",
  change: "change",
  supplier: "suppliers",
  training: "training",
  apqp_summary: "ppap",
  control_plan: "ppap",
  dimensional_report: "ppap",
  process_flow_diagram: "ppap",
  appearance_approval: "ppap",
  dvpr: "ppap",
  final_inspection_release_checklist: "ppap",
};

export function pictureRecordForForm(formType: string, entityId: number): PictureRecord {
  return { entityType: FORM_ATTACHMENT_TYPE[formType] ?? formType, entityId };
}
