/**
 * Complete Strut Assembly first-article rules.
 * Limits are never invented here. A measured characteristic with no
 * acceptance limit from the drawing, specification, or inspection plan
 * is Engineering Review Required.
 */

export const CSA_WORKFLOW_NAME = "CSA First Article Inspection";
export const CSA_PRODUCT_FAMILY = "Complete Strut Assembly";
export const CSA_WORKFLOW_KEY = "csa_fai";
/** A controlled version of this workflow is created as a draft. Shawn publishes it. */
export const CSA_CONTROLLED_VERSION_STATUS = "draft" as const;

export const CSA_NODE = {
  trigger: "t_submit",
  documentReview: "appr_doc",
  correct: "act_correct",
  reject: "act_reject",
  endRejected: "end_rejected",
  parallel: "par_inspect",
  component: "appr_component",
  dimensional: "appr_dimensional",
  functional: "appr_functional",
  fitment: "appr_fitment",
  doneComponent: "done_component",
  doneDimensional: "done_dimensional",
  doneFunctional: "done_functional",
  doneFitment: "done_fitment",
  calculate: "act_calculate",
  passed: "cond_passed",
  engineeringGate: "cond_eng",
  engineering: "appr_eng",
  ncr: "act_ncr",
  corrective: "act_ca",
  retest: "appr_retest",
  openAttempt: "act_open_attempt",
  endRetestRejected: "end_retest_rejected",
  finalApproval: "appr_final",
  release: "act_release",
  archive: "act_archive",
  endApproved: "end_approved",
} as const;

export const CSA_BRANCHES = ["component", "dimensional", "functional", "fitment"] as const;
export type CsaBranch = (typeof CSA_BRANCHES)[number];

export const CSA_RESULTS = ["Pass", "Fail", "Not Applicable", "Engineering Review Required"] as const;
export type CsaResult = (typeof CSA_RESULTS)[number];

export type CsaCriterionKind = "attribute" | "measurement" | "evidence";

export interface CsaCriterion {
  key: string;
  branch: CsaBranch;
  label: string;
  kind: CsaCriterionKind;
  allowNa: boolean;
  /** Measured only when the record says this test applies. Otherwise Not Applicable. */
  when?: "damping" | "ride_height";
  /** A measurement only when an actual or a limit was supplied. Otherwise Pass/Fail stands on its own. */
  qualitativeUnlessMeasured?: boolean;
}

export interface CsaPhoto {
  fileName: string;
  caption?: string;
}

export interface CsaCriterionResult {
  key: string;
  branch: CsaBranch;
  label: string;
  result: CsaResult | "";
  actual: string | null;
  units: string | null;
  specifiedLimits: string | null;
  equipment: string | null;
  comments: string | null;
  photos: CsaPhoto[];
}

export interface CsaTotals {
  criteria: number;
  passed: number;
  failed: number;
  notApplicable: number;
  engineeringReviewRequired: number;
}

export interface CsaAttempt {
  number: number;
  startedAt: string;
  branches: CsaBranch[];
  results: CsaCriterionResult[];
  totals: CsaTotals | null;
  overall: "Passed" | "Failed" | "Pending Engineering Review" | null;
}

export interface CsaCorrectiveAction {
  failureCause: string;
  correctiveAction: string;
  owner: string;
  ownerId: number | null;
  dueDate: string;
  correctedSampleId: string;
  completionEvidence: string;
}

export interface CsaState {
  csaFaiId: number | null;
  number: string;
  partNumber: string;
  partDescription: string;
  supplierName: string;
  supplierId: number | null;
  supplierPartNumber: string;
  sampleLotNumber: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  position: string;
  inspectorName: string;
  inspectorUserId: number | null;
  openedBy: number | null;
  dateOpened: string;
  status: string;
  stage: string;
  productFamily: typeof CSA_PRODUCT_FAMILY;
  productionRelease: "Yes" | "No";
  approvedSupplier: "Yes" | "No";
  ncrRequired: "Yes" | "No";
  failureDetected: "Yes" | "No";
  ncrId: number | null;
  ncrStatus: string | null;
  locked: "Yes" | "No";
  attempt: CsaAttempt;
  history: CsaAttempt[];
  overallResult: CsaAttempt["overall"];
  correctionReady: boolean;
  correctionComments: string | null;
  correctiveActionReady: boolean;
  correctiveAction: CsaCorrectiveAction | null;
  correctiveOwnerId: number | null;
  finalQualityApproval: boolean;
  engineeringAccepted: boolean;
  branchApplies: CsaBranch[] | null;
  openNewAttempt: boolean;
  limitOverrides: Record<string, { specifiedLimits: string; units: string | null }>;
  dampingTestRequired: boolean;
  vehicleFitmentPerformed: boolean;
  rejectionReason: string | null;
  rejectedBy: string | null;
  rejectionDate: string | null;
  approvedBy: number | null;
  approvalDate: string | null;
  dateClosed: string | null;
  outcomeLabel: string | null;
  outcomeDisplay: string | null;
  engineeringNoticePending: boolean;
  report: Record<string, unknown> | null;
  archive: Record<string, unknown> | null;
  slaStatus: "On track" | "Reminder" | "SLA Overdue" | "SLA Escalated" | "Not started";
  slaNotices: string[];
  stepNodeId: string | null;
  stepEnteredAt: string | null;
  correctedSamplesAvailableAt: string | null;
}

