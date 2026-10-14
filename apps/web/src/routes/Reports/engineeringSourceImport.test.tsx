import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { VerifyReportDialog } from "./engineeringReportDelete";
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
  it("is a plain confirm that says the raw rows are deleted, with no PIN", () => {
    const html = renderToString(<VerifyReportDialog monthLabel="September 2026" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    assert.match(html, /Verify the September 2026 Monthly Quality Report\?/);
    assert.match(html, /deletes that month&#x27;s raw imported source rows/);
    assert.doesNotMatch(html, /PIN|type="password"/);
  });
});
