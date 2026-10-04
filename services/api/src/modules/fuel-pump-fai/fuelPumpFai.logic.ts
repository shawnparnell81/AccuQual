import { limitPassFail } from "../../utils/passFail.js";

/**
 * Fuel Pump Module first-article rules.
 * Limits are never invented here. A measured characteristic with no
 * acceptance limit from the drawing, specification, or inspection plan
 * is Engineering Review Required. That result is not a Pass.
 */

export const FPM_WORKFLOW_NAME = "Fuel Pump Module FAI";
export const FPM_PRODUCT_FAMILY = "Fuel Pump Module";
export const FPM_WORKFLOW_KEY = "fpm_fai";
export const FPM_NUMBER_PREFIX = "FPM-FAI";
/** A controlled version of this workflow is created as a draft. Shawn publishes it. */
export const FPM_CONTROLLED_VERSION_STATUS = "draft" as const;

export const FPM_NODE = {
  trigger: "t_submit",
  documentReview: "appr_doc",
  correct: "act_correct",
  reject: "act_reject",
  endRejected: "end_rejected",
  parallel: "par_test",
  visual: "act_visual",
  dimensional: "act_dimensional",
  electrical: "act_electrical",
  functional: "act_functional",
  fitment: "act_fitment",
  packaging: "act_packaging",
  calculate: "act_calculate",
  attemptGate: "cond_attempt",
  failures: "cond_failures",
  retestPassed: "cond_retest",
  engineeringGate: "cond_eng",
  engineering: "appr_eng",
  ncr: "act_ncr",
  corrective: "act_ca",
  retest: "appr_retest",
  openAttempt: "act_open_attempt",
  finalApproval: "appr_final",
  release: "act_release",
  archive: "act_archive",
  endApproved: "end_approved",
} as const;

export const FPM_BRANCHES = ["visual", "dimensional", "electrical", "functional", "fitment", "packaging"] as const;
export type FpmBranch = (typeof FPM_BRANCHES)[number];

export const FPM_RESULTS = ["Pass", "Fail", "Engineering Review Required"] as const;
export type FpmResult = (typeof FPM_RESULTS)[number];

export type FpmCriterionKind = "attribute" | "measurement";

export interface FpmCriterion {
  key: string;
  branch: FpmBranch;
  label: string;
  kind: FpmCriterionKind;
  /** Photos are required when this characteristic fails. */
  photosOnFail: boolean;
}

export interface FpmPhoto {
  fileName: string;
  caption?: string;
}

export interface FpmCriterionResult {
  key: string;
  branch: FpmBranch;
  label: string;
  result: FpmResult | "";
  actual: string | null;
  units: string | null;
  specifiedLimits: string | null;
  comments: string | null;
  photos: FpmPhoto[];
  critical: boolean;
}

export interface FpmTotals {
  criteria: number;
  passed: number;
  failed: number;
  engineeringReviewRequired: number;
}

export interface FpmAttempt {
  number: number;
  startedAt: string;
  branches: FpmBranch[];
  results: FpmCriterionResult[];
  totals: FpmTotals | null;
  overall: "Passed" | "Failed" | "Pending Engineering Review" | null;
}

export interface FpmCorrectiveAction {
  rootCause: string;
  correctiveAction: string;
  responsiblePerson: string;
  dueDate: string;
}

export type FpmSlaStatus = "On track" | "Reminder" | "Warning" | "Overdue" | "Escalated" | "Not started";

export interface FpmState {
  fuelPumpFaiId: number | null;
  number: string;
  partNumber: string;
  partDescription: string;
  supplier: string;
  supplierId: number | null;
  supplierPartNumber: string;
  sampleLotNumber: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleEngine: string;
  application: string;
  inspector: string;
  inspectorUserId: number | null;
  validationOwner: string;
  qualityManager: string;
  openedBy: number | null;
  siteId: number | null;
  signatureStamp: string | null;
  dateOpened: string;
  status: string;
  stage: string;
  productFamily: typeof FPM_PRODUCT_FAMILY;
  productionRelease: "Yes" | "No";
  ncrRequired: "Yes" | "No";
  failureDetected: "Yes" | "No";
  ncrId: number | null;
  ncrStatus: string | null;
  overallResult: FpmAttempt["overall"];
  flowRateResult: string | null;
  pressureResult: string | null;
  currentDrawResult: string | null;
  electricalResult: string | null;
  fitmentResult: string | null;
  packagingResult: string | null;
  locked: "Yes" | "No";
  attempt: FpmAttempt;
  history: FpmAttempt[];
  correctionReady: boolean;
  correctionComments: string | null;
  correctiveActionReady: boolean;
  correctiveAction: FpmCorrectiveAction | null;
  correctiveOwnerId: number | null;
  finalQualityApproval: boolean;
  engineeringAccepted: boolean;
  branchApplies: FpmBranch[] | null;
  openNewAttempt: boolean;
  limitOverrides: Record<string, { specifiedLimits: string; units: string | null }>;
  visualReady: boolean;
  dimensionalReady: boolean;
  electricalReady: boolean;
  functionalReady: boolean;
  fitmentReady: boolean;
  packagingReady: boolean;
  rejectionReason: string | null;
  rejectedBy: string | null;
  rejectionDate: string | null;
  approvedBy: number | null;
  approvalDate: string | null;
  dateClosed: string | null;
  outcomeLabel: string | null;
  outcomeDisplay: string | null;
  criticalNoticeSent: boolean;
  report: Record<string, unknown> | null;
  archive: Record<string, unknown> | null;
  slaStatus: FpmSlaStatus;
  slaNotices: string[];
  stepNodeId: string | null;
  stepEnteredAt: string | null;
}

