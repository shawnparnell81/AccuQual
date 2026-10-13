import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditListParams, EMPTY_AUDIT_FILTERS } from "./auditLogFilters.ts";

describe("audit log filters", () => {
  it("asks for the paged shape and leaves blank filters out", () => {
    assert.deepEqual(auditListParams(EMPTY_AUDIT_FILTERS), { paged: 1 });
  });

  it("sends each filter and the paging cursor", () => {
    const params = auditListParams({ userId: "7", entityType: "NCR", from: "2026-01-01", to: "2026-02-01", q: "  delete " }, 120);
    assert.deepEqual(params, { paged: 1, userId: "7", entityType: "NCR", from: "2026-01-01", to: "2026-02-01", q: "delete", before: 120 });
  });
});
