/**
 * Official Blank 8D sheet. Labels match the owner's workbook, including spelling.
 * Older step text is copied into the matching box. Anything that does not fit
 * stays on the record and is shown as previous fields.
 */

export const BLANK_8D_TITLE = "8D Problem Solving";

export const BLANK_8D_LABELS = {
  whoImpacted: "Who is Impacted by the Problem?",
  dateOpen: "Date Open:",
  eightDNo: "8D No.:",
  customer: "Customer:",
  initialResponse: "Initial Response:",
  customerComplaintNo: "Customer Complaint No.:",
  address: "Address:",
  targetCloseDate: "Target Close Date:",
  location: "Location:",
  revisionDates: "Revision Date(s):",
  partNo: "Part No./Code",
  initiator: "8D Initiator:",
  productName: "Product Name:",
  initiatorSupervisor: "8D Initiator's Spvr:",
  actualCloseDate: "Actual Close Date:",
  impactedInternal: "INTERNAL",
  impactedOr: "or",
  impactedExternal: "EXTERNAL",
  d1: "D1  Team Member Names/Titles:",
  champion: "Champion:",
  teamLeader: "Team Leader:",
  teamMembers: "Team Members:",
  d2: "D2  Problem Statement/Description (quantify) (one defect per 8D):",
  d3: "D3  Choose and Verify Interim Containment Action(s) (ICA):",
  percentEffective: "% Effective:",
  targetDate: "Target Date:",
  actualDate: "Actual Date:",
  d4: "D4 Define and Verify Root Cause(s)",
  percentContribution: "% Contribution:",
  d5: "D5  Choose and Verify Permenant Corrective Action(s) (PCA):",
  d6: "D6 Implement and Validate Permentant Corrective Action(s) (PCA):",
  d7: "D7  System Prevention Actions to Prevent Reoccurence:",
  mistakeProofing: "Mistake Proofing:  How are you going to ensure it can't happen again?",
  documentsReviewed: "Have Corrective Action/Implementation Been Reviewed Against Documents:?",
  checkBoxes: "Check boxes that apply:",
  controlPlan: "Control Plan",
  fmea: "FMEA",
  flowchart: "Flowchart",
  procWorkInstr: "Proc./Work Instr.",
  internalAudit: "Add to Internal Audit",
  d8: "D8  TEAM AND INDIVIDUAL RECOGNITION:  Recognize the collective efforts of the team.",
} as const;

export const BLANK_8D_STRING_KEYS = [
  "customer",
  "address",
  "location",
  "partNo",
  "productName",
  "dateOpen",
  "initialResponse",
  "targetCloseDate",
  "revisionDates",
  "actualCloseDate",
  "customerComplaintNo",
  "initiator",
  "initiatorSupervisor",
  "champion",
  "teamLeader",
  "teamMembers",
  "problemStatement",
  "ica",
  "icaPercentEffective",
  "icaTargetDate",
  "icaActualDate",
  "rootCauses",
  "rootCausePercentContribution",
  "pca",
  "pcaPercentEffective",
  "implementation",
  "implementationTargetDate",
  "implementationActualDate",
  "prevention",
  "preventionTargetDate",
  "preventionActualDate",
  "recognition",
] as const;

export const BLANK_8D_BOOL_KEYS = [
  "impactedInternal",
  "impactedExternal",
  "reviewedControlPlan",
  "reviewedFmea",
  "reviewedFlowchart",
  "reviewedProcWorkInstr",
  "reviewedInternalAudit",
] as const;

export type Blank8DStringKey = (typeof BLANK_8D_STRING_KEYS)[number];
export type Blank8DBoolKey = (typeof BLANK_8D_BOOL_KEYS)[number];

export type Blank8DValues = Record<Blank8DStringKey, string> & Record<Blank8DBoolKey, boolean>;

/** Older writeup key -> the Blank 8D box it matches. D1 does not match one box. */
export const LEGACY_STRING_MAP = {
  d2_problem: "problemStatement",
  d3_containment: "ica",
  d4_rootCause: "rootCauses",
  d5_correctiveAction: "pca",
  d6_implementation: "implementation",
  d7_prevention: "prevention",
  d8_closure: "recognition",
} as const;