export interface FpmRoute {
  decision: string;
  label: string;
  branch: string;
  revisit?: boolean;
  commentsRequired?: boolean;
}

const READY_FIELD: Record<FpmBranch, keyof FpmState> = {
  visual: "visualReady",
  dimensional: "dimensionalReady",
  electrical: "electricalReady",
  functional: "functionalReady",
  fitment: "fitmentReady",
  packaging: "packagingReady",
};

const text = (value: unknown): string | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

export function normalizeAssigneeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function userMatchesAssignees(userKeys: string[], assignees: { label?: string; roleName?: string }[]): boolean {
  const wanted = new Set<string>();
  for (const assignee of assignees) {
    if (assignee.roleName) wanted.add(normalizeAssigneeKey(assignee.roleName));
    if (assignee.label) wanted.add(normalizeAssigneeKey(assignee.label));
  }
  return userKeys.some((key) => wanted.has(normalizeAssigneeKey(key)));
}

function attribute(branch: FpmBranch, key: string, label: string, photosOnFail = false): FpmCriterion {
  return { key, branch, label, kind: "attribute", photosOnFail };
}

function measurement(branch: FpmBranch, key: string, label: string): FpmCriterion {
  return { key, branch, label, kind: "measurement", photosOnFail: false };
}

export const FPM_CRITERIA: FpmCriterion[] = [
  attribute("visual", "correct_label", "Correct Label", true),
  attribute("visual", "correct_connector", "Correct Connector", true),
  attribute("visual", "no_housing_damage", "No Housing Damage", true),
  attribute("visual", "no_cracks", "No Cracks", true),
  attribute("visual", "no_corrosion", "No Corrosion", true),
  attribute("visual", "no_missing_components", "No Missing Components", true),
  attribute("visual", "no_loose_components", "No Loose Components", true),
  attribute("visual", "no_terminal_damage", "No Damage To Terminals", true),
  attribute("visual", "no_fuel_connection_damage", "No Damage To Fuel Connections", true),
  measurement("dimensional", "overall_height", "Overall Height"),
  measurement("dimensional", "overall_diameter", "Overall Diameter"),
  measurement("dimensional", "mounting_dimensions", "Mounting Dimensions"),
  measurement("dimensional", "connector_location", "Connector Location"),
  measurement("dimensional", "outlet_location", "Outlet Location"),
  measurement("dimensional", "inlet_location", "Inlet Location"),
  measurement("electrical", "connector_continuity", "Connector Continuity"),
  measurement("electrical", "terminal_continuity", "Terminal Continuity"),
  measurement("electrical", "resistance_values", "Resistance Values"),
  measurement("electrical", "polarity", "Polarity"),
  measurement("electrical", "electrical_current_draw", "Current Draw"),
  attribute("functional", "prime_function", "Prime Function"),
  measurement("functional", "flow_rate", "Flow Rate"),
  measurement("functional", "pressure_output", "Pressure Output"),
  attribute("functional", "pressure_stability", "Pressure Stability"),
  measurement("functional", "noise_level", "Noise Level"),
  attribute("functional", "leak_check", "Leak Check"),
  attribute("functional", "low_voltage_operation", "Low Voltage Operation"),
  attribute("functional", "normal_voltage_operation", "Normal Voltage Operation"),
  measurement("functional", "current_draw", "Current Draw"),
  attribute("fitment", "fuel_tank_fitment", "Fuel Tank Fitment", true),
  attribute("fitment", "lock_ring_fitment", "Lock Ring Fitment", true),
  attribute("fitment", "seal_fitment", "Seal Fitment", true),
  attribute("fitment", "connector_fitment", "Connector Fitment", true),
  attribute("fitment", "fuel_line_fitment", "Fuel Line Connection Fitment", true),
  attribute("fitment", "vehicle_application_verification", "Vehicle Application Verification", true),
  attribute("packaging", "correct_carton", "Correct Carton", true),
  attribute("packaging", "packaging_label", "Correct Label", true),
  attribute("packaging", "correct_barcode", "Correct Barcode", true),
  attribute("packaging", "packaging_protection", "Packaging Protection", true),
  attribute("packaging", "included_components", "Included Components", true),
  attribute("packaging", "instructions_present", "Instructions Present", true),
];

export function criteriaForBranch(branch: FpmBranch): FpmCriterion[] {
  return FPM_CRITERIA.filter((row) => row.branch === branch);
}

export function isFpmBranch(value: string): value is FpmBranch {
  return (FPM_BRANCHES as readonly string[]).includes(value);
}

export function readyField(branch: FpmBranch): keyof FpmState {
  return READY_FIELD[branch];
}

function blankAttempt(number: number, startedAt: string, branches: FpmBranch[] = [...FPM_BRANCHES]): FpmAttempt {
  return { number, startedAt, branches, results: [], totals: null, overall: null };
}