export interface CsaFlags {
  dampingTestRequired: boolean;
  vehicleFitmentPerformed: boolean;
  limitOverrides: CsaState["limitOverrides"];
}

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

function attribute(branch: CsaBranch, key: string, label: string, allowNa = false): CsaCriterion {
  return { key, branch, label, kind: "attribute", allowNa };
}

function measurement(branch: CsaBranch, key: string, label: string, extra: Partial<CsaCriterion> = {}): CsaCriterion {
  return { key, branch, label, kind: "measurement", allowNa: false, ...extra };
}

export const CSA_CRITERIA: CsaCriterion[] = [
  attribute("component", "strut_cartridge", "Correct strut cartridge", true),
  attribute("component", "coil_spring", "Coil spring", true),
  attribute("component", "upper_mount", "Upper mount", true),
  attribute("component", "bearing", "Bearing", true),
  attribute("component", "spring_isolators", "Spring isolators", true),
  attribute("component", "dust_boot", "Dust boot", true),
  attribute("component", "bump_stop", "Bump stop", true),
  attribute("component", "spring_seat", "Spring seat", true),
  attribute("component", "mounting_hardware", "Mounting hardware", true),
  attribute("component", "left_or_right", "Left or right configuration", true),
  attribute("component", "brake_hose_bracket", "Brake hose bracket", true),
  attribute("component", "abs_sensor_bracket", "ABS or sensor-wire bracket", true),
  attribute("component", "spring_ends_seated", "Spring ends seated", true),
  attribute("component", "spring_clocking", "Spring clocking", true),
  attribute("component", "upper_mount_orientation", "Upper mount orientation", true),
  attribute("component", "bearing_movement", "Bearing movement", true),
  attribute("component", "fasteners_present", "Fasteners present", true),
  attribute("component", "no_oil_leakage", "No oil leakage", true),
  attribute("component", "no_rod_damage", "No rod damage", true),
  attribute("component", "no_spring_damage", "No spring damage", true),
  attribute("component", "no_unacceptable_welds", "No cracked or unacceptable welds", true),
  attribute("component", "coating_coverage", "Coating coverage", true),
  attribute("component", "label_correct", "Label correct and readable", true),
  attribute("component", "no_missing_loose_damaged", "No missing, loose, or damaged components", true),
  measurement("dimensional", "overall_extended_length", "Overall extended length"),
  measurement("dimensional", "mounting_hole_spacing", "Mounting-hole spacing"),
  measurement("dimensional", "lower_bracket_width", "Lower bracket width"),
  measurement("dimensional", "lower_bracket_thickness", "Lower bracket thickness"),
  measurement("dimensional", "upper_stud_spacing", "Upper stud spacing"),
  measurement("dimensional", "upper_stud_thread", "Upper stud thread size and pitch"),
  measurement("dimensional", "piston_rod_thread", "Piston-rod thread size and pitch"),
  measurement("dimensional", "spring_outside_diameter", "Spring outside diameter"),
  measurement("dimensional", "spring_wire_diameter", "Spring wire diameter"),
  measurement("dimensional", "spring_installed_position", "Spring installed position"),
  measurement("dimensional", "spring_seat_orientation", "Spring-seat orientation"),
  measurement("dimensional", "bracket_angle", "Bracket angle and orientation"),
  measurement("dimensional", "brake_hose_bracket_location", "Brake hose bracket location"),
  measurement("dimensional", "abs_sensor_bracket_location", "ABS or sensor-wire bracket location"),
  measurement("dimensional", "critical_mounting_dimensions", "Critical mounting dimensions"),
  attribute("functional", "compression_extension_smooth", "Compression and extension smooth"),
  attribute("functional", "no_binding", "No binding"),
  attribute("functional", "no_abnormal_internal_noise", "No abnormal internal noise"),
  attribute("functional", "no_excessive_free_play", "No excessive free play"),
  attribute("functional", "upper_bearing_operates", "Upper bearing or mount operates"),
  attribute("functional", "no_component_interference", "No component interference"),
  attribute("functional", "no_visible_leakage", "No visible leakage"),
  measurement("functional", "rebound_compression", "Rebound and compression acceptable", { qualitativeUnlessMeasured: true }),
  measurement("functional", "damping_test", "Damping test", { when: "damping" }),
  attribute("fitment", "installs_without_modification", "Installs without modification"),
  attribute("fitment", "mounting_points_align", "Mounting points align"),
  attribute("fitment", "correct_position_orientation", "Correct vehicle position and orientation"),
  attribute("fitment", "brake_abs_routing", "Brake hose and ABS routing acceptable"),
  attribute("fitment", "tire_wheel_clearance", "Tire and wheel clearance"),
  attribute("fitment", "suspension_body_clearance", "Suspension and body clearance"),
  attribute("fitment", "steering_no_binding", "Steering has no binding"),
  measurement("fitment", "ride_height", "Ride height", { when: "ride_height" }),
  attribute("fitment", "no_abnormal_fitment_noise", "No abnormal fitment noise"),
  attribute("fitment", "packaging_protects", "Packaging protects the assembly"),
  attribute("fitment", "product_restrained", "Product restrained"),
  attribute("fitment", "threads_studs_protected", "Threads and studs protected"),
  attribute("fitment", "correct_hardware", "Correct hardware"),
  attribute("fitment", "correct_label_barcode", "Correct label and barcode"),
  attribute("fitment", "correct_vehicle_application", "Correct vehicle application"),
  { key: "package_photos", branch: "fitment", label: "Package photos", kind: "evidence", allowNa: false },
];

