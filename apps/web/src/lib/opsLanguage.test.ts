import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRIMARY_NAV,
  capaLoopIndex,
  capaNextAction,
  departmentPhrase,
  documentLoop,
  duePhrase,
  homeKind,
  isPastDue,
  lateItems,
  navSearchText,
  ncrLoopIndex,
  ncrNextAction,
  personLabel,
  plainNav,
  recordPath,
  rolePhrase,
  statusPhrase,
} from "./opsLanguage.ts";

describe("home and role language", () => {
  it("maps the seeded roles onto lead, auditor, and floor homes", () => {
    assert.equal(homeKind("quality_manager"), "lead");
    assert.equal(homeKind("admin"), "lead");
    assert.equal(homeKind("auditor"), "auditor");
    assert.equal(homeKind("operator"), "floor");
    assert.equal(homeKind(null), "floor");
  });

  it("speaks the job, and keeps the system role readable", () => {
    assert.equal(rolePhrase("quality_manager"), "Quality lead");
    assert.equal(rolePhrase("operator"), "Operator");
    assert.equal(departmentPhrase("customer_service"), "Customer service");
    assert.equal(statusPhrase("corrective_action"), "Fix in progress");
    assert.equal(statusPhrase("approved"), "Released");
  });
});

describe("nav search", () => {
  it("finds an issue by the plain name or the standard term", () => {
    assert.match(navSearchText("ncr", "NCR"), /issues/);
    assert.match(navSearchText("ncr", "NCR"), /ncr/);
    assert.equal(plainNav("capa", "CAPA").label, "Fixes");
    assert.deepEqual(
      PRIMARY_NAV.map((item) => item.key),
      ["ncr", "capa", "documents", "training", "audit"]
    );
  });
});

describe("close-the-loop copy", () => {
  it("walks an issue from containment to the check", () => {
    assert.equal(ncrLoopIndex("open"), 0);
    assert.match(ncrNextAction("open", false), /Contain/);
    assert.equal(ncrLoopIndex("contained"), 1);
    assert.match(ncrNextAction("investigating", false), /Open a fix/);
    assert.match(ncrNextAction("investigating", true), /corrective action/);
    assert.equal(ncrLoopIndex("closed"), 4);
  });

  it("walks a fix from start to the effectiveness check", () => {
    assert.equal(capaLoopIndex("open"), 0);
    assert.match(capaNextAction("in_progress"), /worked/);
    assert.match(capaNextAction("verifying"), /Close it/);
    assert.equal(capaLoopIndex("closed"), 3);
  });

  it("points a released document at training", () => {
    assert.match(documentLoop("draft", false).next, /review/);
    assert.match(documentLoop("approved", false).next, /Assign training/);
    assert.match(documentLoop("approved", true).next, /mark people complete/);
    assert.equal(documentLoop("obsolete", false).index, 4);
  });
});

describe("ownership and dates", () => {
  it("names a person when the directory has them", () => {
    const people = [{ id: 4, name: "Sam Lee", email: "sam@plant.test" }];
    assert.equal(personLabel(people, 4), "Sam Lee");
    assert.equal(personLabel(people, null), "Unassigned");
    assert.equal(personLabel(undefined, 9), "Assigned");
    assert.equal(personLabel([{ id: 2, name: "  ", email: "a@b.c" }], 2), "a@b.c");
  });

  it("treats a past calendar day as late and a closed record as finished", () => {
    assert.equal(isPastDue("2026-09-01T00:00:00.000Z", false, "2026-09-23"), true);
    assert.equal(isPastDue("2026-09-23T00:00:00.000Z", false, "2026-09-23"), false);
    assert.equal(isPastDue("2026-09-01T00:00:00.000Z", true, "2026-09-23"), false);
    assert.match(duePhrase("2026-09-01T00:00:00.000Z", false, "2026-09-23"), /^Late/);
    assert.equal(duePhrase(null, false), "No due date");
  });

  it("sorts late work by due day", () => {
    const rows = lateItems(
      [
        { who: "Sam", label: "Issue #2", link: "/ncr/2", due: "2026-09-20", terminal: false },
        { who: "Ada", label: "Fix #1", link: "/capa/1", due: "2026-09-10", terminal: false },
        { who: "Ada", label: "Issue #9", link: "/ncr/9", due: "2026-09-01", terminal: true },
      ],
      "2026-09-23"
    );
    assert.deepEqual(
      rows.map((row) => row.label),
      ["Fix #1", "Issue #2"]
    );
  });
});

describe("record paths", () => {
  it("opens the record a notice is about", () => {
    assert.equal(recordPath("DocumentVersion", 12), "/documents/12");
    assert.equal(recordPath("training", 4), "/training/4");
    assert.equal(recordPath("NCR", 8), "/ncr/8");
    assert.equal(recordPath("TrainingAssignment", 3), null);
    assert.equal(recordPath("ncr", null), null);
  });
});