export function emptyState(now: string): FpmState {
  return {
    fuelPumpFaiId: null,
    number: "",
    partNumber: "",
    partDescription: "",
    supplier: "",
    supplierId: null,
    supplierPartNumber: "",
    sampleLotNumber: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleEngine: "",
    application: "",
    inspector: "",
    inspectorUserId: null,
    validationOwner: "",
    qualityManager: "",
    openedBy: null,
    siteId: null,
    signatureStamp: null,
    dateOpened: now,
    status: "Submitted",
    stage: "Document Review",
    productFamily: FPM_PRODUCT_FAMILY,
    productionRelease: "No",
    ncrRequired: "No",
    failureDetected: "No",
    ncrId: null,
    ncrStatus: null,
    overallResult: null,
    flowRateResult: null,
    pressureResult: null,
    currentDrawResult: null,
    electricalResult: null,
    fitmentResult: null,
    packagingResult: null,
    locked: "No",
    attempt: blankAttempt(1, now),
    history: [],
    correctionReady: false,
    correctionComments: null,
    correctiveActionReady: false,
    correctiveAction: null,
    correctiveOwnerId: null,
    finalQualityApproval: false,
    engineeringAccepted: false,
    branchApplies: null,
    openNewAttempt: false,
    limitOverrides: {},
    visualReady: false,
    dimensionalReady: false,
    electricalReady: false,
    functionalReady: false,
    fitmentReady: false,
    packagingReady: false,
    rejectionReason: null,
    rejectedBy: null,
    rejectionDate: null,
    approvedBy: null,
    approvalDate: null,
    dateClosed: null,
    outcomeLabel: null,
    outcomeDisplay: null,
    criticalNoticeSent: false,
    report: null,
    archive: null,
    slaStatus: "Not started",
    slaNotices: [],
    stepNodeId: null,
    stepEnteredAt: null,
  };
}

const STATE_DEFAULTS = emptyState("1970-01-01T00:00:00.000Z");

export function readFpm(context: Record<string, unknown>): FpmState {
  const base = emptyState(typeof context.dateOpened === "string" ? context.dateOpened : new Date().toISOString());
  const next = { ...base };
  for (const key of Object.keys(STATE_DEFAULTS) as (keyof FpmState)[]) {
    if (context[key] !== undefined) (next as Record<string, unknown>)[key] = context[key];
  }
  if (!next.attempt || typeof next.attempt !== "object") next.attempt = base.attempt;
  if (!Array.isArray(next.history)) next.history = [];
  if (!next.limitOverrides || typeof next.limitOverrides !== "object") next.limitOverrides = {};
  if (!Array.isArray(next.slaNotices)) next.slaNotices = [];
  return next;
}

export function writeFpm(context: Record<string, unknown>, state: FpmState): void {
  Object.assign(context, state);
  context.overallResult = state.overallResult;
  context.failureDetected = state.failureDetected;
  context.branchApplies = state.branchApplies;
  context.ncrRequired = state.ncrRequired;
  context.productionRelease = state.productionRelease;
}

export function submissionErrors(input: Record<string, unknown>): string[] {
  const application = text(input.application) ?? text(input.vehicleApplication);
  const required: [unknown, string][] = [
    [input.partNumber, "Part Number"],
    [input.supplier ?? input.supplierName, "Supplier"],
    [input.sampleLotNumber, "Sample Lot Number"],
    [application, "Vehicle Application"],
    [input.inspector ?? input.inspectorName, "Inspector"],
  ];
  const errors: string[] = [];
  for (const [value, label] of required) if (!text(value)) errors.push(`${label} is required.`);
  if (input.dateOpened != null && input.dateOpened !== "" && Number.isNaN(Date.parse(String(input.dateOpened)))) errors.push("Date Opened is not a date.");
  return errors;
}

export function vehicleApplication(state: Pick<FpmState, "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleEngine" | "application">): string {
  return state.application || [state.vehicleYear, state.vehicleMake, state.vehicleModel, state.vehicleEngine].filter(Boolean).join(" ");
}

function asResult(value: unknown): FpmResult | "" {
  const word = text(value);
  if (!word) return "";
  return (FPM_RESULTS as readonly string[]).includes(word) ? (word as FpmResult) : "";
}

function photosOf(value: unknown): FpmPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const fileName = text((row as { fileName?: unknown }).fileName);
      if (!fileName) return null;
      const caption = text((row as { caption?: unknown }).caption);
      return caption ? { fileName, caption } : { fileName };
    })
    .filter((row): row is FpmPhoto => row != null);
}

export function judgeCriterion(
  criterion: FpmCriterion,
  entry: Partial<FpmCriterionResult>,
  limitsFromPlan: string | null,
): { result: FpmResult | ""; error: string | null } {
  const stated = asResult(entry.result);
  const actual = text(entry.actual);
  const units = text(entry.units);
  const limits = text(entry.specifiedLimits) ?? limitsFromPlan;
  const comments = text(entry.comments);
  const photos = entry.photos ?? [];

  if (criterion.kind === "measurement") {
    if (!actual) return { result: "", error: `${criterion.label} needs the actual measurement.` };
    if (!units) return { result: "", error: `${criterion.label} needs units.` };
    if (!limits) return { result: "Engineering Review Required", error: null };
    const judged = limitPassFail(limits, actual);
    if (!judged) return { result: "", error: `${criterion.label} needs a readable numeric limit or band.` };
    if (judged === "Fail" && !comments) return { result: "", error: `${criterion.label} needs inspector comments for a failure.` };
    return { result: judged, error: null };
  }

  if (stated !== "Pass" && stated !== "Fail") return { result: "", error: `${criterion.label} needs Pass or Fail.` };
  if (stated === "Fail") {
    if (!comments) return { result: "", error: `${criterion.label} needs inspector comments for a failure.` };
    if (criterion.photosOnFail && photos.length === 0) return { result: "", error: `${criterion.label} needs a photo for a failure.` };
  }
  return { result: stated, error: null };
}

