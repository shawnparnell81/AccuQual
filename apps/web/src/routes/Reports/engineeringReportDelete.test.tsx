import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { ROLE_PERMISSION_GROUPS } from "../../lib/rolePermissionSelection";
import { DeleteReportDialog, deleteReportMessage } from "./engineeringReportDelete";

describe("Delete report confirm dialog", () => {
  it("names the month and says what is removed", () => {
    assert.equal(
      deleteReportMessage("September 2026"),
      "Delete the September 2026 Monthly Quality Report? This removes the typed text, imported supplier data, NCR table rows and pictures for that month.",
    );
    const html = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    assert.ok(html.includes("Delete the September 2026 Monthly Quality Report?"));
    assert.doesNotMatch(html, /PIN/);
    assert.doesNotMatch(html, /type="password"/);
    assert.match(html, /not touched/);
  });

  it("lets Delete report be clicked right away and shows a refused delete", () => {
    const ready = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    assert.doesNotMatch(ready, /disabled=""/);
    const refused = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error="The report wasn't deleted." onCancel={() => {}} onConfirm={() => {}} />);
    assert.match(refused, /The report wasn(&#x27;|')t deleted\./);
  });

  it("is hidden from print and styled as a danger action", () => {
    const html = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    assert.match(html, /qe-no-print/);
    assert.match(html, /bg-destructive/);
  });
});

describe("Delete report button on the Monthly Quality Report", () => {
  const page = readFileSync(new URL("./EngineeringMonthlyReport.tsx", import.meta.url), "utf8").split("\r\n").join("\n");

  it("shows only with the delete permission and a saved report, next to Print and Download PDF", () => {
    assert.match(page, /reportPermissions\?\.\["quality_report\.delete"\] === "edit"/);
    assert.match(page, /canDelete && view\?\.saved/);
    const download = page.indexOf("Download PDF");
    const print = page.indexOf("            Print\n");
    const del = page.indexOf("              Delete report\n");
    assert.ok(download > 0 && print > download && del > print, "Delete report comes right after Print");
    assert.match(page, /border-destructive/);
  });

  it("sends the delete without a PIN and resets the month to a fresh report", () => {
    assert.match(page, /apiClient\.delete<ReportView>\("\/reports\/engineering", \{ params: \{ year, month \} \}\)/);
    assert.match(page, /setNarrative\(fresh\.narrative\)/);
  });
});

describe("the role permission", () => {
  it("is on the Roles page as 'Can delete monthly quality reports'", () => {
    const all = ROLE_PERMISSION_GROUPS.flatMap((group) => group.permissions);
    const found = all.find((item) => item.key === "quality_report.delete");
    assert.ok(found);
    assert.equal(found.label, "Can delete monthly quality reports");
  });
});
