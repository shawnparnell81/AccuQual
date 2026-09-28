import { describe, expect, it } from "vitest";
import { collectPersonIds, rewritePersonIds } from "../../src/modules/audit-trail/audit-trail.service.js";

describe("history person names", () => {
  it("turns assigned-to and created-by ids into names and leaves other numbers alone", () => {
    const changes = { action: "update", patch: { assignedTo: 3, quantity: 3 }, created_by: "1" };
    const fieldChanges = [{ table: "ncr", op: "UPDATE", changes: { assigned_to: { from: 1, to: 3 }, title: { from: "Old", to: "New" } } }];
    const ids: number[] = [];
    collectPersonIds(changes, ids);
    collectPersonIds(fieldChanges, ids);
    expect(ids.sort((a, b) => a - b)).toEqual([1, 1, 3, 3]);

    const names = new Map<number, string>([
      [1, "Jane Doe (inactive)"],
      [3, "Sam Lee"],
    ]);
    expect(rewritePersonIds(changes, names)).toEqual({
      action: "update",
      patch: { assignedTo: "Sam Lee", quantity: 3 },
      created_by: "Jane Doe (inactive)",
    });
    expect(rewritePersonIds(fieldChanges, names)).toEqual([
      { table: "ncr", op: "UPDATE", changes: { assigned_to: { from: "Jane Doe (inactive)", to: "Sam Lee" }, title: { from: "Old", to: "New" } } },
    ]);
  });
});