const CRITERIA_BY_KEY = new Map(CSA_CRITERIA.map((row) => [row.key, row]));

export function criteriaForBranch(branch: CsaBranch): CsaCriterion[] {
  return CSA_CRITERIA.filter((row) => row.branch === branch);
}

export function isCsaBranch(value: string): value is CsaBranch {
  return (CSA_BRANCHES as readonly string[]).includes(value);
}

function blankAttempt(number: number, startedAt: string, branches: CsaBranch[] = [...CSA_BRANCHES]): CsaAttempt {
  return { number, startedAt, branches, results: [], totals: null, overall: null };
}

export function emptyState(now: string): CsaState {
  return {
    csaFaiId: null,
    number: "",
    partNumber: "",
    partDescription: "",
    supplierName: "",
    supplierId: null,
    supplierPartNumber: "",
    sampleLotNumber: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    position: "",
    inspectorName: "",
    inspectorUserId: null,
    openedBy: null,
    dateOpened: now,
    status: "Submitted",
    stage: "Document Review",
    productFamily: CSA_PRODUCT_FAMILY,
    productionRelease: "No",
    approvedSupplier: "No",
    ncrRequired: "No",
    failureDetected: "No",
    ncrId: null,
    ncrStatus: null,
    locked: "No",
    attempt: blankAttempt(1, now),
    history: [],
    overallResult: null,
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
    dampingTestRequired: false,
    vehicleFitmentPerformed: false,
    rejectionReason: null,
    rejectedBy: null,
    rejectionDate: null,
    approvedBy: null,
    approvalDate: null,
    dateClosed: null,
    outcomeLabel: null,
    outcomeDisplay: null,
    engineeringNoticePending: false,
    report: null,
    archive: null,
    slaStatus: "Not started",
    slaNotices: [],
    stepNodeId: null,
    stepEnteredAt: null,
    correctedSamplesAvailableAt: null,
  };
}

const STATE_DEFAULTS = emptyState("1970-01-01T00:00:00.000Z");

export function readCsa(context: Record<string, unknown>): CsaState {
  const base = emptyState(typeof context.dateOpened === "string" ? context.dateOpened : new Date().toISOString());
  const next = { ...base };
  for (const key of Object.keys(STATE_DEFAULTS) as (keyof CsaState)[]) {
    if (context[key] !== undefined) (next as Record<string, unknown>)[key] = context[key];
  }
  if (!next.attempt || typeof next.attempt !== "object") next.attempt = base.attempt;
  if (!Array.isArray(next.history)) next.history = [];
  if (!next.limitOverrides || typeof next.limitOverrides !== "object") next.limitOverrides = {};
  return next;
}

export function writeCsa(context: Record<string, unknown>, state: CsaState): void {
  Object.assign(context, state);
  context.overallResult = state.overallResult;
  context.branchApplies = state.branchApplies;
}

export function submissionErrors(input: Record<string, unknown>): string[] {
  const required: [string, string][] = [
    ["partNumber", "Part Number"],
    ["partDescription", "Part Description"],
    ["supplierName", "Supplier"],
    ["supplierPartNumber", "Supplier Part Number"],
    ["sampleLotNumber", "Sample Lot Number"],
    ["vehicleYear", "Vehicle Year"],
    ["vehicleMake", "Make"],
    ["vehicleModel", "Model"],
    ["position", "Position"],
    ["inspectorName", "Inspector"],
  ];
  const errors: string[] = [];
  for (const [key, label] of required) if (!text(input[key])) errors.push(`${label} is required.`);
  if (input.dateOpened != null && input.dateOpened !== "" && Number.isNaN(Date.parse(String(input.dateOpened)))) errors.push("Date Opened is not a date.");
  return errors;
}