const LEGACY_LABELS: Record<string, string> = {
  d1_team: "D1 — Establish the Team",
  d2_problem: "D2 — Describe the Problem",
  d3_containment: "D3 — Interim Containment Action",
  d4_rootCause: "D4 — Root Cause Analysis",
  d5_correctiveAction: "D5 — Permanent Corrective Action",
  d6_implementation: "D6 — Implement & Validate",
  d7_prevention: "D7 — Prevent Recurrence",
  d8_closure: "D8 — Congratulate the Team / Closure",
};

const STRING_KEY_SET = new Set<string>(BLANK_8D_STRING_KEYS);
const BOOL_KEY_SET = new Set<string>(BLANK_8D_BOOL_KEYS);

export function emptyBlank8D(): Blank8DValues {
  const values = {} as Blank8DValues;
  for (const key of BLANK_8D_STRING_KEYS) values[key] = "";
  for (const key of BLANK_8D_BOOL_KEYS) values[key] = false;
  return values;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function blank8dFromData(data: Record<string, unknown> | null | undefined): Blank8DValues {
  const source = data ?? {};
  const values = emptyBlank8D();
  for (const key of BLANK_8D_STRING_KEYS) values[key] = asText(source[key]);
  for (const key of BLANK_8D_BOOL_KEYS) values[key] = source[key] === true;
  for (const [legacy, official] of Object.entries(LEGACY_STRING_MAP) as [keyof typeof LEGACY_STRING_MAP, Blank8DStringKey][]) {
    if (!values[official].trim() && typeof source[legacy] === "string") values[official] = source[legacy];
  }
  return values;
}

export function formatStoredValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface PreviousField {
  label: string;
  value: string;
}

/** Stored values that do not appear in a Blank 8D box. */
export function previousFields(data: Record<string, unknown> | null | undefined): PreviousField[] {
  const source = data ?? {};
  const shown = blank8dFromData(source);
  const items: PreviousField[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (STRING_KEY_SET.has(key) || BOOL_KEY_SET.has(key) || key === "previousUnmapped") continue;
    if (value == null || value === "") continue;
    const official = LEGACY_STRING_MAP[key as keyof typeof LEGACY_STRING_MAP];
    if (official && typeof value === "string" && value === shown[official]) continue;
    const text = formatStoredValue(value).trim();
    if (!text) continue;
    items.push({ label: LEGACY_LABELS[key] ?? key, value: text });
  }
  const bag = source.previousUnmapped;
  if (bag && typeof bag === "object" && !Array.isArray(bag)) {
    for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
      const text = formatStoredValue(value).trim();
      if (!text) continue;
      items.push({ label: `${LEGACY_LABELS[key] ?? key} (earlier)`, value: text });
    }
  }
  return items;
}

/** Writes the sheet back onto the record without dropping keys the sheet does not edit. */
export function buildSaveData(existing: Record<string, unknown> | null | undefined, values: Blank8DValues): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const key of BLANK_8D_STRING_KEYS) next[key] = values[key];
  for (const key of BLANK_8D_BOOL_KEYS) next[key] = values[key];
  for (const [legacy, official] of Object.entries(LEGACY_STRING_MAP)) {
    const current = next[legacy];
    if (current === undefined || typeof current === "string") next[legacy] = values[official];
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Completing a discipline still stores that step's payload under the legacy
 * key. A previous plain-text D1 is kept, because it does not match Champion /
 * Team Leader / Team Members. A previous plain-text D2–D8 is copied into the
 * matching box first when that box is still empty.
 */
export function applyStepCompletion(data: Record<string, unknown> | null | undefined, stepKey: string, payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(data ?? {}) };
  const prior = next[stepKey];
  if (stepKey === "d1_team" && typeof prior === "string" && prior.trim() && JSON.stringify(prior) !== JSON.stringify(payload)) {
    const bag = isRecord(next.previousUnmapped) ? { ...next.previousUnmapped } : {};
    if (bag.d1_team === undefined) bag.d1_team = prior;
    next.previousUnmapped = bag;
  }
  const official = LEGACY_STRING_MAP[stepKey as keyof typeof LEGACY_STRING_MAP];
  if (official && !asText(next[official]).trim() && typeof prior === "string") next[official] = prior;

  for (const [key, value] of Object.entries(payload)) {
    if (STRING_KEY_SET.has(key) && typeof value === "string") next[key] = value;
    if (BOOL_KEY_SET.has(key) && typeof value === "boolean") next[key] = value;
  }
  next[stepKey] = payload;
  if (typeof next.recognition === "string" && (next.d8_closure === undefined || typeof next.d8_closure === "string")) {
    next.d8_closure = next.recognition;
  }
  return next;
}
