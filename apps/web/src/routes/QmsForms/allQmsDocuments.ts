import { QMS_FORM_DEFINITIONS } from "./qmsFormDefinitions";

export interface QmsDocumentEntry {
  title: string;
  department: string;
  route: string;
  /** True when this document opens on the generic QMS Forms engine; false when it's a real, already-built module (DCR/NCR/CAPA/Risk/Audits/Calibration/Training/Complaints/Change/Work Orders) — see qmsFormDefinitions.ts's own comment on why those 15 aren't on the generic engine. */
  isGeneric: boolean;
}

/**
 * The full "ACCUQUAL Forms" batch — all 37 real source documents
 * (33.docx + 4.pdf + one.docx added after the original count), minus the
 * one literal duplicate title ("Automotive Manufacturing Work Order"
 * appears twice, as both a.docx and a.pdf) — 37 unique titles total, per
 * the catalog count. 22 share one generic shape and live on the
 * QMS Forms engine (QMS_FORM_DEFINITIONS); the other 15 duplicate an
 * already-real, better module and were deliberately routed there instead of
 * being rebuilt — see qmsFormDefinitions.ts's own comment for exactly why.
 */
const REUSED_MODULE_DOCUMENTS: QmsDocumentEntry[] = [
  { title: "Document Change Request", department: "Quality", route: "/document-change-requests", isGeneric: false },
  { title: "Risk & Opportunity Assessment", department: "Quality", route: "/risk", isGeneric: false },
  { title: "Internal Audit Plan", department: "Quality", route: "/audits", isGeneric: false },
  { title: "Internal Audit Report", department: "Quality", route: "/audits", isGeneric: false },
  { title: "Nonconformance Report", department: "Quality", route: "/ncr", isGeneric: false },
  { title: "Corrective Action Request", department: "Quality", route: "/capa", isGeneric: false },
  { title: "Calibration Equipment Register", department: "Quality", route: "/calibration", isGeneric: false },
  { title: "Calibration Record", department: "Quality", route: "/calibration", isGeneric: false },
  { title: "Training & Competency Record", department: "Quality", route: "/training", isGeneric: false },
  { title: "Customer Complaint Record", department: "Quality", route: "/complaints", isGeneric: false },
  { title: "Supplier NCR", department: "Quality", route: "/ncr", isGeneric: false },
  { title: "Engineering Change Request", department: "Engineering", route: "/change", isGeneric: false },
  { title: "Engineering Change Order", department: "Engineering", route: "/change", isGeneric: false },
];

const HIDDEN_FORM_DEPARTMENTS = new Set(["Purchasing", "Sales and Marketing", "Customer Service", "Production", "Material Management"]);
const HIDDEN_FORM_TYPES = new Set(["po_quality_requirements", "customer_satisfaction_record", "product_traceability_record"]);

export const ALL_QMS_DOCUMENTS: QmsDocumentEntry[] = [
  ...QMS_FORM_DEFINITIONS.filter((def) => !HIDDEN_FORM_DEPARTMENTS.has(def.folderPath[0]) && !HIDDEN_FORM_TYPES.has(def.formType)).map((def) => ({ title: def.title, department: def.folderPath[0], route: `/qms-forms/${def.formType}`, isGeneric: true })),
  ...REUSED_MODULE_DOCUMENTS,
];
