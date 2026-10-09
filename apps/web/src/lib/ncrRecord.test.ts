import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowHistoryEntry } from "../api/types.ts";
import { ncrRecordedSteps } from "./ncrRecord.ts";

function entry(id: number, changes: Record<string, unknown>): WorkflowHistoryEntry {
  return {
    id,
    entityType: "NCR",
    entityId: 6,
    action: "status_change",
    changes,
    performedBy: 1,
    performedByName: "Shawn Parnell",
    createdAt: "2026-10-09T10:52:00.000Z",
  };
}

test("every step's text is available after close, including verify text that lived only on the audit row", () => {
  const recorded = ncrRecordedSteps(
    {
      containment: "5 suspect parts placed in quarantine",
      rootCause: "Drill fixture bushing worn beyond tolerance",
      correctiveAction: "Fixture bushing replaced and added to the PM plan",
      processData: { dispositionNote: "Rework the 5 quarantined parts" },
    },
    [entry(9, { action: "verify", verification: "Next lot inspected and accepted" }), entry(8, { action: "disposition", note: "Older disposition note" })],
  );

  assert.equal(recorded.containment, "5 suspect parts placed in quarantine");
  assert.equal(recorded.cause, "Drill fixture bushing worn beyond tolerance");
  assert.equal(recorded.disposition, "Rework the 5 quarantined parts");
  assert.equal(recorded.fix, "Fixture bushing replaced and added to the PM plan");
  assert.equal(recorded.verify, "Next lot inspected and accepted");
});
