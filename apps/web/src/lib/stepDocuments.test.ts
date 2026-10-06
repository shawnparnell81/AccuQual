import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkedDocumentsForStep, mergeLinkedDocuments, parseLinkedDocuments, readNcrStepDocuments } from "./stepDocuments.ts";

describe("step document links", () => {
  it("keeps published document ids and drops blanks", () => {
    assert.deepEqual(
      parseLinkedDocuments([
        { id: 4, title: " Work instruction " },
        { id: 4, title: "duplicate" },
        { id: 0, title: "no" },
        { title: "missing id" },
      ]),
      [{ id: 4, title: "Work instruction" }],
    );
  });

  it("reads the NCR step bucket without touching the rest of the process data", () => {
    const data = { part_number: "P-1", stepDocuments: { contain: [{ id: 2, title: "Hold procedure" }] } };
    assert.deepEqual(readNcrStepDocuments(data, "contain"), [{ id: 2, title: "Hold procedure" }]);
    assert.deepEqual(readNcrStepDocuments(data, "fix"), []);
  });

  it("matches a workflow step by its stage or its name", () => {
    const nodes = [
      { id: "a7", label: "Containment Activities", config: { workflowStage: "Containment", linkedDocuments: [{ id: 8, title: "Containment WI" }] } },
      { id: "a9", label: "Corrective Action Planning", config: { workflowStage: "Corrective Action", linkedDocuments: [{ id: 9, title: "CA form" }] } },
    ];
    assert.deepEqual(linkedDocumentsForStep(nodes, "Containment"), [{ id: 8, title: "Containment WI" }]);
    assert.deepEqual(mergeLinkedDocuments(linkedDocumentsForStep(nodes, "Containment"), [{ id: 8, title: "again" }, { id: 3, title: "Record copy" }]), [
      { id: 8, title: "Containment WI" },
      { id: 3, title: "Record copy" },
    ]);
  });
});