function outcomeOf(rows: FpmCriterionResult[]): string | null {
  if (rows.length === 0) return null;
  if (rows.some((row) => row.result === "Fail")) return "Fail";
  if (rows.some((row) => row.result === "Engineering Review Required")) return "Engineering Review Required";
  if (rows.every((row) => row.result === "Pass")) return "Pass";
  return null;
}

export function withRecordedResults(state: FpmState): FpmState {
  const results = state.attempt.results;
  const one = (key: string) => {
    const result = results.find((row) => row.key === key)?.result;
    return result ? result : null;
  };
  return {
    ...state,
    flowRateResult: one("flow_rate"),
    pressureResult: one("pressure_output"),
    currentDrawResult: one("current_draw"),
    electricalResult: outcomeOf(results.filter((row) => row.branch === "electrical")),
    fitmentResult: outcomeOf(results.filter((row) => row.branch === "fitment")),
    packagingResult: outcomeOf(results.filter((row) => row.branch === "packaging")),
  };
}

export function applyBranchResults(state: FpmState, branch: FpmBranch, entries: Partial<FpmCriterionResult>[]): { state: FpmState; errors: string[] } {
  if (state.locked === "Yes") return { state, errors: ["This fuel pump FAI is locked."] };
  const errors: string[] = [];
  const judged: FpmCriterionResult[] = [];
  for (const criterion of criteriaForBranch(branch)) {
    const entry = entries.find((row) => row.key === criterion.key) ?? {};
    const override = text(state.limitOverrides[criterion.key]?.specifiedLimits);
    const outcome = judgeCriterion(criterion, { ...entry, photos: photosOf(entry.photos) }, override);
    if (outcome.error || !outcome.result) {
      errors.push(outcome.error ?? `${criterion.label} is incomplete.`);
      continue;
    }
    const storedOverride = state.limitOverrides[criterion.key];
    judged.push({
      key: criterion.key,
      branch,
      label: criterion.label,
      result: outcome.result,
      actual: text(entry.actual),
      units: text(entry.units) ?? storedOverride?.units ?? null,
      specifiedLimits: text(entry.specifiedLimits) ?? text(storedOverride?.specifiedLimits),
      comments: text(entry.comments),
      photos: photosOf(entry.photos),
      critical: outcome.result === "Fail" && entry.critical === true,
    });
  }
  if (errors.length > 0) return { state, errors };
  const kept = state.attempt.results.filter((row) => row.branch !== branch);
  return { state: withRecordedResults({ ...state, attempt: { ...state.attempt, results: [...kept, ...judged] } }), errors: [] };
}

export function branchLabel(branch: FpmBranch): string {
  if (branch === "visual") return "Visual Inspection";
  if (branch === "dimensional") return "Dimensional Inspection";
  if (branch === "electrical") return "Electrical Testing";
  if (branch === "functional") return "Fuel Pump Functional Testing";
  if (branch === "fitment") return "Fitment Verification";
  return "Packaging Verification";
}

export function branchComplete(state: FpmState, branch: FpmBranch): string | null {
  const keys = new Set(state.attempt.results.filter((row) => row.branch === branch && row.result).map((row) => row.key));
  const missing = criteriaForBranch(branch).filter((row) => !keys.has(row.key));
  if (missing.length > 0) return `${branchLabel(branch)} is incomplete.`;
  return null;
}

export function activeBranches(state: FpmState): FpmBranch[] {
  return state.branchApplies && state.branchApplies.length > 0 ? state.branchApplies : [...FPM_BRANCHES];
}

export function hasCriticalFailure(state: FpmState): boolean {
  return state.attempt.results.some((row) => row.result === "Fail" && row.critical);
}

export function calculateInspection(state: FpmState): FpmState {
  const branches = state.attempt.branches.length > 0 ? state.attempt.branches : activeBranches(state);
  const inScope = state.attempt.results.filter((row) => branches.includes(row.branch));
  const expected = FPM_CRITERIA.filter((row) => branches.includes(row.branch));
  if (inScope.length < expected.length) throw new Error("Inspection criteria are missing.");
  const totals: FpmTotals = {
    criteria: inScope.length,
    passed: inScope.filter((row) => row.result === "Pass").length,
    failed: inScope.filter((row) => row.result === "Fail").length,
    engineeringReviewRequired: inScope.filter((row) => row.result === "Engineering Review Required").length,
  };
  let overall: FpmAttempt["overall"];
  let failureDetected: FpmState["failureDetected"] = "No";
  let status = state.status;
  let stage = state.stage;
  if (totals.failed > 0) {
    overall = "Failed";
    failureDetected = "Yes";
    stage = "NCR and Corrective Action";
  } else if (totals.engineeringReviewRequired > 0) {
    overall = "Pending Engineering Review";
    status = "Pending Engineering Review";
    stage = "Engineering Review";
  } else {
    overall = "Passed";
    stage = "Final Quality Approval";
  }
  return withRecordedResults({
    ...state,
    attempt: { ...state.attempt, totals, overall, branches },
    overallResult: overall,
    failureDetected,
    status,
    stage,
    finalQualityApproval: false,
  });
}

