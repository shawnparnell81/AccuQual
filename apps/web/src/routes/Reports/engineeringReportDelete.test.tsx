import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { ROLE_PERMISSION_GROUPS } from "../../lib/rolePermissionSelection";
import { DeleteReportDialog, deleteReportMessage, isFourDigitPin } from "./engineeringReportDelete";

describe("Delete report confirm dialog", () => {
  it("names the month and says what is removed", () => {
    assert.equal(
      deleteReportMessage("September 2026"),
      "Delete the September 2026 Monthly Quality Report? This removes the typed text, imported supplier data, NCR table rows and pictures for that month.",
    );
    const html = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    assert.ok(html.includes("Delete the September 2026 Monthly Quality Report?"));
    assert.match(html, /Your 4-digit PIN/);
    assert.match(html, /type="password"/);
    assert.match(html, /not touched/);
  });

  it("keeps Delete report disabled until a 4-digit PIN is typed, and shows a refused PIN", () => {
    const html = renderToString(<DeleteReportDialog monthLabel="September 2026" pending={false} error="That PIN is not correct." onCancel={() => {}} onConfirm={() => {}} />);
    assert.ok(/<button[^>]*type="submit"[^>]*disabled/.test(html) || /<button[^>]*disabled[^>]*type="submit"/.test(html));
    assert.match(html, /That PIN is not correct\./);
    assert.equal(isFourDigitPin("1234"), true);
    assert.equal(isFourDigitPin("123"), false);
    assert.equal(isFourDigitPin("12a4"), false);
    assert.equal(isFourDigitPin("12345"), false);
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

  it("sends the PIN with the delete and resets the month to a fresh report", () => {
    assert.match(page, /apiClient\.delete<ReportView>\("\/reports\/engineering", \{ params: \{ year, month \}, data: \{ pin \} \}\)/);
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
