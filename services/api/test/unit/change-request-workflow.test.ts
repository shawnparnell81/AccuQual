import { describe, expect, it } from "vitest";
import { FIXED_TEMPLATE_REVISIONS } from "../../src/modules/forms/templateStructure.js";
import {
  applyEcrTransition,
  assertEcrAnswerEdit,
  blankEcrWorkflow,
  canApproveChangeRequest,
  ecrActions,
  ecrApproveBlockers,
} from "../../src/modules/change-requests/changeRequestWorkflow.js";
import { DRAWING_CHANGE, PROCESS_CHANGE, DOCUMENT_CHANGE } from "../../src/modules/change-requests/changeRequestKinds.js";
import { ECR_LABEL_DEFAULTS, defaultEcrLabels, defaultKindLabels, ecrCodeStamp, kindCodeStamp, nextEcrMaster, type EcrMaster } from "../../src/modules/change-requests/ecrTemplate.js";
import { AppError } from "../../src/utils/appError.js";

const engineer = { roleName: "Engineer", department: "engineering" };
const quality = { roleName: "operator", department: "quality" };
const manager = { roleName: "quality_manager", department: "quality" };
const productEngineer = { roleName: "Product Engineer", department: "engineering" };

function step(workflow: ReturnType<typeof blankEcrWorkflow>, action: Parameters<typeof applyEcrTransition>[0]["action"], actor = manager, extra: Partial<Parameters<typeof applyEcrTransition>[0]> = {}) {
  return applyEcrTransition({
    workflow,
    action,
    actor,
    canEditRecord: true,
    hasManagerSignature: true,
    verificationAnswered: true,
    now: "2026-10-01T12:00:00.000Z",
    actorName: "Shawn Parnell",
    ...extra,
  });
}