export function releaseBlockers(state: FpmState, options: { finalApprovalRecorded?: boolean; engineeringCleared?: boolean } = {}): string[] {
  const blockers: string[] = [];
  const results = state.attempt.results;
  const branches = state.attempt.branches.length > 0 ? state.attempt.branches : activeBranches(state);
  const expected = FPM_CRITERIA.filter((row) => branches.includes(row.branch));
  if (results.filter((row) => branches.includes(row.branch) && row.result).length < expected.length) blockers.push("Inspection criteria are missing.");
  if (results.some((row) => row.result === "Fail")) blockers.push("Unresolved failed criteria.");
  if (results.some((row) => row.result === "Fail" && row.critical)) blockers.push("A critical failure is unresolved.");
  if (results.some((row) => row.result === "Engineering Review Required") && !options.engineeringCleared && !state.engineeringAccepted) {
    blockers.push("A missing limit is not a Pass. Engineering review is still required.");
  }
  if (!options.finalApprovalRecorded && !state.finalQualityApproval) blockers.push("Final quality approval is required.");
  if (state.ncrRequired === "Yes" && state.ncrStatus !== "closed") blockers.push("The linked NCR is not done.");
  if (state.history.some((attempt) => attempt.overall === "Failed") && state.attempt.overall !== "Passed") blockers.push("The retest has not passed.");
  return blockers;
}

export function assertCanRelease(state: FpmState, options?: { finalApprovalRecorded?: boolean; engineeringCleared?: boolean }): void {
  const blockers = releaseBlockers(state, options);
  if (blockers.length > 0) throw new Error(`Production release is not allowed. ${blockers.join(" ")}`);
}

export function rejectFai(state: FpmState, now: string): FpmState {
  if (!text(state.rejectionReason) || !text(state.rejectedBy) || !text(state.rejectionDate)) {
    throw new Error("Rejection reason, rejected by, and rejection date are required.");
  }
  return {
    ...state,
    status: "Rejected",
    stage: "Rejected",
    productionRelease: "No",
    outcomeLabel: "Fuel Pump FAI Rejected",
    outcomeDisplay: "The fuel pump is not approved for production.",
    rejectionDate: state.rejectionDate ?? now,
  };
}

export function beginAttempt(state: FpmState, now: string): FpmState {
  if (!state.openNewAttempt) return state;
  const nextBranches = activeBranches(state);
  const carried = state.attempt.results.filter((row) => !nextBranches.includes(row.branch));
  const history = [...state.history, { ...state.attempt, results: state.attempt.results.map((row) => ({ ...row, photos: [...row.photos] })) }];
  return {
    ...state,
    openNewAttempt: false,
    engineeringAccepted: false,
    finalQualityApproval: false,
    overallResult: null,
    visualReady: false,
    dimensionalReady: false,
    electricalReady: false,
    functionalReady: false,
    fitmentReady: false,
    packagingReady: false,
    history,
    attempt: {
      number: state.attempt.number + 1,
      startedAt: now,
      branches: [...FPM_BRANCHES],
      results: carried.map((row) => ({ ...row, photos: [...row.photos] })),
      totals: null,
      overall: null,
    },
  };
}

export function buildReport(state: FpmState): Record<string, unknown> {
  return {
    name: FPM_WORKFLOW_NAME,
    faiNumber: state.number,
    productFamily: state.productFamily,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplier: state.supplier,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicleYear: state.vehicleYear,
    vehicleMake: state.vehicleMake,
    vehicleModel: state.vehicleModel,
    vehicleEngine: state.vehicleEngine,
    application: state.application,
    inspector: state.inspector,
    validationOwner: state.validationOwner,
    qualityManager: state.qualityManager,
    dateOpened: state.dateOpened,
    status: state.status,
    workflowStage: state.stage,
    productionRelease: state.productionRelease,
    overallResult: state.overallResult,
    flowRateResult: state.flowRateResult,
    pressureResult: state.pressureResult,
    currentDrawResult: state.currentDrawResult,
    electricalResult: state.electricalResult,
    fitmentResult: state.fitmentResult,
    packagingResult: state.packagingResult,
    failureDetected: state.failureDetected,
    ncrRequired: state.ncrRequired,
    linkedNcr: state.ncrId,
    slaStatus: state.slaStatus,
    totals: state.attempt.totals,
    attempts: [...state.history, state.attempt],
    correctiveAction: state.correctiveAction,
    approvalDate: state.approvalDate,
    approvedBy: state.approvedBy,
  };
}

