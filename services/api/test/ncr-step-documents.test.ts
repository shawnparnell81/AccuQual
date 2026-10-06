import { describe, expect, it } from "vitest";
import { notificationOpenPath } from "../src/modules/notifications/notificationTarget.js";
import { writeStepDocuments } from "../src/modules/ncr/ncrStepDocuments.js";

describe("NCR step documents", () => {
  it("stores links for one step and keeps the process fields already on the record", () => {
    const next = writeStepDocuments({ part_number: "P-1", locked: false, stepDocuments: { fix: [{ id: 1, title: "Old" }] } }, "contain", [{ id: 9, title: "Hold WI" }]);
    expect(next.part_number).toBe("P-1");
    expect(next.locked).toBe(false);
    expect(next.stepDocuments).toEqual({
      fix: [{ id: 1, title: "Old" }],
      contain: [{ id: 9, title: "Hold WI" }],
    });
  });
});

describe("notification open path", () => {
  it("opens the record on its current step", () => {
    expect(notificationOpenPath("ncr", 12)).toBe("/ncr/12#record-current-step");
    expect(notificationOpenPath("FaiRecord", 3)).toBe("/fai/records/3#record-current-step");
    expect(notificationOpenPath("Validation", 4)).toBe("/validation-reports/4#record-current-step");
    expect(notificationOpenPath("ChangeRequest", 6)).toBe("/change/6#record-current-step");
    expect(notificationOpenPath("not-a-record", 1)).toBeNull();
  });
});
