import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenWork, type OpenWorkInput } from "../../src/modules/dashboard/dashboard.openWork.js";
import { applyEcrTransition, blankEcrWorkflow, ecrApproveBlockers, ecrHasManagerSignature } from "../../src/modules/change-requests/changeRequestWorkflow.js";
import { liveStructureHash } from "../../src/modules/forms/templateStructure.js";
import { FORM_TEMPLATE_CATALOG } from "../../src/modules/forms/formTemplateCatalog.js";
import {
  NOT_REQUIRED_LABEL,
  SIGNATURE_REQUIRED_KEY,
  describeSignatureRequired,
  showsRequiredControl,
  signatureBlocksFor,
  signaturePdfValue,
  signatureRequired,
  withSanitizedRequired,
} from "../../src/modules/signatures/signatureRequired.js";
import { AppError } from "../../src/utils/appError.js";

const manager = { roleName: "quality_manager", department: "quality" };
const quality = { roleName: "operator", department: "quality" };
const engineer = { roleName: "Engineer", department: "engineering" };

function reviewed() {
  let workflow = blankEcrWorkflow();
  workflow = applyEcrTransition({
    workflow,
    action: "submit",
    actor: quality,
    canEditRecord: true,
    hasManagerSignature: false,
    verificationAnswered: true,
    now: "2026-10-01T12:00:00.000Z",
    actorName: "Shawn Parnell",
  }).workflow;
  workflow = applyEcrTransition({
    workflow,
    action: "engineering_review",
    actor: engineer,
    canEditRecord: true,
    hasManagerSignature: false,
    verificationAnswered: true,
    now: "2026-10-01T12:00:00.000Z",
    actorName: "Shawn Parnell",
  }).workflow;
  workflow = applyEcrTransition({
    workflow,
    action: "quality_review",
    actor: quality,
    canEditRecord: true,
    hasManagerSignature: false,
    verificationAnswered: true,
    now: "2026-10-01T12:00:00.000Z",
    actorName: "Shawn Parnell",
  }).workflow;
  return workflow;
}

function approve(hasManagerSignature: boolean) {
  return applyEcrTransition({
    workflow: reviewed(),
    action: "approve",
    actor: manager,
    canEditRecord: true,
    hasManagerSignature,
    verificationAnswered: true,
    now: "2026-10-01T12:00:00.000Z",
    actorName: "Shawn Parnell",
  });
}