export function archiveState(state: FpmState, now: string): FpmState {
  const report = state.report ?? buildReport(state);
  return {
    ...state,
    status: "Closed",
    stage: "Closed",
    dateClosed: now,
    locked: "Yes",
    report,
    archive: {
      report,
      inspectionResults: state.attempt.results,
      flowData: state.attempt.results.filter((row) => row.key === "flow_rate"),
      pressureData: state.attempt.results.filter((row) => row.key === "pressure_output"),
      photos: [...state.history, state.attempt].flatMap((attempt) => attempt.results.flatMap((row) => row.photos)),
      approvals: { finalQualityApproval: state.finalQualityApproval, approvalDate: state.approvalDate, approvedBy: state.approvedBy },
      ncrHistory: { linkedNcr: state.ncrId, ncrRequired: state.ncrRequired, ncrStatus: state.ncrStatus, correctiveAction: state.correctiveAction },
      retestHistory: state.history,
      archivedAt: now,
    },
    outcomeLabel: "Fuel Pump FAI Approved",
    outcomeDisplay: "The fuel pump is approved for production.",
  };
}

export function ncrDescription(state: FpmState): string {
  const failed = state.attempt.results.filter((row) => row.result === "Fail" || row.result === "Engineering Review Required");
  const lines = failed.map((row) => {
    const bits = [row.label, row.result];
    if (row.critical) bits.push("critical failure");
    if (row.actual) bits.push(`actual ${row.actual}${row.units ? ` ${row.units}` : ""}`);
    if (row.specifiedLimits) bits.push(`limits ${row.specifiedLimits}`);
    if (row.comments) bits.push(row.comments);
    if (row.photos.length > 0) bits.push(`photos ${row.photos.map((photo) => photo.fileName).join(", ")}`);
    return bits.join(" — ");
  });
  return [
    `FAI Number: ${state.number}`,
    `Part: ${state.partNumber}`,
    `Description: ${state.partDescription}`,
    `Supplier: ${state.supplier}`,
    `Supplier part number: ${state.supplierPartNumber}`,
    `Lot: ${state.sampleLotNumber}`,
    `Vehicle application: ${vehicleApplication(state)}`,
    `Failed tests:`,
    ...(lines.length > 0 ? lines : [state.rejectionReason ?? "Rejected from final quality approval."]),
  ].join("\n");
}