describe("engineering change request workflow", () => {
  it("keeps approval with management titles", () => {
    expect(canApproveChangeRequest({ roleName: "quality_manager" })).toBe(true);
    expect(canApproveChangeRequest({ roleName: "Engineering Manager" })).toBe(true);
    expect(canApproveChangeRequest({ roleName: "VP of Quality and Engineering" })).toBe(true);
    expect(canApproveChangeRequest({ roleName: "owner" })).toBe(true);
    expect(canApproveChangeRequest({ roleName: "Engineer" })).toBe(false);
    expect(canApproveChangeRequest({ roleName: "Product Engineer" })).toBe(false);
    expect(canApproveChangeRequest({ roleName: "Quality" })).toBe(false);
    expect(canApproveChangeRequest(null)).toBe(false);
  });

  it("runs request, parallel review, approval, implementation, and close", () => {
    const request = blankEcrWorkflow();
    expect(ecrActions({ workflow: request, actor: quality, canEditRecord: true, hasManagerSignature: false })).toEqual(["submit"]);
    const review = step(request, "submit", quality, { hasManagerSignature: false }).workflow;
    expect(review.status).toBe("review");
    expect(ecrActions({ workflow: review, actor: quality, canEditRecord: true, hasManagerSignature: false })).toEqual(["quality_review"]);
    expect(ecrActions({ workflow: review, actor: engineer, canEditRecord: true, hasManagerSignature: false })).toEqual(["engineering_review"]);
    const withEngineering = step(review, "engineering_review", engineer, { hasManagerSignature: false }).workflow;
    const withBoth = step(withEngineering, "quality_review", quality, { hasManagerSignature: false }).workflow;
    expect(ecrApproveBlockers(withBoth, false)).toEqual(["The engineering or quality manager still needs to sign."]);
    expect(() => step(withBoth, "approve", manager, { hasManagerSignature: false })).toThrow(AppError);
    const approved = step(withBoth, "approve", manager).workflow;
    expect(approved.status).toBe("approved");
    expect(() => assertEcrAnswerEdit({ workflow: approved, cells: { B6: "A" } }, { cells: { B6: "B" } })).toThrow(/can't be edited/);
    const implement = step(approved, "implement", engineer).workflow;
    expect(() => assertEcrAnswerEdit({ workflow: implement, cells: { B6: "A" } }, { cells: { B6: "B" } })).toThrow(/implementation verification/);
    expect(() => assertEcrAnswerEdit({ workflow: implement, cells: { B31: "" } }, { cells: { B31: "YES" } })).not.toThrow();
    expect(() => step(implement, "close", manager, { verificationAnswered: false })).toThrow(/planned batch/);
    const closed = step(implement, "close", manager).workflow;
    expect(closed.status).toBe("closed");
    expect(ecrActions({ workflow: closed, actor: manager, canEditRecord: true, hasManagerSignature: true })).toEqual([]);
  });

  it("sends a rejection back to request and clears the reviews", () => {
    let workflow = step(blankEcrWorkflow(), "submit", quality).workflow;
    workflow = step(workflow, "engineering_review", engineer).workflow;
    expect(() => step(workflow, "reject", productEngineer, { note: "Wrong part" })).toThrow(AppError);
    expect(() => step(workflow, "reject", manager, { note: "  " })).toThrow(/why this request is rejected/);
    const rejected = step(workflow, "reject", manager, { note: "Wrong part" });
    expect(rejected.summary).toContain("Wrong part");
    expect(rejected.to).toBe("rejected");
    const again = step(rejected.workflow, "reopen", quality).workflow;
    expect(again).toMatchObject({ status: "request", engineeringReview: null, qualityReview: null });
  });
});

describe("engineering change request template revision", () => {
  it("publishes Rev B and leaves the letter alone when the labels do not change", () => {
    expect(FIXED_TEMPLATE_REVISIONS["iso:engineering_change"]).toEqual({ version: 2, revision: "B" });
    expect(ecrCodeStamp().revision).toBe("B");
    expect(ECR_LABEL_DEFAULTS.section7).toBe("SECTION 7: LINKS, TRAINING, AND IMPACT");
    const current: EcrMaster = { companyId: 1, ...ecrCodeStamp(), labels: defaultEcrLabels(), lastChange: null };
    const same = nextEcrMaster(current, defaultEcrLabels(), null);
    expect(same.changed).toBe(false);
    expect(same.master.revision).toBe("B");
    expect(same.master.version).toBe(2);
  });

  it("clones the same stages onto a drawing change request", () => {
    const request = blankEcrWorkflow();
    const submitted = applyEcrTransition({
      workflow: request,
      action: "submit",
      actor: quality,
      canEditRecord: true,
      hasManagerSignature: false,
      verificationAnswered: false,
      now: "2026-10-01T12:00:00.000Z",
      actorName: "Shawn Parnell",
      kind: DRAWING_CHANGE,
    });
    expect(submitted.summary).toBe("Submitted the drawing change request for review.");
    expect(submitted.workflow.status).toBe("review");
    expect(DRAWING_CHANGE.labels.partNumbers).toBe("Drawing Number:");
    expect(PROCESS_CHANGE.labels.partNumbers).toBe("Process Name:");
    expect(DOCUMENT_CHANGE.labels.section4).toBe("SECTION 4: OLD REVISION DISPOSITION");
    expect(kindCodeStamp(DRAWING_CHANGE)).toMatchObject({ version: 1, revision: "A" });
    expect(ECR_LABEL_DEFAULTS.partNumbers).toBe("Part Number(s) Affected:");
    const current: EcrMaster = { companyId: 1, ...kindCodeStamp(DRAWING_CHANGE), labels: defaultKindLabels(DRAWING_CHANGE), lastChange: null };
    expect(nextEcrMaster(current, defaultKindLabels(DRAWING_CHANGE), null).changed).toBe(false);
  });

  it("bumps VERSION and REV only when a label changes", () => {
    const current: EcrMaster = { companyId: 1, ...ecrCodeStamp(), labels: defaultEcrLabels(), lastChange: null };
    const labels = defaultEcrLabels();
    labels.partNumbers = "Affected part numbers:";
    const next = nextEcrMaster(current, labels, { who: "Shawn Parnell", what: "Template structure", when: "2026-10-01T12:00:00.000Z", description: "Changed the template." });
    expect(next.changed).toBe(true);
    expect(next.master.revision).toBe("C");
    expect(next.master.version).toBe(3);
    expect(next.master.lastChange?.who).toBe("Shawn Parnell");
  });
});
