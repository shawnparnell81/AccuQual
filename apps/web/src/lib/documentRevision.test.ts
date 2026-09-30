import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentControlStandard,
  listRevisionLabel,
  revisionCodeFieldHint,
  revisionCodeFieldLabel,
  showingVersionLabel,
  versionActivityLine,
  versionRevisionNote,
} from "./documentRevision.ts";

/** Document #1 shape: a Version 1 draft exists, nothing has been published, the release ledger is empty. */
const unreleasedDraft = { currentVersion: 0, revisionCode: null, status: "draft" as const };
const openDraft = { versionNumber: 1, status: "draft", revisionCode: "Rev A" };

describe("document revision labels agree across list, header, banner, and history", () => {
  it("describes an unreleased Version 1 draft without claiming it is released or that no version exists", () => {
    assert.equal(listRevisionLabel(unreleasedDraft), "Draft — not released");
    assert.equal(
      documentControlStandard(unreleasedDraft, openDraft),
      "Not released yet · Version 1 draft (proposed Rev A) · document control",
    );
    assert.equal(showingVersionLabel(openDraft), "Showing version 1 (proposed Rev A) — draft, not released");
    assert.equal(versionRevisionNote(openDraft), "Proposed Rev A — draft, not released");
    assert.equal(revisionCodeFieldLabel("draft"), "Revision code (proposed)");
    assert.equal(revisionCodeFieldHint("draft"), "Proposed code for this draft. It is not released until this version is published.");

    const story = [
      listRevisionLabel(unreleasedDraft),
      documentControlStandard(unreleasedDraft, openDraft),
      showingVersionLabel(openDraft),
      versionRevisionNote(openDraft),
    ].join(" ");
    assert.match(story, /draft/i);
    assert.match(story, /not released/i);
    assert.doesNotMatch(listRevisionLabel(unreleasedDraft), /^Not released$/);
    assert.match(showingVersionLabel(openDraft), /proposed Rev A/);
    assert.match(showingVersionLabel(openDraft), /not released/);
  });

  it("keeps the header honest before the open draft has loaded", () => {
    assert.equal(documentControlStandard(unreleasedDraft, null), "Not released yet · draft in progress · document control");
    assert.equal(
      documentControlStandard({ currentVersion: 0, revisionCode: null, status: "in_review" }, null),
      "Not released yet · in review · document control",
    );
    assert.equal(listRevisionLabel({ currentVersion: 0, revisionCode: null, status: "in_review" }), "In review — not released");
  });

  it("uses Not released only when nothing is released and the document is not in draft or review", () => {
    assert.equal(listRevisionLabel({ currentVersion: 0, revisionCode: null, status: "obsolete" }), "Not released");
    assert.equal(
      documentControlStandard({ currentVersion: 0, revisionCode: null, status: "obsolete" }, null),
      "Not released yet · document control",
    );
  });

  it("shows the released revision once a version is published, including while a later draft is open", () => {
    const released = { currentVersion: 1, revisionCode: "Rev A", status: "approved" };
    assert.equal(listRevisionLabel(released), "Rev A (v1)");
    assert.equal(documentControlStandard(released, { versionNumber: 2, status: "draft", revisionCode: "Rev B" }), "Rev A · document control");
    assert.equal(showingVersionLabel({ versionNumber: 1, status: "published", revisionCode: "Rev A" }), "Showing version 1 (Rev A) — released");
    assert.equal(showingVersionLabel({ versionNumber: 2, status: "draft", revisionCode: "Rev B" }), "Showing version 2 (proposed Rev B) — draft, not released");
    assert.equal(versionRevisionNote({ status: "published", revisionCode: "Rev A" }), "Rev A — released");
    assert.equal(versionRevisionNote({ status: "archived", revisionCode: "Rev A" }), "Rev A — earlier revision");
    assert.equal(revisionCodeFieldLabel("published"), "Revision code");
    assert.equal(revisionCodeFieldHint("published"), null);
  });

  it("names the same person and moment on the Versions tab and in history", () => {
    assert.match(
      versionActivityLine({ status: "draft", createdAt: "2026-09-28T15:00:00.000Z", createdByName: "Shawn Parnell" }),
      /^Started .+ by Shawn Parnell$/,
    );
    assert.match(
      versionActivityLine({ status: "published", publishedAt: "2026-09-29T15:00:00.000Z", publishedByName: "Shawn Parnell", createdAt: "2026-09-28T15:00:00.000Z" }),
      /^Published .+ by Shawn Parnell$/,
    );
  });
});
