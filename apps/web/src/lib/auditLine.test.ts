import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_DETAIL_FALLBACK, formatAuditLine } from "./auditLine.ts";

test("a status change names the actor, the action, and the old and new values", () => {
  const line = formatAuditLine({
    action: "status_change",
    performedByName: "Shawn Parnell",
    changes: { action: "closed", patch: { status: "closed" } },
    fieldChanges: [
      {
        op: "UPDATE",
        changes: {
          status: { from: "corrective_action", to: "closed" },
          severity: { from: "low", to: "high" },
        },
      },
    ],
  });

  assert.equal(line.who, "Shawn Parnell");
  assert.equal(line.what, "Status changed");
  assert.match(line.description, /Status changed from Fix to closed/);
  assert.match(line.description, /Severity changed from low to high/);
  assert.doesNotMatch(line.description, /\{/);
});

test("deleting a plant records who deleted it and a plain description", () => {
  const line = formatAuditLine({
    action: "delete",
    performedByName: "Shawn Parnell",
    changes: {
      name: "Harbor",
      code: "harbor",
      summary: 'Deleted plant "Harbor" (harbor). Records that already used this plant keep the name. It no longer appears in plant lists.',
    },
  });

  assert.equal(line.who, "Shawn Parnell");
  assert.equal(line.what, "Deleted");
  assert.match(line.description, /Deleted plant "Harbor"/);
  assert.match(line.description, /keep the name/);
});

test("a delete keeps the stored summary and still says who deleted it", () => {
  const line = formatAuditLine({
    action: "delete",
    performedByName: "Sam Lee",
    changes: { summary: 'Deleted NCR #3 "Bent flange"', snapshot: { title: "Bent flange", secret: "nope" } },
  });

  assert.equal(line.who, "Sam Lee");
  assert.equal(line.what, "Deleted");
  assert.equal(line.description, 'Deleted NCR #3 "Bent flange"');
  assert.doesNotMatch(line.description, /nope/);
});

test("an older row with only an action code stays readable", () => {
  const line = formatAuditLine({ action: "update", changes: null, performedByName: null });

  assert.equal(line.who, "System");
  assert.equal(line.what, "Updated");
  assert.equal(line.description, AUDIT_DETAIL_FALLBACK);
});

test("a status change with no stored detail does not show the raw action code", () => {
  const line = formatAuditLine({ action: "status_change", changes: null, performedByName: "Pat Kim <pat@plant.example>" });

  assert.equal(line.who, "Pat Kim <pat@plant.example>");
  assert.equal(line.what, "Status changed");
  assert.equal(line.description, AUDIT_DETAIL_FALLBACK);
  assert.doesNotMatch(line.what, /status_change/);
});

test("an update written as a patch, before field diffs existed, names the fields", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    changes: { title: "Cracked housing", severity: "high", answers: { section: { a: 1, b: [2, 3] } }, password: "secret123" },
  });

  assert.equal(line.what, "Updated");
  assert.match(line.description, /Title set to "Cracked housing"/);
  assert.match(line.description, /Severity set to high/);
  assert.match(line.description, /Section changed/);
  assert.doesNotMatch(line.description, /secret123/);
  assert.doesNotMatch(line.description, /\{/);
});

test("a form section names the fields inside it", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    fieldChanges: [
      {
        op: "UPDATE",
        changes: {
          answers: {
            from: { severity: "low", note: "Old note" },
            to: { severity: "high", note: "Old note", disposition: "scrap" },
          },
        },
      },
    ],
  });

  assert.match(line.description, /Severity changed from low to high/);
  assert.match(line.description, /Disposition set to scrap/);
  assert.doesNotMatch(line.description, /Old note/);
  assert.doesNotMatch(line.description, /\{/);
});

test("a create lists identifying fields and skips the rest of the inserted row", () => {
  const line = formatAuditLine({
    action: "create",
    performedByName: "Shawn Parnell",
    fieldChanges: [
      {
        op: "INSERT",
        changes: {
          title: { to: "Bent flange" },
          status: { to: "open" },
          internal_notes: { to: "not the headline" },
          created_by: { to: 4 },
        },
      },
    ],
  });

  assert.equal(line.what, "Created");
  assert.match(line.description, /Title set to "Bent flange"/);
  assert.match(line.description, /Status set to open/);
  assert.doesNotMatch(line.description, /not the headline/);
  assert.doesNotMatch(line.description, /Created by/);
});

test("uploading a file reads as an attachment, not an action code", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    changes: { action: "upload_certificate", filename: "cal-cert.pdf" },
  });

  assert.equal(line.what, "Attached file");
  assert.match(line.description, /File "cal-cert\.pdf"/);
  assert.doesNotMatch(line.description, /upload_certificate/);
});

