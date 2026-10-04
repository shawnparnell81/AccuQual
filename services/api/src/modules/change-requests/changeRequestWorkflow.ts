import { AppError } from "../../utils/appError.js";
import { signatureBlocksFor, signatureRequired } from "../signatures/signatureRequired.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { nameStartsWithVicePresident, roleTokens } from "../roles/roleHierarchy.js";
import { ENGINEERING_CHANGE, type ChangeRequestKindDef } from "./changeRequestKinds.js";

/** Request, then parallel review, then one decision, then implementation, then close. */
export const ECR_STATUSES = ["request", "review", "approved", "rejected", "implement", "closed"] as const;
export type EcrStatus = (typeof ECR_STATUSES)[number];

export const ECR_ACTIONS = ["submit", "engineering_review", "quality_review", "approve", "reject", "implement", "close", "reopen"] as const;
export type EcrAction = (typeof ECR_ACTIONS)[number];

export type EcrEditing = "all" | "implementation" | "none";

/** Verification cells that stay open during implementation. */
export const ECR_IMPLEMENT_CELLS = ["B31", "D31", "F31"] as const;

export interface EcrReviewMark {
  at: string;
  by: string;
}

export interface EcrWorkflow {
  status: EcrStatus;
  engineeringReview: EcrReviewMark | null;
  qualityReview: EcrReviewMark | null;
}

export interface EcrActor {
  roleName?: string | null;
  department?: string | null;
}

export function blankEcrWorkflow(): EcrWorkflow {
  return { status: "request", engineeringReview: null, qualityReview: null };
}

function readMark(value: unknown): EcrReviewMark | null {
  if (!value || typeof value !== "object") return null;
  const at = (value as { at?: unknown }).at;
  const by = (value as { by?: unknown }).by;
  if (typeof at !== "string" || typeof by !== "string" || !at.trim() || !by.trim()) return null;
  return { at, by };
}

export function readEcrWorkflow(data: unknown): EcrWorkflow {
  const raw = data && typeof data === "object" ? (data as { workflow?: unknown }).workflow : undefined;
  if (!raw || typeof raw !== "object") return blankEcrWorkflow();
  const status = (raw as { status?: unknown }).status;
  const known = typeof status === "string" && (ECR_STATUSES as readonly string[]).includes(status) ? (status as EcrStatus) : "request";
  return {
    status: known,
    engineeringReview: readMark((raw as { engineeringReview?: unknown }).engineeringReview),
    qualityReview: readMark((raw as { qualityReview?: unknown }).qualityReview),
  };
}

export function ecrEditingMode(status: EcrStatus): EcrEditing {
  if (status === "closed" || status === "approved") return "none";
  if (status === "implement") return "implementation";
  return "all";
}

/**
 * Approve, reject, and close. A general engineer, product engineer, or quality
 * staff title can review or fill, and does not approve.
 */
export function canApproveChangeRequest(user: { roleName?: string | null } | null | undefined): boolean {
  const roleName = user?.roleName?.trim();
  if (!roleName) return false;
  if (isFullAccessRole(roleName)) return true;
  const key = roleName.toLowerCase();
  if (key === "quality_manager" || key === "vice_president") return true;
  const tokens = roleTokens(roleName);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers");
  if (has("quality") && has("manager")) return true;
  if (has("manager") && (has("engineering") || engineer)) return true;
  if (nameStartsWithVicePresident(roleName) && (has("quality") || has("engineering") || engineer)) return true;
  return false;
}

export function canCompleteEngineeringReview(actor: EcrActor): boolean {
  if (canApproveChangeRequest(actor)) return true;
  if (actor.department === "engineering") return true;
  const tokens = roleTokens(actor.roleName ?? "");
  return tokens.some((token) => token === "engineer" || token === "engineers" || token === "engineering");
}

export function canCompleteQualityReview(actor: EcrActor): boolean {
  if (canApproveChangeRequest(actor)) return true;
  if (actor.department === "quality") return true;
  return roleTokens(actor.roleName ?? "").includes("quality");
}

export function ecrApproveBlockers(workflow: EcrWorkflow, hasManagerSignature: boolean): string[] {
  if (workflow.status !== "review") return [];
  const blockers: string[] = [];
  if (!workflow.engineeringReview) blockers.push("Engineering review is still open.");
  if (!workflow.qualityReview) blockers.push("Quality review is still open.");
  if (!hasManagerSignature) blockers.push("The engineering or quality manager still needs to sign.");
  return blockers;
}

export function ecrActions(input: { workflow: EcrWorkflow; actor: EcrActor; canEditRecord: boolean; hasManagerSignature: boolean }): EcrAction[] {
  const { workflow, actor, canEditRecord, hasManagerSignature } = input;
  const actions: EcrAction[] = [];
  if (workflow.status === "request" && canEditRecord) actions.push("submit");
  if (workflow.status === "review" && !workflow.engineeringReview && canCompleteEngineeringReview(actor)) actions.push("engineering_review");
  if (workflow.status === "review" && !workflow.qualityReview && canCompleteQualityReview(actor)) actions.push("quality_review");
  if (workflow.status === "review" && canApproveChangeRequest(actor)) {
    actions.push("reject");
    if (ecrApproveBlockers(workflow, hasManagerSignature).length === 0) actions.push("approve");
  }
  if (workflow.status === "approved" && canEditRecord) actions.push("implement");
  if (workflow.status === "implement" && canApproveChangeRequest(actor)) actions.push("close");
  if (workflow.status === "rejected" && canEditRecord) actions.push("reopen");
  return actions;
}

