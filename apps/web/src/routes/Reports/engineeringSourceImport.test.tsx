import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { ROLE_PERMISSION_GROUPS } from "../../lib/rolePermissionSelection";
import { DeleteReportDialog, verifyReportMessage } from "./engineeringReportDelete";
import { previewLines } from "./engineeringSourceImport";

describe("Monthly source import preview", () => {
  it("lists rows per month, ignored tabs, undated rows and verified months", () => {
    const lines = previewLines({
      fileName: "alerts.xlsx",
      sheets: [
        { sheet: "Oreilly", kind: "product_alerts", label: "O'Reilly product alerts", rows: 3, undated: 1 },
        { sheet: "Stats", kind: null, label: null, rows: 0, undated: 0 },
      ],
      kinds: [{ source: "product_alerts", label: "O'Reilly product alerts", rows: 3, months: [{ month: "2026-09", rows: 3, added: 2, updated: 1, removed: 1 }] }],
      added: 2,
      updated: 1,
      removed: 1,
      skippedVerified: [{ month: "2026-08", rows: 4 }],
    });
    assert.deepEqual(lines, [
      "O'Reilly product alerts: 2026-09 3 (2 new, 1 updated, 1 removed)",
      "Not recognized, ignored: Stats",
      "1 rows had no usable date and are left out.",
      "Skipped (month already verified): 2026-08 4",
    ]);
  });
});

describe("Verify report", () => {
  it("says the raw rows are deleted and asks for the PIN", () => {
    const html = renderToString(
      <DeleteReportDialog monthLabel="September 2026" title="Verify report" message={verifyReportMessage("September 2026")} confirmLabel="Verify report" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />,
    );
    assert.match(html, /deletes that month&#x27;s raw imported source rows/);
    assert.match(html, /Your 4-digit PIN/);
  });
  it("is a permission on the Roles page, not a role name", () => {
    const all = ROLE_PERMISSION_GROUPS.flatMap((group) => group.permissions);
    assert.ok(all.some((item) => item.key === "quality_report.verify"));
  });
});