test("publishing names the version and does not print the diff object", () => {
  const line = formatAuditLine({
    action: "status_change",
    performedByName: "Shawn Parnell",
    changes: { event: "published", version: 3, replaced: 2, changes: { added: ["purpose"], removed: [] } },
  });

  assert.equal(line.what, "Published");
  assert.equal(line.description, "Published version 3, replacing version 2.");
});

test("a blocked change quotes the reason and the role already stored on the row", () => {
  const line = formatAuditLine({
    action: "permission_denied",
    performedByName: "Pat Kim",
    changes: {
      message: "Permission denied for workflow transition",
      attemptedTransition: "POST /ncr/5/close",
      userRole: "operator",
      userDepartment: "production",
    },
  });

  assert.equal(line.what, "Change blocked");
  assert.match(line.description, /Tried POST \/ncr\/5\/close/);
  assert.match(line.description, /Permission denied for workflow transition/);
  assert.match(line.description, /role operator/);
  assert.match(line.description, /department production/);
});

test("a failed change uses the error text", () => {
  const line = formatAuditLine({
    action: "transition_failed",
    performedByName: "Shawn Parnell",
    changes: { errorMessage: 'Cannot "close" an NCR from status "open"', attemptedTransition: "POST /ncr/5/close" },
  });

  assert.equal(line.what, "Change failed");
  assert.match(line.description, /Cannot "close" an NCR from status "open"/);
});

test("a hidden value is described without revealing it", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    fieldChanges: [{ op: "UPDATE", changes: { comment: { from: "[redacted]", to: "[redacted]" } } }],
  });

  assert.match(line.description, /Comment changed \(value hidden\)/);
  assert.doesNotMatch(line.description, /\[redacted\]/);
});

test("a suggestion decision does not repeat a model label stored on the row", () => {
  const line = formatAuditLine({
    action: "decision",
    performedByName: "Shawn Parnell",
    changes: { decision: "accepted", aiState: "AI-suggestion accepted", pipeline: "form" },
  });

  assert.equal(line.what, "Decision recorded");
  assert.equal(line.description, "Accepted the suggestion.");
  assert.doesNotMatch(line.description, /\bAI\b/);
});

test("a long field list stays short and points at the rest", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    fieldChanges: [
      {
        op: "UPDATE",
        changes: {
          title: { from: "Old", to: "New" },
          severity: { from: "low", to: "high" },
          containment: { from: "empty", to: "Quarantine the lot" },
          root_cause: { from: "empty", to: "Worn fixture" },
          corrective_action: { from: "empty", to: "Replace the fixture" },
        },
      },
    ],
  });

  assert.match(line.description, /Title changed from Old to New/);
  assert.match(line.description, /1 more field changed/);
  assert.doesNotMatch(line.description, /Replace the fixture/);
});

test("a form save names the fields that were sent, without the internal source flag", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    changes: { fieldsChanged: ["description", "severity"], source: "form" },
  });

  assert.equal(line.description, "Changed description and severity.");
});

test("a sign-in row names the method and does not show the address or browser hash", () => {
  const line = formatAuditLine({
    action: "status_change",
    performedByName: "Pat Kim",
    changes: {
      action: "login",
      method: "password",
      ipHash: "abc123secretaddress",
      userAgentHash: "browserhashvalue",
    },
  });

  assert.equal(line.who, "Pat Kim");
  assert.equal(line.what, "Signed in");
  assert.match(line.description, /Signed in with a password/);
  assert.doesNotMatch(line.description, /abc123secretaddress/);
  assert.doesNotMatch(line.description, /browserhashvalue/);
});

test("a moved hold names the locations instead of calling them a status", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    changes: { event: "quarantine_moved", from: "Receiving", to: "Cage A", quantity: 4 },
  });

  assert.equal(line.what, "Updated");
  assert.match(line.description, /Moved from Receiving to "Cage A"/);
  assert.match(line.description, /Quantity set to 4/);
});

test("a folder move names who moved it and the path it left and joined", () => {
  const line = formatAuditLine({
    action: "update",
    performedByName: "Shawn Parnell",
    changes: {
      event: "moved",
      summary: 'Moved the folder "Quality" from ISO Compliance Documents\\Quality → ISO Compliance Documents\\Quality Logs\\Quality.',
      fromParentId: 1,
      toParentId: 8,
    },
  });

  assert.equal(line.who, "Shawn Parnell");
  assert.equal(line.what, "Moved");
  assert.equal(line.description, 'Moved the folder "Quality" from ISO Compliance Documents\\Quality → ISO Compliance Documents\\Quality Logs\\Quality.');
  assert.doesNotMatch(line.description, /fromParentId|toParentId/);
});