export function vehicleApplication(state: Pick<CsaState, "vehicleYear" | "vehicleMake" | "vehicleModel" | "position">): string {
  return [state.vehicleYear, state.vehicleMake, state.vehicleModel, state.position].filter(Boolean).join(" ");
}

function flagsOf(state: CsaState): CsaFlags {
  return {
    dampingTestRequired: state.dampingTestRequired,
    vehicleFitmentPerformed: state.vehicleFitmentPerformed,
    limitOverrides: state.limitOverrides,
  };
}

function asResult(value: unknown): CsaResult | "" {
  const word = text(value);
  if (!word) return "";
  return (CSA_RESULTS as readonly string[]).includes(word) ? (word as CsaResult) : "";
}

function photosOf(value: unknown): CsaPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const fileName = text((row as { fileName?: unknown }).fileName);
      if (!fileName) return null;
      const caption = text((row as { caption?: unknown }).caption);
      return caption ? { fileName, caption } : { fileName };
    })
    .filter((row): row is CsaPhoto => row != null);
}

export function judgeCriterion(criterion: CsaCriterion, entry: Partial<CsaCriterionResult>, flags: CsaFlags): { result: CsaResult | ""; error: string | null } {
  if (criterion.when === "damping" && !flags.dampingTestRequired) return { result: "Not Applicable", error: null };
  if (criterion.when === "ride_height" && !flags.vehicleFitmentPerformed) return { result: "Not Applicable", error: null };

  const stated = asResult(entry.result);
  const actual = text(entry.actual);
  const units = text(entry.units);
  const fromEntry = text(entry.specifiedLimits);
  const override = text(flags.limitOverrides[criterion.key]?.specifiedLimits);
  const limits = fromEntry ?? override;
  const equipment = text(entry.equipment);
  const comments = text(entry.comments);
  const photos = entry.photos ?? [];

  if (stated === "Not Applicable") {
    if (!criterion.allowNa && !criterion.when) return { result: "", error: `${criterion.label} cannot be Not Applicable.` };
    return { result: "Not Applicable", error: null };
  }

  if (criterion.kind === "evidence") {
    if (photos.length === 0) return { result: "", error: `${criterion.label} are required.` };
    return { result: "Pass", error: null };
  }

  if (criterion.kind === "measurement" && criterion.qualitativeUnlessMeasured && !actual && !limits) {
    if (stated !== "Pass" && stated !== "Fail") return { result: "", error: `${criterion.label} needs Pass or Fail.` };
    if (stated === "Fail" && !comments) return { result: "", error: `${criterion.label} needs inspector comments for a failure.` };
    return { result: stated, error: null };
  }

  if (criterion.kind === "measurement") {
    if (!actual) return { result: "", error: `${criterion.label} needs the actual measurement.` };
    if (!units) return { result: "", error: `${criterion.label} needs units.` };
    if (!limits) return { result: "Engineering Review Required", error: null };
    if (!equipment) return { result: "", error: `${criterion.label} needs the equipment used.` };
    if (stated !== "Pass" && stated !== "Fail") return { result: "", error: `${criterion.label} needs Pass or Fail against the approved limits.` };
    if (stated === "Fail" && !comments) return { result: "", error: `${criterion.label} needs inspector comments for a failure.` };
    if (stated === "Pass" || stated === "Fail") {
      if (criterion.when === "damping" && photos.length === 0 && !comments) return { result: "", error: `${criterion.label} needs actual results and evidence.` };
    }
    return { result: stated, error: null };
  }

  if (stated !== "Pass" && stated !== "Fail") return { result: "", error: `${criterion.label} needs Pass, Fail, or Not Applicable.` };
  if (stated === "Fail") {
    if (!comments) return { result: "", error: `${criterion.label} needs inspector comments for a failure.` };
    if (criterion.branch === "component" && photos.length === 0) return { result: "", error: `${criterion.label} needs a photo for a failure.` };
  }
  return { result: stated, error: null };
}

export function applyBranchResults(state: CsaState, branch: CsaBranch, entries: Partial<CsaCriterionResult>[]): { state: CsaState; errors: string[] } {
  if (state.locked === "Yes") return { state, errors: ["This CSA FAI is locked."] };
  const errors: string[] = [];
  const flags = flagsOf(state);
  const judged: CsaCriterionResult[] = [];
  for (const criterion of criteriaForBranch(branch)) {
    const entry = entries.find((row) => row.key === criterion.key) ?? {};
    const outcome = judgeCriterion(criterion, { ...entry, photos: photosOf(entry.photos) }, flags);
    if (outcome.error || !outcome.result) {
      errors.push(outcome.error ?? `${criterion.label} is incomplete.`);
      continue;
    }
    const override = flags.limitOverrides[criterion.key];
    judged.push({
      key: criterion.key,
      branch,
      label: criterion.label,
      result: outcome.result,
      actual: text(entry.actual),
      units: text(entry.units) ?? override?.units ?? null,
      specifiedLimits: text(entry.specifiedLimits) ?? text(override?.specifiedLimits),
      equipment: text(entry.equipment),
      comments: text(entry.comments),
      photos: photosOf(entry.photos),
    });
  }
  if (errors.length > 0) return { state, errors };
  const kept = state.attempt.results.filter((row) => row.branch !== branch);
  return { state: { ...state, attempt: { ...state.attempt, results: [...kept, ...judged] } }, errors: [] };
}

