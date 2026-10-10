import assert from "node:assert/strict";
import test from "node:test";
import { ncrLogFailure } from "./ncrCreateError.ts";
import { mergeStageIntoDocument, missingClosureSignatures, stagePreviewPatch } from "./ncrDocument.ts";

test("a 502 while logging an NCR is a server error with retry, and a title error is not", () => {
  const gateway = { response: { status: 502, data: { message: "Bad gateway" } } };
  assert.deepEqual(ncrLogFailure(gateway), { message: "The server couldn't log this NCR. Try again.", retry: true });
  assert.equal(ncrLogFailure(gateway).message.includes("title"), false);

  const dropped = new Error("Network Error");
  assert.equal(ncrLogFailure(dropped).retry, true);

  const title = { response: { status: 400, data: { message: "Title is required" } } };
  const titleFailure = ncrLogFailure(title);
  assert.equal(titleFailure.retry, false);
  assert.match(titleFailure.message, /Title/);

  const number = { response: { status: 400, data: { message: "That NCR number is already used." } } };
  assert.equal(ncrLogFailure(number).message, "That NCR number is already used.");
  assert.equal(ncrLogFailure(number).retry, false);
});

test("stage text fills the NCR document sections that print", () => {
  const next = mergeStageIntoDocument({}, {
    containment: "Hold the lot",
    rootCause: "Seal worn\nTorque low",
    disposition: "Scrap the lot",
    correctiveAction: "Replace the seal",
    verification: "Next lot passed",
  });
  const containment = next.containmentActions as { action: string }[];
  const whys = next.fiveWhyAnalysis as { answer: string }[];
  const actions = next.correctiveActions as { description: string }[];
  const checks = next.effectivenessVerification as { resultObservations: string }[];
  const disposition = next.suspectMaterialDisposition as { disposition: Record<string, boolean> }[];
  assert.equal(containment[0]?.action, "Hold the lot");
  assert.equal(whys[0]?.answer, "Seal worn");
  assert.equal(whys[1]?.answer, "Torque low");
  assert.equal(next.identifiedRootCauseSummary, "Seal worn\nTorque low");
  assert.equal(actions[0]?.description, "Replace the seal");
  assert.equal(checks[0]?.resultObservations, "Next lot passed");
  assert.equal(disposition[0]?.disposition.Scrap, true);
  assert.ok(stagePreviewPatch({}, { containment: "Hold the lot" }).containmentActions);
});

test("closure asks only for roles still marked required", () => {
  const missing = missingClosureSignatures({});
  assert.equal(missing.length, 4);
  assert.equal(missing[0]?.label, "Quality Manager");

  const waived = missingClosureSignatures({
    _signatureRequired: { "closureApprovals.2.signature": "no", "closureApprovals.3.signature": "no" },
    closureApprovals: [{ signature: "Ada — 2026-10-10 09:00" }, { signature: "Bea — 2026-10-10 09:05" }],
  });
  assert.deepEqual(waived, []);
});
