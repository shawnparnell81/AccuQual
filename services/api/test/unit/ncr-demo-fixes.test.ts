import { describe, expect, it } from "vitest";
import { dispositionAdvances, mergeStageIntoDocument, missingClosureSignatures, readStageFromDocument, stageColumnPatch, stripRowZeroWaiver } from "../../src/modules/ncr/ncr.document.js";
import { sourceNumberMatches } from "../../src/modules/ncr/ncr.sourceLink.js";

describe("NCR document and the workflow stay one record", () => {
  it("writes cause, fix, containment, disposition, and verify onto the printed sections", () => {
    const next = mergeStageIntoDocument({}, {
      containment: "Quarantine lot 12",
      rootCause: "Worn seal",
      correctiveAction: "New seal spec",
      disposition: "Use as is with concession",
      verification: "Three lots clean",
    });
    expect((next.containmentActions as { action: string }[])[0]?.action).toBe("Quarantine lot 12");
    expect(next.identifiedRootCauseSummary).toBe("Worn seal");
    expect((next.fiveWhyAnalysis as { answer: string }[])[4]?.answer).toBe("Worn seal");
    expect((next.correctiveActions as { description: string }[])[0]?.description).toBe("New seal spec");
    expect((next.effectivenessVerification as { resultObservations: string }[])[0]?.resultObservations).toBe("Three lots clean");
    const selected = (next.suspectMaterialDisposition as { disposition: Record<string, boolean> }[])[0]?.disposition;
    expect(selected?.["Use As-Is"]).toBe(true);
    expect(selected?.["with concession"]).toBe(true);
    expect(readStageFromDocument(next)).toMatchObject({
      containment: "Quarantine lot 12",
      rootCause: "Worn seal",
      correctiveAction: "New seal spec",
      verification: "Three lots clean",
      disposition: "Use As-Is",
    });
  });

  it("writes document edits back and does not clear a blank section", () => {
    const patch = stageColumnPatch(
      { containment: "Hold", rootCause: null, correctiveAction: null, processData: { dispositionNote: "Scrap the leaking pumps" } },
      { correctiveActions: [{ description: "Replace the fixture" }], suspectMaterialDisposition: [{ disposition: { Scrap: true } }] },
    );
    expect(patch?.correctiveAction).toBe("Replace the fixture");
    expect(patch?.containment).toBeUndefined();
    expect(patch?.processData).toBeUndefined();
  });
});

describe("NCR closure signatures follow the Required setting", () => {
  it("lists every required role until it has a stamp", () => {
    expect(missingClosureSignatures({}).map((item) => item.label)).toEqual([
      "Quality Manager",
      "Operations / Production Manager",
      "Engineering (if applicable)",
      "Customer Representative (if required)",
    ]);
    const done = missingClosureSignatures({
      _signatureRequired: { "closureApprovals.3.signature": "no" },
      closureApprovals: [
        { signature: "Ada 2026-10-10" },
        { signature: "Bea 2026-10-10" },
        { signature: "Cam 2026-10-10" },
      ],
    });
    expect(done).toEqual([]);
  });

  it("counts Not required marks as satisfied", () => {
    const done = missingClosureSignatures({
      closureApprovals: [
        { signature: "Ada 2026-10-10 10:00" },
        { signature: "Not required – Bea 2026-10-10 11:00" },
        { signature: "Not required – Cam 2026-10-10 12:00" },
        { signature: "Not required – Dan 2026-10-10 13:00" },
      ],
    });
    expect(done).toEqual([]);
  });

  it("still blocks close when a row is neither signed nor Not required", () => {
    const missing = missingClosureSignatures({
      closureApprovals: [
        { signature: "Ada 2026-10-10 10:00" },
        { signature: "" },
        { signature: "Not required – Cam 2026-10-10 12:00" },
      ],
    });
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]?.path).toBe("closureApprovals.1.signature");
  });
});

describe("quarantine complete disposition advances the stage once", () => {
  it("moves Contain to Disposition and leaves a later step alone", () => {
    expect(dispositionAdvances("contain", true)).toBe(true);
    expect(dispositionAdvances("ncr_created", true)).toBe(true);
    expect(dispositionAdvances("fix", true)).toBe(false);
    expect(dispositionAdvances("contain", false)).toBe(false);
  });
});

describe("link existing finds a form number", () => {
  it("matches DEMO-CSA-002", () => {
    expect(sourceNumberMatches("DEMO-CSA-002", "DEMO-CSA-002")).toBe(true);
    expect(sourceNumberMatches("DEMO-CSA-002", "csa-002")).toBe(true);
    expect(sourceNumberMatches("DEMO-CSA-002", "")).toBe(false);
  });
});

describe("NCR closure Not-required marks", () => {
  it("close succeeds when rows 1+ are Not required and row 0 is signed", () => {
    const missing = missingClosureSignatures({
      _signatureRequired: { "closureApprovals.3.signature": "no" },
      closureApprovals: [
        { signature: "Ada 2026-10-10 10:00" },
        { signature: "Not required – Bea 2026-10-10 11:00" },
        { signature: "Not required – Cam 2026-10-10 12:00" },
      ],
    });
    expect(missing).toEqual([]);
  });

  it("a plain 'Not required' label without the dash does NOT count as signed", () => {
    const missing = missingClosureSignatures({
      closureApprovals: [
        { signature: "Ada 2026-10-10 10:00" },
        { signature: "Not required" },
      ],
    });
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]?.path).toBe("closureApprovals.1.signature");
  });

  it("row 0 with _signatureRequired 'no' is ignored (still required)", () => {
    const missing = missingClosureSignatures({
      _signatureRequired: { "closureApprovals.0.signature": "no" },
      closureApprovals: [{ signature: "" }],
    });
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]?.path).toBe("closureApprovals.0.signature");
  });

  it("stripRowZeroWaiver removes a stored 'no' for row 0", () => {
    const data = stripRowZeroWaiver({
      _signatureRequired: { "closureApprovals.0.signature": "no", "closureApprovals.1.signature": "no" },
    });
    const map = data._signatureRequired as Record<string, string>;
    expect(map["closureApprovals.0.signature"]).toBeUndefined();
    expect(map["closureApprovals.1.signature"]).toBe("no");
  });
});