export function branchComplete(state: CsaState, branch: CsaBranch): string | null {
  const keys = new Set(state.attempt.results.filter((row) => row.branch === branch && row.result).map((row) => row.key));
  const missing = criteriaForBranch(branch).filter((row) => !keys.has(row.key));
  if (missing.length > 0) return `${branchLabel(branch)} is incomplete.`;
  return null;
}

export function branchLabel(branch: CsaBranch): string {
  if (branch === "component") return "Component and Visual";
  if (branch === "dimensional") return "Dimensional";
  if (branch === "functional") return "Functional";
  return "Fitment and Packaging";
}

export function activeBranches(state: CsaState): CsaBranch[] {
  return state.branchApplies && state.branchApplies.length > 0 ? state.branchApplies : [...CSA_BRANCHES];
}

export function calculateInspection(state: CsaState): CsaState {
  const branches = state.attempt.branches.length > 0 ? state.attempt.branches : activeBranches(state);
  const inScope = state.attempt.results.filter((row) => branches.includes(row.branch));
  const expected = CSA_CRITERIA.filter((row) => branches.includes(row.branch));
  if (inScope.length < expected.length) throw new Error("Inspection criteria are missing.");
  const totals: CsaTotals = {
    criteria: inScope.length,
    passed: inScope.filter((row) => row.result === "Pass").length,
    failed: inScope.filter((row) => row.result === "Fail").length,
    notApplicable: inScope.filter((row) => row.result === "Not Applicable").length,
    engineeringReviewRequired: inScope.filter((row) => row.result === "Engineering Review Required").length,
  };
  let overall: CsaAttempt["overall"];
  let failureDetected: CsaState["failureDetected"] = "No";
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
  return {
    ...state,
    attempt: { ...state.attempt, totals, overall, branches },
    overallResult: overall,
    failureDetected,
    status,
    stage,
    engineeringNoticePending: totals.engineeringReviewRequired > 0,
    finalQualityApproval: false,
  };
}

export function releaseBlockers(state: CsaState, options: { finalApprovalRecorded?: boolean; engineeringCleared?: boolean } = {}): string[] {
  const blockers: string[] = [];
  const results = state.attempt.results;
  const branches = state.attempt.branches.length > 0 ? state.attempt.branches : activeBranches(state);
  const expected = CSA_CRITERIA.filter((row) => branches.includes(row.branch));
  if (results.filter((row) => branches.includes(row.branch) && row.result).length < expected.length) blockers.push("Inspection criteria are missing.");
  if (results.some((row) => row.result === "Fail")) blockers.push("Unresolved failed criteria.");
  if (results.some((row) => row.result === "Engineering Review Required") && !options.engineeringCleared && !state.engineeringAccepted) {
    blockers.push("Engineering review is still required.");
  }
  if (!options.finalApprovalRecorded && !state.finalQualityApproval) blockers.push("Final quality approval is required.");
  if (state.ncrRequired === "Yes" && state.ncrStatus !== "closed") blockers.push("The linked NCR is not done.");
  if (state.history.some((attempt) => attempt.overall === "Failed") && state.attempt.overall !== "Passed") blockers.push("The retest has not passed.");
  return blockers;
}

export function assertCanRelease(state: CsaState, options?: { finalApprovalRecorded?: boolean; engineeringCleared?: boolean }): void {
  const blockers = releaseBlockers(state, options);
  if (blockers.length > 0) throw new Error(`Production release is not allowed. ${blockers.join(" ")}`);
}

export function rejectFai(state: CsaState, now: string): CsaState {
  if (!text(state.rejectionReason) || !text(state.rejectedBy) || !text(state.rejectionDate)) {
    throw new Error("Rejection reason, rejected by, and rejection date are required.");
  }
  return {
    ...state,
    status: "Rejected",
    stage: "Rejected",
    productionRelease: "No",
    approvedSupplier: "No",
    outcomeLabel: "FAI Rejected",
    outcomeDisplay: "The CSA is not approved for production.",
    rejectionDate: state.rejectionDate ?? now,
  };
}

export function beginAttempt(state: CsaState, now: string): CsaState {
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
    history,
    attempt: {
      number: state.attempt.number + 1,
      startedAt: now,
      branches: [...CSA_BRANCHES],
      results: carried.map((row) => ({ ...row, photos: [...row.photos] })),
      totals: null,
      overall: null,
    },
  };
}