function cellsOf(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return {};
  return cells as Record<string, unknown>;
}

function normCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Refuses answer edits the current stage does not allow. A save with no cell change is fine. */
export function assertEcrAnswerEdit(previousData: unknown, incomingData: unknown, noun = ENGINEERING_CHANGE.noun): void {
  const status = readEcrWorkflow(previousData).status;
  const editing = ecrEditingMode(status);
  if (editing === "all") return;
  const prev = cellsOf(previousData);
  const next = cellsOf(incomingData);
  const allowed = new Set<string>(editing === "implementation" ? ECR_IMPLEMENT_CELLS : []);
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (normCell(prev[key]) === normCell(next[key])) continue;
    if (!allowed.has(key)) {
      throw AppError.badRequest(
        editing === "implementation"
          ? "Only the implementation verification can be edited after approval."
          : `This ${noun} can't be edited in its current stage.`,
      );
    }
  }
}

export function ecrHasManagerSignature(data: unknown): boolean {
  const blocks = signatureBlocksFor("iso:engineering_change");
  if (!signatureRequired(data, "managerSignature", blocks)) return true;
  if (!data || typeof data !== "object") return false;
  const value = (data as { managerSignature?: unknown }).managerSignature;
  return typeof value === "string" && value.trim() !== "";
}

export function ecrVerificationAnswered(data: unknown): boolean {
  const value = cellsOf(data).B31;
  return value === "YES" || value === "NO";
}

export interface EcrTransitionResult {
  workflow: EcrWorkflow;
  summary: string;
  from: EcrStatus;
  to: EcrStatus;
}

export function applyEcrTransition(input: {
  workflow: EcrWorkflow;
  action: EcrAction;
  actor: EcrActor;
  canEditRecord: boolean;
  hasManagerSignature: boolean;
  verificationAnswered: boolean;
  note?: string;
  now: string;
  actorName: string;
  kind?: ChangeRequestKindDef;
}): EcrTransitionResult {
  const { workflow, action, actor, canEditRecord, now, actorName } = input;
  const kind = input.kind ?? ENGINEERING_CHANGE;
  const from = workflow.status;
  const allowed = ecrActions({
    workflow,
    actor,
    canEditRecord,
    hasManagerSignature: input.hasManagerSignature,
  });
  if (!allowed.includes(action)) {
    throw AppError.forbidden(transitionRefusal(workflow, action, input.hasManagerSignature, canEditRecord, kind));
  }

  if (action === "submit") {
    return { workflow: { ...workflow, status: "review" }, summary: `Submitted the ${kind.noun} for review.`, from, to: "review" };
  }
  if (action === "engineering_review") {
    return {
      workflow: { ...workflow, engineeringReview: { at: now, by: actorName } },
      summary: "Recorded the engineering review.",
      from,
      to: from,
    };
  }
  if (action === "quality_review") {
    return {
      workflow: { ...workflow, qualityReview: { at: now, by: actorName } },
      summary: "Recorded the quality review.",
      from,
      to: from,
    };
  }
  if (action === "approve") {
    return { workflow: { ...workflow, status: "approved" }, summary: `Approved the ${kind.noun}.`, from, to: "approved" };
  }
  if (action === "reject") {
    const note = (input.note ?? "").trim();
    if (!note) throw AppError.badRequest("Enter why this request is rejected.");
    return {
      workflow: { ...workflow, status: "rejected" },
      summary: `Rejected the ${kind.noun}. ${note}`,
      from,
      to: "rejected",
    };
  }
  if (action === "implement") {
    return { workflow: { ...workflow, status: "implement" }, summary: `Moved the ${kind.noun} to implementation.`, from, to: "implement" };
  }
  if (action === "close") {
    if (!input.verificationAnswered) throw AppError.badRequest(kind.closeBlocker);
    return { workflow: { ...workflow, status: "closed" }, summary: `Closed the ${kind.noun}.`, from, to: "closed" };
  }
  return {
    workflow: { ...workflow, status: "request", engineeringReview: null, qualityReview: null },
    summary: `Returned the ${kind.noun} to the request stage for correction.`,
    from,
    to: "request",
  };
}

function transitionRefusal(workflow: EcrWorkflow, action: EcrAction, hasManagerSignature: boolean, canEditRecord: boolean, kind: ChangeRequestKindDef): string {
  if ((action === "submit" || action === "implement" || action === "reopen") && !canEditRecord) {
    return `Editing this ${kind.noun} requires Documents edit.`;
  }
  if (action === "approve") {
    const blocker = ecrApproveBlockers(workflow, hasManagerSignature)[0];
    if (workflow.status === "review" && blocker) return blocker;
    const article = /^[aeiou]/i.test(kind.noun) ? "an" : "a";
    return `Approving ${article} ${kind.noun} is limited to quality and engineering management.`;
  }
  if (action === "reject" || action === "close") {
    return "That decision is limited to quality and engineering management.";
  }
  if (action === "engineering_review") return "Engineering review is limited to engineering.";
  if (action === "quality_review") return "Quality review is limited to quality.";
  return `That step isn't available on this ${kind.noun}.`;
}