describe("signature required choice", () => {
  it("shows the control only when a form has more than one signature block", () => {
    const ncr = signatureBlocksFor("form:ncr");
    const capa = signatureBlocksFor("form:capa");
    const dimensional = signatureBlocksFor("form:dimensional_report");
    const gage = signatureBlocksFor("form:gage_rr");
    expect(ncr.length).toBeGreaterThan(1);
    expect(capa.length).toBeGreaterThan(1);
    expect(showsRequiredControl(ncr.length)).toBe(true);
    expect(dimensional).toHaveLength(1);
    expect(gage).toHaveLength(1);
    expect(showsRequiredControl(dimensional.length)).toBe(false);
    expect(showsRequiredControl(1)).toBe(false);
    expect(signatureBlocksFor("iso:engineering_change")).toHaveLength(2);
    expect(signatureBlocksFor("iso:salt_spray")).toHaveLength(2);
    expect(signatureBlocksFor("iso:audit_summary").length).toBeGreaterThan(1);
    expect(signatureBlocksFor("validation:fuel_injector")).toHaveLength(2);
    expect(signatureBlocksFor("validation:gas_lift")).toHaveLength(2);
    expect(signatureBlocksFor("validation:air_strut")).toHaveLength(1);
    expect(signatureBlocksFor("iso:prototype_strut")).toHaveLength(1);
    expect(signatureBlocksFor("scar")).toHaveLength(2);
    expect(signatureBlocksFor("quality_inspection")).toHaveLength(2);
    expect(signatureBlocksFor("dcr")).toHaveLength(2);
    expect(signatureBlocksFor("crar")).toHaveLength(2);
    expect(signatureBlocksFor("feasibility")).toHaveLength(4);
    expect(signatureBlocksFor("work_order")).toHaveLength(2);
  });

  it("keeps an existing record required until someone marks a block No", () => {
    const blocks = signatureBlocksFor("iso:engineering_change");
    expect(signatureRequired({}, "managerSignature", blocks)).toBe(true);
    expect(signatureRequired({ managerSignature: "" }, "supplierRepSignature", blocks)).toBe(true);
    expect(signatureRequired({ [SIGNATURE_REQUIRED_KEY]: { managerSignature: "yes" } }, "managerSignature", blocks)).toBe(true);
  });

  it("lets a change request approve without the manager PIN when that block is not required", () => {
    const blocks = signatureBlocksFor("iso:engineering_change");
    const waived = { [SIGNATURE_REQUIRED_KEY]: { managerSignature: "no" } };
    expect(signatureRequired(waived, "managerSignature", blocks)).toBe(false);
    expect(ecrHasManagerSignature(waived)).toBe(true);
    expect(approve(ecrHasManagerSignature(waived)).workflow.status).toBe("approved");
    expect(describeSignatureRequired("Engineering or quality manager signature", "no")).toBe("Marked Engineering or quality manager signature as not required.");
  });

  it("still requires the manager stamp when the block is Yes or was never chosen", () => {
    const blocks = signatureBlocksFor("iso:engineering_change");
    expect(ecrHasManagerSignature({})).toBe(false);
    expect(ecrHasManagerSignature({ [SIGNATURE_REQUIRED_KEY]: { managerSignature: "yes" } })).toBe(false);
    expect(ecrHasManagerSignature({ [SIGNATURE_REQUIRED_KEY]: { supplierRepSignature: "no" } })).toBe(false);
    expect(signatureRequired({ [SIGNATURE_REQUIRED_KEY]: { supplierRepSignature: "no" } }, "managerSignature", blocks)).toBe(true);
    expect(ecrApproveBlockers(reviewed(), false)).toEqual(["The engineering or quality manager still needs to sign."]);
    expect(() => approve(false)).toThrow(AppError);
    expect(ecrHasManagerSignature({ managerSignature: "Shawn Parnell — Oct 1, 2026, 8:00 AM EDT" })).toBe(true);
    expect(approve(true).workflow.status).toBe("approved");
  });

  it("accepts every block marked not required", () => {
    const data = { [SIGNATURE_REQUIRED_KEY]: { managerSignature: "no", supplierRepSignature: "no" } };
    const blocks = signatureBlocksFor("iso:engineering_change");
    expect(signatureRequired(data, "managerSignature", blocks)).toBe(false);
    expect(signatureRequired(data, "supplierRepSignature", blocks)).toBe(false);
    expect(ecrHasManagerSignature(data)).toBe(true);
  });

  it("ignores a stored No on a form with one signature", () => {
    const blocks = signatureBlocksFor("validation:air_strut");
    const data = { [SIGNATURE_REQUIRED_KEY]: { authorizedSignature: "no" } };
    expect(signatureRequired(data, "authorizedSignature", blocks)).toBe(true);
    expect(withSanitizedRequired(data, blocks)[SIGNATURE_REQUIRED_KEY]).toBeUndefined();
    expect(signaturePdfValue(data, "authorizedSignature", "", blocks)).toBe("");
  });

  it("prints a waived signature as not required and leaves a required blank signature blank", () => {
    const blocks = signatureBlocksFor("form:ncr");
    const path = blocks[0]!.path;
    const waived = { [SIGNATURE_REQUIRED_KEY]: { [path]: "no" } };
    expect(signaturePdfValue(waived, path, "", blocks)).toBe(NOT_REQUIRED_LABEL);
    expect(signaturePdfValue(waived, path, "Shawn Parnell — Oct 1, 2026, 8:00 AM EDT", blocks)).toBe("Shawn Parnell — Oct 1, 2026, 8:00 AM EDT");
    expect(signaturePdfValue({}, path, "", blocks)).toBe("");
    expect(signaturePdfValue({ [SIGNATURE_REQUIRED_KEY]: { [path]: "yes" } }, path, "  ", blocks)).toBe("");
  });

  it("drops an unsigned validation or salt-spray record from open work when that finish signature is not required", () => {
    const now = new Date("2026-09-24T15:00:00.000Z");
    const input: OpenWorkInput = {
      now,
      allPlants: true,
      siteIds: [1],
      sites: [{ id: 1, name: "Dayton Machining" }],
      access: { ncr: false, capa: false, scar: false, documents: true, change: false, ppap: false, risk: false, workOrders: false, calibration: false, training: false },
      names: {},
      userSites: [],
      ncrs: [],
      capas: [],
      scars: [],
      changes: [],
      ppaps: [],
      risks: [],
      workOrders: [],
      assignments: [],
      equipment: [],
      validation: [
        { id: 1, formType: "fuel_injector", data: { formType: "fuel_injector", [SIGNATURE_REQUIRED_KEY]: { authorizedSignature: "no" } }, createdAt: now, updatedAt: null },
        { id: 2, formType: "fuel_injector", data: { formType: "fuel_injector", [SIGNATURE_REQUIRED_KEY]: { furtherSignature: "no" } }, createdAt: now, updatedAt: null },
        { id: 3, formType: "air_strut", data: { formType: "air_strut", [SIGNATURE_REQUIRED_KEY]: { authorizedSignature: "no" } }, createdAt: now, updatedAt: null },
      ],
      forms: [
        { id: 11, formType: "salt_spray", data: { [SIGNATURE_REQUIRED_KEY]: { approvedSignature: "no" } }, createdAt: now, updatedAt: null },
        { id: 12, formType: "salt_spray", data: { [SIGNATURE_REQUIRED_KEY]: { testedSignature: "no" } }, createdAt: now, updatedAt: null },
        { id: 13, formType: "prototype_strut", data: { [SIGNATURE_REQUIRED_KEY]: { engineeringSignoffSignature: "no" } }, createdAt: now, updatedAt: null },
      ],
    };
    const work = buildOpenWork(input);
    const numbers = work.records.map((row) => row.number);
    expect(numbers).not.toContain("VAL-1");
    expect(numbers).toContain("VAL-2");
    expect(numbers).toContain("VAL-3");
    expect(numbers).not.toContain("TRP-11");
    expect(numbers).toContain("TRP-12");
    expect(numbers).toContain("TRP-13");
  });

  it("does not change the stored form revision when the choice is added", () => {
    expect(liveStructureHash("form:ncr")).toBe(FORM_TEMPLATE_CATALOG["form:ncr"]?.structureHash);
    expect(liveStructureHash("feasibility")).toBe(FORM_TEMPLATE_CATALOG.feasibility?.structureHash);
    expect(liveStructureHash("dcr")).toBe(FORM_TEMPLATE_CATALOG.dcr?.structureHash);
    const journal = JSON.parse(readFileSync(new URL("../../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.find((entry) => entry.tag === "0107_signature_required")).toMatchObject({ idx: 107, tag: "0107_signature_required" });
    expect(journal.entries.filter((entry) => entry.tag === "0107_signature_required")).toHaveLength(1);
  });
});