/** Branches that still need a result on this attempt. Carried results from an earlier attempt are already stored. */
export function branchesToInspect(state: CsaState): CsaBranch[] {
  return CSA_BRANCHES.filter((branch) => criteriaForBranch(branch).some((row) => !state.attempt.results.some((result) => result.key === row.key && result.result)));
}

export function buildReport(state: CsaState): Record<string, unknown> {
  return {
    name: CSA_WORKFLOW_NAME,
    number: state.number,
    productFamily: state.productFamily,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplierName: state.supplierName,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicleApplication: vehicleApplication(state),
    inspectorName: state.inspectorName,
    dateOpened: state.dateOpened,
    status: state.status,
    stage: state.stage,
    productionRelease: state.productionRelease,
    approvedSupplier: state.approvedSupplier,
    overallResult: state.overallResult,
    failureDetected: state.failureDetected,
    ncrRequired: state.ncrRequired,
    ncrId: state.ncrId,
    totals: state.attempt.totals,
    attempts: [...state.history, state.attempt],
    correctiveAction: state.correctiveAction,
    approvalDate: state.approvalDate,
    approvedBy: state.approvedBy,
  };
}

export function archiveState(state: CsaState, now: string): CsaState {
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
      results: state.attempt.results,
      history: state.history,
      photos: [...state.history, state.attempt].flatMap((attempt) => attempt.results.flatMap((row) => row.photos)),
      fitment: state.attempt.results.filter((row) => row.branch === "fitment"),
      approvals: { finalQualityApproval: state.finalQualityApproval, approvalDate: state.approvalDate, approvedBy: state.approvedBy },
      linkedNcrId: state.ncrId,
      correctiveAction: state.correctiveAction,
      retestHistory: state.history,
      archivedAt: now,
    },
    outcomeLabel: "CSA FAI Approved",
    outcomeDisplay: "The CSA is approved for production.",
  };
}