const HEADER_KEYS = ["partNumber", "partDescription", "supplier", "supplierPartNumber", "sampleLotNumber", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleEngine", "application", "inspector", "validationOwner", "qualityManager"] as const;

export function prepareFpmDecision(
  pending: { nodeId?: string; branch?: string; pauseUntil?: string; routes?: FpmRoute[]; workflowKey?: string },
  decision: string,
  notes: string | undefined,
  details: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (pending.workflowKey !== FPM_WORKFLOW_KEY) return {};
  const state = readFpm(context);
  if (state.locked === "Yes") throw new Error("This fuel pump FAI is locked.");
  const route = (pending.routes ?? []).find((item) => item.decision === decision);
  if (!route && decision !== "approved" && decision !== "rejected") throw new Error("That decision is not on this step.");
  if (route?.commentsRequired && !text(notes)) throw new Error("Comments are required for this decision.");

  const patch: Partial<FpmState> = {};
  const nodeId = pending.nodeId;

  if (nodeId === FPM_NODE.documentReview && decision === "rejected") {
    patch.rejectionReason = text(details?.rejectionReason) ?? text(notes);
    patch.rejectedBy = text(details?.rejectedBy);
    patch.rejectionDate = text(details?.rejectionDate);
    if (!patch.rejectionReason || !patch.rejectedBy || !patch.rejectionDate) throw new Error("Rejection reason, rejected by, and rejection date are required.");
  }

  if (nodeId === FPM_NODE.documentReview && decision === "return") {
    patch.correctionReady = false;
    patch.stage = "Correct FAI Information";
    patch.correctionComments = text(notes);
  }

  if (nodeId === FPM_NODE.correct && decision === "approved") {
    const comments = text(details?.correctionComments) ?? text(notes);
    const changes = details?.changes;
    const changed = changes && typeof changes === "object" && !Array.isArray(changes) && Object.values(changes as Record<string, unknown>).some((value) => text(value));
    if (!comments) throw new Error("Correction comments are required.");
    if (!changed) throw new Error("The information that was sent back has to be corrected.");
    const header = changes as Record<string, unknown>;
    patch.correctionReady = true;
    patch.correctionComments = comments;
    for (const key of HEADER_KEYS) {
      const value = text(header[key]);
      if (value) (patch as Record<string, unknown>)[key] = value;
    }
    patch.stage = "Document Review";
  }

  if (pending.branch && isFpmBranch(pending.branch) && decision === "approved") {
    const problem = branchComplete(state, pending.branch);
    if (problem) throw new Error(problem);
    (patch as Record<string, unknown>)[readyField(pending.branch)] = true;
    patch.stage = "Fuel Pump Validation Testing";
  }

  if (nodeId === FPM_NODE.engineering) {
    if (!text(notes)) throw new Error("Engineering comments are required.");
    if (decision === "approved") patch.engineeringAccepted = true;
    if (decision === "retest") {
      const limits = Array.isArray(details?.limits) ? details.limits : [];
      const overrides = { ...state.limitOverrides };
      for (const row of limits) {
        if (!row || typeof row !== "object") continue;
        const key = text((row as { key?: unknown }).key);
        const specifiedLimits = text((row as { specifiedLimits?: unknown }).specifiedLimits);
        if (!key || !specifiedLimits) continue;
        overrides[key] = { specifiedLimits, units: text((row as { units?: unknown }).units) };
      }
      const requested = Array.isArray(details?.branches) ? details.branches.filter((item): item is FpmBranch => typeof item === "string" && isFpmBranch(item)) : [];
      const fromResults = state.attempt.results.filter((row) => row.result === "Engineering Review Required").map((row) => row.branch);
      patch.limitOverrides = overrides;
      patch.branchApplies = requested.length > 0 ? [...new Set(requested)] : [...new Set(fromResults)];
      patch.openNewAttempt = true;
      patch.engineeringAccepted = false;
    }
    if (decision === "rejected") patch.engineeringAccepted = false;
  }

  if (nodeId === FPM_NODE.corrective && decision === "approved") {
    const action = readCorrective(details);
    if (!action) throw new Error("Root cause, corrective action, responsible person, and due date are required.");
    patch.correctiveAction = action;
    patch.correctiveActionReady = true;
    patch.stage = "Retest Approval";
  }

  if (nodeId === FPM_NODE.retest && decision === "return") {
    patch.correctiveActionReady = false;
    patch.stage = "Corrective Action";
  }
  if (nodeId === FPM_NODE.retest && decision === "approved") {
    if (!state.correctiveAction) throw new Error("Corrective action is required before a retest.");
    patch.openNewAttempt = true;
    patch.branchApplies = [...FPM_BRANCHES];
    patch.stage = "Fuel Pump Validation Testing";
  }
  if (nodeId === FPM_NODE.retest && decision === "rejected") {
    patch.rejectionReason = text(notes) ?? text(details?.rejectionReason);
    patch.rejectedBy = text(details?.rejectedBy);
    patch.rejectionDate = text(details?.rejectionDate) ?? new Date().toISOString();
    if (!patch.rejectionReason || !patch.rejectedBy || !patch.rejectionDate) throw new Error("Rejection reason, rejected by, and rejection date are required.");
    patch.productionRelease = "No";
  }

  if (nodeId === FPM_NODE.finalApproval && decision === "approved") {
    const next = { ...state, ...patch };
    const blockers = releaseBlockers(next, { finalApprovalRecorded: true, engineeringCleared: next.engineeringAccepted });
    if (blockers.length > 0) throw new Error(`Production release is not allowed. ${blockers.join(" ")}`);
    patch.finalQualityApproval = true;
    patch.stage = "Production Release";
  }
  if (nodeId === FPM_NODE.finalApproval && decision === "rejected") {
    patch.finalQualityApproval = false;
    patch.failureDetected = "Yes";
    patch.rejectionReason = text(notes) ?? text(details?.rejectionReason) ?? state.rejectionReason;
  }

  return patch as Record<string, unknown>;
}

function readCorrective(details: Record<string, unknown> | undefined): FpmCorrectiveAction | null {
  if (!details) return null;
  const source = (details.correctiveAction && typeof details.correctiveAction === "object" ? details.correctiveAction : details) as Record<string, unknown>;
  const rootCause = text(source.rootCause) ?? text(source.failureCause);
  const correctiveAction = text(source.correctiveAction);
  const responsiblePerson = text(source.responsiblePerson) ?? text(source.owner);
  const dueDate = text(source.dueDate);
  if (!rootCause || !correctiveAction || !responsiblePerson || !dueDate) return null;
  return { rootCause, correctiveAction, responsiblePerson, dueDate };
}

export function passingEntry(criterion: FpmCriterion): Partial<FpmCriterionResult> {
  if (criterion.kind === "measurement") {
    return { key: criterion.key, result: "Pass", actual: "1", units: "mm", specifiedLimits: "0.5-1.5" };
  }
  return { key: criterion.key, result: "Pass" };
}

export function seedResults(state: FpmState, mutate?: (criterion: FpmCriterion, entry: Partial<FpmCriterionResult>) => Partial<FpmCriterionResult>): FpmState {
  let next = state;
  for (const branch of FPM_BRANCHES) {
    const entries = criteriaForBranch(branch).map((criterion) => {
      const base = passingEntry(criterion);
      return mutate ? mutate(criterion, base) : base;
    });
    const applied = applyBranchResults(next, branch, entries);
    if (applied.errors.length > 0) throw new Error(applied.errors.join(" "));
    next = applied.state;
  }
  return next;
}

/** Weekdays only. No holiday calendar is stored in AccuQual. */
export function addBusinessDays(startIso: string, days: number): string {
  const start = new Date(Date.parse(startIso));
  if (Number.isNaN(start.getTime())) throw new Error("SLA start is not a date.");
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  let left = days;
  while (left > 0) {
    cursor += 86_400_000;
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

export function addCalendarDays(startIso: string, days: number): string {
  const start = new Date(Date.parse(startIso));
  if (Number.isNaN(start.getTime())) throw new Error("SLA start is not a date.");
  const cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) + days * 86_400_000;
  return new Date(cursor).toISOString().slice(0, 10);
}

export function businessDaysAfter(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const end = Date.parse(`${today.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(end) || end <= due) return 0;
  let count = 0;
  for (let cursor = due + 86_400_000; cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function businessDaysBetween(startIso: string, todayIso: string): number {
  const start = new Date(Date.parse(startIso));
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const end = Date.parse(`${todayIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(startDay) || Number.isNaN(end) || end <= startDay) return 0;
  let count = 0;
  for (let cursor = startDay + 86_400_000; cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function calendarDaysBetween(startIso: string, todayIso: string): number {
  const start = new Date(Date.parse(startIso));
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const end = Date.parse(`${todayIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(startDay) || Number.isNaN(end) || end <= startDay) return 0;
  return Math.round((end - startDay) / 86_400_000);
}

export function calendarDaysAfter(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const end = Date.parse(`${today.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(end) || end <= due) return 0;
  return Math.round((end - due) / 86_400_000);
}

export interface SlaEvaluation {
  status: FpmSlaStatus;
  dueOn: string | null;
  overdueDays: number;
  notifyOwner: boolean;
  notifyQualityManager: boolean;
  notifyOperationsManager: boolean;
}

const QUIET: SlaEvaluation = { status: "Not started", dueOn: null, overdueDays: 0, notifyOwner: false, notifyQualityManager: false, notifyOperationsManager: false };

function slaFromRatio(elapsed: number, window: number, dueOn: string, overdueDays: number): SlaEvaluation {
  if (overdueDays > 3) return { status: "Escalated", dueOn, overdueDays, notifyOwner: false, notifyQualityManager: true, notifyOperationsManager: true };
  if (overdueDays > 0) return { status: "Overdue", dueOn, overdueDays, notifyOwner: true, notifyQualityManager: true, notifyOperationsManager: false };
  if (window > 0 && elapsed / window >= 0.9) return { status: "Warning", dueOn, overdueDays: 0, notifyOwner: true, notifyQualityManager: true, notifyOperationsManager: false };
  if (window > 0 && elapsed / window >= 0.75) return { status: "Reminder", dueOn, overdueDays: 0, notifyOwner: true, notifyQualityManager: false, notifyOperationsManager: false };
  return { status: "On track", dueOn, overdueDays: 0, notifyOwner: false, notifyQualityManager: false, notifyOperationsManager: false };
}

export function evaluateSla(input: { startedAt: string | null; now: string; businessDays?: number }): SlaEvaluation {
  if (!input.startedAt || input.businessDays == null) return QUIET;
  const dueOn = addBusinessDays(input.startedAt, input.businessDays);
  const overdueDays = businessDaysAfter(dueOn, input.now.slice(0, 10));
  const elapsed = businessDaysBetween(input.startedAt, input.now);
  return slaFromRatio(elapsed, input.businessDays, dueOn, overdueDays);
}

export function evaluateOverallSla(dateOpened: string, now: string): SlaEvaluation {
  const dueOn = addCalendarDays(dateOpened, 30);
  const overdueDays = calendarDaysAfter(dueOn, now.slice(0, 10));
  const elapsed = calendarDaysBetween(dateOpened, now);
  return slaFromRatio(elapsed, 30, dueOn, overdueDays);
}

const SLA_RANK: Record<FpmSlaStatus, number> = { "Not started": 0, "On track": 1, Reminder: 2, Warning: 3, Overdue: 4, Escalated: 5 };

export function worseSla(left: SlaEvaluation, right: SlaEvaluation): SlaEvaluation {
  return SLA_RANK[right.status] > SLA_RANK[left.status] ? right : left;
}

export const FPM_SLA_RULES: { nodeId: string; label: string; businessDays?: number; calendarDays?: number }[] = [
  { nodeId: FPM_NODE.documentReview, label: "Document Review", businessDays: 2 },
  { nodeId: FPM_NODE.parallel, label: "Fuel Pump Testing", businessDays: 5 },
  { nodeId: FPM_NODE.corrective, label: "Corrective Actions", businessDays: 10 },
  { nodeId: FPM_NODE.retest, label: "Retest", businessDays: 3 },
  { nodeId: FPM_NODE.finalApproval, label: "Final Approval", businessDays: 2 },
];

const TESTING_CLOCK = new Set<string>([FPM_NODE.parallel, FPM_NODE.visual, FPM_NODE.dimensional, FPM_NODE.electrical, FPM_NODE.functional, FPM_NODE.fitment, FPM_NODE.packaging]);

export function clockNode(nodeId: string | null): string | null {
  if (!nodeId) return null;
  return TESTING_CLOCK.has(nodeId) ? FPM_NODE.parallel : nodeId;
}

export function stampStep(state: FpmState, nodeId: string | null, now: string): FpmState {
  const clock = clockNode(nodeId);
  if (!clock || state.stepNodeId === clock) return state;
  return { ...state, stepNodeId: clock, stepEnteredAt: now };
}

export function noteSla(state: FpmState, nodeId: string, evaluation: SlaEvaluation): { state: FpmState; send: boolean } {
  const next = { ...state, slaStatus: evaluation.status };
  if (evaluation.status === "On track" || evaluation.status === "Not started") return { state: next, send: false };
  const key = `${nodeId}:${evaluation.status}`;
  if (state.slaNotices.includes(key)) return { state: next, send: false };
  return { state: { ...next, slaNotices: [...state.slaNotices, key] }, send: true };
}

export function slaForNode(state: FpmState, nodeId: string, now: string): SlaEvaluation {
  const rule = FPM_SLA_RULES.find((item) => item.nodeId === nodeId);
  if (!rule?.businessDays) return QUIET;
  return evaluateSla({ startedAt: state.stepNodeId === nodeId ? state.stepEnteredAt : null, now, businessDays: rule.businessDays });
}