export function ncrDescription(state: CsaState): string {
  const failed = state.attempt.results.filter((row) => row.result === "Fail" || row.result === "Engineering Review Required");
  const lines = failed.map((row) => {
    const bits = [row.label, row.result];
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
    `Supplier: ${state.supplierName}`,
    `Supplier part number: ${state.supplierPartNumber}`,
    `Lot: ${state.sampleLotNumber}`,
    `Vehicle application: ${vehicleApplication(state)}`,
    `Failed criteria:`,
    ...lines,
  ].join("\n");
}

export interface CsaRoute {
  decision: string;
  label: string;
  branch: string;
  revisit?: boolean;
  commentsRequired?: boolean;
}

export function prepareCsaDecision(
  pending: { nodeId?: string; branch?: string; pauseUntil?: string; routes?: CsaRoute[]; workflowKey?: string },
  decision: string,
  notes: string | undefined,
  details: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (pending.workflowKey !== CSA_WORKFLOW_KEY) return {};
  const state = readCsa(context);
  if (state.locked === "Yes") throw new Error("This CSA FAI is locked.");
  const route = (pending.routes ?? []).find((item) => item.decision === decision);
  if (!route && decision !== "approved" && decision !== "rejected") throw new Error("That decision is not on this step.");
  if (route?.commentsRequired && !text(notes)) throw new Error("Comments are required for this decision.");

  const patch: Partial<CsaState> = {};
  const nodeId = pending.nodeId;

  if (nodeId === CSA_NODE.documentReview && decision === "rejected") {
    patch.rejectionReason = text(details?.rejectionReason) ?? text(notes);
    patch.rejectedBy = text(details?.rejectedBy);
    patch.rejectionDate = text(details?.rejectionDate);
    if (!patch.rejectionReason || !patch.rejectedBy || !patch.rejectionDate) throw new Error("Rejection reason, rejected by, and rejection date are required.");
  }

  if (nodeId === CSA_NODE.documentReview && decision === "return") {
    patch.correctionReady = false;
    patch.stage = "Correct FAI Information";
    patch.correctionComments = text(notes);
  }

  if (nodeId === CSA_NODE.correct && decision === "approved") {
    const comments = text(details?.correctionComments) ?? text(notes);
    const changes = details?.changes;
    const changed = changes && typeof changes === "object" && !Array.isArray(changes) && Object.values(changes as Record<string, unknown>).some((value) => text(value));
    if (!comments) throw new Error("Correction comments are required.");
    if (!changed) throw new Error("The information that was sent back has to be corrected.");
    const header = changes as Record<string, unknown>;
    patch.correctionReady = true;
    patch.correctionComments = comments;
    for (const key of ["partNumber", "partDescription", "supplierName", "supplierPartNumber", "sampleLotNumber", "vehicleYear", "vehicleMake", "vehicleModel", "position", "inspectorName"] as const) {
      const value = text(header[key]);
      if (value) (patch as Record<string, unknown>)[key] = value;
    }
    patch.stage = "Document Review";
  }

  if (pending.branch && isCsaBranch(pending.branch) && decision === "approved") {
    const problem = branchComplete(state, pending.branch);
    if (problem) throw new Error(problem);
  }

  if (nodeId === CSA_NODE.engineering) {
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
      const requested = Array.isArray(details?.branches) ? details.branches.filter((item): item is CsaBranch => typeof item === "string" && isCsaBranch(item)) : [];
      const fromResults = state.attempt.results.filter((row) => row.result === "Engineering Review Required").map((row) => row.branch);
      patch.limitOverrides = overrides;
      patch.branchApplies = requested.length > 0 ? [...new Set(requested)] : [...new Set(fromResults)];
      patch.openNewAttempt = true;
      patch.engineeringAccepted = false;
    }
    if (decision === "rejected") patch.engineeringAccepted = false;
  }

  if (nodeId === CSA_NODE.corrective && decision === "approved") {
    const action = readCorrective(details);
    if (!action) throw new Error("Failure cause, corrective action, owner, due date, corrected sample id, and completion evidence are required.");
    patch.correctiveAction = action;
    patch.correctiveActionReady = true;
    patch.correctiveOwnerId = action.ownerId;
    patch.correctedSamplesAvailableAt = action.correctedSampleId ? new Date().toISOString() : state.correctedSamplesAvailableAt;
    patch.stage = "Retest Approval";
  }

  if (nodeId === CSA_NODE.retest && decision === "return") {
    patch.correctiveActionReady = false;
    patch.stage = "Corrective Action";
  }
  if (nodeId === CSA_NODE.retest && decision === "approved") {
    if (!state.correctiveAction) throw new Error("Corrective action is required before a retest.");
    patch.openNewAttempt = true;
    patch.branchApplies = [...CSA_BRANCHES];
    patch.correctedSamplesAvailableAt = state.correctedSamplesAvailableAt ?? new Date().toISOString();
    patch.stage = "Perform CSA Inspection";
  }
  if (nodeId === CSA_NODE.retest && decision === "rejected") {
    patch.rejectionReason = text(notes) ?? text(details?.rejectionReason);
    patch.rejectedBy = text(details?.rejectedBy);
    patch.rejectionDate = text(details?.rejectionDate) ?? new Date().toISOString();
    if (!patch.rejectionReason || !patch.rejectedBy || !patch.rejectionDate) throw new Error("Rejection reason, rejected by, and rejection date are required.");
    patch.productionRelease = "No";
  }

  if (nodeId === CSA_NODE.finalApproval && decision === "approved") {
    const next = { ...state, ...patch };
    const blockers = releaseBlockers(next, { finalApprovalRecorded: true, engineeringCleared: next.engineeringAccepted });
    if (blockers.length > 0) throw new Error(`Production release is not allowed. ${blockers.join(" ")}`);
    patch.finalQualityApproval = true;
    patch.stage = "Production Release";
  }
  if (nodeId === CSA_NODE.finalApproval && decision === "return") {
    const requested = Array.isArray(details?.branches) ? details.branches.filter((item): item is CsaBranch => typeof item === "string" && isCsaBranch(item)) : [];
    patch.branchApplies = requested.length > 0 ? [...new Set(requested)] : [...CSA_BRANCHES];
    patch.openNewAttempt = true;
    patch.finalQualityApproval = false;
    patch.stage = "Perform CSA Inspection";
  }
  if (nodeId === CSA_NODE.finalApproval && decision === "rejected") {
    patch.finalQualityApproval = false;
    patch.failureDetected = "Yes";
  }

  return patch as Record<string, unknown>;
}

function readCorrective(details: Record<string, unknown> | undefined): CsaCorrectiveAction | null {
  if (!details) return null;
  const source = (details.correctiveAction && typeof details.correctiveAction === "object" ? details.correctiveAction : details) as Record<string, unknown>;
  const failureCause = text(source.failureCause);
  const correctiveAction = text(source.correctiveAction);
  const owner = text(source.owner);
  const dueDate = text(source.dueDate);
  const correctedSampleId = text(source.correctedSampleId);
  const completionEvidence = text(source.completionEvidence);
  if (!failureCause || !correctiveAction || !owner || !dueDate || !correctedSampleId || !completionEvidence) return null;
  const ownerId = typeof source.ownerId === "number" ? source.ownerId : null;
  return { failureCause, correctiveAction, owner, ownerId, dueDate, correctedSampleId, completionEvidence };
}

export function passingEntry(criterion: CsaCriterion): Partial<CsaCriterionResult> {
  if (criterion.kind === "evidence") return { key: criterion.key, photos: [{ fileName: "package.jpg" }] };
  if (criterion.kind === "measurement" && criterion.when) return { key: criterion.key, result: "Not Applicable" };
  if (criterion.kind === "measurement") {
    return { key: criterion.key, result: "Pass", actual: "1", units: "mm", specifiedLimits: "1 mm from the approved drawing", equipment: "caliper" };
  }
  return { key: criterion.key, result: "Pass" };
}

export function seedResults(state: CsaState, mutate?: (criterion: CsaCriterion, entry: Partial<CsaCriterionResult>) => Partial<CsaCriterionResult>): CsaState {
  let next = state;
  for (const branch of CSA_BRANCHES) {
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

export interface SlaEvaluation {
  status: CsaState["slaStatus"];
  dueOn: string | null;
  overdueBusinessDays: number;
  notifyOwnerAndQualityManager: boolean;
  notifyOperationsManager: boolean;
}

export function evaluateSla(input: { startedAt: string | null; now: string; businessDays?: number; dueOn?: string | null; notBefore?: string | null }): SlaEvaluation {
  if (input.notBefore && Date.parse(input.now) < Date.parse(input.notBefore)) {
    return { status: "Not started", dueOn: null, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
  }
  const anchor = input.notBefore ?? input.startedAt;
  if (!anchor) return { status: "Not started", dueOn: null, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
  const dueOn = input.dueOn ?? (input.businessDays != null ? addBusinessDays(anchor, input.businessDays) : null);
  if (!dueOn) return { status: "On track", dueOn: null, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
  const today = input.now.slice(0, 10);
  const overdueBusinessDays = businessDaysAfter(dueOn, today);
  if (overdueBusinessDays > 3) return { status: "SLA Escalated", dueOn, overdueBusinessDays, notifyOwnerAndQualityManager: true, notifyOperationsManager: true };
  if (overdueBusinessDays > 0) return { status: "SLA Overdue", dueOn, overdueBusinessDays, notifyOwnerAndQualityManager: true, notifyOperationsManager: false };
  const window = input.businessDays ?? Math.max(1, businessDaysBetween(anchor, `${dueOn}T00:00:00.000Z`) );
  const elapsed = businessDaysBetween(anchor, input.now);
  if (window > 0 && elapsed / window >= 0.75) return { status: "Reminder", dueOn, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
  return { status: "On track", dueOn, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
}

export const CSA_SLA_RULES: { nodeId: string; label: string; businessDays?: number; usesDueDate?: boolean; startsWhenSamplesAvailable?: boolean }[] = [
  { nodeId: CSA_NODE.documentReview, label: "Document Review", businessDays: 2 },
  { nodeId: CSA_NODE.parallel, label: "Initial inspection", businessDays: 5 },
  { nodeId: CSA_NODE.engineering, label: "Engineering Review", businessDays: 2 },
  { nodeId: CSA_NODE.corrective, label: "Corrective Action", usesDueDate: true },
  { nodeId: CSA_NODE.retest, label: "Retest", businessDays: 3, startsWhenSamplesAvailable: true },
  { nodeId: CSA_NODE.finalApproval, label: "Final Quality Approval", businessDays: 2 },
];

const INSPECTION_CLOCK = new Set<string>([CSA_NODE.parallel, CSA_NODE.component, CSA_NODE.dimensional, CSA_NODE.functional, CSA_NODE.fitment, CSA_NODE.doneComponent, CSA_NODE.doneDimensional, CSA_NODE.doneFunctional, CSA_NODE.doneFitment]);

export function clockNode(nodeId: string | null): string | null {
  if (!nodeId) return null;
  return INSPECTION_CLOCK.has(nodeId) ? CSA_NODE.parallel : nodeId;
}

export function stampStep(state: CsaState, nodeId: string | null, now: string): CsaState {
  const clock = clockNode(nodeId);
  if (!clock || state.stepNodeId === clock) return state;
  return { ...state, stepNodeId: clock, stepEnteredAt: now };
}

export function noteSla(state: CsaState, nodeId: string, evaluation: SlaEvaluation): { state: CsaState; send: boolean } {
  const next = { ...state, slaStatus: evaluation.status };
  if (evaluation.status === "On track" || evaluation.status === "Not started") return { state: next, send: false };
  const key = `${nodeId}:${evaluation.status}`;
  if (state.slaNotices.includes(key)) return { state: next, send: false };
  return { state: { ...next, slaNotices: [...state.slaNotices, key] }, send: true };
}

export function slaForNode(state: CsaState, nodeId: string, now: string): SlaEvaluation {
  const rule = CSA_SLA_RULES.find((item) => item.nodeId === nodeId);
  if (!rule) return { status: "Not started", dueOn: null, overdueBusinessDays: 0, notifyOwnerAndQualityManager: false, notifyOperationsManager: false };
  return evaluateSla({
    startedAt: state.stepNodeId === nodeId ? state.stepEnteredAt : null,
    now,
    businessDays: rule.businessDays,
    dueOn: rule.usesDueDate ? state.correctiveAction?.dueDate ?? null : null,
    notBefore: rule.startsWhenSamplesAvailable ? state.correctedSamplesAvailableAt : null,
  });
}
